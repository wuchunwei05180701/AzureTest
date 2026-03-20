"""
PII Detection & Redaction API — 獨立掃描/脫敏端點（測試與管理用）
"""
import logging
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from pydantic import BaseModel, Field

from core.security import get_current_user_payload
from services.pii_service import get_pii_service
from utils.audit_logger import audit_log, AuditAction

logger = logging.getLogger(__name__)
router = APIRouter()


# ===== Request / Response Schemas =====


class PIIScanRequest(BaseModel):
    text: str = Field(..., description="要掃描的文字", max_length=50000)


class PIIEntityResponse(BaseModel):
    entity_type: str
    text: str
    start: int
    end: int
    score: float


class PIIScanResponse(BaseModel):
    has_pii: bool
    entity_count: int
    entities: list[PIIEntityResponse]
    entity_types: list[str]
    redacted_text: Optional[str] = None
    scanned_at: str
    text_length: int
    confidence_threshold: float


class PIIRedactRequest(BaseModel):
    text: str = Field(..., description="要脫敏的文字", max_length=50000)


class PIIRedactResponse(BaseModel):
    original_length: int
    redacted_text: str
    entities_found: int
    entity_types: list[str]


class PIIStatusResponse(BaseModel):
    enabled: bool
    engine: str
    languages: list[str]
    confidence_threshold: float
    redact_mode: str


# ===== API Endpoints =====


@router.get("/status", response_model=PIIStatusResponse)
async def get_pii_status(
    payload: dict = Depends(get_current_user_payload),
):
    """取得 PII 服務狀態"""
    service = get_pii_service()
    return PIIStatusResponse(**service.get_status())


@router.post("/scan", response_model=PIIScanResponse)
async def scan_text(
    body: PIIScanRequest,
    payload: dict = Depends(get_current_user_payload),
):
    """
    掃描文字中的 PII

    回傳偵測到的 PII 實體列表，以及脫敏後的文字預覽。
    """
    service = get_pii_service()

    if not service.enabled:
        raise HTTPException(status_code=503, detail="PII 服務未啟用（PII_ENABLED=false）")

    result = service.scan_text(body.text)
    redacted = service.anonymize_text(body.text) if result.has_pii else body.text

    return PIIScanResponse(
        has_pii=result.has_pii,
        entity_count=result.entity_count,
        entities=[
            PIIEntityResponse(
                entity_type=e.entity_type,
                text=e.text,
                start=e.start,
                end=e.end,
                score=e.score,
            )
            for e in result.entities
        ],
        entity_types=result.entity_types,
        redacted_text=redacted,
        scanned_at=result.scanned_at,
        text_length=result.text_length,
        confidence_threshold=result.confidence_threshold,
    )


@router.post("/redact", response_model=PIIRedactResponse)
async def redact_text(
    body: PIIRedactRequest,
    payload: dict = Depends(get_current_user_payload),
):
    """
    脫敏文字中的 PII

    回傳遮蔽後的文字。
    """
    service = get_pii_service()

    if not service.enabled:
        raise HTTPException(status_code=503, detail="PII 服務未啟用（PII_ENABLED=false）")

    result = service.scan_text(body.text)
    redacted = service.anonymize_text(body.text)

    return PIIRedactResponse(
        original_length=len(body.text),
        redacted_text=redacted,
        entities_found=result.entity_count,
        entity_types=result.entity_types,
    )


# ===== 檔案預掃描 Schemas =====


class PIIFileScanResult(BaseModel):
    filename: str
    has_pii: bool
    entity_count: int
    entity_types: list[str]
    entities: list[PIIEntityResponse] = []


class PIIFileScanResponse(BaseModel):
    has_pii: bool  # 任一檔案含 PII 即為 True
    files: list[PIIFileScanResult]
    message: str


# ===== 檔案預掃描端點 =====


@router.post("/scan-files", response_model=PIIFileScanResponse)
async def scan_files(
    request: Request,
    payload: dict = Depends(get_current_user_payload),
):
    """
    預掃描上傳檔案中的 PII（不儲存檔案）

    用於前端在使用者選擇檔案後、正式上傳前，先檢查是否含有 PII。
    檔案會暫存到 temp 目錄進行掃描，掃描完畢後立即刪除。

    支援格式：PDF、DOCX、TXT、CSV
    """
    service = get_pii_service()

    if not service.enabled:
        return PIIFileScanResponse(
            has_pii=False,
            files=[],
            message="PII 服務未啟用",
        )

    # 從 multipart form 取得檔案
    uploaded_files = []
    content_type_header = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type_header:
        form = await request.form()
        uploaded_files = form.getlist("file")
        if not uploaded_files:
            single_file = form.get("file")
            if single_file and hasattr(single_file, 'filename') and single_file.filename:
                uploaded_files = [single_file]

    if not uploaded_files:
        raise HTTPException(status_code=400, detail="未收到任何檔案")

    file_results = []
    any_pii = False

    for uploaded_file in uploaded_files:
        if not hasattr(uploaded_file, 'filename') or not uploaded_file.filename:
            continue

        filename = uploaded_file.filename
        # 取得副檔名
        ext = Path(filename).suffix.lower()

        # 只掃描支援的格式
        if ext not in ('.pdf', '.docx', '.doc', '.txt', '.csv'):
            file_results.append(PIIFileScanResult(
                filename=filename,
                has_pii=False,
                entity_count=0,
                entity_types=[],
                entities=[],
            ))
            continue

        # 暫存檔案到 temp 目錄
        tmp_path = None
        try:
            content = await uploaded_file.read()
            with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
                tmp.write(content)
                tmp_path = Path(tmp.name)

            # 掃描
            scan_result = await service.scan_file(tmp_path)

            file_results.append(PIIFileScanResult(
                filename=filename,
                has_pii=scan_result.has_pii,
                entity_count=scan_result.entity_count,
                entity_types=scan_result.entity_types,
                entities=[
                    PIIEntityResponse(
                        entity_type=e.entity_type,
                        text=e.text,
                        start=e.start,
                        end=e.end,
                        score=e.score,
                    )
                    for e in scan_result.entities
                ],
            ))

            if scan_result.has_pii:
                any_pii = True
                logger.warning(
                    f"⚠️ PII 預掃描: {filename} "
                    f"含 {scan_result.entity_count} 個 PII 實體 "
                    f"({', '.join(scan_result.entity_types)})"
                )
        except Exception as e:
            logger.error(f"❌ 檔案預掃描失敗 ({filename}): {e}")
            file_results.append(PIIFileScanResult(
                filename=filename,
                has_pii=False,
                entity_count=0,
                entity_types=[],
                entities=[],
            ))
        finally:
            # 清理暫存檔案
            if tmp_path and tmp_path.exists():
                try:
                    tmp_path.unlink()
                except Exception:
                    pass
            # 重置檔案指標（讓後續上傳可以重新讀取）
            try:
                await uploaded_file.seek(0)
            except Exception:
                pass

    if any_pii:
        pii_files = [f for f in file_results if f.has_pii]
        details = []
        for pf in pii_files:
            types_str = ", ".join(pf.entity_types)
            details.append(f"「{pf.filename}」含 {pf.entity_count} 個 PII（{types_str}）")
        msg = f"偵測到個人敏感資訊（PII）：{'; '.join(details)}。請遮蔽機密資料後再試。"

        # 寫入稽核日誌：前端預掃描偵測到 PII，上傳被前端阻擋
        operator_email = payload.get("sub", "")
        operator_country = payload.get("country", "TW")
        audit_log(
            action=AuditAction.PII_BLOCKED_UPLOAD,
            operator_email=operator_email,
            country_code=operator_country,
            target=", ".join(pf.filename for pf in pii_files),
            result="failure",
            error_message=f"前端預掃描阻擋上傳：{'; '.join(details)}",
            details={
                "pii_files": [
                    {
                        "filename": pf.filename,
                        "entity_count": pf.entity_count,
                        "entity_types": pf.entity_types,
                    }
                    for pf in pii_files
                ]
            },
            request=request,
        )
    else:
        msg = "未偵測到個人敏感資訊"

    return PIIFileScanResponse(
        has_pii=any_pii,
        files=file_results,
        message=msg,
    )
