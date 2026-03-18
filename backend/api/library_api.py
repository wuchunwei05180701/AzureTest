"""
圖書館 API：文件 CRUD + 權限設定 + 上傳/下載 + 館名目錄管理
圖書館存在 Local DB（各國 PostgreSQL），國家隔離
super_admin 可跨國查看（透過 ?country=XX 參數）
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import delete, select, update, func

from config import settings
from core.data_router import data_router
from core.local_database import local_db_factory
from core.permissions import has_permission, require_permission
from core.security import get_current_user_payload
from models.local_models import LocalLibrary, LocalLibraryCatalog
from models.schemas import (
    LibraryAuthUpdate,
    LibraryCatalogCreate,
    LibraryCatalogResponse,
    LibraryDocCreate,
    LibraryDocResponse,
    LibraryDocUpdate,
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
        # 驗證國家是否存在
        if query_country not in settings.LOCAL_DB_CONFIG:
            raise HTTPException(status_code=400, detail=f"國家 [{query_country}] 不存在")
        return query_country

    return user_country


# ===== 館名目錄 (Catalog) API =====

@router.get("/catalogs", response_model=List[LibraryCatalogResponse])
async def list_catalogs(
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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


@router.post("/catalogs/{catalog_id}/image", response_model=MessageResponse)
async def upload_catalog_image(
    catalog_id: str,
    file: UploadFile = File(...),
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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

    # platform_admin / super_admin 看到全部
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
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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
    return MessageResponse(message=msg, detail=doc_id)


@router.delete("/by-library/{library_name}", response_model=MessageResponse)
async def delete_library(
    library_name: str,
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """刪除文件"""
    target_country = _resolve_country(payload, country)

    session = await data_router.get_local_pg(target_country)
    try:
        # 取得文件資訊
        doc_result = await session.execute(
            select(LocalLibrary).where(LocalLibrary.doc_id == doc_id)
        )
        doc = doc_result.scalar_one_or_none()
        if not doc:
            raise HTTPException(status_code=404, detail="文件不存在")

        await session.execute(
            delete(LocalLibrary).where(LocalLibrary.doc_id == doc_id)
        )
        await session.commit()
    finally:
        await session.close()

    # 刪除實體檔案
    storage_service.delete_files(target_country, "library", doc_id)

    return MessageResponse(message="文件已刪除")


@router.put("/{doc_id}", response_model=MessageResponse)
async def update_document(
    doc_id: str,
    body: LibraryDocUpdate,
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """編輯文件資訊（名稱、描述、館名）"""
    target_country = _resolve_country(payload, country)

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

    return MessageResponse(message="文件資訊已更新")


@router.delete("/{doc_id}/file", response_model=MessageResponse)
async def delete_document_file(
    doc_id: str,
    filename: str = Query(..., description="要刪除的附件檔名"),
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
    payload: dict = Depends(require_permission("manage_library")),
):
    """更新文件授權規則"""
    target_country = _resolve_country(payload, country)

    if len(body.authorized_users) > 50:
        raise HTTPException(status_code=400, detail="授權使用者不可超過 50 人")

    # super_admin / platform_admin 本身有 access_all_docs 權限，不需要加入 authorized_users
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
            admin_emails = {row.email for row in result if row.role in ("super_admin", "platform_admin")}
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
    filename: Optional[str] = Query(None, description="指定下載的檔案名稱（多檔案時使用）"),
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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

    return FileResponse(
        path=str(file_path),
        filename=target_filename,
        media_type="application/octet-stream",
    )


@router.get("/{doc_id}/preview")
async def preview_document(
    doc_id: str,
    filename: Optional[str] = Query(None, description="指定預覽的檔案名稱（多檔案時使用）"),
    country: Optional[str] = Query(None, description="國家代碼（僅 super_admin 可跨國）"),
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

    return FileResponse(
        path=str(file_path),
        filename=target_filename,
        media_type="application/pdf",
    )


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
