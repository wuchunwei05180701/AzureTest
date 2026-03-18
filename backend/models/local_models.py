"""
Local DB Models（各國 PostgreSQL）
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from core.local_database import LocalBase


class OTPVault(LocalBase):
    """OTP 保險庫"""
    __tablename__ = "otp_vault"

    email = Column(String(255), primary_key=True)
    otp_hash = Column(String(255), nullable=False)
    expiry_time = Column(DateTime(timezone=True), nullable=False)
    retries = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class LoginAudit(LocalBase):
    """登入稽核"""
    __tablename__ = "login_audit"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False)
    status = Column(String(20), nullable=False)  # success / failed / locked
    ip_address = Column(String(45))
    user_agent = Column(Text)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class LocalNotice(LocalBase):
    """本地公告"""
    __tablename__ = "local_notice"

    notice_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject = Column(String(255), nullable=False)
    content_en = Column(Text)
    files = Column(JSONB, default=[])
    library_docs = Column(JSONB, default=[])  # 關聯的圖書館文件 [{"doc_id": "xxx", "name": "文件名", "library_name": "館名"}]
    publish_status = Column(String(20), default="draft")  # draft / published
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class LocalLibraryCatalog(LocalBase):
    """圖書館館名目錄（各國獨立）— 館的生命週期由管理者手動控制"""
    __tablename__ = "local_library_catalog"

    catalog_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    library_name = Column(String(255), nullable=False, unique=True)
    description = Column(Text)
    image_url = Column(Text)  # 館封面圖片路徑
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class LocalLibrary(LocalBase):
    """本地圖書館（各國獨立）"""
    __tablename__ = "local_library"

    doc_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    library_name = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    metadata_json = Column("metadata", JSONB, nullable=False, default={})
    auth_rules = Column(JSONB, nullable=False, default={
        "authorized_roles": [],
        "authorized_users": [],
        "exception_list": [],
    })
    file_url = Column(Text)  # 向後相容：第一個檔案的路徑
    files_json = Column("files", JSONB, nullable=False, default=[])  # 多檔案資訊
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class FileLifecycle(LocalBase):
    """檔案生命週期"""
    __tablename__ = "file_lifecycle"

    file_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False)
    original_name = Column(String(500), nullable=False)
    blob_path = Column(Text)
    status = Column(String(20), nullable=False, default="processing")  # processing / deleted
    deleted_at = Column(DateTime(timezone=True))
    audit = Column(JSONB, default={})
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
