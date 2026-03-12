"""
CTBC AI Portal - 環境變數與設定管理
"""
import json
import os
from typing import Dict, List, Optional
from urllib.parse import quote_plus

from pathlib import Path

from dotenv import load_dotenv

# Azure App Service 中 Oryx 可能會改變工作目錄到 /tmp/...
# 明確指定 .env 路徑確保正確載入
_env_path = Path("/home/site/wwwroot/.env")
if _env_path.exists():
    load_dotenv(_env_path)
else:
    load_dotenv()  # fallback: 本地開發用


class Settings:
    """應用程式設定"""

    # === 應用程式 ===
    APP_ENV: str = os.getenv("APP_ENV", "development")
    APP_PORT: int = int(os.getenv("APP_PORT", "8180"))
    APP_SECRET_KEY: str = os.getenv("APP_SECRET_KEY", "dev-secret-key-change-in-production")
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))
    OTP_EXPIRE_MINUTES: int = int(os.getenv("OTP_EXPIRE_MINUTES", "10"))
    OTP_MAX_RETRIES: int = int(os.getenv("OTP_MAX_RETRIES", "5"))

    # === Database SSL ===
    DB_SSL_ENABLED: bool = os.getenv("DB_SSL_ENABLED", "false").lower() in ("true", "1", "yes")

    # === Global DB (台灣 PostgreSQL) ===
    GLOBAL_DB_HOST: str = os.getenv("GLOBAL_DB_HOST", "localhost")
    GLOBAL_DB_PORT: int = int(os.getenv("GLOBAL_DB_PORT", "5432"))
    GLOBAL_DB_NAME: str = os.getenv("GLOBAL_DB_NAME", "ctbc_global")
    GLOBAL_DB_USER: str = os.getenv("GLOBAL_DB_USER", "postgres")
    GLOBAL_DB_PASSWORD: str = os.getenv("GLOBAL_DB_PASSWORD", "password")

    @property
    def GLOBAL_DB_URL(self) -> str:
        password = quote_plus(self.GLOBAL_DB_PASSWORD)
        user = quote_plus(self.GLOBAL_DB_USER)
        return (
            f"postgresql+asyncpg://{user}:{password}"
            f"@{self.GLOBAL_DB_HOST}:{self.GLOBAL_DB_PORT}/{self.GLOBAL_DB_NAME}"
        )

    @property
    def GLOBAL_DB_URL_SYNC(self) -> str:
        password = quote_plus(self.GLOBAL_DB_PASSWORD)
        user = quote_plus(self.GLOBAL_DB_USER)
        return (
            f"postgresql+psycopg2://{user}:{password}"
            f"@{self.GLOBAL_DB_HOST}:{self.GLOBAL_DB_PORT}/{self.GLOBAL_DB_NAME}"
        )

    # === Local DB 連線 ===
    @property
    def LOCAL_DB_CONFIG(self) -> Dict:
        raw = os.getenv("LOCAL_DB_CONFIG", "{}")
        return json.loads(raw)

    def get_local_pg_url(self, country_code: str) -> Optional[str]:
        """取得指定國家的 PostgreSQL 連線 URL"""
        config = self.LOCAL_DB_CONFIG.get(country_code)
        if not config:
            return None
        user = quote_plus(config['pg_user'])
        password = quote_plus(config['pg_password'])
        return (
            f"postgresql+asyncpg://{user}:{password}"
            f"@{config['pg_host']}:{config['pg_port']}/{config['pg_db']}"
        )

    def get_local_mongo_config(self, country_code: str) -> Optional[Dict]:
        """取得指定國家的 MongoDB 連線設定（選填，沒有 mongo_uri 時回傳 None）"""
        config = self.LOCAL_DB_CONFIG.get(country_code)
        if not config:
            return None
        mongo_uri = config.get("mongo_uri")
        mongo_db = config.get("mongo_db")
        if not mongo_uri or not mongo_db:
            return None
        return {
            "uri": mongo_uri,
            "db": mongo_db,
        }

    # === 台灣 Blob Storage ===
    TW_BLOB_CONNECTION_STRING: str = os.getenv("TW_BLOB_CONNECTION_STRING", "")
    TW_BLOB_CONTAINER: str = os.getenv("TW_BLOB_CONTAINER", "knowledge-library")

    # === Local Blob Storage ===
    @property
    def LOCAL_BLOB_CONFIG(self) -> Dict:
        raw = os.getenv("LOCAL_BLOB_CONFIG", "{}")
        return json.loads(raw)

    # === Email Service ===
    SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.office365.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "")

    # === Agatha Partner API ===
    AGATHA_API_BASE_URL: str = os.getenv("AGATHA_API_BASE_URL", "http://localhost:8000")
    AGATHA_API_KEY: str = os.getenv("AGATHA_API_KEY", "")
    AGATHA_API_TIMEOUT: int = int(os.getenv("AGATHA_API_TIMEOUT", "120"))

    @property
    def AGATHA_PARTNER_API_URL(self) -> str:
        return f"{self.AGATHA_API_BASE_URL}/api/v1/partner"

    # === Portal MongoDB（對話歷史專用，獨立於 Local DB） ===
    PORTAL_MONGO_URI: str = os.getenv("PORTAL_MONGO_URI", "")
    PORTAL_MONGO_DB: str = os.getenv("PORTAL_MONGO_DB", "ctbc_portal")

    # === PII Detection & Redaction ===
    PII_ENABLED: bool = os.getenv("PII_ENABLED", "false").lower() in ("true", "1", "yes")
    PII_CONFIDENCE_THRESHOLD: float = float(os.getenv("PII_CONFIDENCE_THRESHOLD", "0.5"))
    PII_CHAT_AUTO_REDACT: bool = os.getenv("PII_CHAT_AUTO_REDACT", "true").lower() in ("true", "1", "yes")
    PII_REDACT_MODE: str = os.getenv("PII_REDACT_MODE", "replace")  # replace, mask, hash
    PII_BLOCK_UPLOAD: bool = os.getenv("PII_BLOCK_UPLOAD", "true").lower() in ("true", "1", "yes")  # 阻擋含 PII 的檔案上傳
    PII_BLOCK_CHAT: bool = os.getenv("PII_BLOCK_CHAT", "true").lower() in ("true", "1", "yes")  # 阻擋含 PII 的聊天訊息

    @property
    def PII_LANGUAGES(self) -> list:
        raw = os.getenv("PII_LANGUAGES", "en,zh")
        return [lang.strip() for lang in raw.split(",") if lang.strip()]

    @property
    def PII_EXCLUDED_ENTITIES(self) -> list:
        """不需要偵測/阻擋的 PII entity type（逗號分隔）"""
        raw = os.getenv("PII_EXCLUDED_ENTITIES", "DATE_TIME,LOCATION,URL,NRP")
        return [e.strip() for e in raw.split(",") if e.strip()]

    # === CORS ===
    @property
    def CORS_ORIGINS(self) -> List[str]:
        raw = os.getenv("CORS_ORIGINS", '["http://localhost:5173","http://localhost:8079"]')
        return json.loads(raw)


settings = Settings()
