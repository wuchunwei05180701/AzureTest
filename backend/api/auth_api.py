"""
認證 API：OTP 申請/驗證/登入/登出
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, update

from config import settings
from core.database import get_global_db, GlobalSessionLocal
from core.data_router import data_router
from core.permissions import get_role_permissions
from core.security import (
    create_access_token,
    generate_otp,
    get_current_user_payload,
    hash_otp,
    verify_otp,
)
from models.global_models import UserRouteMap, GlobalAuditLog
from models.local_models import LoginAudit, OTPVault
from models.schemas import MessageResponse, OTPRequest, OTPVerify, TokenResponse, UserInfo
from services.email_service import send_otp_email

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/request-otp", response_model=MessageResponse)
async def request_otp(body: OTPRequest, request: Request):
    """
    Step 1: 使用者輸入 Email → 系統寄送 OTP
    """
    email = body.email.lower()

    # 1. 查詢 Global DB → 確認使用者存在 + 取得 country_code
    async with GlobalSessionLocal() as session:
        result = await session.execute(
            select(UserRouteMap).where(UserRouteMap.email == email)
        )
        user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="此 Email 尚未註冊")

    if user.status == "locked":
        raise HTTPException(status_code=403, detail="帳號已被鎖定，請聯繫管理員")

    if user.status == "inactive":
        raise HTTPException(status_code=403, detail="帳號已停用")

    # 2. 產生 OTP
    otp_code = generate_otp()
    otp_hashed = hash_otp(otp_code)
    expiry = datetime.now(timezone.utc) + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)

    # 3. 存入 Local DB OTP_Vault
    country = user.country_code
    local_session = await data_router.get_local_pg(country)
    try:
        # 先刪除舊的 OTP
        from sqlalchemy import delete
        await local_session.execute(
            delete(OTPVault).where(OTPVault.email == email)
        )
        # 建立新的 OTP
        new_otp = OTPVault(
            email=email,
            otp_hash=otp_hashed,
            expiry_time=expiry,
            retries=0,
        )
        local_session.add(new_otp)
        await local_session.commit()
    finally:
        await local_session.close()

    # 4. 寄送 OTP（SMTP 未設定時回傳 OTP 供直接登入）
    dev_otp = None
    smtp_configured = bool(settings.SMTP_USER and settings.SMTP_PASSWORD)

    if smtp_configured:
        email_sent = await send_otp_email(to_email=email, otp_code=otp_code)
        if not email_sent:
            logger.error(f"OTP Email 寄送失敗: {email}")
            raise HTTPException(
                status_code=500,
                detail="驗證碼寄送失敗，請稍後再試或聯繫管理員"
            )
        logger.info(f"OTP Email 已寄送至 {email}")
    else:
        # SMTP 未設定：直接回傳 OTP（開發/測試用）
        logger.warning(f"SMTP 未設定，直接回傳 OTP for {email}")
        dev_otp = otp_code

    # 5. 記錄稽核
    await _log_audit(country, email, "otp_requested", "auth", request)

    return MessageResponse(message="OTP 已寄送至您的 Email", detail=email, dev_otp=dev_otp)


@router.post("/verify-otp", response_model=TokenResponse)
async def verify_otp_endpoint(body: OTPVerify, request: Request):
    """
    Step 2: 驗證 OTP → 回傳 JWT Token
    """
    email = body.email.lower()

    # 1. 查詢 Global DB
    async with GlobalSessionLocal() as session:
        result = await session.execute(
            select(UserRouteMap).where(UserRouteMap.email == email)
        )
        user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    if user.status in ("locked", "inactive"):
        raise HTTPException(status_code=403, detail="帳號已被鎖定或停用")

    country = user.country_code

    # 2. 查詢 Local DB OTP_Vault
    local_session = await data_router.get_local_pg(country)
    try:
        result = await local_session.execute(
            select(OTPVault).where(OTPVault.email == email)
        )
        otp_record = result.scalar_one_or_none()

        if not otp_record:
            raise HTTPException(status_code=400, detail="請先申請 OTP")

        # 3. 檢查效期
        if datetime.now(timezone.utc) > otp_record.expiry_time:
            await local_session.delete(otp_record)
            await local_session.commit()
            raise HTTPException(status_code=400, detail="OTP 已過期，請重新申請")

        # 4. 驗證 OTP
        if not verify_otp(body.otp_code, otp_record.otp_hash):
            otp_record.retries += 1

            if otp_record.retries >= settings.OTP_MAX_RETRIES:
                # 鎖定帳號
                await local_session.delete(otp_record)
                await local_session.commit()

                async with GlobalSessionLocal() as g_session:
                    await g_session.execute(
                        update(UserRouteMap)
                        .where(UserRouteMap.email == email)
                        .values(status="locked")
                    )
                    await g_session.commit()

                await _log_login(local_session, email, "locked", request)
                await _log_audit(country, email, "account_locked", "auth", request)
                raise HTTPException(status_code=403, detail="OTP 錯誤次數過多，帳號已鎖定")

            await local_session.commit()
            await _log_login(local_session, email, "failed", request)
            remaining = settings.OTP_MAX_RETRIES - otp_record.retries
            raise HTTPException(
                status_code=401,
                detail=f"OTP 驗證失敗，剩餘 {remaining} 次嘗試機會"
            )

        # 5. 驗證成功 → 刪除 OTP
        await local_session.delete(otp_record)
        await local_session.commit()

    finally:
        await local_session.close()

    # 6. 記錄登入成功
    local_session2 = await data_router.get_local_pg(country)
    try:
        await _log_login(local_session2, email, "success", request)
        await local_session2.commit()
    finally:
        await local_session2.close()

    # 7. 更新 Global DB last_login_at
    async with GlobalSessionLocal() as g_session:
        await g_session.execute(
            update(UserRouteMap)
            .where(UserRouteMap.email == email)
            .values(last_login_at=datetime.now(timezone.utc))
        )
        await g_session.commit()

    # 8. 同步脫敏稽核到 Global
    await _log_audit(country, email, "login_success", "auth", request)

    # 9. 產生 JWT
    permissions = get_role_permissions(user.role)
    token = create_access_token({
        "sub": email,
        "role": user.role,
        "country": country,
        "name": user.name,
    })

    return TokenResponse(
        access_token=token,
        user=UserInfo(
            email=email,
            name=user.name,
            role=user.role,
            department=user.department,
            country=country,
            permissions=permissions,
        ),
    )


@router.get("/me", response_model=UserInfo)
async def get_current_user(payload: dict = Depends(get_current_user_payload)):
    """取得當前使用者資訊"""
    email = payload["sub"]

    async with GlobalSessionLocal() as session:
        result = await session.execute(
            select(UserRouteMap).where(UserRouteMap.email == email)
        )
        user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    permissions = get_role_permissions(user.role)

    return UserInfo(
        email=user.email,
        name=user.name,
        role=user.role,
        department=user.department,
        country=user.country_code,
        permissions=permissions,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(payload: dict = Depends(get_current_user_payload)):
    """登出（前端清除 token，後端記錄稽核）"""
    email = payload["sub"]
    country = payload.get("country", "TW")
    await _log_audit(country, email, "logout", "auth")
    return MessageResponse(message="已登出")


# === 內部工具函式 ===

async def _log_login(session, email: str, status: str, request: Request = None):
    """記錄登入稽核到 Local DB"""
    audit = LoginAudit(
        email=email,
        status=status,
        ip_address=request.client.host if request else None,
        user_agent=request.headers.get("user-agent") if request else None,
    )
    session.add(audit)


async def _log_audit(country: str, email: str, action: str, target: str, request: Request = None):
    """記錄脫敏稽核到 Global DB"""
    try:
        async with GlobalSessionLocal() as session:
            log = GlobalAuditLog(
                user_email=email,
                action=action,
                target=target,
                country_code=country,
            )
            session.add(log)
            await session.commit()
    except Exception as e:
        logger.error(f"稽核記錄失敗: {e}")
