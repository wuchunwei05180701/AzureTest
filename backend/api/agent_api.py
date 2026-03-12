"""
Agent API：透過 Agatha Partner API 取得 Agent 列表
"""
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from config import settings
from core.security import get_current_user_payload
from models.schemas import AgentResponse
from services import agatha_partner_client

logger = logging.getLogger(__name__)
router = APIRouter()


def _resolve_icon_url(icon: str | None, icon_type: str | None) -> str | None:
    """將相對路徑的 icon 轉為完整 URL"""
    if not icon:
        return None
    if icon_type == "image_url" and icon.startswith("/"):
        return f"{settings.AGATHA_API_BASE_URL}{icon}"
    return icon


def _partner_agent_to_response(agent: dict) -> AgentResponse:
    """將 Partner API 回傳的 agent dict 轉為 AgentResponse"""
    icon_type = agent.get("icon_type")
    return AgentResponse(
        agent_id=agent.get("agent_id", ""),
        name=agent.get("name", ""),
        agent_config_json={
            "agent_type": agent.get("agent_type", ""),
            "capabilities": agent.get("capabilities", {}),
            "agatha_enabled": True,
        },
        icon=_resolve_icon_url(agent.get("icon"), icon_type),
        icon_type=icon_type,
        color=None,
        description=agent.get("description"),
        is_published=True,
    )


@router.get("", response_model=List[AgentResponse])
async def list_agents(payload: dict = Depends(get_current_user_payload)):
    """取得可用 Agent 列表（從 Agatha Partner API）"""
    try:
        agents = await agatha_partner_client.list_agents()
        return [_partner_agent_to_response(a) for a in agents]
    except Exception as e:
        logger.error(f"❌ Partner API 取得 Agent 列表失敗: {e}")
        raise HTTPException(status_code=502, detail=f"無法連接 Agatha 服務: {e}")


@router.get("/all", response_model=List[AgentResponse])
async def list_all_agents(payload: dict = Depends(get_current_user_payload)):
    """取得所有 Agent（管理用，同樣從 Partner API）"""
    return await list_agents(payload)
