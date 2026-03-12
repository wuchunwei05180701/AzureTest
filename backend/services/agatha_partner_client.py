"""
Agatha Partner API Client
透過 X-API-Key 認證呼叫 Agatha SaaS Partner API
"""
import logging
from typing import AsyncIterator, Dict, List, Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=settings.AGATHA_PARTNER_API_URL,
            timeout=httpx.Timeout(settings.AGATHA_API_TIMEOUT, connect=10.0),
            verify=False,
            headers={
                "X-API-Key": settings.AGATHA_API_KEY,
                "User-Agent": "AzureTest-Portal/1.0",
            },
        )
    return _client


async def list_agents() -> List[Dict]:
    """GET /agents — 取得 Partner 可見的 Agent 列表"""
    client = _get_client()
    resp = await client.get("/agents")
    resp.raise_for_status()
    data = resp.json()
    return data.get("agents", [])


async def get_agent(agent_id: str) -> Optional[Dict]:
    """GET /agents/{agent_id} — 取得單一 Agent 詳情"""
    client = _get_client()
    resp = await client.get(f"/agents/{agent_id}")
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


async def create_session(agent_id: str, external_user_id: str = "", metadata: Optional[Dict] = None) -> Dict:
    """POST /sessions — 建立聊天 Session"""
    client = _get_client()
    payload = {"agent_id": agent_id, "external_user_id": external_user_id}
    if metadata:
        payload["metadata"] = metadata
    resp = await client.post("/sessions", json=payload)
    resp.raise_for_status()
    return resp.json()


async def chat_stream(session_id: str, message: str, images: Optional[List[str]] = None) -> httpx.Response:
    """POST /sessions/{session_id}/chat — SSE 串流聊天（回傳 raw response 供 caller 處理 SSE）"""
    client = _get_client()
    payload = {"message": message, "stream": True}
    if images:
        payload["images"] = images
    return await client.send(
        client.build_request("POST", f"/sessions/{session_id}/chat", json=payload),
        stream=True,
    )


async def get_messages(session_id: str) -> List[Dict]:
    """GET /sessions/{session_id}/messages — 取得訊息歷史"""
    client = _get_client()
    resp = await client.get(f"/sessions/{session_id}/messages")
    resp.raise_for_status()
    data = resp.json()
    return data.get("messages", [])


async def close_session(session_id: str) -> None:
    """DELETE /sessions/{session_id} — 關閉 Session"""
    client = _get_client()
    resp = await client.delete(f"/sessions/{session_id}")
    resp.raise_for_status()


async def health_check() -> Dict:
    """GET /health — 健康檢查"""
    client = _get_client()
    resp = await client.get("/health")
    resp.raise_for_status()
    return resp.json()
