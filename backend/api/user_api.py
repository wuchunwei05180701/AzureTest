"""
使用者管理 API：CRUD + 角色指派 + 停用/啟用
國家隔離：非 root 只能看到/操作自己國家的使用者
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, update, delete, func

from config import settings
from core.database import GlobalSessionLocal
from core.permissions import (
    Role,
    require_permission,
    validate_role_operation,
    get_assignable_roles,
    get_role_level,
)
from models.global_models import UserRouteMap
from models.schemas import (
    MessageResponse,
    UserCreate,
    UserListResponse,
    UserRoleUpdate,
    UserStatusUpdate,
    UserUpdate,
)
from utils.audit_logger import audit_log, AuditAction

logger = logging.getLogger(__name__)
router = APIRouter()


def _resolve_country_filter(payload: dict, query_country: Optional[str] = None) -> Optional[str]:
    """
    解析國家篩選條件：
    - root / admin：可指定任意國家，或不指定（看全部）
    - 其他角色：強制只看自己國家
    """
    user_country = payload.get("country", "TW")
    role = payload.get("role", "user")

    if role in ("root", "admin"):
        # root / admin 可以指定國家，也可以不指定（看全部）
        if query_country:
            if query_country not in settings.LOCAL_DB_CONFIG:
                raise HTTPException(status_code=400, detail=f"國家 [{query_country}] 不存在")
            return query_country
        return None  # None = 不篩選，看全部
    else:
        # user 強制只看自己國家（理論上 user 沒有 manage_users 權限，不會進到這裡）
        return user_country


@router.get("/assignable-roles")
async def get_assignable_roles_api(
    payload: dict = Depends(require_permission("manage_users")),
):
    """取得當前使用者可指派的角色列表"""
    operator_role = payload.get("role", "user")
    return get_assignable_roles(operator_role)


@router.get("", response_model=List[UserListResponse])
async def list_users(
    role: Optional[str] = Query(None, description="篩選角色"),
    country: Optional[str] = Query(None, description="篩選國家"),
    status: Optional[str] = Query(None, description="篩選狀態"),
    search: Optional[str] = Query(None, description="搜尋姓名或 Email"),
    payload: dict = Depends(require_permission("manage_users")),
):
    """取得使用者列表（國家隔離）"""
    # 解析國家篩選
    country_filter = _resolve_country_filter(payload, country)

    async with GlobalSessionLocal() as session:
        query = select(UserRouteMap)

        # 國家隔離：非 root 強制篩選自己國家
        if country_filter:
            query = query.where(UserRouteMap.country_code == country_filter)

        if role:
            query = query.where(UserRouteMap.role == role)
        if status:
            query = query.where(UserRouteMap.status == status)
        if search:
            query = query.where(
                (UserRouteMap.name.ilike(f"%{search}%")) |
                (UserRouteMap.email.ilike(f"%{search}%"))
            )

        query = query.order_by(UserRouteMap.created_at.desc())
        result = await session.execute(query)
        users = result.scalars().all()

    return [
        UserListResponse(
            email=u.email,
            name=u.name,
            department=u.department,
            country=u.country_code,
            role=u.role,
            status=u.status,
            last_login_at=u.last_login_at,
            created_at=u.created_at,
        )
        for u in users
    ]


@router.post("", response_model=MessageResponse)
async def create_user(
    body: UserCreate,
    request: Request,
    payload: dict = Depends(require_permission("manage_users")),
):
    """新增使用者"""
    email = body.email.lower()
    operator_email = payload.get("sub", "")
    operator_role = payload.get("role", "user")
    operator_country = payload.get("country", "TW")

    # 驗證角色值
    try:
        Role(body.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"無效的角色: {body.role}")

    # 驗證國家是否存在於 LOCAL_DB_CONFIG
    if body.country not in settings.LOCAL_DB_CONFIG:
        raise HTTPException(status_code=400, detail=f"國家 [{body.country}] 尚未設定 Local DB")

    # 階層檢查：不能建立角色 >= 自己的使用者
    validate_role_operation(
        operator_role=operator_role,
        target_current_role=body.role,  # 新使用者的角色視為目標角色
        target_new_role=body.role,
    )

    async with GlobalSessionLocal() as session:
        # 檢查是否已存在
        existing = await session.execute(
            select(UserRouteMap).where(UserRouteMap.email == email)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="此 Email 已存在")

        new_user = UserRouteMap(
            email=email,
            name=body.name,
            department=body.department,
            country_code=body.country,
            role=body.role,
            status="active",
        )
        session.add(new_user)
        await session.commit()

    logger.info(f"使用者已建立: {email} (角色: {body.role}, 國家: {body.country})")
    audit_log(
        action=AuditAction.USER_CREATE,
        operator_email=operator_email,
        country_code=operator_country,
        target=email,
        details={"role": body.role, "country": body.country, "name": body.name},
        request=request,
    )
    return MessageResponse(message="使用者已建立", detail=email)


@router.put("/{email}", response_model=MessageResponse)
async def update_user(
    email: str,
    body: UserUpdate,
    request: Request,
    payload: dict = Depends(require_permission("manage_users")),
):
    """編輯使用者"""
    operator_role = payload.get("role", "user")
    operator_email = payload.get("sub", "")
    operator_country = payload.get("country", "TW")

    # 先查詢目標使用者的當前角色
    async with GlobalSessionLocal() as session:
        target_user = await session.execute(
            select(UserRouteMap).where(UserRouteMap.email == email.lower())
        )
        target = target_user.scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=404, detail="使用者不存在")

        # 國家隔離：非 root 不能編輯其他國家的使用者
        if operator_role != "root" and target.country_code != operator_country:
            raise HTTPException(status_code=403, detail="權限不足：無法編輯其他國家的使用者")

        # 階層檢查：不能編輯自己、不能編輯等級 >= 自己的使用者
        validate_role_operation(
            operator_role=operator_role,
            target_current_role=target.role,
            target_new_role=body.role if body.role else None,
            operator_email=operator_email,
            target_email=email,
        )
        old_role = target.role

    update_data = {}
    if body.name is not None:
        update_data["name"] = body.name
    if body.department is not None:
        update_data["department"] = body.department
    if body.country is not None:
        # 驗證國家是否存在於 LOCAL_DB_CONFIG
        if body.country not in settings.LOCAL_DB_CONFIG:
            raise HTTPException(status_code=400, detail=f"國家 [{body.country}] 尚未設定 Local DB")
        # root 和 admin 皆可設定任意國家
        update_data["country_code"] = body.country
    if body.role is not None:
        try:
            Role(body.role)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"無效的角色: {body.role}")
        update_data["role"] = body.role

    if not update_data:
        raise HTTPException(status_code=400, detail="沒有要更新的欄位")

    update_data["updated_at"] = datetime.now(timezone.utc)

    async with GlobalSessionLocal() as session:
        result = await session.execute(
            update(UserRouteMap)
            .where(UserRouteMap.email == email.lower())
            .values(**update_data)
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="使用者不存在")
        await session.commit()

    audit_log(
        action=AuditAction.USER_UPDATE,
        operator_email=operator_email,
        country_code=operator_country,
        target=email.lower(),
        details={k: v for k, v in update_data.items() if k != "updated_at"},
        request=request,
    )
    return MessageResponse(message="使用者已更新", detail=email)


@router.patch("/{email}/status", response_model=MessageResponse)
async def update_user_status(
    email: str,
    body: UserStatusUpdate,
    request: Request,
    payload: dict = Depends(require_permission("manage_users")),
):
    """停用/啟用帳號"""
    operator_role = payload.get("role", "user")
    operator_email = payload.get("sub", "")
    operator_country = payload.get("country", "TW")

    # 先查詢目標使用者的當前角色
    async with GlobalSessionLocal() as session:
        target_user = await session.execute(
            select(UserRouteMap).where(UserRouteMap.email == email.lower())
        )
        target = target_user.scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=404, detail="使用者不存在")

        # 國家隔離：非 root 不能操作其他國家的使用者
        if operator_role != "root" and target.country_code != operator_country:
            raise HTTPException(status_code=403, detail="權限不足：無法操作其他國家的使用者")

        # 階層檢查：不能停用自己、不能停用等級 >= 自己的使用者
        validate_role_operation(
            operator_role=operator_role,
            target_current_role=target.role,
            operator_email=operator_email,
            target_email=email,
        )
        old_status = target.status

        # 執行更新
        await session.execute(
            update(UserRouteMap)
            .where(UserRouteMap.email == email.lower())
            .values(status=body.status, updated_at=datetime.now(timezone.utc))
        )
        await session.commit()

    action_label = "啟用" if body.status == "active" else "停用"
    audit_log(
        action=AuditAction.USER_STATUS_CHANGE,
        operator_email=operator_email,
        country_code=operator_country,
        target=email.lower(),
        details={"status_from": old_status, "status_to": body.status},
        request=request,
    )
    return MessageResponse(message=f"帳號已{action_label}", detail=email)


@router.patch("/{email}/role", response_model=MessageResponse)
async def update_user_role(
    email: str,
    body: UserRoleUpdate,
    request: Request,
    payload: dict = Depends(require_permission("manage_users")),
):
    """角色指派"""
    operator_role = payload.get("role", "user")
    operator_email = payload.get("sub", "")
    operator_country = payload.get("country", "TW")

    try:
        Role(body.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"無效的角色: {body.role}")

    # 先查詢目標使用者的當前角色
    async with GlobalSessionLocal() as session:
        target_user = await session.execute(
            select(UserRouteMap).where(UserRouteMap.email == email.lower())
        )
        target = target_user.scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=404, detail="使用者不存在")

        # 國家隔離：非 root 不能操作其他國家的使用者
        if operator_role != "root" and target.country_code != operator_country:
            raise HTTPException(status_code=403, detail="權限不足：無法操作其他國家的使用者")

        # 階層檢查：不能改自己、不能改等級 >= 自己的人、不能指派 >= 自己的角色
        validate_role_operation(
            operator_role=operator_role,
            target_current_role=target.role,
            target_new_role=body.role,
            operator_email=operator_email,
            target_email=email,
        )
        old_role = target.role

        # 執行更新
        await session.execute(
            update(UserRouteMap)
            .where(UserRouteMap.email == email.lower())
            .values(role=body.role, updated_at=datetime.now(timezone.utc))
        )
        await session.commit()

    audit_log(
        action=AuditAction.USER_ROLE_CHANGE,
        operator_email=operator_email,
        country_code=operator_country,
        target=email.lower(),
        details={"role_from": old_role, "role_to": body.role},
        request=request,
    )
    return MessageResponse(message="角色已更新", detail=f"{email} → {body.role}")


@router.delete("/{email}", response_model=MessageResponse)
async def delete_user(
    email: str,
    request: Request,
    payload: dict = Depends(require_permission("manage_users")),
):
    """永久刪除使用者（硬刪除）"""
    operator_role = payload.get("role", "user")
    operator_email = payload.get("sub", "")
    operator_country = payload.get("country", "TW")

    email = email.lower()

    # 先查詢目標使用者
    async with GlobalSessionLocal() as session:
        target_user = await session.execute(
            select(UserRouteMap).where(UserRouteMap.email == email)
        )
        target = target_user.scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=404, detail="使用者不存在")

        # 國家隔離：非 root 不能刪除其他國家的使用者
        if operator_role != "root" and target.country_code != operator_country:
            raise HTTPException(status_code=403, detail="權限不足：無法刪除其他國家的使用者")

        # 階層檢查：不能刪自己、不能刪等級 >= 自己的使用者
        validate_role_operation(
            operator_role=operator_role,
            target_current_role=target.role,
            operator_email=operator_email,
            target_email=email,
        )

        target_country = target.country_code
        target_role = target.role

        # 從 Global DB 硬刪除
        await session.execute(
            delete(UserRouteMap).where(UserRouteMap.email == email)
        )
        await session.commit()

    # 清理 Local DB 的 OTP 紀錄
    try:
        from core.data_router import data_router
        from models.local_models import OTPVault
        local_session = await data_router.get_local_pg(target_country)
        try:
            await local_session.execute(
                delete(OTPVault).where(OTPVault.email == email)
            )
            await local_session.commit()
        finally:
            await local_session.close()
    except Exception as e:
        logger.warning(f"清理 OTP 紀錄失敗（非致命）: {e}")

    logger.info(f"使用者已永久刪除: {email} (操作者: {operator_email})")
    audit_log(
        action=AuditAction.USER_DELETE,
        operator_email=operator_email,
        country_code=operator_country,
        target=email,
        details={"deleted_role": target_role, "deleted_country": target_country},
        request=request,
    )
    return MessageResponse(message="使用者已永久刪除", detail=email)
