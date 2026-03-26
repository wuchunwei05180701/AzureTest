"""
圖書館 API：文件 CRUD + 權限設定 + 上傳/下載 + 館名目錄管理
圖書館存在 Local DB（各國 PostgreSQL），國家隔離
root 可跨國查看（透過 ?country=XX 參數）
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import delete, select, update, func, and_

from config import settings
from core.data_router import data_router
from core.local_database import local_db_factory
from core.permissions import has_permission, require_permission
from core.security import get_current_user_payload
from models.local_models import LocalLibrary, LocalLibraryCatalog
from models.schemas import (
    LibraryAuthUpdate,
    LibraryCatalogCreate,
    LibraryCatalogUpdate,
    LibraryCatalogResponse,
    LibraryDocCreate,
    LibraryDocResponse,
    LibraryDocUpdate,
    MessageResponse,
)
from services.storage_service import storage_service
from services.pii_service import get_pii_service
from utils.audit_logger import audit_log, AuditAction

logger = logging.getLogger(__name__)
router = APIRouter()


def _resolve_country(payload: dict, query_country: Optional[str] = None) -> str:
    """
    解析要查詢的國家：
    - root 可透過 query param 指定國家
    - 其他角色只能查自己的國家
    """
    user_country = payload.get("country", "TW")
    role = payload.get("role", "user")

    if query_country and query_country != user_country:
        if role != "root":
            raise HTTPException(status_code=403, detail="只有最高管理者可以跨國查看")
        # 驗證國家是否存在
        if query_country not in settings.LOCAL_DB_CONFIG:
            raise HTTPException(status_code=400, detail=f"國家 [{query_country}] 不存在")
        return query_country

    return user_country


# ===== 館名目錄 (Catalog) API =====

@router.get("/catalogs", response_model=List[LibraryCatalogResponse])
async def list_catalogs(
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(get_current_user_payload),
):
    """取得所有館名列表（含各館文件數量）"""
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        # 取得所有 catalog
        cat_result = await session.execute(
            select(LocalLibraryCatalog).order_by(LocalLibraryCatalog.library_name)
        )
        catalogs = cat_result.scalars().all()

        # 計算每個館的文件數量
        count_result = await session.execute(
            select(
                LocalLibrary.library_name,
                func.count(LocalLibrary.doc_id).label("doc_count"),
            ).group_by(LocalLibrary.library_name)
        )
        count_map = {row.library_name: row.doc_count for row in count_result}
    finally:
        await session.close()

    return [
        LibraryCatalogResponse(
            catalog_id=str(cat.catalog_id),
            library_name=cat.library_name,
            description=cat.description,
            image_url=cat.image_url,
            doc_count=count_map.get(cat.library_name, 0),
            created_at=cat.created_at,
        )
        for cat in catalogs
    ]


@router.post("/catalogs", response_model=LibraryCatalogResponse)
async def create_catalog(
    body: LibraryCatalogCreate,
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """手動建立新館（不需要同時上傳文件）"""
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        # 檢查是否已存在
        existing = await session.execute(
            select(LocalLibraryCatalog).where(
                LocalLibraryCatalog.library_name == body.library_name
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"館名「{body.library_name}」已存在")

        catalog = LocalLibraryCatalog(
            library_name=body.library_name,
            description=body.description,
        )
        session.add(catalog)
        await session.commit()
        await session.refresh(catalog)
    finally:
        await session.close()

    return LibraryCatalogResponse(
        catalog_id=str(catalog.catalog_id),
        library_name=catalog.library_name,
        description=catalog.description,
        image_url=catalog.image_url,
        doc_count=0,
        created_at=catalog.created_at,
    )


@router.put("/catalogs/{catalog_id}", response_model=LibraryCatalogResponse)
async def update_catalog(
    catalog_id: str,
    body: LibraryCatalogUpdate,
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """更新館名或描述（若館名變更，同步更新所有文件的 library_name）"""
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibraryCatalog).where(
                LocalLibraryCatalog.catalog_id == catalog_id
            )
        )
        catalog = result.scalar_one_or_none()
        if not catalog:
            raise HTTPException(status_code=404, detail="館不存在")

        old_name = catalog.library_name
        update_data = {}

        if body.library_name is not None and body.library_name != old_name:
            # 檢查新館名是否已存在
            dup = await session.execute(
                select(LocalLibraryCatalog).where(
                    LocalLibraryCatalog.library_name == body.library_name
                )
            )
            if dup.scalar_one_or_none():
                raise HTTPException(status_code=400, detail=f"館名「{body.library_name}」已存在")
            update_data["library_name"] = body.library_name

        if body.description is not None:
            update_data["description"] = body.description

        if not update_data:
            raise HTTPException(status_code=400, detail="沒有要更新的欄位")

        # 更新 catalog
        await session.execute(
            update(LocalLibraryCatalog)
            .where(LocalLibraryCatalog.catalog_id == catalog_id)
            .values(**update_data)
        )

        # 若館名有變更，同步更新所有文件的 library_name
        if "library_name" in update_data:
            await session.execute(
                update(LocalLibrary)
                .where(LocalLibrary.library_name == old_name)
                .values(library_name=update_data["library_name"])
            )
            logger.info(f"館名已更新: {old_name} → {update_data['library_name']} ({target_country})")

        await session.commit()
        await session.refresh(catalog)
    finally:
        await session.close()

    # 計算文件數量
    session = await data_router.get_local_pg(target_country)
    try:
        count_result = await session.execute(
            select(func.count(LocalLibrary.doc_id)).where(
                LocalLibrary.library_name == catalog.library_name
            )
        )
        doc_count = count_result.scalar() or 0
    finally:
        await session.close()

    return LibraryCatalogResponse(
        catalog_id=str(catalog.catalog_id),
        library_name=catalog.library_name,
        description=catalog.description,
        image_url=catalog.image_url,
        doc_count=doc_count,
        created_at=catalog.created_at,
    )


@router.post("/catalogs/{catalog_id}/image", response_model=MessageResponse)
async def upload_catalog_image(
    catalog_id: str,
    file: UploadFile = File(...),
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """上傳館封面圖片（僅限 PNG/JPG）"""
    target_country = _resolve_country(payload, country)

    # 驗證檔案類型
    if not file.filename:
        raise HTTPException(status_code=400, detail="未提供檔案")
    ext = file.filename.lower().rsplit('.', 1)[-1] if '.' in file.filename else ''
    if ext not in ('png', 'jpg', 'jpeg'):
        raise HTTPException(status_code=400, detail="僅支援 PNG 或 JPG 格式")

    # 驗證檔案大小（5MB 上限）
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="圖片大小不可超過 5MB")
    await file.seek(0)

    # 驗證 catalog 存在
    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibraryCatalog).where(
                LocalLibraryCatalog.catalog_id == catalog_id
            )
        )
        catalog = result.scalar_one_or_none()
        if not catalog:
            raise HTTPException(status_code=404, detail="館不存在")
    finally:
        await session.close()

    # 刪除舊圖片（如果有的話）
    if catalog.image_url:
        storage_service.delete_files(target_country, "catalog", catalog_id)

    # 重新命名檔案為 cover.{ext}（避免超長中文檔名導致 OS 錯誤）
    file.filename = f"cover.{ext}"

    # 儲存圖片
    file_result = await storage_service.save_file(
        target_country, "catalog", catalog_id, file
    )

    # 更新 DB
    session = await data_router.get_local_pg(target_country)
    try:
        await session.execute(
            update(LocalLibraryCatalog)
            .where(LocalLibraryCatalog.catalog_id == catalog_id)
            .values(image_url=file_result["relative_path"])
        )
        await session.commit()
    finally:
        await session.close()

    logger.info(f"館封面圖片已上傳: catalog_id={catalog_id}, path={file_result['relative_path']}")
    return MessageResponse(message="封面圖片已上傳", detail=file_result["relative_path"])


@router.delete("/catalogs/{catalog_id}/image", response_model=MessageResponse)
async def delete_catalog_image(
    catalog_id: str,
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """刪除館封面圖片"""
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibraryCatalog).where(
                LocalLibraryCatalog.catalog_id == catalog_id
            )
        )
        catalog = result.scalar_one_or_none()
        if not catalog:
            raise HTTPException(status_code=404, detail="館不存在")
        if not catalog.image_url:
            raise HTTPException(status_code=404, detail="該館沒有封面圖片")
    finally:
        await session.close()

    # 刪除實體檔案
    storage_service.delete_files(target_country, "catalog", catalog_id)

    # 更新 DB
    session = await data_router.get_local_pg(target_country)
    try:
        await session.execute(
            update(LocalLibraryCatalog)
            .where(LocalLibraryCatalog.catalog_id == catalog_id)
            .values(image_url=None)
        )
        await session.commit()
    finally:
        await session.close()

    logger.info(f"館封面圖片已刪除: catalog_id={catalog_id}")
    return MessageResponse(message="封面圖片已刪除")


@router.get("/catalogs/{catalog_id}/image")
async def get_catalog_image(
    catalog_id: str,
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(get_current_user_payload),
):
    """取得館封面圖片"""
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibraryCatalog).where(
                LocalLibraryCatalog.catalog_id == catalog_id
            )
        )
        catalog = result.scalar_one_or_none()
        if not catalog or not catalog.image_url:
            raise HTTPException(status_code=404, detail="圖片不存在")
    finally:
        await session.close()

    # 從 image_url 解析出實際路徑
    # image_url 格式: "uploads/{country}/catalog/{catalog_id}/{filename}"
    parts = catalog.image_url.split('/')
    if len(parts) >= 5:
        filename = parts[-1]
    else:
        raise HTTPException(status_code=404, detail="圖片路徑無效")

    file_path = storage_service.get_file_path(
        target_country, "catalog", catalog_id, filename
    )
    if not file_path:
        raise HTTPException(status_code=404, detail="圖片檔案不存在")

    # 判斷 media type
    ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
    media_type = "image/png" if ext == "png" else "image/jpeg"

    return FileResponse(path=str(file_path), media_type=media_type)


# ===== 文件列表 API =====

@router.get("", response_model=List[LibraryDocResponse])
async def list_library(
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(get_current_user_payload),
):
    """取得圖書館文件列表（依授權過濾）"""
    email = payload["sub"]
    role = payload.get("role", "user")
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibrary).order_by(LocalLibrary.library_name, LocalLibrary.name)
        )
        all_docs = result.scalars().all()
    finally:
        await session.close()

    # root / admin 看到全部
    if has_permission(role, "access_all_docs"):
        return [_doc_to_response(d) for d in all_docs]

    # 其他角色依 auth_rules 過濾
    authorized_docs = []
    for doc in all_docs:
        if _check_doc_auth(doc.auth_rules, email, role):
            authorized_docs.append(doc)

    return [_doc_to_response(d) for d in authorized_docs]


@router.get("/latest", response_model=List[LibraryDocResponse])
async def list_latest_library(
    limit: int = Query(4, ge=1, le=20, description="回傳筆數"),
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(get_current_user_payload),
):
    """取得最新的圖書館文件（按建立時間倒序，供首頁展示）"""
    email = payload["sub"]
    role = payload.get("role", "user")
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibrary).order_by(LocalLibrary.created_at.desc())
        )
        all_docs = result.scalars().all()
    finally:
        await session.close()

    # 權限過濾
    if has_permission(role, "access_all_docs"):
        filtered = all_docs
    else:
        filtered = [d for d in all_docs if _check_doc_auth(d.auth_rules, email, role)]

    # 取前 N 筆
    return [_doc_to_response(d) for d in filtered[:limit]]


@router.get("/all", response_model=List[LibraryDocResponse])
async def list_all_library(
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """取得所有文件（管理用）"""
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibrary).order_by(LocalLibrary.library_name, LocalLibrary.name)
        )
        docs = result.scalars().all()
    finally:
        await session.close()

    return [_doc_to_response(d) for d in docs]


@router.post("/upload", response_model=MessageResponse)
async def upload_document(
    request: Request,
    library_name: str = Query(..., description="館名"),
    name: str = Query(..., description="文件名稱"),
    description: str = Query("", description="文件描述"),
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """上傳文件至本國圖書館（支援多檔案）"""
    target_country = _resolve_country(payload, country)

    # 自動建立 catalog（如果不存在）
    session = await data_router.get_local_pg(target_country)
    try:
        existing_cat = await session.execute(
            select(LocalLibraryCatalog).where(
                LocalLibraryCatalog.library_name == library_name
            )
        )
        if not existing_cat.scalar_one_or_none():
            new_cat = LocalLibraryCatalog(library_name=library_name)
            session.add(new_cat)
            await session.commit()
            logger.info(f"自動建立 catalog: {library_name} ({target_country})")
    finally:
        await session.close()

    # 建立文件 DB 記錄
    session = await data_router.get_local_pg(target_country)
    try:
        doc = LocalLibrary(
            library_name=library_name,
            name=name,
            description=description,
            metadata_json={},
            file_url=None,
            files_json=[],
        )
        session.add(doc)
        await session.commit()
        await session.refresh(doc)
        doc_id = str(doc.doc_id)
    finally:
        await session.close()

    # 處理多檔案上傳
    files_info = []
    first_file_url = None
    content_type_header = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type_header:
        try:
            form = await request.form()
            # 取得所有名為 "file" 的上傳檔案
            for key in form:
                if key == "file":
                    uploaded_file = form[key]
                    if hasattr(uploaded_file, 'filename') and uploaded_file.filename:
                        result = await storage_service.save_file(
                            target_country, "library", doc_id, uploaded_file
                        )
                        files_info.append({
                            "filename": result["original_filename"],
                            "relative_path": result["relative_path"],
                            "file_size": result["file_size"],
                        })
                        if first_file_url is None:
                            first_file_url = result["relative_path"]

            # form.getlist 方式取得多個同名欄位
            if not files_info:
                uploaded_files = form.getlist("file")
                for uploaded_file in uploaded_files:
                    if hasattr(uploaded_file, 'filename') and uploaded_file.filename:
                        result = await storage_service.save_file(
                            target_country, "library", doc_id, uploaded_file
                        )
                        files_info.append({
                            "filename": result["original_filename"],
                            "relative_path": result["relative_path"],
                            "file_size": result["file_size"],
                        })
                        if first_file_url is None:
                            first_file_url = result["relative_path"]
        except Exception as e:
            logger.warning(f"檔案上傳失敗: {e}")

    # PII 掃描
    pii_scan_results = []
    pii_warning = ""
    try:
        pii_svc = get_pii_service()
        if pii_svc.enabled and files_info:
            from pathlib import Path
            for fi in files_info:
                file_path = storage_service.get_file_path(
                    target_country, "library", doc_id, fi["filename"]
                )
                if file_path:
                    scan_result = await pii_svc.scan_file(file_path)
                    pii_scan_results.append({
                        "filename": fi["filename"],
                        **scan_result.to_dict(),
                    })
                    if scan_result.has_pii:
                        logger.warning(
                            f"⚠️ PII 偵測: 圖書館文件 {doc_id}/{fi['filename']} "
                            f"含 {scan_result.entity_count} 個 PII 實體 "
                            f"({', '.join(scan_result.entity_types)})"
                        )
            # 檢查是否有 PII 檔案
            pii_files = [r for r in pii_scan_results if r.get("has_pii")]
            if pii_files:
                if settings.PII_BLOCK_UPLOAD:
                    # 阻擋模式：清理已儲存的檔案 + 刪除 DB 記錄
                    storage_service.delete_files(target_country, "library", doc_id)
                    session = await data_router.get_local_pg(target_country)
                    try:
                        from sqlalchemy import delete as sql_delete
                        await session.execute(
                            sql_delete(LocalLibrary).where(LocalLibrary.doc_id == doc_id)
                        )
                        await session.commit()
                    finally:
                        await session.close()
                    # 組合被阻擋的檔案資訊
                    blocked_details = []
                    for pf in pii_files:
                        types_str = ", ".join(pf.get("entity_types", []))
                        blocked_details.append(
                            f"「{pf['filename']}」含 {pf.get('entity_count', 0)} 個 PII（{types_str}）"
                        )
                    # 寫入 PII 阻擋稽核日誌
                    audit_log(
                        action=AuditAction.PII_BLOCKED_UPLOAD,
                        operator_email=payload.get("sub", ""),
                        country_code=target_country,
                        target=name,
                        result="failure",
                        error_message=f"PII 偵測阻擋上傳：{'; '.join(blocked_details)}",
                        details={
                            "library_name": library_name,
                            "doc_name": name,
                            "pii_files": pii_files,
                        },
                        request=request,
                    )
                    raise HTTPException(
                        status_code=422,
                        detail=f"上傳被拒絕：偵測到個人敏感資訊（PII）。{'; '.join(blocked_details)}。請移除敏感資訊後重新上傳。",
                    )
                else:
                    # 警告模式（原有行為）
                    pii_warning = f"⚠️ {len(pii_files)} 個檔案偵測到個人敏感資訊（PII）"
    except HTTPException:
        raise  # 重新拋出 PII 阻擋的 HTTPException
    except Exception as e:
        logger.warning(f"⚠️ PII 掃描失敗（不影響上傳）: {e}")

    # 更新 DB
    if files_info:
        metadata = {
            "file_count": len(files_info),
            "total_size": sum(f["file_size"] for f in files_info),
            "original_filename": files_info[0]["filename"] if files_info else None,
        }
        # 加入 PII 掃描結果
        if pii_scan_results:
            metadata["pii_scan"] = pii_scan_results

        session = await data_router.get_local_pg(target_country)
        try:
            await session.execute(
                update(LocalLibrary)
                .where(LocalLibrary.doc_id == doc_id)
                .values(
                    file_url=first_file_url,
                    files_json=files_info,
                    metadata_json=metadata,
                )
            )
            await session.commit()
        finally:
            await session.close()

    msg = "文件已上傳"
    if pii_warning:
        msg += f"。{pii_warning}"

    operator_email = payload.get("sub", "")
    audit_log(
        action=AuditAction.LIBRARY_UPLOAD,
        operator_email=operator_email,
        country_code=target_country,
        target=doc_id,
        details={"library_name": library_name, "doc_name": name, "file_count": len(files_info)},
        request=request,
    )
    return MessageResponse(message=msg, detail=doc_id)


@router.get("/stats/summary")
async def get_library_stats(
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    date_from: Optional[str] = Query(None, description="開始時間（ISO 8601，例如 2026-01-01T00:00:00Z）"),
    date_to: Optional[str] = Query(None, description="結束時間（ISO 8601）"),
    payload: dict = Depends(get_current_user_payload),
):
    """
    取得圖書館文件統計（點擊、預覽、下載次數）
    - 一般使用者：只能查看自己國家
    - root：可透過 country 參數指定國家，不傳則看所有國家
    """
    from core.database import GlobalSessionLocal
    from models.global_models import GlobalAuditLog

    role = payload.get("role", "user")
    user_country = payload.get("country", "")

    # 決定 country 篩選邏輯
    # root：可指定 country，不指定則看所有國家（不加 country 篩選）
    # 其他角色：只能看自己的國家
    if role == "root":
        target_country = country  # 可能是 None（看全部）或指定國家
    else:
        # 非 root：只能看自己的國家，忽略 country 參數
        target_country = user_country or "TW"

    # 解析時間範圍
    dt_from = None
    dt_to = None
    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"date_from 格式錯誤：{date_from}")
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"date_to 格式錯誤：{date_to}")

    # 查詢 global_audit_log 中圖書館相關的操作
    library_actions = [
        AuditAction.LIBRARY_VIEW,
        AuditAction.LIBRARY_PREVIEW,
        AuditAction.LIBRARY_DOWNLOAD,
    ]

    async with GlobalSessionLocal() as session:
        # 建立基本條件
        base_conditions = [
            GlobalAuditLog.action.in_(library_actions),
            GlobalAuditLog.result == "success",
        ]
        # 只有在指定 country 時才加 country 篩選
        if target_country:
            base_conditions.append(GlobalAuditLog.country_code == target_country)
        if dt_from:
            base_conditions.append(GlobalAuditLog.timestamp >= dt_from)
        if dt_to:
            base_conditions.append(GlobalAuditLog.timestamp <= dt_to)

        where_clause = and_(*base_conditions)

        # 1. 總覽統計
        summary_result = await session.execute(
            select(
                GlobalAuditLog.action,
                func.count(GlobalAuditLog.log_id).label("count"),
            )
            .where(where_clause)
            .group_by(GlobalAuditLog.action)
        )
        summary_rows = summary_result.fetchall()
        summary = {row.action: row.count for row in summary_rows}

        # 2. 各文件統計（Top 20）
        doc_result = await session.execute(
            select(
                GlobalAuditLog.target,
                GlobalAuditLog.action,
                func.count(GlobalAuditLog.log_id).label("count"),
            )
            .where(where_clause)
            .group_by(GlobalAuditLog.target, GlobalAuditLog.action)
            .order_by(func.count(GlobalAuditLog.log_id).desc())
            .limit(100)
        )
        doc_rows = doc_result.fetchall()

        # 整理各文件統計
        doc_stats: dict = {}
        for row in doc_rows:
            doc_id_key = row.target
            if doc_id_key not in doc_stats:
                doc_stats[doc_id_key] = {
                    "doc_id": doc_id_key,
                    "doc_name": "",
                    "library_name": "",
                    "views": 0,
                    "previews": 0,
                    "downloads": 0,
                }
            if row.action == AuditAction.LIBRARY_VIEW:
                doc_stats[doc_id_key]["views"] = row.count
            elif row.action == AuditAction.LIBRARY_PREVIEW:
                doc_stats[doc_id_key]["previews"] = row.count
            elif row.action == AuditAction.LIBRARY_DOWNLOAD:
                doc_stats[doc_id_key]["downloads"] = row.count

        # 3. 取得文件名稱（從 details JSON 欄位）
        if doc_stats:
            # 修復：target_country 可能為 None（root 看全部），需要條件判斷
            # 修復：JSONB 欄位用 is_not(None) 而非 isnot(None)
            from sqlalchemy import text as sa_text
            name_conditions = [
                GlobalAuditLog.target.in_(list(doc_stats.keys())),
                GlobalAuditLog.action.in_(library_actions),
                GlobalAuditLog.details != None,  # noqa: E711
            ]
            if target_country:
                name_conditions.append(GlobalAuditLog.country_code == target_country)
            details_result = await session.execute(
                select(
                    GlobalAuditLog.target,
                    GlobalAuditLog.details,
                )
                .where(and_(*name_conditions))
                .order_by(GlobalAuditLog.timestamp.desc())
                .limit(500)
            )
            seen_docs = set()
            for row in details_result.fetchall():
                if row.target not in seen_docs and row.details:
                    doc_stats[row.target]["doc_name"] = row.details.get("doc_name", "")
                    doc_stats[row.target]["library_name"] = row.details.get("library_name", "")
                    seen_docs.add(row.target)

        # 4. 各館統計
        # 使用 literal_column 避免 asyncpg 參數化 GROUP BY 問題
        from sqlalchemy import literal_column
        lib_name_col = literal_column("details->>'library_name'").label("library_name")
        library_result = await session.execute(
            select(
                GlobalAuditLog.action,
                func.count(GlobalAuditLog.log_id).label("count"),
                lib_name_col,
            )
            .where(where_clause)
            .group_by(
                GlobalAuditLog.action,
                literal_column("details->>'library_name'"),
            )
            .order_by(func.count(GlobalAuditLog.log_id).desc())
        )
        library_rows = library_result.fetchall()

        library_stats: dict = {}
        for row in library_rows:
            lib_name = row.library_name or "（未知）"
            if lib_name not in library_stats:
                library_stats[lib_name] = {
                    "library_name": lib_name,
                    "views": 0,
                    "previews": 0,
                    "downloads": 0,
                }
            if row.action == AuditAction.LIBRARY_VIEW:
                library_stats[lib_name]["views"] = row.count
            elif row.action == AuditAction.LIBRARY_PREVIEW:
                library_stats[lib_name]["previews"] = row.count
            elif row.action == AuditAction.LIBRARY_DOWNLOAD:
                library_stats[lib_name]["downloads"] = row.count

        # 5. 每日趨勢（最近 30 天）
        from sqlalchemy import cast, Date as SADate
        trend_result = await session.execute(
            select(
                cast(GlobalAuditLog.timestamp, SADate).label("date"),
                GlobalAuditLog.action,
                func.count(GlobalAuditLog.log_id).label("count"),
            )
            .where(where_clause)
            .group_by(cast(GlobalAuditLog.timestamp, SADate), GlobalAuditLog.action)
            .order_by(cast(GlobalAuditLog.timestamp, SADate))
        )
        trend_rows = trend_result.fetchall()

        trend_map: dict = {}
        for row in trend_rows:
            date_str = str(row.date)
            if date_str not in trend_map:
                trend_map[date_str] = {"date": date_str, "views": 0, "previews": 0, "downloads": 0}
            if row.action == AuditAction.LIBRARY_VIEW:
                trend_map[date_str]["views"] = row.count
            elif row.action == AuditAction.LIBRARY_PREVIEW:
                trend_map[date_str]["previews"] = row.count
            elif row.action == AuditAction.LIBRARY_DOWNLOAD:
                trend_map[date_str]["downloads"] = row.count

        # 6. 以館為主的每日趨勢（日期 + 館名 + action 分組）
        lib_trend_result = await session.execute(
            select(
                cast(GlobalAuditLog.timestamp, SADate).label("date"),
                GlobalAuditLog.action,
                func.count(GlobalAuditLog.log_id).label("count"),
                lib_name_col,
            )
            .where(where_clause)
            .group_by(
                cast(GlobalAuditLog.timestamp, SADate),
                GlobalAuditLog.action,
                literal_column("details->>'library_name'"),
            )
            .order_by(cast(GlobalAuditLog.timestamp, SADate))
        )
        lib_trend_rows = lib_trend_result.fetchall()

        # 整理成 { library_name: { date: { views, downloads, previews } } }
        lib_trend_map: dict = {}
        all_dates = set()
        for row in lib_trend_rows:
            date_str = str(row.date)
            lib_name = row.library_name or "（未知）"
            all_dates.add(date_str)
            if lib_name not in lib_trend_map:
                lib_trend_map[lib_name] = {}
            if date_str not in lib_trend_map[lib_name]:
                lib_trend_map[lib_name][date_str] = {"date": date_str, "views": 0, "previews": 0, "downloads": 0}
            if row.action == AuditAction.LIBRARY_VIEW:
                lib_trend_map[lib_name][date_str]["views"] = row.count
            elif row.action == AuditAction.LIBRARY_PREVIEW:
                lib_trend_map[lib_name][date_str]["previews"] = row.count
            elif row.action == AuditAction.LIBRARY_DOWNLOAD:
                lib_trend_map[lib_name][date_str]["downloads"] = row.count

        # 轉換成前端友好格式：每個館一條線
        sorted_dates = sorted(all_dates)
        daily_trend_by_library = []
        for lib_name, date_map in lib_trend_map.items():
            # 補齊所有日期（沒有資料的日期填 0）
            trend_data = []
            for d in sorted_dates:
                if d in date_map:
                    trend_data.append(date_map[d])
                else:
                    trend_data.append({"date": d, "views": 0, "previews": 0, "downloads": 0})
            daily_trend_by_library.append({
                "library_name": lib_name,
                "trend": trend_data,
            })

    # 排序 top_docs（依 views + downloads 總和）
    top_docs = sorted(
        doc_stats.values(),
        key=lambda x: x["views"] + x["downloads"] + x["previews"],
        reverse=True,
    )[:20]

    return {
        "summary": {
            "total_views": summary.get(AuditAction.LIBRARY_VIEW, 0),
            "total_previews": summary.get(AuditAction.LIBRARY_PREVIEW, 0),
            "total_downloads": summary.get(AuditAction.LIBRARY_DOWNLOAD, 0),
        },
        "top_docs": top_docs,
        "by_library": sorted(
            library_stats.values(),
            key=lambda x: x["views"] + x["downloads"] + x["previews"],
            reverse=True,
        ),
        "daily_trend": list(trend_map.values()),
        "daily_trend_by_library": daily_trend_by_library,
    }


@router.get("/stats/daily-detail")
async def get_daily_detail(
    date: str = Query(..., description="日期（YYYY-MM-DD 格式）"),
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(get_current_user_payload),
):
    """
    取得指定日期的文件閱覽/下載明細
    回傳該天每個文件的 view/preview/download 次數及操作者
    """
    from core.database import GlobalSessionLocal
    from models.global_models import GlobalAuditLog
    from sqlalchemy import cast, Date as SADate

    role = payload.get("role", "user")
    user_country = payload.get("country", "")

    if role == "root":
        target_country = country
    else:
        target_country = user_country or "TW"

    # 解析日期
    try:
        from datetime import date as date_type
        target_date = date_type.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"日期格式錯誤：{date}，請使用 YYYY-MM-DD")

    library_actions = [
        AuditAction.LIBRARY_VIEW,
        AuditAction.LIBRARY_PREVIEW,
        AuditAction.LIBRARY_DOWNLOAD,
    ]

    async with GlobalSessionLocal() as session:
        base_conditions = [
            GlobalAuditLog.action.in_(library_actions),
            GlobalAuditLog.result == "success",
            cast(GlobalAuditLog.timestamp, SADate) == target_date,
        ]
        if target_country:
            base_conditions.append(GlobalAuditLog.country_code == target_country)

        where_clause = and_(*base_conditions)

        # 查詢該天所有圖書館操作記錄
        result = await session.execute(
            select(
                GlobalAuditLog.target,
                GlobalAuditLog.action,
                GlobalAuditLog.user_email,
                GlobalAuditLog.timestamp,
                GlobalAuditLog.details,
            )
            .where(where_clause)
            .order_by(GlobalAuditLog.timestamp.desc())
            .limit(500)
        )
        rows = result.fetchall()

    # 整理成文件維度的統計
    doc_map: dict = {}
    for row in rows:
        doc_id = row.target
        if doc_id not in doc_map:
            doc_name = ""
            library_name = ""
            if row.details:
                doc_name = row.details.get("doc_name", "")
                library_name = row.details.get("library_name", "")
            doc_map[doc_id] = {
                "doc_id": doc_id,
                "doc_name": doc_name,
                "library_name": library_name,
                "views": 0,
                "previews": 0,
                "downloads": 0,
                "users": set(),
                "records": [],
            }
        entry = doc_map[doc_id]
        # 補充名稱（如果之前沒取到）
        if not entry["doc_name"] and row.details:
            entry["doc_name"] = row.details.get("doc_name", "")
            entry["library_name"] = row.details.get("library_name", "")

        if row.action == AuditAction.LIBRARY_VIEW:
            entry["views"] += 1
        elif row.action == AuditAction.LIBRARY_PREVIEW:
            entry["previews"] += 1
        elif row.action == AuditAction.LIBRARY_DOWNLOAD:
            entry["downloads"] += 1

        entry["users"].add(row.user_email)
        action_label = {
            AuditAction.LIBRARY_VIEW: "點擊",
            AuditAction.LIBRARY_PREVIEW: "預覽",
            AuditAction.LIBRARY_DOWNLOAD: "下載",
        }.get(row.action, row.action)
        entry["records"].append({
            "action": action_label,
            "user": row.user_email,
            "time": row.timestamp.strftime("%H:%M:%S") if row.timestamp else "",
        })

    # 轉換 set → list，排序
    docs = []
    for entry in doc_map.values():
        entry["users"] = list(entry["users"])
        entry["total"] = entry["views"] + entry["previews"] + entry["downloads"]
        docs.append(entry)

    docs.sort(key=lambda x: x["total"], reverse=True)

    return {
        "date": date,
        "total_records": len(rows),
        "docs": docs,
    }


@router.delete("/by-library/{library_name}", response_model=MessageResponse)
async def delete_library(
    library_name: str,
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """刪除整個館（僅限空館，同時刪除 catalog 記錄）"""
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        # 檢查該館下是否還有文件
        result = await session.execute(
            select(func.count()).select_from(LocalLibrary).where(
                LocalLibrary.library_name == library_name
            )
        )
        doc_count = result.scalar()

        if doc_count and doc_count > 0:
            raise HTTPException(
                status_code=400,
                detail=f"無法刪除：館「{library_name}」中還有 {doc_count} 個文件，請先刪除所有文件"
            )

        # 刪除 catalog 記錄
        del_result = await session.execute(
            delete(LocalLibraryCatalog).where(
                LocalLibraryCatalog.library_name == library_name
            )
        )
        if del_result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"館「{library_name}」不存在")

        await session.commit()
    finally:
        await session.close()

    return MessageResponse(message=f"館「{library_name}」已刪除")


@router.delete("/{doc_id}", response_model=MessageResponse)
async def delete_document(
    doc_id: str,
    request: Request,
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """刪除文件"""
    target_country = _resolve_country(payload, country)
    operator_email = payload.get("sub", "")

    session = await data_router.get_local_pg(target_country)
    doc_name = doc_id
    library_name = ""
    try:
        # 取得文件資訊
        doc_result = await session.execute(
            select(LocalLibrary).where(LocalLibrary.doc_id == doc_id)
        )
        doc = doc_result.scalar_one_or_none()
        if not doc:
            raise HTTPException(status_code=404, detail="文件不存在")

        doc_name = doc.name
        library_name = doc.library_name

        await session.execute(
            delete(LocalLibrary).where(LocalLibrary.doc_id == doc_id)
        )
        await session.commit()
    finally:
        await session.close()

    # 刪除實體檔案
    storage_service.delete_files(target_country, "library", doc_id)

    audit_log(
        action=AuditAction.LIBRARY_DELETE,
        operator_email=operator_email,
        country_code=target_country,
        target=doc_id,
        details={"doc_name": doc_name, "library_name": library_name},
        request=request,
    )
    return MessageResponse(message="文件已刪除")


@router.put("/{doc_id}", response_model=MessageResponse)
async def update_document(
    doc_id: str,
    body: LibraryDocUpdate,
    request: Request,
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """編輯文件資訊（名稱、描述、館名）"""
    target_country = _resolve_country(payload, country)
    operator_email = payload.get("sub", "")

    update_data = {}
    if body.name is not None:
        update_data["name"] = body.name
    if body.description is not None:
        update_data["description"] = body.description
    if body.library_name is not None:
        update_data["library_name"] = body.library_name

    if not update_data:
        raise HTTPException(status_code=400, detail="沒有要更新的欄位")

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            update(LocalLibrary)
            .where(LocalLibrary.doc_id == doc_id)
            .values(**update_data)
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="文件不存在")
        await session.commit()
    finally:
        await session.close()

    audit_log(
        action=AuditAction.LIBRARY_UPDATE,
        operator_email=operator_email,
        country_code=target_country,
        target=doc_id,
        details=update_data,
        request=request,
    )
    return MessageResponse(message="文件資訊已更新")


@router.delete("/{doc_id}/file", response_model=MessageResponse)
async def delete_document_file(
    doc_id: str,
    filename: str = Query(..., description="要刪除的附件檔名"),
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """刪除文件的單一附件"""
    target_country = _resolve_country(payload, country)

    # 取得文件
    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibrary).where(LocalLibrary.doc_id == doc_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            raise HTTPException(status_code=404, detail="文件不存在")

        current_files = list(doc.files_json or [])
    finally:
        await session.close()

    # 找到並移除指定 filename 的 entry
    file_entry = next((f for f in current_files if f.get("filename") == filename), None)
    if not file_entry:
        raise HTTPException(status_code=404, detail=f"找不到附件：{filename}")

    current_files.remove(file_entry)

    # 刪除實體檔案
    storage_service.delete_single_file(target_country, "library", doc_id, filename)

    # 更新 DB
    new_file_url = None
    if current_files:
        new_file_url = current_files[0].get("relative_path")

    session = await data_router.get_local_pg(target_country)
    try:
        await session.execute(
            update(LocalLibrary)
            .where(LocalLibrary.doc_id == doc_id)
            .values(
                files_json=current_files,
                file_url=new_file_url,
                metadata_json={
                    "file_count": len(current_files),
                    "total_size": sum(f.get("file_size", 0) for f in current_files),
                    "original_filename": current_files[0]["filename"] if current_files else None,
                },
            )
        )
        await session.commit()
    finally:
        await session.close()

    return MessageResponse(message=f"附件「{filename}」已刪除")


@router.post("/{doc_id}/upload-file", response_model=MessageResponse)
async def upload_document_file(
    doc_id: str,
    request: Request,
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """追加上傳附件到已有文件（支援多檔案）"""
    target_country = _resolve_country(payload, country)

    # 驗證文件存在
    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibrary).where(LocalLibrary.doc_id == doc_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            raise HTTPException(status_code=404, detail="文件不存在")

        current_files = list(doc.files_json or [])
        current_file_url = doc.file_url
    finally:
        await session.close()

    # 處理多檔案上傳
    new_files = []
    content_type_header = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type_header:
        try:
            form = await request.form()
            # 取得所有名為 "file" 的上傳檔案
            uploaded_files = form.getlist("file")
            if not uploaded_files:
                single_file = form.get("file")
                if single_file and hasattr(single_file, 'filename') and single_file.filename:
                    uploaded_files = [single_file]

            for uploaded_file in uploaded_files:
                if hasattr(uploaded_file, 'filename') and uploaded_file.filename:
                    file_result = await storage_service.save_file(
                        target_country, "library", doc_id, uploaded_file
                    )
                    new_files.append({
                        "filename": file_result["original_filename"],
                        "relative_path": file_result["relative_path"],
                        "file_size": file_result["file_size"],
                    })
        except Exception as e:
            logger.warning(f"追加附件上傳失敗: {e}")
            raise HTTPException(status_code=500, detail=f"檔案上傳失敗: {str(e)}")

    if not new_files:
        raise HTTPException(status_code=400, detail="未收到任何檔案")

    # 追加到 files_json
    current_files.extend(new_files)

    # 更新 file_url（如果原本沒有檔案）
    if not current_file_url and current_files:
        current_file_url = current_files[0].get("relative_path")

    # PII 掃描新上傳的檔案
    pii_scan_results = []
    pii_warning = ""
    try:
        pii_svc = get_pii_service()
        if pii_svc.enabled and new_files:
            for fi in new_files:
                file_path = storage_service.get_file_path(
                    target_country, "library", doc_id, fi["filename"]
                )
                if file_path:
                    scan_result = await pii_svc.scan_file(file_path)
                    pii_scan_results.append({
                        "filename": fi["filename"],
                        **scan_result.to_dict(),
                    })
                    if scan_result.has_pii:
                        logger.warning(
                            f"⚠️ PII 偵測: 圖書館追加附件 {doc_id}/{fi['filename']} "
                            f"含 {scan_result.entity_count} 個 PII 實體"
                        )
            pii_files = [r for r in pii_scan_results if r.get("has_pii")]
            if pii_files:
                if settings.PII_BLOCK_UPLOAD:
                    # 阻擋模式：刪除本次新上傳的檔案（不影響已有附件）
                    for fi in new_files:
                        storage_service.delete_single_file(
                            target_country, "library", doc_id, fi["filename"]
                        )
                    blocked_details = []
                    for pf in pii_files:
                        types_str = ", ".join(pf.get("entity_types", []))
                        blocked_details.append(
                            f"「{pf['filename']}」含 {pf.get('entity_count', 0)} 個 PII（{types_str}）"
                        )
                    # 寫入 PII 阻擋稽核日誌
                    audit_log(
                        action=AuditAction.PII_BLOCKED_UPLOAD,
                        operator_email=payload.get("sub", ""),
                        country_code=target_country,
                        target=doc_id,
                        result="failure",
                        error_message=f"PII 偵測阻擋追加上傳：{'; '.join(blocked_details)}",
                        details={
                            "doc_id": doc_id,
                            "pii_files": pii_files,
                        },
                        request=request,
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

    # 更新 DB
    metadata = {
        "file_count": len(current_files),
        "total_size": sum(f.get("file_size", 0) for f in current_files),
        "original_filename": current_files[0]["filename"] if current_files else None,
    }
    if pii_scan_results:
        metadata["pii_scan"] = pii_scan_results

    session = await data_router.get_local_pg(target_country)
    try:
        await session.execute(
            update(LocalLibrary)
            .where(LocalLibrary.doc_id == doc_id)
            .values(
                file_url=current_file_url,
                files_json=current_files,
                metadata_json=metadata,
            )
        )
        await session.commit()
    finally:
        await session.close()

    uploaded_names = [f["filename"] for f in new_files]
    msg = f"已追加上傳 {len(new_files)} 個附件"
    if pii_warning:
        msg += f"。{pii_warning}"
    return MessageResponse(
        message=msg,
        detail=", ".join(uploaded_names),
    )


@router.put("/{doc_id}/auth", response_model=MessageResponse)
async def update_doc_auth(
    doc_id: str,
    body: LibraryAuthUpdate,
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """更新文件授權規則"""
    target_country = _resolve_country(payload, country)

    if len(body.authorized_users) > 50:
        raise HTTPException(status_code=400, detail="授權使用者不可超過 50 人")

    # root / admin 本身有 access_all_docs 權限，不需要加入 authorized_users
    # 過濾掉這兩個角色的使用者（需從 DB 查詢角色）
    from core.database import GlobalSessionLocal
    from models.global_models import UserRouteMap
    from sqlalchemy import select as sa_select
    filtered_users = list(body.authorized_users)
    if filtered_users:
        async with GlobalSessionLocal() as gs:
            result = await gs.execute(
                sa_select(UserRouteMap.email, UserRouteMap.role)
                .where(UserRouteMap.email.in_(filtered_users))
            )
            admin_emails = {row.email for row in result if row.role in ("root", "admin")}
        filtered_users = [e for e in filtered_users if e not in admin_emails]

    auth_data = {
        "authorized_roles": body.authorized_roles,
        "authorized_users": filtered_users,
        "exception_list": body.exception_list,
    }

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            update(LocalLibrary)
            .where(LocalLibrary.doc_id == doc_id)
            .values(auth_rules=auth_data)
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="文件不存在")
        await session.commit()
    finally:
        await session.close()

    return MessageResponse(message="文件授權規則已更新")


@router.get("/{doc_id}/download")
async def download_document(
    doc_id: str,
    request: Request,
    filename: Optional[str] = Query(None, description="指定下載的檔案名稱（多檔案時使用）"),
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(get_current_user_payload),
):
    """下載文件（需授權檢查，支援指定檔名下載）"""
    email = payload["sub"]
    role = payload.get("role", "user")
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibrary).where(LocalLibrary.doc_id == doc_id)
        )
        doc = result.scalar_one_or_none()
    finally:
        await session.close()

    if not doc:
        raise HTTPException(status_code=404, detail="文件不存在")

    # 權限檢查
    if not has_permission(role, "access_all_docs"):
        if not _check_doc_auth(doc.auth_rules, email, role):
            raise HTTPException(status_code=403, detail="無權存取此文件")

    if not doc.file_url and not doc.files_json:
        raise HTTPException(status_code=404, detail="文件檔案不存在")

    # 決定要下載哪個檔案
    if filename:
        target_filename = filename
    else:
        # 向後相容：從 metadata 取得原始檔名
        metadata = doc.metadata_json or {}
        target_filename = metadata.get("original_filename", doc.name)

    # 取得實體檔案路徑
    file_path = storage_service.get_file_path(target_country, "library", str(doc.doc_id), target_filename)
    if not file_path:
        raise HTTPException(status_code=404, detail="實體檔案不存在")

    audit_log(
        action=AuditAction.LIBRARY_DOWNLOAD,
        operator_email=email,
        country_code=target_country,
        target=doc_id,
        details={"doc_name": doc.name, "filename": target_filename, "library_name": doc.library_name},
        request=request,
    )
    return FileResponse(
        path=str(file_path),
        filename=target_filename,
        media_type="application/octet-stream",
    )


@router.get("/{doc_id}/preview")
async def preview_document(
    doc_id: str,
    request: Request,
    filename: Optional[str] = Query(None, description="指定預覽的檔案名稱（多檔案時使用）"),
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    record: bool = Query(True, description="是否記錄稽核日誌（縮圖載入時傳 false）"),
    payload: dict = Depends(get_current_user_payload),
):
    """預覽文件（僅支援 PDF，回傳 application/pdf 供 iframe 嵌入）"""
    email = payload["sub"]
    role = payload.get("role", "user")
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibrary).where(LocalLibrary.doc_id == doc_id)
        )
        doc = result.scalar_one_or_none()
    finally:
        await session.close()

    if not doc:
        raise HTTPException(status_code=404, detail="文件不存在")

    # 權限檢查
    if not has_permission(role, "access_all_docs"):
        if not _check_doc_auth(doc.auth_rules, email, role):
            raise HTTPException(status_code=403, detail="無權存取此文件")

    # 決定要預覽哪個檔案
    if filename:
        target_filename = filename
    else:
        # 預設預覽第一個檔案
        files = doc.files_json or []
        if files:
            target_filename = files[0].get("filename")
        else:
            metadata = doc.metadata_json or {}
            target_filename = metadata.get("original_filename", doc.name)

    if not target_filename:
        raise HTTPException(status_code=404, detail="無可預覽的檔案")

    # 僅支援 PDF 預覽
    if not target_filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail=f"不支援預覽此檔案格式：{target_filename}（僅支援 PDF）"
        )

    file_path = storage_service.get_file_path(
        target_country, "library", str(doc.doc_id), target_filename
    )
    if not file_path:
        raise HTTPException(status_code=404, detail="實體檔案不存在")

    if record:
        audit_log(
            action=AuditAction.LIBRARY_PREVIEW,
            operator_email=email,
            country_code=target_country,
            target=doc_id,
            details={"doc_name": doc.name, "filename": target_filename, "library_name": doc.library_name},
            request=request,
        )
    return FileResponse(
        path=str(file_path),
        filename=target_filename,
        media_type="application/pdf",
    )


@router.post("/{doc_id}/view", response_model=MessageResponse)
async def record_view(
    doc_id: str,
    request: Request,
    country: Optional[str] = Query(None, description="國家代碼（僅 root 可跨國）"),
    payload: dict = Depends(get_current_user_payload),
):
    """記錄文件點擊（開啟文件 Modal 時呼叫，寫入稽核日誌）"""
    email = payload["sub"]
    role = payload.get("role", "user")
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        result = await session.execute(
            select(LocalLibrary).where(LocalLibrary.doc_id == doc_id)
        )
        doc = result.scalar_one_or_none()
    finally:
        await session.close()

    if not doc:
        raise HTTPException(status_code=404, detail="文件不存在")

    # 權限檢查
    if not has_permission(role, "access_all_docs"):
        if not _check_doc_auth(doc.auth_rules, email, role):
            raise HTTPException(status_code=403, detail="無權存取此文件")

    audit_log(
        action=AuditAction.LIBRARY_VIEW,
        operator_email=email,
        country_code=target_country,
        target=doc_id,
        details={"doc_name": doc.name, "library_name": doc.library_name},
        request=request,
    )
    return MessageResponse(message="已記錄")


# === 內部工具函式 ===

def _doc_to_response(doc: LocalLibrary) -> LibraryDocResponse:
    return LibraryDocResponse(
        doc_id=str(doc.doc_id),
        library_name=doc.library_name,
        name=doc.name,
        description=doc.description,
        file_url=doc.file_url,
        files=doc.files_json or [],
        auth_rules=doc.auth_rules or {},
        created_at=doc.created_at,
    )


def _check_doc_auth(auth_rules: dict, email: str, role: str) -> bool:
    """檢查使用者是否有權存取文件"""
    if not auth_rules:
        return True  # 無授權規則 = 公開

    exception_list = auth_rules.get("exception_list", [])
    if email in exception_list:
        return False

    authorized_users = auth_rules.get("authorized_users", [])
    if authorized_users and email in authorized_users:
        return True

    authorized_roles = auth_rules.get("authorized_roles", [])
    if authorized_roles and role in authorized_roles:
        return True

    # 如果沒有設定任何授權規則（空陣列），視為公開
    if not authorized_users and not authorized_roles:
        return True

    return False
