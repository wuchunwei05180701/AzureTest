"""
稽核日誌 API：查詢 global_audit_log 表
僅限 super_admin / platform_admin 存取

端點：
  GET /api/audit-logs          — 分頁查詢（支援多種篩選條件）
  GET /api/audit-logs/export   — 匯出 CSV
  GET /api/audit-logs/actions  — 取得所有 action 類型列表（供前端篩選用）
"""
import csv
import io
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import Session

from core.database import GlobalSessionLocal
from core.permissions import require_any_permission
from core.security import get_current_user_payload
from models.global_models import GlobalAuditLog
from models.schemas import MessageResponse

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================
# Pydantic Response Schema（直接在此定義，避免 schemas.py 過大）
# ============================================================

from pydantic import BaseModel
from uuid import UUID


class AuditLogItem(BaseModel):
    log_id: str
    user_email: Optional[str] = None
    action: str
    target: Optional[str] = None
    country_code: Optional[str] = None
    timestamp: Optional[datetime] = None
    ip_address: Optional[str] = None
    result: Optional[str] = "success"
    error_message: Optional[str] = None
    details: Optional[dict] = None
    user_agent: Optional[str] = None
    response_time_ms: Optional[int] = None

    class Config:
        from_attributes = True


class AuditLogListResponse(BaseModel):
    logs: List[AuditLogItem]
    total: int
    page: int
    page_size: int


# ============================================================
# 查詢端點
# ============================================================


@router.get("", response_model=AuditLogListResponse)
async def list_audit_logs(
    # 分頁
    page: int = Query(1, ge=1, description="頁碼"),
    page_size: int = Query(50, ge=1, le=200, description="每頁筆數"),
    # 篩選條件
    user_email: Optional[str] = Query(None, description="使用者 Email（模糊搜尋）"),
    action: Optional[str] = Query(None, description="操作類型（完整比對，例如 user.create）"),
    action_category: Optional[str] = Query(None, description="操作類別（前綴比對，例如 user / auth / library）"),
    country_code: Optional[str] = Query(None, description="國家代碼"),
    result: Optional[str] = Query(None, description="操作結果：success / failure"),
    target: Optional[str] = Query(None, description="操作對象（模糊搜尋）"),
    date_from: Optional[str] = Query(None, description="開始時間（ISO 8601，例如 2026-03-01T00:00:00Z）"),
    date_to: Optional[str] = Query(None, description="結束時間（ISO 8601）"),
    payload: dict = Depends(require_any_permission("manage_users", "cross_country_logs")),
):
    """
    查詢稽核日誌（分頁）

    權限：root（可查看所有國家）/ admin（只能查看自己國家）
    """
    operator_role = payload.get("role", "user")
    operator_country = payload.get("country", "TW")

    async with GlobalSessionLocal() as session:
        # 建立查詢條件
        conditions = []

        # 國家隔離：非 root 只能看自己國家
        if operator_role != "root":
            conditions.append(GlobalAuditLog.country_code == operator_country)
        elif country_code:
            conditions.append(GlobalAuditLog.country_code == country_code)

        if user_email:
            conditions.append(GlobalAuditLog.user_email.ilike(f"%{user_email}%"))

        if action:
            conditions.append(GlobalAuditLog.action == action)
        elif action_category:
            conditions.append(GlobalAuditLog.action.like(f"{action_category}.%"))

        if result:
            conditions.append(GlobalAuditLog.result == result)

        if target:
            conditions.append(GlobalAuditLog.target.ilike(f"%{target}%"))

        if date_from:
            try:
                dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
                conditions.append(GlobalAuditLog.timestamp >= dt_from)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"date_from 格式錯誤：{date_from}")

        if date_to:
            try:
                dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
                conditions.append(GlobalAuditLog.timestamp <= dt_to)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"date_to 格式錯誤：{date_to}")

        where_clause = and_(*conditions) if conditions else True

        # 計算總數
        count_result = await session.execute(
            select(func.count()).select_from(GlobalAuditLog).where(where_clause)
        )
        total = count_result.scalar() or 0

        # 分頁查詢（時間倒序）
        skip = (page - 1) * page_size
        logs_result = await session.execute(
            select(GlobalAuditLog)
            .where(where_clause)
            .order_by(GlobalAuditLog.timestamp.desc())
            .offset(skip)
            .limit(page_size)
        )
        logs = logs_result.scalars().all()

    return AuditLogListResponse(
        logs=[
            AuditLogItem(
                log_id=str(log.log_id),
                user_email=log.user_email,
                action=log.action,
                target=log.target,
                country_code=log.country_code,
                timestamp=log.timestamp,
                ip_address=log.ip_address,
                result=log.result or "success",
                error_message=log.error_message,
                details=log.details,
                user_agent=log.user_agent,
                response_time_ms=log.response_time_ms,
            )
            for log in logs
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/actions")
async def list_audit_actions(
    payload: dict = Depends(require_any_permission("manage_users", "cross_country_logs")),
):
    """
    取得所有已記錄的 action 類型列表（供前端篩選下拉選單用）
    """
    async with GlobalSessionLocal() as session:
        result = await session.execute(
            select(GlobalAuditLog.action)
            .distinct()
            .order_by(GlobalAuditLog.action)
        )
        actions = [row[0] for row in result.fetchall() if row[0]]

    # 同時回傳中文標籤對照
    action_labels = {
        "auth.otp_request":     "申請 OTP",
        "auth.login_success":   "登入成功",
        "auth.login_failed":    "登入失敗",
        "auth.account_locked":  "帳號鎖定",
        "auth.logout":          "登出",
        "user.create":          "新增使用者",
        "user.update":          "更新使用者",
        "user.role_change":     "變更角色",
        "user.status_change":   "變更狀態",
        "user.delete":          "刪除使用者",
        "agent.publish":        "上架 Agent",
        "agent.unpublish":      "下架 Agent",
        "agent.acl_update":     "更新 Agent 權限",
        "library.upload":       "上傳文件",
        "library.download":     "下載文件",
        "library.delete":       "刪除文件",
        "library.update":       "更新文件",
        "library.auth_update":  "更新文件權限",
        "announcement.create":  "新增公告",
        "announcement.update":  "更新公告",
        "announcement.delete":  "刪除公告",
        "chat.session_delete":  "刪除對話",
        "pii.detected_chat":    "聊天偵測到個資",
        "pii.blocked_upload":   "上傳因個資被阻擋",
        "pii.blocked_chat":     "聊天因個資被阻擋",
    }

    return {
        "actions": actions,
        "labels": action_labels,
    }


@router.get("/export")
async def export_audit_logs(
    # 篩選條件（與 list_audit_logs 相同）
    user_email: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    action_category: Optional[str] = Query(None),
    country_code: Optional[str] = Query(None),
    result: Optional[str] = Query(None),
    target: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    payload: dict = Depends(require_any_permission("manage_users", "cross_country_logs")),
):
    """
    匯出稽核日誌為 CSV（最多 5000 筆）

    權限：root（可查看所有國家）/ admin（只能查看自己國家）
    """
    operator_role = payload.get("role", "user")
    operator_country = payload.get("country", "TW")

    async with GlobalSessionLocal() as session:
        conditions = []

        if operator_role != "root":
            conditions.append(GlobalAuditLog.country_code == operator_country)
        elif country_code:
            conditions.append(GlobalAuditLog.country_code == country_code)

        if user_email:
            conditions.append(GlobalAuditLog.user_email.ilike(f"%{user_email}%"))
        if action:
            conditions.append(GlobalAuditLog.action == action)
        elif action_category:
            conditions.append(GlobalAuditLog.action.like(f"{action_category}.%"))
        if result:
            conditions.append(GlobalAuditLog.result == result)
        if target:
            conditions.append(GlobalAuditLog.target.ilike(f"%{target}%"))
        if date_from:
            try:
                dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
                conditions.append(GlobalAuditLog.timestamp >= dt_from)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"date_from 格式錯誤：{date_from}")
        if date_to:
            try:
                dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
                conditions.append(GlobalAuditLog.timestamp <= dt_to)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"date_to 格式錯誤：{date_to}")

        where_clause = and_(*conditions) if conditions else True

        logs_result = await session.execute(
            select(GlobalAuditLog)
            .where(where_clause)
            .order_by(GlobalAuditLog.timestamp.desc())
            .limit(5000)
        )
        logs = logs_result.scalars().all()

    # 產生 CSV
    output = io.StringIO()
    writer = csv.writer(output)

    # 標題列
    writer.writerow([
        "時間", "使用者", "操作類型", "操作對象", "國家",
        "結果", "IP 位址", "失敗原因", "補充資訊", "回應時間(ms)"
    ])

    for log in logs:
        writer.writerow([
            log.timestamp.strftime("%Y-%m-%d %H:%M:%S") if log.timestamp else "",
            log.user_email or "",
            log.action or "",
            log.target or "",
            log.country_code or "",
            log.result or "success",
            log.ip_address or "",
            log.error_message or "",
            str(log.details) if log.details else "",
            log.response_time_ms or "",
        ])

    output.seek(0)
    filename = f"audit_logs_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
