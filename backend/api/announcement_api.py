"""
公告 API：CRUD + 發布/取消發布
公告存在 Local DB（各國 PostgreSQL），國家隔離
super_admin 可跨國查看（透過 ?country=XX 參數）
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import delete, select, update

from config import settings
from core.data_router import data_router
from core.local_database import local_db_factory
from core.permissions import require_permission
from core.security import get_current_user_payload
from models.local_models import LocalNotice
from models.schemas import (
    AnnouncementCreate,
    AnnouncementResponse,
    AnnouncementUpdate,
    MessageResponse,
)
from services.storage_service import storage_service
from services.pii_service import get_pii_service

logger = logging.getLogger(__name__)
router = APIRouter()


def _resolve_country(payload: dict, query_country: Optional[str] = None) -> str:
    """
    解析要查詢的國家：
    - super_admin 可透過 query param 指定國家
    - 其他角色只能查自己的國家
    """
    user_country = payload.get("country", "TW")
    role = payload.get("role", "user")

    if query_country and query_country != user_country:
        if role != "super_admin":
            raise HTTPException(status_code=403, detail="只有最高管理者可以跨國查看")
        if query_country not in settings.LOCAL_DB_CONFIG:
            raise HTTPException(status_code=400, detail=f"國家 [{query_country}] 不存在")
        return query_country

    return user_country


@router.get("", response_model=List[AnnouncementResponse])
async def list_announcements(
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
    limit: Optional[int] = Query(None, description="回傳筆數上限（不指定則回傳全部）"),
    payload: dict = Depends(get_current_user_payload),
):
    """取得公告列表（已發布的）"""
    target_country = _resolve_country(payload, country)
    session = await data_router.get_local_pg(target_country)
    try:
        stmt = (
            select(LocalNotice)
            .where(LocalNotice.publish_status == "published")
            .order_by(LocalNotice.created_at.desc())
        )
        if limit and limit > 0:
            stmt = stmt.limit(limit)
        result = await session.execute(stmt)
        notices = result.scalars().all()
        return [_notice_to_response(n) for n in notices]
    finally:
        await session.close()


@router.get("/all", response_model=List[AnnouncementResponse])
async def list_all_announcements(
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
    payload: dict = Depends(require_permission("manage_announcements")),
):
    """取得所有公告（含未發布，管理用）"""
    target_country = _resolve_country(payload, country)
    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalNotice).order_by(LocalNotice.created_at.desc())
        )
        notices = result.scalars().all()
        return [_notice_to_response(n) for n in notices]
    finally:
        await session.close()


@router.post("", response_model=MessageResponse)
async def create_announcement(
    body: AnnouncementCreate,
    country: Optional[str] = Query(None, description="目標國家（僅 super_admin 可跨國建立）"),
    payload: dict = Depends(require_permission("manage_announcements")),
):
    """新增公告（不含附件，僅建立記錄）"""
    target_country = _resolve_country(payload, country)
    session = await data_router.get_local_pg(target_country)
    try:
        notice = LocalNotice(
            subject=body.subject,
            content_en=body.content_en,
            files=body.files or [],
            library_docs=body.library_docs or [],
            publish_status=body.publish_status,
        )
        session.add(notice)
        await session.commit()
        return MessageResponse(message="公告已新增", detail=str(notice.notice_id))
    finally:
        await session.close()


@router.post("/create-with-files", response_model=MessageResponse)
async def create_announcement_with_files(
    request: Request,
    subject: str = Query(..., description="公告標題"),
    content_en: str = Query("", description="公告內容"),
    publish_status: str = Query("published", description="發布狀態"),
    country: Optional[str] = Query(None, description="目標國家（僅 super_admin 可跨國建立）"),
    payload: dict = Depends(require_permission("manage_announcements")),
):
    """
    一步到位建立公告（含附件上傳 + PII 掃描）

    如果附件被 PII 偵測擋下，公告記錄也會一併回滾刪除，
    避免留下沒有附件的空公告。
    """
    target_country = _resolve_country(payload, country)

    # 步驟 1：建立公告 DB 記錄
    session = await data_router.get_local_pg(target_country)
    try:
        notice = LocalNotice(
            subject=subject,
            content_en=content_en,
            files=[],
            publish_status=publish_status,
        )
        session.add(notice)
        await session.commit()
        await session.refresh(notice)
        notice_id = str(notice.notice_id)
    finally:
        await session.close()

    # 步驟 2：處理多檔案上傳
    new_files = []
    content_type_header = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type_header:
        try:
            form = await request.form()
            uploaded_files = form.getlist("file")
            if not uploaded_files:
                single_file = form.get("file")
                if single_file and hasattr(single_file, 'filename') and single_file.filename:
                    uploaded_files = [single_file]

            for uploaded_file in uploaded_files:
                if hasattr(uploaded_file, 'filename') and uploaded_file.filename:
                    file_info = await storage_service.save_file(
                        target_country, "announcements", notice_id, uploaded_file
                    )
                    file_entry = {
                        "name": file_info["original_filename"],
                        "file_url": f"/api/announcements/{notice_id}/download?country={target_country}&filename={file_info['original_filename']}",
                        "file_size": file_info["file_size"],
                        "storage_path": file_info["relative_path"],
                    }
                    new_files.append(file_entry)
        except Exception as e:
            # 檔案上傳失敗 → 回滾：刪除公告記錄
            logger.warning(f"公告附件上傳失敗，回滾公告記錄: {e}")
            storage_service.delete_files(target_country, "announcements", notice_id)
            session = await data_router.get_local_pg(target_country)
            try:
                await session.execute(
                    delete(LocalNotice).where(LocalNotice.notice_id == notice_id)
                )
                await session.commit()
            finally:
                await session.close()
            raise HTTPException(status_code=500, detail=f"檔案上傳失敗: {str(e)}")

    # 步驟 3：PII 掃描
    pii_warning = ""
    try:
        pii_svc = get_pii_service()
        if pii_svc.enabled and new_files:
            for fi in new_files:
                file_path = storage_service.get_file_path(
                    target_country, "announcements", notice_id, fi["name"]
                )
                if file_path:
                    scan_result = await pii_svc.scan_file(file_path)
                    fi["pii_detected"] = scan_result.has_pii
                    fi["pii_entity_count"] = scan_result.entity_count
                    fi["pii_entity_types"] = scan_result.entity_types
                    if scan_result.has_pii:
                        logger.warning(
                            f"⚠️ PII 偵測: 公告附件 {notice_id}/{fi['name']} "
                            f"含 {scan_result.entity_count} 個 PII 實體 "
                            f"({', '.join(scan_result.entity_types)})"
                        )
            pii_files = [f for f in new_files if f.get("pii_detected")]
            if pii_files:
                if settings.PII_BLOCK_UPLOAD:
                    # 阻擋模式：刪除檔案 + 回滾公告記錄
                    storage_service.delete_files(target_country, "announcements", notice_id)
                    session = await data_router.get_local_pg(target_country)
                    try:
                        await session.execute(
                            delete(LocalNotice).where(LocalNotice.notice_id == notice_id)
                        )
                        await session.commit()
                    finally:
                        await session.close()
                    blocked_details = []
                    for pf in pii_files:
                        types_str = ", ".join(pf.get("pii_entity_types", []))
                        blocked_details.append(
                            f"「{pf['name']}」含 {pf.get('pii_entity_count', 0)} 個 PII（{types_str}）"
                        )
                    raise HTTPException(
                        status_code=422,
                        detail=f"上傳被拒絕：偵測到個人敏感資訊（PII）。{'; '.join(blocked_details)}。請移除敏感資訊後重新上傳。",
                    )
                else:
                    pii_warning = f"⚠️ {len(pii_files)} 個檔案偵測到個人敏感資訊（PII）"
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"⚠️ PII 掃描失敗（不影響上傳）: {e}")

    # 步驟 4：更新公告的 files JSONB
    if new_files:
        # 清除 PII 掃描的臨時欄位
        clean_files = []
        for f in new_files:
            clean_files.append({
                "name": f["name"],
                "file_url": f["file_url"],
                "file_size": f["file_size"],
                "storage_path": f["storage_path"],
            })
        session = await data_router.get_local_pg(target_country)
        try:
            await session.execute(
                update(LocalNotice)
                .where(LocalNotice.notice_id == notice_id)
                .values(files=clean_files)
            )
            await session.commit()
        finally:
            await session.close()

    msg = "公告已新增"
    if new_files:
        msg += f"（含 {len(new_files)} 個附件）"
    if pii_warning:
        msg += f"。{pii_warning}"
    return MessageResponse(message=msg, detail=notice_id)


@router.put("/{notice_id}", response_model=MessageResponse)
async def update_announcement(
    notice_id: str,
    body: AnnouncementUpdate,
    country: Optional[str] = Query(None, description="目標國家（僅 super_admin 可跨國編輯）"),
    payload: dict = Depends(require_permission("manage_announcements")),
):
    """編輯公告"""
    target_country = _resolve_country(payload, country)
    update_data = {}
    if body.subject is not None:
        update_data["subject"] = body.subject
    if body.content_en is not None:
        update_data["content_en"] = body.content_en
    if body.publish_status is not None:
        update_data["publish_status"] = body.publish_status
    if body.files is not None:
        update_data["files"] = body.files
    if body.library_docs is not None:
        update_data["library_docs"] = body.library_docs

    if not update_data:
        raise HTTPException(status_code=400, detail="沒有要更新的欄位")

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            update(LocalNotice)
            .where(LocalNotice.notice_id == notice_id)
            .values(**update_data)
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="公告不存在")
        await session.commit()
        return MessageResponse(message="公告已更新")
    finally:
        await session.close()


@router.delete("/{notice_id}", response_model=MessageResponse)
async def delete_announcement(
    notice_id: str,
    country: Optional[str] = Query(None, description="目標國家（僅 super_admin 可跨國刪除）"),
    payload: dict = Depends(require_permission("manage_announcements")),
):
    """刪除公告"""
    target_country = _resolve_country(payload, country)
    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            delete(LocalNotice).where(LocalNotice.notice_id == notice_id)
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="公告不存在")
        await session.commit()
    finally:
        await session.close()

    # 刪除附件檔案
    storage_service.delete_files(target_country, "announcements", notice_id)

    return MessageResponse(message="公告已刪除")


@router.post("/upload-file", response_model=MessageResponse)
async def upload_announcement_file(
    request: Request,
    notice_id: str = Query(..., description="公告 ID"),
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
    payload: dict = Depends(require_permission("manage_announcements")),
):
    """上傳公告附件（支援多檔案）"""
    target_country = _resolve_country(payload, country)

    # 驗證公告存在
    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalNotice).where(LocalNotice.notice_id == notice_id)
        )
        notice = result.scalar_one_or_none()
        if not notice:
            raise HTTPException(status_code=404, detail="公告不存在")
        current_files = list(notice.files or [])
    finally:
        await session.close()

    # 處理多檔案上傳
    new_files = []
    content_type_header = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type_header:
        try:
            form = await request.form()
            # 嘗試 getlist 取得多個同名欄位
            uploaded_files = form.getlist("file")
            if not uploaded_files:
                # fallback: 單一 file 欄位
                single_file = form.get("file")
                if single_file and hasattr(single_file, 'filename') and single_file.filename:
                    uploaded_files = [single_file]

            for uploaded_file in uploaded_files:
                if hasattr(uploaded_file, 'filename') and uploaded_file.filename:
                    file_info = await storage_service.save_file(
                        target_country, "announcements", notice_id, uploaded_file
                    )
                    file_entry = {
                        "name": file_info["original_filename"],
                        "file_url": f"/api/announcements/{notice_id}/download?country={target_country}&filename={file_info['original_filename']}",
                        "file_size": file_info["file_size"],
                        "storage_path": file_info["relative_path"],
                    }
                    new_files.append(file_entry)
        except Exception as e:
            logger.warning(f"公告附件上傳失敗: {e}")
            raise HTTPException(status_code=500, detail=f"檔案上傳失敗: {str(e)}")

    if not new_files:
        raise HTTPException(status_code=400, detail="未收到任何檔案")

    # PII 掃描新上傳的附件
    pii_warning = ""
    try:
        pii_svc = get_pii_service()
        if pii_svc.enabled and new_files:
            for fi in new_files:
                file_path = storage_service.get_file_path(
                    target_country, "announcements", notice_id, fi["name"]
                )
                if file_path:
                    scan_result = await pii_svc.scan_file(file_path)
                    fi["pii_detected"] = scan_result.has_pii
                    fi["pii_entity_count"] = scan_result.entity_count
                    fi["pii_entity_types"] = scan_result.entity_types
                    if scan_result.has_pii:
                        logger.warning(
                            f"⚠️ PII 偵測: 公告附件 {notice_id}/{fi['name']} "
                            f"含 {scan_result.entity_count} 個 PII 實體 "
                            f"({', '.join(scan_result.entity_types)})"
                        )
            pii_files = [f for f in new_files if f.get("pii_detected")]
            if pii_files:
                if settings.PII_BLOCK_UPLOAD:
                    # 阻擋模式：刪除本次新上傳的檔案（不影響已有附件）
                    for fi in new_files:
                        storage_service.delete_single_file(
                            target_country, "announcements", notice_id, fi["name"]
                        )
                    blocked_details = []
                    for pf in pii_files:
                        types_str = ", ".join(pf.get("pii_entity_types", []))
                        blocked_details.append(
                            f"「{pf['name']}」含 {pf.get('pii_entity_count', 0)} 個 PII（{types_str}）"
                        )
                    raise HTTPException(
                        status_code=422,
                        detail=f"上傳被拒絕：偵測到個人敏感資訊（PII）。{'; '.join(blocked_details)}。請移除敏感資訊後重新上傳。",
                    )
                else:
                    pii_warning = f"⚠️ {len(pii_files)} 個檔案偵測到個人敏感資訊（PII）"
    except HTTPException:
        raise  # 重新拋出 PII 阻擋的 HTTPException
    except Exception as e:
        logger.warning(f"⚠️ PII 掃描失敗（不影響上傳）: {e}")

    # 更新公告的 files JSONB（追加）
    current_files.extend(new_files)
    session = await data_router.get_local_pg(target_country)
    try:
        await session.execute(
            update(LocalNotice)
            .where(LocalNotice.notice_id == notice_id)
            .values(files=current_files)
        )
        await session.commit()
    finally:
        await session.close()

    uploaded_names = [f["name"] for f in new_files]
    msg = f"已上傳 {len(new_files)} 個附件"
    if pii_warning:
        msg += f"。{pii_warning}"
    return MessageResponse(
        message=msg,
        detail=", ".join(uploaded_names),
    )


@router.delete("/{notice_id}/file", response_model=MessageResponse)
async def delete_announcement_file(
    notice_id: str,
    filename: str = Query(..., description="要刪除的附件檔名"),
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
    payload: dict = Depends(require_permission("manage_announcements")),
):
    """刪除公告的單一附件"""
    target_country = _resolve_country(payload, country)

    # 取得公告
    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalNotice).where(LocalNotice.notice_id == notice_id)
        )
        notice = result.scalar_one_or_none()
        if not notice:
            raise HTTPException(status_code=404, detail="公告不存在")

        current_files = list(notice.files or [])
    finally:
        await session.close()

    # 找到並移除指定 filename 的 entry
    file_entry = next((f for f in current_files if f.get("name") == filename), None)
    if not file_entry:
        raise HTTPException(status_code=404, detail=f"找不到附件：{filename}")

    current_files.remove(file_entry)

    # 刪除實體檔案
    storage_service.delete_single_file(target_country, "announcements", notice_id, filename)

    # 更新 DB 的 files JSONB
    session = await data_router.get_local_pg(target_country)
    try:
        await session.execute(
            update(LocalNotice)
            .where(LocalNotice.notice_id == notice_id)
            .values(files=current_files)
        )
        await session.commit()
    finally:
        await session.close()

    return MessageResponse(message=f"附件「{filename}」已刪除")


@router.get("/{notice_id}/download")
async def download_announcement_file(
    notice_id: str,
    filename: Optional[str] = Query(None, description="指定下載的檔案名稱（多附件時使用）"),
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
    payload: dict = Depends(get_current_user_payload),
):
    """下載公告附件（支援指定檔名下載）"""
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalNotice).where(LocalNotice.notice_id == notice_id)
        )
        notice = result.scalar_one_or_none()
    finally:
        await session.close()

    if not notice:
        raise HTTPException(status_code=404, detail="公告不存在")

    files = notice.files or []
    if not files:
        raise HTTPException(status_code=404, detail="此公告沒有附件")

    # 決定要下載哪個檔案
    if filename:
        file_entry = next((f for f in files if f.get("name") == filename), None)
        if not file_entry:
            raise HTTPException(status_code=404, detail=f"找不到附件：{filename}")
        original_filename = filename
    else:
        file_entry = files[0]
        original_filename = file_entry.get("name", "attachment")

    file_path = storage_service.get_file_path(target_country, "announcements", notice_id, original_filename)
    if not file_path:
        raise HTTPException(status_code=404, detail="附件檔案不存在")

    return FileResponse(
        path=str(file_path),
        filename=original_filename,
        media_type="application/octet-stream",
    )


@router.get("/{notice_id}/preview")
async def preview_announcement_file(
    notice_id: str,
    filename: Optional[str] = Query(None, description="指定預覽的檔案名稱（多附件時使用）"),
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
    payload: dict = Depends(get_current_user_payload),
):
    """預覽公告附件（僅支援 PDF，回傳 application/pdf 供 iframe 嵌入）"""
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalNotice).where(LocalNotice.notice_id == notice_id)
        )
        notice = result.scalar_one_or_none()
    finally:
        await session.close()

    if not notice:
        raise HTTPException(status_code=404, detail="公告不存在")

    files = notice.files or []
    if not files:
        raise HTTPException(status_code=404, detail="此公告沒有附件")

    # 決定要預覽哪個檔案
    if filename:
        file_entry = next((f for f in files if f.get("name") == filename), None)
        if not file_entry:
            raise HTTPException(status_code=404, detail=f"找不到附件：{filename}")
        target_filename = filename
    else:
        file_entry = files[0]
        target_filename = file_entry.get("name", "attachment")

    # 僅支援 PDF 預覽
    if not target_filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail=f"不支援預覽此檔案格式：{target_filename}（僅支援 PDF）"
        )

    file_path = storage_service.get_file_path(target_country, "announcements", notice_id, target_filename)
    if not file_path:
        raise HTTPException(status_code=404, detail="附件檔案不存在")

    return FileResponse(
        path=str(file_path),
        filename=target_filename,
        media_type="application/pdf",
    )


def _notice_to_response(notice: LocalNotice) -> AnnouncementResponse:
    return AnnouncementResponse(
        notice_id=str(notice.notice_id),
        subject=notice.subject,
        content_en=notice.content_en,
        files=notice.files or [],
        library_docs=notice.library_docs or [],
        publish_status=notice.publish_status,
        created_at=notice.created_at,
        updated_at=notice.updated_at,
    )
