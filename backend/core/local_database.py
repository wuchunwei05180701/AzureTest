"""
Local DB 連線工廠（各國 PostgreSQL + MongoDB）
依 country_code 動態建立/取得連線池
"""
import logging
import ssl
from typing import Dict, Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from config import settings

# SSL context（僅在 DB_SSL_ENABLED=true 時啟用）
_local_connect_args = {}
if settings.DB_SSL_ENABLED:
    _local_ssl_context = ssl.create_default_context()
    _local_ssl_context.check_hostname = False
    _local_ssl_context.verify_mode = ssl.CERT_NONE
    _local_connect_args["ssl"] = _local_ssl_context

logger = logging.getLogger(__name__)


class LocalBase(DeclarativeBase):
    """Local DB 的 ORM Base"""
    pass


class LocalDatabaseFactory:
    """
    Local DB 連線工廠
    管理各國的 PostgreSQL 和 MongoDB 連線池
    """

    def __init__(self):
        self._pg_engines: Dict[str, any] = {}
        self._pg_sessions: Dict[str, async_sessionmaker] = {}
        self._mongo_clients: Dict[str, AsyncIOMotorClient] = {}
        self._mongo_dbs: Dict[str, AsyncIOMotorDatabase] = {}

    async def init_all(self):
        """初始化所有已設定國家的連線"""
        for country_code in settings.LOCAL_DB_CONFIG:
            await self._init_country(country_code)
        logger.info(f"已初始化 {len(self._pg_engines)} 個國家的 Local DB 連線")

    async def _init_country(self, country_code: str):
        """初始化單一國家的連線"""
        # PostgreSQL
        pg_url = settings.get_local_pg_url(country_code)
        if pg_url:
            engine = create_async_engine(
                pg_url,
                echo=settings.APP_ENV == "development",
                pool_size=5,
                max_overflow=10,
                pool_pre_ping=True,
                connect_args=_local_connect_args,
            )
            self._pg_engines[country_code] = engine
            self._pg_sessions[country_code] = async_sessionmaker(
                bind=engine,
                class_=AsyncSession,
                expire_on_commit=False,
            )
            # 建立表
            async with engine.begin() as conn:
                await conn.run_sync(LocalBase.metadata.create_all)
            logger.info(f"[{country_code}] PostgreSQL 連線已建立")

        # MongoDB（選填，連線失敗不影響主程式）
        mongo_config = settings.get_local_mongo_config(country_code)
        if mongo_config:
            try:
                client = AsyncIOMotorClient(
                    mongo_config["uri"],
                    serverSelectionTimeoutMS=5000,
                )
                self._mongo_clients[country_code] = client
                self._mongo_dbs[country_code] = client[mongo_config["db"]]
                logger.info(f"[{country_code}] MongoDB 連線已建立")
            except Exception as e:
                logger.warning(f"[{country_code}] MongoDB 連線失敗（非致命錯誤，聊天功能將不可用）: {e}")
        else:
            logger.info(f"[{country_code}] 未設定 MongoDB，跳過初始化（聊天功能將不可用）")

    def get_pg_session(self, country_code: str) -> Optional[async_sessionmaker]:
        """取得指定國家的 PostgreSQL Session 工廠"""
        session_factory = self._pg_sessions.get(country_code)
        if not session_factory:
            logger.error(f"找不到國家 [{country_code}] 的 PostgreSQL 連線")
        return session_factory

    def get_mongo_db(self, country_code: str) -> Optional[AsyncIOMotorDatabase]:
        """取得指定國家的 MongoDB Database"""
        db = self._mongo_dbs.get(country_code)
        if not db:
            logger.error(f"找不到國家 [{country_code}] 的 MongoDB 連線")
        return db

    async def close_all(self):
        """關閉所有連線"""
        for country_code, engine in self._pg_engines.items():
            await engine.dispose()
            logger.info(f"[{country_code}] PostgreSQL 連線已關閉")

        for country_code, client in self._mongo_clients.items():
            client.close()
            logger.info(f"[{country_code}] MongoDB 連線已關閉")

        self._pg_engines.clear()
        self._pg_sessions.clear()
        self._mongo_clients.clear()
        self._mongo_dbs.clear()


# 全域單例
local_db_factory = LocalDatabaseFactory()
