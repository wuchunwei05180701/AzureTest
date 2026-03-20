"""
檔案儲存服務 — 本地磁碟儲存（未來可替換為 Azure Blob Storage）
"""
import logging
import os
import shutil
from pathlib import Path
from typing import Optional

from fastapi import UploadFile

logger = logging.getLogger(__name__)

UPLOAD_ROOT = Path(__file__).parent.parent / "uploads"


class StorageService:
    """本地檔案儲存服務"""

    def __init__(self, root: Path = UPLOAD_ROOT):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        logger.info(f"📁 檔案儲存根目錄: {self.root}")

    def _get_dir(self, country_code: str, category: str, item_id: str) -> Path:
        return self.root / country_code / category / item_id

    async def save_file(self, country_code: str, category: str, item_id: str, file: UploadFile) -> dict:
        """
        儲存上傳的檔案
        category: "library" 或 "announcements"
        回傳 dict: { "relative_path": str, "file_size": int, "original_filename": str }
        """
        target_dir = self._get_dir(country_code, category, item_id)
        target_dir.mkdir(parents=True, exist_ok=True)

        file_path = target_dir / file.filename
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        relative_path = f"uploads/{country_code}/{category}/{item_id}/{file.filename}"
        logger.info(f"檔案已儲存: {relative_path} ({len(content)} bytes)")
        return {
            "relative_path": relative_path,
            "file_size": len(content),
            "original_filename": file.filename,
        }

    def get_file_path(self, country_code: str, category: str, item_id: str, filename: str) -> Optional[Path]:
        """取得檔案的絕對路徑（用於下載）"""
        file_path = self._get_dir(country_code, category, item_id) / filename
        if file_path.is_file():
            return file_path
        return None

    def delete_files(self, country_code: str, category: str, item_id: str) -> bool:
        """刪除整個項目目錄（包含所有檔案）"""
        target_dir = self._get_dir(country_code, category, item_id)
        if target_dir.exists():
            shutil.rmtree(target_dir)
            logger.info(f"檔案目錄已刪除: {target_dir}")
            return True
        return False

    def delete_single_file(self, country_code: str, category: str, item_id: str, filename: str) -> bool:
        """刪除指定的單一檔案（不是整個目錄）"""
        file_path = self._get_dir(country_code, category, item_id) / filename
        if file_path.is_file():
            os.remove(file_path)
            logger.info(f"單一檔案已刪除: {file_path}")
            return True
        logger.warning(f"檔案不存在，無法刪除: {file_path}")
        return False

    # ===== 使用者頭貼 =====

    def _get_avatar_dir(self) -> Path:
        """頭貼儲存目錄（全域，不分國家）"""
        avatar_dir = self.root / "avatars"
        avatar_dir.mkdir(parents=True, exist_ok=True)
        return avatar_dir

    async def save_avatar(self, email: str, file: UploadFile) -> dict:
        """
        儲存使用者頭貼（每人只保留一張，自動覆蓋舊圖）
        回傳 dict: { "relative_path": str, "file_size": int }
        """
        avatar_dir = self._get_avatar_dir()

        # 取得副檔名（限 jpg/jpeg/png/gif/webp）
        original_ext = Path(file.filename).suffix.lower() if file.filename else ".jpg"
        allowed_exts = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
        if original_ext not in allowed_exts:
            original_ext = ".jpg"

        # 以 email hash 作為檔名（避免特殊字元）
        import hashlib
        email_hash = hashlib.md5(email.lower().encode()).hexdigest()
        filename = f"{email_hash}{original_ext}"

        # 刪除同名但不同副檔名的舊頭貼
        for old_file in avatar_dir.glob(f"{email_hash}.*"):
            try:
                os.remove(old_file)
            except Exception:
                pass

        file_path = avatar_dir / filename
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        relative_path = f"uploads/avatars/{filename}"
        logger.info(f"頭貼已儲存: {relative_path} ({len(content)} bytes)")
        return {
            "relative_path": relative_path,
            "file_size": len(content),
        }

    def get_avatar_path(self, email: str) -> Optional[Path]:
        """取得使用者頭貼的絕對路徑"""
        import hashlib
        email_hash = hashlib.md5(email.lower().encode()).hexdigest()
        avatar_dir = self._get_avatar_dir()
        for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
            file_path = avatar_dir / f"{email_hash}{ext}"
            if file_path.is_file():
                return file_path
        return None

    def delete_avatar(self, email: str) -> bool:
        """刪除使用者頭貼"""
        import hashlib
        email_hash = hashlib.md5(email.lower().encode()).hexdigest()
        avatar_dir = self._get_avatar_dir()
        deleted = False
        for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
            file_path = avatar_dir / f"{email_hash}{ext}"
            if file_path.is_file():
                os.remove(file_path)
                deleted = True
        return deleted


storage_service = StorageService()
