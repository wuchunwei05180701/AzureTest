"""
對話 API：整合 Agatha Public API（支援 Streaming SSE + 非 Streaming fallback）
+ 對話歷史管理（Session + Message 雙 Collection）

MongoDB Collections（Portal 專用 DB）：
  - ctbc_portal_sessions: 對話 Session
  - ctbc_portal_messages: 每條訊息

Agatha Public API 端點：
  POST https://uat.heph-ai.net/agatha/public/api/public-api-keys/chat

流程：
  前端 POST /api/chat/stream
    → 後端嘗試 streaming → Agatha API
    → 如果 streaming 失敗，fallback 到非 streaming
    → SSE 回傳給前端 + 存入 Portal MongoDB
"""
import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from config import settings
from core.database import GlobalSessionLocal
from core.portal_mongo import get_sessions_collection, get_messages_collection
from core.permissions import require_permission
from core.security import get_current_user_payload
from services.pii_service import get_pii_service
from utils.audit_logger import audit_log, AuditAction
from models.global_models import AgentMaster
from models.schemas import (
    ChatCreate,
    ChatHistoryItem,
    ChatResponse,
    ChatStreamCreate,
    MessageResponse,
    SessionDetailResponse,
    SessionListResponse,
    SessionMessageItem,
    SessionSummary,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Agatha Public API 的 httpx 客戶端（模組級別，重複使用）
_agatha_client: httpx.AsyncClient | None = None


def _get_agatha_client() -> httpx.AsyncClient:
    """取得或建立 Agatha API 的 httpx 客戶端"""
    global _agatha_client
    if _agatha_client is None or _agatha_client.is_closed:
        _agatha_client = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.AGATHA_API_TIMEOUT, connect=10.0),
            verify=False,
            headers={
                "User-Agent": "CTBC-AI-Portal/1.0",
                "Accept": "application/json",
            },
        )
    return _agatha_client


# ============================================================
# 工具函式
# ============================================================


async def _get_agent_name(agent_id: str) -> str:
    """從 AgentMaster 查詢 Agent 名稱"""
    try:
        async with GlobalSessionLocal() as session:
            result = await session.execute(
                select(AgentMaster.name).where(
                    AgentMaster.agent_id == UUID(agent_id)
                )
            )
            name = result.scalar_one_or_none()
            return name or f"Agent {agent_id[:8]}"
    except Exception:
        return f"Agent {agent_id[:8]}"


async def _save_to_portal(
    email: str,
    country: str,
    agent_id: str,
    agent_name: str,
    user_message: str,
    assistant_message: str,
    session_id: str | None = None,
    thread_id: str | None = None,
    images: list | None = None,
) -> str:
    """
    將對話存入 Portal MongoDB（雙 Collection）

    - session_id 為 None → 建新 session
    - session_id 有值 → 追加到現有 session

    回傳 session_id
    """
    sessions_col = get_sessions_collection()
    messages_col = get_messages_collection()

    if sessions_col is None or messages_col is None:
        logger.warning("⚠️ Portal MongoDB 未連線，跳過對話儲存")
        return session_id or ""

    now = datetime.now(timezone.utc)

    if not session_id:
        # === 新對話 ===
        session_id = f"sess-{uuid4().hex}"
        await sessions_col.insert_one({
            "session_id": session_id,
            "user_email": email,
            "country": country,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "thread_id": thread_id,
            "title": user_message[:50],
            "message_count": 2,
            "last_message_preview": assistant_message[:100],
            "created_at": now,
            "updated_at": now,
        })
        logger.info(f"✅ 新對話已建立: session_id={session_id}")
    else:
        # === 追加到現有對話 ===
        update_fields = {
            "updated_at": now,
            "last_message_preview": assistant_message[:100],
        }
        if thread_id:
            update_fields["thread_id"] = thread_id

        await sessions_col.update_one(
            {"session_id": session_id},
            {
                "$set": update_fields,
                "$inc": {"message_count": 2},
            },
        )
        logger.info(f"✅ 對話已追加: session_id={session_id}")

    # 插入兩條訊息（assistant 時間戳 +1ms，確保排序正確）
    user_msg_doc = {
        "session_id": session_id,
        "role": "user",
        "content": user_message,
        "created_at": now,
    }
    # 如果有圖片，記錄圖片數量（不存 base64 原始資料以節省空間）
    if images:
        user_msg_doc["metadata"] = {
            "image_count": len(images),
            "has_images": True,
        }

    await messages_col.insert_many([
        user_msg_doc,
        {
            "session_id": session_id,
            "role": "assistant",
            "content": assistant_message,
            "created_at": now + timedelta(milliseconds=1),
        },
    ])

    return session_id


def _sse_json(data: dict) -> str:
    """將 dict 轉為 SSE data 行"""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# ============================================================
# Streaming 聊天端點（主要功能）
# ============================================================


@router.post("/stream")
async def chat_stream(
    request: Request,
    body: ChatStreamCreate,
    payload: dict = Depends(get_current_user_payload),
):
    """
    Streaming 聊天端點

    根據 Agent 的 agent_config_json 判斷走哪條路：
    - agatha_enabled=True → 呼叫 Agatha Public API（streaming + fallback）
    - 其他 → 回傳 mock 回覆

    前端收到的 SSE 事件格式：
      data: {"type":"content","data":"片段","accumulated":"累積內容"}
      data: {"type":"complete","content":"完整回覆","thread_id":"resp_xxx","session_id":"sess-xxx"}
      data: {"type":"error","message":"錯誤訊息"}
      data: [DONE]
    """
    email = payload["sub"]
    country = payload.get("country", "TW")

    # 查詢 Agent 設定，判斷是否啟用 Agatha
    agatha_enabled = False
    agent_name = ""
    try:
        async with GlobalSessionLocal() as session:
            result = await session.execute(
                select(AgentMaster).where(
                    AgentMaster.agent_id == UUID(body.agent_id)
                )
            )
            agent = result.scalar_one_or_none()
            if agent:
                agent_name = agent.name or ""
                if isinstance(agent.agent_config_json, dict):
                    agatha_enabled = agent.agent_config_json.get("agatha_enabled", False)
    except Exception as e:
        logger.warning(f"⚠️ 查詢 Agent 設定失敗: {e}, 將使用 mock 回覆")

    if not agent_name:
        agent_name = await _get_agent_name(body.agent_id)

    # 如果啟用 Agatha，檢查 API Key
    if agatha_enabled and not settings.AGATHA_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Agatha API Key 尚未設定，請聯繫管理員",
        )

    # 如果是延續對話，從 session 取出 thread_id
    existing_thread_id = body.session_id  # 向後相容：舊前端可能傳 thread_id
    if body.session_id and body.session_id.startswith("sess-"):
        # 新格式：session_id，需要查 MongoDB 取 thread_id
        sessions_col = get_sessions_collection()
        if sessions_col is not None:
            doc = await sessions_col.find_one({"session_id": body.session_id})
            if doc:
                existing_thread_id = doc.get("thread_id")
            else:
                existing_thread_id = None

    # 提取圖片列表
    images = body.images or []
    if images:
        logger.info(f"📸 收到 {len(images)} 張圖片")

    logger.info(
        f"🤖 Chat stream: user={email}, agent={body.agent_id}, "
        f"agatha={agatha_enabled}, session_id={body.session_id}, "
        f"thread_id={existing_thread_id}, "
        f"images={len(images)}, "
        f"query={body.message[:50]}..."
    )

    # PII 掃描與脫敏（送給 AI 的訊息）
    original_message = body.message
    redacted_message = body.message
    pii_warning_data = None
    pii_blocked = False  # PII 阻擋標記：不拋錯誤，改為正常回覆提示訊息
    pii_block_message = ""
    try:
        pii_svc = get_pii_service()
        if pii_svc.enabled:
            pii_result = pii_svc.scan_text(body.message)
            if pii_result.has_pii:
                logger.warning(
                    f"⚠️ PII 偵測: 聊天訊息含 {pii_result.entity_count} 個 PII 實體 "
                    f"({', '.join(pii_result.entity_types)}), user={email}"
                )
                # 阻擋模式：以正常回覆方式提示使用者，不拋 HTTP 錯誤
                if settings.PII_BLOCK_CHAT:
                    types_str = ", ".join(pii_result.entity_types)
                    pii_blocked = True
                    pii_block_message = (
                        f"⚠️ 偵測到您的訊息中包含 {pii_result.entity_count} 個個人敏感資訊"
                        f"（{types_str}）。\n\n"
                        f"為保護您的隱私安全，此訊息未被送出。請移除敏感資訊後重新發送。"
                    )
                else:
                    pii_warning_data = {
                        "has_pii": True,
                        "entity_count": pii_result.entity_count,
                        "entity_types": pii_result.entity_types,
                    }
                    # 如果啟用自動脫敏，替換送給 AI 的訊息
                    if settings.PII_CHAT_AUTO_REDACT:
                        redacted_message = pii_svc.anonymize_text(body.message)
                        logger.info(f"🔒 聊天訊息已脫敏後送出 AI（原始長度={len(original_message)}, 脫敏長度={len(redacted_message)}）")
    except Exception as e:
        logger.warning(f"⚠️ 聊天 PII 掃描失敗（不影響發送）: {e}")

    async def stream_generator():
        """SSE 串流產生器"""
        full_content = ""
        final_thread_id = existing_thread_id
        final_session_id = body.session_id if (body.session_id and body.session_id.startswith("sess-")) else None

        # 如果有 PII 警告，先發送警告事件
        if pii_warning_data:
            yield _sse_json({
                "type": "pii_warning",
                **pii_warning_data,
                "auto_redacted": settings.PII_CHAT_AUTO_REDACT,
            })

        # ============================================================
        # PII 阻擋模式：以正常回覆方式提示使用者
        # ============================================================
        if pii_blocked:
            full_content = pii_block_message
            yield _sse_json({
                "type": "content",
                "data": pii_block_message,
                "accumulated": pii_block_message,
            })
            yield _sse_json({
                "type": "complete",
                "content": pii_block_message,
                "thread_id": final_thread_id,
                "session_id": final_session_id,
                "pii_blocked": True,
            })
            yield "data: [DONE]\n\n"
            return

        # ============================================================
        # 非 Agatha Agent → Mock 回覆
        # ============================================================
        if not agatha_enabled:
            mock_reply = (
                f"已收到您的訊息：「{body.message}」。\n\n"
                "此 Agent 尚未連接 AI 服務，目前為模擬回覆模式。"
            )
            full_content = mock_reply
            yield _sse_json({
                "type": "content",
                "data": mock_reply,
                "accumulated": mock_reply,
            })

            # 存入 Portal MongoDB
            try:
                final_session_id = await _save_to_portal(
                    email=email,
                    country=country,
                    agent_id=body.agent_id,
                    agent_name=agent_name,
                    user_message=body.message,
                    assistant_message=full_content,
                    session_id=final_session_id,
                    thread_id=None,
                    images=images if images else None,
                )
            except Exception as e:
                logger.warning(f"⚠️ 儲存 mock 對話失敗: {e}")

            yield _sse_json({
                "type": "complete",
                "content": mock_reply,
                "thread_id": None,
                "session_id": final_session_id,
            })
            yield "data: [DONE]\n\n"
            return

        # ============================================================
        # Agatha Agent → 呼叫 Agatha Public API
        # ============================================================
        client = _get_agatha_client()

        # === 先嘗試 Streaming 模式 ===
        streaming_success = False
        try:
            agatha_payload = {
                "api_key": settings.AGATHA_API_KEY,
                "query": redacted_message,
                "thread_id": existing_thread_id,
                "streaming": True,
            }
            # 如果有圖片，加入 payload（等 Agatha Public API 支援後即可生效）
            if images:
                agatha_payload["images"] = images

            async with client.stream(
                "POST",
                settings.AGATHA_API_URL,
                json=agatha_payload,
                timeout=settings.AGATHA_API_TIMEOUT,
            ) as response:

                if response.status_code != 200:
                    error_text = await response.aread()
                    error_text = error_text.decode("utf-8", errors="ignore")
                    logger.warning(
                        f"⚠️ Agatha streaming 失敗 ({response.status_code}), "
                        f"將 fallback 到非 streaming: {error_text[:200]}"
                    )
                else:
                    buffer = ""
                    async for chunk in response.aiter_bytes():
                        buffer += chunk.decode("utf-8", errors="ignore")

                        while "\n" in buffer:
                            line, buffer = buffer.split("\n", 1)
                            line = line.strip()
                            if not line:
                                continue

                            if line.startswith("data: "):
                                payload_str = line[6:]
                                if payload_str.strip() == "[DONE]":
                                    continue

                                try:
                                    obj = json.loads(payload_str)
                                except json.JSONDecodeError:
                                    continue

                                if not isinstance(obj, dict):
                                    continue

                                event_type = obj.get("type", "")

                                if event_type == "content":
                                    content_delta = obj.get("data") or obj.get("content") or ""
                                    if isinstance(content_delta, str) and content_delta:
                                        full_content += content_delta
                                    yield _sse_json({
                                        "type": "content",
                                        "data": content_delta,
                                        "accumulated": full_content,
                                    })
                                    streaming_success = True

                                elif event_type in ("complete", "done") or obj.get("is_complete"):
                                    final_thread_id = (
                                        obj.get("thread_id")
                                        or obj.get("session_id")
                                        or obj.get("response_id")
                                        or final_thread_id
                                    )
                                    if obj.get("content") and not full_content:
                                        full_content = obj["content"]
                                    streaming_success = True
                                    # complete 事件延後到存完 MongoDB 再發

                                elif event_type == "error":
                                    error_msg = obj.get("message") or obj.get("error") or "AI 服務發生錯誤"
                                    logger.error(f"❌ Agatha streaming 錯誤事件: {error_msg}")
                                    break

                                else:
                                    yield _sse_json(obj)
                                    streaming_success = True

        except (httpx.TimeoutException, httpx.ConnectError, Exception) as e:
            logger.warning(f"⚠️ Agatha streaming 異常: {e}, 將 fallback 到非 streaming")

        # === Fallback: 非 Streaming 模式 ===
        if not streaming_success:
            logger.info("🔄 Fallback 到非 streaming 模式")
            try:
                agatha_payload = {
                    "api_key": settings.AGATHA_API_KEY,
                    "query": redacted_message,
                    "thread_id": existing_thread_id,
                    "streaming": False,
                }
                # 如果有圖片，加入 payload
                if images:
                    agatha_payload["images"] = images

                resp = await client.post(
                    settings.AGATHA_API_URL,
                    json=agatha_payload,
                    timeout=settings.AGATHA_API_TIMEOUT,
                )

                if resp.status_code == 200:
                    result = resp.json()

                    content = ""
                    thread_id = None

                    if result.get("success") and isinstance(result.get("data"), dict):
                        inner_data = result["data"]
                        if isinstance(inner_data.get("data"), dict):
                            content = inner_data["data"].get("content", "")
                            thread_id = inner_data["data"].get("thread_id")
                        elif isinstance(inner_data.get("content"), str):
                            content = inner_data["content"]
                            thread_id = inner_data.get("thread_id") or inner_data.get("session_id")
                    elif isinstance(result.get("content"), str):
                        content = result["content"]
                        thread_id = result.get("thread_id") or result.get("session_id")

                    full_content = content
                    final_thread_id = thread_id or final_thread_id

                    if content:
                        yield _sse_json({
                            "type": "content",
                            "data": content,
                            "accumulated": content,
                        })
                    else:
                        yield _sse_json({
                            "type": "error",
                            "message": "AI 回覆為空",
                        })
                else:
                    error_text = resp.text[:200]
                    logger.error(f"❌ Agatha 非 streaming 錯誤: {resp.status_code}, {error_text}")
                    yield _sse_json({
                        "type": "error",
                        "message": f"AI 服務錯誤 ({resp.status_code})",
                    })

            except httpx.TimeoutException:
                logger.error("❌ Agatha API 超時（非 streaming）")
                yield _sse_json({"type": "error", "message": "AI 服務回應超時，請稍後再試"})
            except httpx.ConnectError:
                logger.error("❌ Agatha API 連線失敗（非 streaming）")
                yield _sse_json({"type": "error", "message": "無法連接 AI 服務，請稍後再試"})
            except Exception as e:
                logger.error(f"❌ 非 streaming 處理失敗: {e}")
                yield _sse_json({"type": "error", "message": f"處理失敗: {str(e)}"})

        # === 存入 Portal MongoDB（用 asyncio.shield 保護，即使 SSE 連線中斷也能完成儲存）===
        if full_content:
            try:
                saved_session_id = await asyncio.shield(
                    _save_to_portal(
                        email=email,
                        country=country,
                        agent_id=body.agent_id,
                        agent_name=agent_name,
                        user_message=body.message,
                        assistant_message=full_content,
                        session_id=final_session_id,
                        thread_id=final_thread_id,
                        images=images if images else None,
                    )
                )
                final_session_id = saved_session_id
            except asyncio.CancelledError:
                # SSE 連線已中斷，但 asyncio.shield 會讓儲存繼續在背景完成
                logger.info(f"ℹ️ SSE 連線已中斷，對話儲存在背景繼續執行")
                return
            except Exception as e:
                logger.warning(f"⚠️ 儲存對話到 Portal MongoDB 失敗（不影響回覆）: {e}")

        # 記錄稽核日誌（直接 await，確保在 generator 內正確執行）
        try:
            from utils.audit_logger import _write_audit_log, _get_client_ip, _get_user_agent
            await _write_audit_log(
                action=AuditAction.CHAT_SEND,
                operator_email=email,
                country_code=country,
                target=body.agent_id,
                result="success",
                details={
                    "agent_name": agent_name,
                    "session_id": final_session_id,
                    "message_preview": body.message[:100],
                },
                ip_address=_get_client_ip(request),
                user_agent=_get_user_agent(request),
            )
        except Exception as e:
            logger.warning(f"⚠️ 聊天稽核日誌寫入失敗: {e}")

        # 發送 complete 事件（帶 session_id）
        yield _sse_json({
            "type": "complete",
            "content": full_content,
            "thread_id": final_thread_id,
            "session_id": final_session_id,
        })
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================
# 非 Streaming 聊天端點（保留向後相容）
# ============================================================


@router.post("", response_model=ChatResponse)
async def create_or_continue_chat(
    body: ChatCreate,
    payload: dict = Depends(get_current_user_payload),
):
    """
    發送訊息（非 streaming）
    呼叫 Agatha API 取得回覆，存入 Portal MongoDB
    """
    email = payload["sub"]
    country = payload.get("country", "TW")
    now = datetime.now(timezone.utc)

    agent_name = await _get_agent_name(body.agent_id)

    # PII 掃描與脫敏
    query_for_ai = body.message
    pii_blocked = False
    try:
        pii_svc = get_pii_service()
        if pii_svc.enabled:
            pii_result = pii_svc.scan_text(body.message)
            if pii_result.has_pii:
                logger.warning(
                    f"⚠️ PII 偵測（非 streaming）: 含 {pii_result.entity_count} 個 PII 實體, user={email}"
                )
                # 阻擋模式：以正常回覆方式提示使用者，不拋 HTTP 錯誤
                if settings.PII_BLOCK_CHAT:
                    types_str = ", ".join(pii_result.entity_types)
                    pii_blocked = True
                    pii_block_reply = (
                        f"⚠️ 偵測到您的訊息中包含 {pii_result.entity_count} 個個人敏感資訊"
                        f"（{types_str}）。\n\n"
                        f"為保護您的隱私安全，此訊息未被送出。請移除敏感資訊後重新發送。"
                    )
                else:
                    # 脫敏模式
                    if settings.PII_CHAT_AUTO_REDACT:
                        query_for_ai = pii_svc.anonymize_text(body.message)
    except Exception as e:
        logger.warning(f"⚠️ 聊天 PII 掃描失敗（不影響發送）: {e}")

    # PII 阻擋模式：直接回傳提示訊息，不呼叫 AI
    if pii_blocked:
        user_message = {
            "role": "user",
            "content": body.message,
            "timestamp": now.isoformat(),
        }
        assistant_message = {
            "role": "assistant",
            "content": pii_block_reply,
            "timestamp": now.isoformat(),
        }
        return ChatResponse(
            chat_id="",
            agent_id=body.agent_id,
            agent_name=agent_name,
            messages=[user_message, assistant_message],
            created_at=now,
            updated_at=now,
        )

    user_message = {
        "role": "user",
        "content": body.message,
        "timestamp": now.isoformat(),
    }

    # 呼叫 Agatha API（非 streaming）
    assistant_content = ""
    if settings.AGATHA_API_KEY:
        try:
            client = _get_agatha_client()
            agatha_payload = {
                "api_key": settings.AGATHA_API_KEY,
                "query": query_for_ai,
                "thread_id": None,
                "streaming": False,
            }
            resp = await client.post(
                settings.AGATHA_API_URL,
                json=agatha_payload,
                timeout=settings.AGATHA_API_TIMEOUT,
            )
            if resp.status_code == 200:
                result = resp.json()
                if result.get("success") and isinstance(result.get("data"), dict):
                    inner_data = result["data"]
                    if isinstance(inner_data.get("data"), dict):
                        assistant_content = inner_data["data"].get("content", "")
                    elif isinstance(inner_data.get("content"), str):
                        assistant_content = inner_data["content"]
                elif isinstance(result.get("content"), str):
                    assistant_content = result["content"]
            else:
                logger.error(f"❌ Agatha API 非 streaming 錯誤: {resp.status_code}")
        except Exception as e:
            logger.error(f"❌ Agatha API 呼叫失敗: {e}")

    if not assistant_content:
        assistant_content = (
            f"已收到您的訊息：「{body.message}」。"
            "這是模擬回覆，實際功能需連接 Agent 服務。"
        )

    assistant_message = {
        "role": "assistant",
        "content": assistant_content,
        "timestamp": now.isoformat(),
    }

    # 存入 Portal MongoDB
    session_id = ""
    try:
        session_id = await _save_to_portal(
            email=email,
            country=country,
            agent_id=body.agent_id,
            agent_name=agent_name,
            user_message=body.message,
            assistant_message=assistant_content,
        )
    except Exception as e:
        logger.warning(f"⚠️ 儲存對話失敗: {e}")

    return ChatResponse(
        chat_id=session_id,
        agent_id=body.agent_id,
        agent_name=agent_name,
        messages=[user_message, assistant_message],
        created_at=now,
        updated_at=now,
    )


# ============================================================
# 對話歷史 Session API（新）
# ============================================================


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    agent_id: Optional[str] = Query(None, description="篩選特定 Agent"),
    payload: dict = Depends(get_current_user_payload),
):
    """取得對話 Session 列表（分頁）"""
    email = payload["sub"]

    sessions_col = get_sessions_collection()
    if sessions_col is None:
        raise HTTPException(status_code=503, detail="對話歷史服務未啟用")

    # 建立查詢條件
    query = {"user_email": email}
    if agent_id:
        query["agent_id"] = agent_id

    # 計算總數
    total = await sessions_col.count_documents(query)

    # 分頁查詢
    skip = (page - 1) * page_size
    cursor = (
        sessions_col.find(query)
        .sort("updated_at", -1)
        .skip(skip)
        .limit(page_size)
    )

    sessions = []
    async for doc in cursor:
        sessions.append(
            SessionSummary(
                session_id=doc["session_id"],
                agent_id=doc.get("agent_id", ""),
                agent_name=doc.get("agent_name", ""),
                title=doc.get("title", ""),
                last_message_preview=doc.get("last_message_preview", ""),
                message_count=doc.get("message_count", 0),
                created_at=doc.get("created_at"),
                updated_at=doc.get("updated_at"),
            )
        )

    return SessionListResponse(
        sessions=sessions,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/sessions/{session_id}", response_model=SessionDetailResponse)
async def get_session_detail(
    session_id: str,
    payload: dict = Depends(get_current_user_payload),
):
    """取得對話 Session 詳情（含所有訊息）"""
    email = payload["sub"]

    sessions_col = get_sessions_collection()
    messages_col = get_messages_collection()
    if sessions_col is None or messages_col is None:
        raise HTTPException(status_code=503, detail="對話歷史服務未啟用")

    # 查詢 session（驗證所有權）
    session_doc = await sessions_col.find_one({
        "session_id": session_id,
        "user_email": email,
    })
    if not session_doc:
        raise HTTPException(status_code=404, detail="對話不存在")

    # 查詢所有訊息（時間正序，_id 作為次要排序確保相同時間戳的順序正確）
    cursor = messages_col.find({"session_id": session_id}).sort([("created_at", 1), ("_id", 1)])
    messages = []
    async for msg in cursor:
        messages.append(
            SessionMessageItem(
                role=msg["role"],
                content=msg["content"],
                created_at=msg.get("created_at"),
            )
        )

    return SessionDetailResponse(
        session_id=session_doc["session_id"],
        agent_id=session_doc.get("agent_id", ""),
        agent_name=session_doc.get("agent_name", ""),
        title=session_doc.get("title", ""),
        thread_id=session_doc.get("thread_id"),
        messages=messages,
        created_at=session_doc.get("created_at"),
        updated_at=session_doc.get("updated_at"),
    )


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    payload: dict = Depends(get_current_user_payload),
):
    """刪除對話 Session 及其所有訊息"""
    email = payload["sub"]

    sessions_col = get_sessions_collection()
    messages_col = get_messages_collection()
    if sessions_col is None or messages_col is None:
        raise HTTPException(status_code=503, detail="對話歷史服務未啟用")

    # 驗證所有權
    session_doc = await sessions_col.find_one({
        "session_id": session_id,
        "user_email": email,
    })
    if not session_doc:
        raise HTTPException(status_code=404, detail="對話不存在")

    # 刪除所有訊息
    delete_msgs = await messages_col.delete_many({"session_id": session_id})
    # 刪除 session
    await sessions_col.delete_one({"session_id": session_id})

    logger.info(
        f"🗑️ 對話已刪除: session_id={session_id}, "
        f"messages_deleted={delete_msgs.deleted_count}"
    )

    audit_log(
        action=AuditAction.CHAT_SESSION_DELETE,
        operator_email=email,
        country_code=payload.get("country", "TW"),
        target=session_id,
        result="success",
        details={"messages_deleted": delete_msgs.deleted_count},
    )

    return {"message": "對話已刪除"}


# ============================================================
# 舊版歷史端點（保留向後相容，標記 deprecated）
# ============================================================


@router.get("/history", response_model=List[ChatHistoryItem], deprecated=True)
async def get_chat_history(
    payload: dict = Depends(get_current_user_payload),
):
    """
    [Deprecated] 取得對話歷史列表
    請改用 GET /api/chat/sessions
    """
    email = payload["sub"]

    # 優先從 Portal MongoDB 讀取
    sessions_col = get_sessions_collection()
    if sessions_col is not None:
        cursor = (
            sessions_col.find({"user_email": email})
            .sort("updated_at", -1)
            .limit(50)
        )

        history = []
        async for doc in cursor:
            history.append(
                ChatHistoryItem(
                    chat_id=doc["session_id"],
                    agent_id=doc.get("agent_id", ""),
                    agent_name=doc.get("agent_name", ""),
                    last_message=doc.get("last_message_preview", ""),
                    timestamp=doc.get("updated_at"),
                )
            )
        return history

    # Fallback: 從舊的 Local MongoDB 讀取
    try:
        from core.data_router import data_router
        country = payload.get("country", "TW")
        mongo_db = await data_router.get_local_mongo(country)
        chat_collection = mongo_db["chat_store"]

        cursor = (
            chat_collection.find({"user_email": email})
            .sort("updated_at", -1)
            .limit(50)
        )

        history = []
        async for doc in cursor:
            messages = doc.get("messages", [])
            last_msg = messages[-1]["content"] if messages else ""
            if len(last_msg) > 50:
                last_msg = last_msg[:50] + "..."

            history.append(
                ChatHistoryItem(
                    chat_id=str(doc["_id"]),
                    agent_id=doc.get("agent_id", ""),
                    last_message=last_msg,
                    timestamp=doc.get("updated_at"),
                )
            )
        return history
    except Exception as e:
        logger.warning(f"⚠️ 舊版歷史查詢失敗: {e}")
        return []


@router.get("/{chat_id}", response_model=ChatResponse, deprecated=True)
async def get_chat_detail(
    chat_id: str,
    payload: dict = Depends(get_current_user_payload),
):
    """
    [Deprecated] 取得單一對話詳情
    請改用 GET /api/chat/sessions/{session_id}
    """
    email = payload["sub"]

    # 如果是 sess- 開頭，轉到新 API
    if chat_id.startswith("sess-"):
        return await _get_session_as_chat_response(chat_id, email)

    # 舊格式：從 Local MongoDB 讀取
    try:
        from bson import ObjectId
        from core.data_router import data_router
        country = payload.get("country", "TW")
        mongo_db = await data_router.get_local_mongo(country)
        chat_collection = mongo_db["chat_store"]

        doc = await chat_collection.find_one({
            "_id": ObjectId(chat_id),
            "user_email": email,
        })

        if not doc:
            raise HTTPException(status_code=404, detail="對話不存在")

        return ChatResponse(
            chat_id=str(doc["_id"]),
            agent_id=doc.get("agent_id", ""),
            messages=doc.get("messages", []),
            created_at=doc.get("created_at"),
            updated_at=doc.get("updated_at"),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"⚠️ 舊版對話詳情查詢失敗: {e}")
        raise HTTPException(status_code=404, detail="對話不存在")


async def _get_session_as_chat_response(session_id: str, email: str) -> ChatResponse:
    """將新格式 Session 轉為舊格式 ChatResponse（向後相容）"""
    sessions_col = get_sessions_collection()
    messages_col = get_messages_collection()
    if sessions_col is None or messages_col is None:
        raise HTTPException(status_code=503, detail="對話歷史服務未啟用")

    session_doc = await sessions_col.find_one({
        "session_id": session_id,
        "user_email": email,
    })
    if not session_doc:
        raise HTTPException(status_code=404, detail="對話不存在")

    cursor = messages_col.find({"session_id": session_id}).sort([("created_at", 1), ("_id", 1)])
    messages = []
    async for msg in cursor:
        messages.append({
            "role": msg["role"],
            "content": msg["content"],
            "timestamp": msg.get("created_at", "").isoformat() if msg.get("created_at") else "",
        })

    return ChatResponse(
        chat_id=session_doc["session_id"],
        agent_id=session_doc.get("agent_id", ""),
        agent_name=session_doc.get("agent_name", ""),
        messages=messages,
        created_at=session_doc.get("created_at"),
        updated_at=session_doc.get("updated_at"),
    )


# ============================================================
# Agent 使用統計 API
# ============================================================


@router.get("/stats/summary")
async def get_agent_stats(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    country: Optional[str] = None,
    payload: dict = Depends(require_permission("manage_agent_permissions")),
):
    """
    取得 Agent 使用統計摘要（需要 manage_agent_permissions 權限）

    回傳：
    - summary: 總對話數、總訊息數、活躍使用者數、活躍 Agent 數
    - by_agent: 各 Agent 的對話數、訊息數
    - top_users: 最活躍使用者排行
    - daily_trend: 每日對話趨勢（依 Agent 分組）
    """
    sessions_col = get_sessions_collection()
    if sessions_col is None:
        raise HTTPException(status_code=503, detail="對話歷史服務未啟用")

    # 建立時間篩選條件
    time_filter: dict = {}
    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            time_filter["$gte"] = dt_from
        except ValueError:
            pass
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            time_filter["$lte"] = dt_to
        except ValueError:
            pass

    match_stage: dict = {}
    if time_filter:
        match_stage["created_at"] = time_filter
    if country:
        match_stage["country"] = country

    # ── 1. 總覽統計 ──────────────────────────────────────────
    pipeline_summary = []
    if match_stage:
        pipeline_summary.append({"$match": match_stage})
    pipeline_summary += [
        {
            "$group": {
                "_id": None,
                "total_sessions": {"$sum": 1},
                "total_messages": {"$sum": "$message_count"},
                "unique_users": {"$addToSet": "$user_email"},
                "unique_agents": {"$addToSet": "$agent_id"},
            }
        }
    ]
    summary_result = await sessions_col.aggregate(pipeline_summary).to_list(1)
    if summary_result:
        s = summary_result[0]
        summary = {
            "total_sessions": s.get("total_sessions", 0),
            "total_messages": s.get("total_messages", 0),
            "active_users": len(s.get("unique_users", [])),
            "active_agents": len(s.get("unique_agents", [])),
        }
    else:
        summary = {"total_sessions": 0, "total_messages": 0, "active_users": 0, "active_agents": 0}

    # ── 2. 各 Agent 統計 ─────────────────────────────────────
    pipeline_by_agent = []
    if match_stage:
        pipeline_by_agent.append({"$match": match_stage})
    pipeline_by_agent += [
        {
            "$group": {
                "_id": {"agent_id": "$agent_id", "agent_name": "$agent_name"},
                "sessions": {"$sum": 1},
                "messages": {"$sum": "$message_count"},
                "unique_users": {"$addToSet": "$user_email"},
            }
        },
        {"$sort": {"sessions": -1}},
    ]
    by_agent_cursor = sessions_col.aggregate(pipeline_by_agent)
    by_agent = []
    async for doc in by_agent_cursor:
        by_agent.append({
            "agent_id": doc["_id"].get("agent_id", ""),
            "agent_name": doc["_id"].get("agent_name", ""),
            "sessions": doc.get("sessions", 0),
            "messages": doc.get("messages", 0),
            "unique_users": len(doc.get("unique_users", [])),
        })

    # ── 3. 最活躍使用者 Top 10 ───────────────────────────────
    pipeline_top_users = []
    if match_stage:
        pipeline_top_users.append({"$match": match_stage})
    pipeline_top_users += [
        {
            "$group": {
                "_id": "$user_email",
                "sessions": {"$sum": 1},
                "messages": {"$sum": "$message_count"},
                "agents_used": {"$addToSet": "$agent_id"},
            }
        },
        {"$sort": {"sessions": -1}},
        {"$limit": 10},
    ]
    top_users_cursor = sessions_col.aggregate(pipeline_top_users)
    top_users = []
    async for doc in top_users_cursor:
        top_users.append({
            "user_email": doc["_id"],
            "sessions": doc.get("sessions", 0),
            "messages": doc.get("messages", 0),
            "agents_used": len(doc.get("agents_used", [])),
        })

    # ── 4. 每日趨勢（依 Agent 分組）─────────────────────────
    pipeline_daily = []
    if match_stage:
        pipeline_daily.append({"$match": match_stage})
    pipeline_daily += [
        {
            "$group": {
                "_id": {
                    "date": {
                        "$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}
                    },
                    "agent_id": "$agent_id",
                    "agent_name": "$agent_name",
                },
                "sessions": {"$sum": 1},
                "messages": {"$sum": "$message_count"},
            }
        },
        {"$sort": {"_id.date": 1}},
    ]
    daily_cursor = sessions_col.aggregate(pipeline_daily)

    # 整理成「以 Agent 為主」的結構（同 LibraryStats 的 daily_trend_by_library）
    agent_daily_map: dict = defaultdict(lambda: {"agent_id": "", "agent_name": "", "trend": {}})
    async for doc in daily_cursor:
        aid = doc["_id"].get("agent_id", "")
        aname = doc["_id"].get("agent_name", "")
        date = doc["_id"].get("date", "")
        agent_daily_map[aid]["agent_id"] = aid
        agent_daily_map[aid]["agent_name"] = aname
        agent_daily_map[aid]["trend"][date] = {
            "date": date,
            "sessions": doc.get("sessions", 0),
            "messages": doc.get("messages", 0),
        }

    # 收集所有日期，補齊缺失日期為 0
    all_dates: set = set()
    for v in agent_daily_map.values():
        all_dates.update(v["trend"].keys())
    sorted_dates = sorted(all_dates)

    daily_trend_by_agent = []
    for aid, data in agent_daily_map.items():
        trend_list = []
        for d in sorted_dates:
            entry = data["trend"].get(d, {"date": d, "sessions": 0, "messages": 0})
            trend_list.append(entry)
        daily_trend_by_agent.append({
            "agent_id": data["agent_id"],
            "agent_name": data["agent_name"],
            "trend": trend_list,
        })
    # 依總 sessions 降序排列
    daily_trend_by_agent.sort(
        key=lambda x: sum(t["sessions"] for t in x["trend"]), reverse=True
    )

    return {
        "summary": summary,
        "by_agent": by_agent,
        "top_users": top_users,
        "daily_trend_by_agent": daily_trend_by_agent,
    }
