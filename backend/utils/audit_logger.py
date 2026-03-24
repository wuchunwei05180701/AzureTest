"""
稽核日誌服務（Audit Logger）

統一的稽核日誌寫入介面，使用 asyncio.create_task() 背景執行，
不阻塞主業務流程。日誌寫入失敗時靜默處理，不影響 API 回應。

使用方式：
    from utils.audit_logger import audit_log

    # 在 API 函式中呼叫（不需要 await，背景執行）
    audit_log(
        action="user.create",
        operator_email="super@ctbc.com",
        country_code="TW",
        target="carol@ctbc.com",
        result="success",
        details={"role": "user", "country": "TW"},
        request=request,  # FastAPI Request 物件（可選）
    )
"""
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import Request

logger = logging.getLogger(__name__)

# ============================================================
# Action 常數定義（方便各 API 引用，避免打錯字）
# ============================================================

class AuditAction:
    # 認證
    OTP_REQUEST     = "auth.otp_request"
    LOGIN_SUCCESS   = "auth.login_success"
    LOGIN_FAILED    = "auth.login_failed"
    ACCOUNT_LOCKED  = "auth.account_locked"
    LOGOUT          = "auth.logout"

    # 使用者管理
    USER_CREATE         = "user.create"
    USER_UPDATE         = "user.update"
    USER_ROLE_CHANGE    = "user.role_change"
    USER_STATUS_CHANGE  = "user.status_change"
    USER_DELETE         = "user.delete"

    # Agent 管理
    AGENT_PUBLISH       = "agent.publish"
    AGENT_UNPUBLISH     = "agent.unpublish"
    AGENT_ACL_UPDATE    = "agent.acl_update"

    # 圖書館
    LIBRARY_UPLOAD      = "library.upload"
    LIBRARY_DOWNLOAD    = "library.download"
    LIBRARY_DELETE      = "library.delete"
    LIBRARY_AUTH_UPDATE = "library.auth_update"
    LIBRARY_UPDATE      = "library.update"
    LIBRARY_VIEW        = "library.view"     # 點擊開啟文件 Modal
    LIBRARY_PREVIEW     = "library.preview"  # 預覽 PDF

    # 公告
    ANNOUNCEMENT_CREATE = "announcement.create"
    ANNOUNCEMENT_UPDATE = "announcement.update"
    ANNOUNCEMENT_DELETE = "announcement.delete"

    # 聊天
    CHAT_SEND           = "chat.send"
    CHAT_SESSION_DELETE = "chat.session_delete"

    # PII
    PII_DETECTED_CHAT   = "pii.detected_chat"
    PII_BLOCKED_UPLOAD  = "pii.blocked_upload"
    PII_BLOCKED_CHAT    = "pii.blocked_chat"


def _get_client_ip(request: Optional[Request]) -> Optional[str]:
    """從 Request 取得客戶端 IP（支援 X-Forwarded-For）"""
    if not request:
        return None
    # 優先取 X-Forwarded-For（Nginx 反向代理後的真實 IP）
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _get_user_agent(request: Optional[Request]) -> Optional[str]:
    """從 Request 取得 User-Agent"""
    if not request:
        return None
    ua = request.headers.get("User-Agent", "")
    # 只取前 200 字元，避免過長
    return ua[:200] if ua else None


async def _write_audit_log(
    action: str,
    operator_email: str,
    country_code: str,
    target: Optional[str] = None,
    result: str = "success",
    error_message: Optional[str] = None,
    details: Optional[dict] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    response_time_ms: Optional[int] = None,
) -> None:
    """實際寫入稽核日誌到 Global DB（內部函式）"""
    try:
        from core.database import GlobalSessionLocal
        from models.global_models import GlobalAuditLog

        async with GlobalSessionLocal() as session:
            log = GlobalAuditLog(
                user_email=operator_email,
                action=action,
                target=target or "",
                country_code=country_code,
                timestamp=datetime.now(timezone.utc),
                ip_address=ip_address,
                result=result,
                error_message=error_message,
                details=details,
                user_agent=user_agent,
                response_time_ms=response_time_ms,
            )
            session.add(log)
            await session.commit()
    except Exception as e:
        # 日誌寫入失敗不影響主業務，只記錄到 stderr
        logger.error(f"⚠️ 稽核日誌寫入失敗（不影響主業務）: action={action}, error={e}")


def audit_log(
    action: str,
    operator_email: str,
    country_code: str,
    target: Optional[str] = None,
    result: str = "success",
    error_message: Optional[str] = None,
    details: Optional[dict] = None,
    request: Optional[Request] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    response_time_ms: Optional[int] = None,
) -> None:
    """
    寫入稽核日誌（非同步背景執行，不阻塞主流程）

    參數：
        action          操作類型（使用 AuditAction 常數）
        operator_email  操作者 Email
        country_code    操作者所屬國家
        target          操作對象（使用者 Email、Agent ID、文件 ID 等）
        result          操作結果："success" 或 "failure"
        error_message   失敗原因（result="failure" 時填入）
        details         補充資訊（dict，例如角色變更前後的值）
        request         FastAPI Request 物件（用於取得 IP 和 User-Agent）
        ip_address      IP 位址（若已有則不需要傳 request）
        user_agent      User-Agent（若已有則不需要傳 request）
        response_time_ms 操作耗時（毫秒）
    """
    # 從 request 取得 IP 和 User-Agent（若未直接提供）
    if request:
        if not ip_address:
            ip_address = _get_client_ip(request)
        if not user_agent:
            user_agent = _get_user_agent(request)

    # 使用 asyncio.create_task() 背景執行，不阻塞主流程
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(
                _write_audit_log(
                    action=action,
                    operator_email=operator_email,
                    country_code=country_code,
                    target=target,
                    result=result,
                    error_message=error_message,
                    details=details,
                    ip_address=ip_address,
                    user_agent=user_agent,
                    response_time_ms=response_time_ms,
                )
            )
        else:
            # 若 event loop 未運行（例如測試環境），同步執行
            loop.run_until_complete(
                _write_audit_log(
                    action=action,
                    operator_email=operator_email,
                    country_code=country_code,
                    target=target,
                    result=result,
                    error_message=error_message,
                    details=details,
                    ip_address=ip_address,
                    user_agent=user_agent,
                    response_time_ms=response_time_ms,
                )
            )
    except Exception as e:
        logger.error(f"⚠️ 稽核日誌排程失敗: {e}")


class AuditTimer:
    """
    計時器輔助類別，用於測量 API 操作耗時

    使用方式：
        timer = AuditTimer()
        # ... 執行操作 ...
        audit_log(..., response_time_ms=timer.elapsed_ms())
    """
    def __init__(self):
        self._start = time.monotonic()

    def elapsed_ms(self) -> int:
        """回傳從建立到現在的毫秒數"""
        return int((time.monotonic() - self._start) * 1000)
