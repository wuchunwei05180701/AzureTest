"""
Agent API：列表/上架/下架/ACL 管理
"""
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, update

from core.database import GlobalSessionLocal
from core.permissions import has_permission, require_permission
from core.security import get_current_user_payload
from models.global_models import AgentACL, AgentMaster
from models.schemas import AgentACLInfo, AgentACLUpdate, AgentPublishUpdate, AgentResponse, MessageResponse
from utils.audit_logger import audit_log, AuditAction

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("", response_model=List[AgentResponse])
async def list_agents(payload: dict = Depends(get_current_user_payload)):
    """
    取得可用 Agent 列表（所有角色都依 ACL 過濾，包括 root）
    - 只有在 ACL 的 authorized_users 或 authorized_roles 中的使用者才能看到
    - 沒有 ACL 記錄的 Agent 不會顯示給任何人
    """
    email = payload["sub"]
    role = payload.get("role", "user")

    async with GlobalSessionLocal() as session:
        # 取得所有已上架 Agent
        result = await session.execute(
            select(AgentMaster).where(AgentMaster.is_published == True)
        )
        all_agents = result.scalars().all()

        # 所有角色都需要檢查 ACL（包括 root / admin）
        authorized_agents = []
        for agent in all_agents:
            acl_result = await session.execute(
                select(AgentACL).where(AgentACL.agent_id == agent.agent_id)
            )
            acl = acl_result.scalar_one_or_none()

            if acl and _check_acl(acl.allowed_users, email, role):
                authorized_agents.append(agent)

        return [_agent_to_response(a) for a in authorized_agents]


@router.get("/all", response_model=List[AgentResponse])
async def list_all_agents(
    payload: dict = Depends(require_permission("manage_agent_permissions")),
):
    """取得所有 Agent（管理用，含未上架），包含 ACL 資訊"""
    async with GlobalSessionLocal() as session:
        result = await session.execute(
            select(AgentMaster).order_by(AgentMaster.created_at.desc())
        )
        agents = result.scalars().all()

        # 批次查詢所有 ACL
        acl_result = await session.execute(select(AgentACL))
        acl_map = {str(acl.agent_id): acl.allowed_users for acl in acl_result.scalars().all()}

    return [_agent_to_response(a, acl_map.get(str(a.agent_id))) for a in agents]


@router.put("/{agent_id}/publish", response_model=MessageResponse)
async def update_publish_status(
    agent_id: str,
    body: AgentPublishUpdate,
    request: Request,
    payload: dict = Depends(require_permission("manage_agent_permissions")),
):
    """上架/下架 Agent"""
    operator_email = payload.get("sub", "")
    operator_country = payload.get("country", "TW")

    # 先查詢 Agent 名稱（用於日誌）
    agent_name = agent_id
    async with GlobalSessionLocal() as session:
        agent_result = await session.execute(
            select(AgentMaster).where(AgentMaster.agent_id == agent_id)
        )
        agent = agent_result.scalar_one_or_none()
        if agent:
            agent_name = agent.name

        result = await session.execute(
            update(AgentMaster)
            .where(AgentMaster.agent_id == agent_id)
            .values(is_published=body.is_published)
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Agent 不存在")
        await session.commit()

    action_label = "上架" if body.is_published else "下架"
    audit_log(
        action=AuditAction.AGENT_PUBLISH if body.is_published else AuditAction.AGENT_UNPUBLISH,
        operator_email=operator_email,
        country_code=operator_country,
        target=agent_id,
        details={"agent_name": agent_name, "is_published": body.is_published},
        request=request,
    )
    return MessageResponse(message=f"Agent 已{action_label}")


@router.put("/{agent_id}/acl", response_model=MessageResponse)
async def update_agent_acl(
    agent_id: str,
    body: AgentACLUpdate,
    request: Request,
    payload: dict = Depends(require_permission("manage_agent_permissions")),
):
    """更新 Agent 授權規則"""
    operator_email = payload.get("sub", "")
    operator_country = payload.get("country", "TW")

    # 驗證 authorized_users 不超過 50
    if len(body.authorized_users) > 50:
        raise HTTPException(status_code=400, detail="授權使用者不可超過 50 人")

    acl_data = {
        "authorized_roles": body.authorized_roles,
        "authorized_users": body.authorized_users,
        "exception_list": body.exception_list,
    }

    agent_name = agent_id
    async with GlobalSessionLocal() as session:
        # 檢查 Agent 是否存在
        agent_result = await session.execute(
            select(AgentMaster).where(AgentMaster.agent_id == agent_id)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent 不存在")
        agent_name = agent.name

        # 更新或建立 ACL
        acl_result = await session.execute(
            select(AgentACL).where(AgentACL.agent_id == agent_id)
        )
        existing_acl = acl_result.scalar_one_or_none()

        if existing_acl:
            await session.execute(
                update(AgentACL)
                .where(AgentACL.agent_id == agent_id)
                .values(allowed_users=acl_data)
            )
        else:
            new_acl = AgentACL(agent_id=agent_id, allowed_users=acl_data)
            session.add(new_acl)

        await session.commit()

    audit_log(
        action=AuditAction.AGENT_ACL_UPDATE,
        operator_email=operator_email,
        country_code=operator_country,
        target=agent_id,
        details={
            "agent_name": agent_name,
            "authorized_roles": body.authorized_roles,
            "authorized_users_count": len(body.authorized_users),
            "exception_list_count": len(body.exception_list),
        },
        request=request,
    )
    return MessageResponse(message="Agent 授權規則已更新")


# === 內部工具函式 ===

def _agent_to_response(agent: AgentMaster, acl_data: dict = None) -> AgentResponse:
    acl_info = None
    if acl_data:
        acl_info = AgentACLInfo(
            authorized_roles=acl_data.get("authorized_roles", []),
            authorized_users=acl_data.get("authorized_users", []),
            exception_list=acl_data.get("exception_list", []),
        )

    return AgentResponse(
        agent_id=str(agent.agent_id),
        name=agent.name,
        agent_config_json=agent.agent_config_json or {},
        icon=agent.icon,
        color=agent.color,
        description=agent.description,
        is_published=agent.is_published,
        acl=acl_info,
    )


def _check_acl(acl_data: dict, email: str, role: str) -> bool:
    """
    檢查使用者是否通過 ACL 授權
    1. exception_list 排除
    2. authorized_users 包含
    3. authorized_roles 包含
    """
    if not acl_data:
        return False

    exception_list = acl_data.get("exception_list", [])
    if email in exception_list:
        return False

    authorized_users = acl_data.get("authorized_users", [])
    if email in authorized_users:
        return True

    authorized_roles = acl_data.get("authorized_roles", [])
    if role in authorized_roles:
        return True

    return False
