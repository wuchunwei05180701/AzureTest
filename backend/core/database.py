"""
Global DB 連線管理（台灣 PostgreSQL）
"""
import ssl

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from config import settings

# SSL context（僅在 DB_SSL_ENABLED=true 時啟用）
_connect_args = {}
if settings.DB_SSL_ENABLED:
    _ssl_context = ssl.create_default_context()
    _ssl_context.check_hostname = False
    _ssl_context.verify_mode = ssl.CERT_NONE
    _connect_args["ssl"] = _ssl_context

# Global DB 非同步引擎
global_engine = create_async_engine(
    settings.GLOBAL_DB_URL,
    echo=settings.APP_ENV == "development",
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    connect_args=_connect_args,
)

# Global DB Session 工廠
GlobalSessionLocal = async_sessionmaker(
    bind=global_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class GlobalBase(DeclarativeBase):
    """Global DB 的 ORM Base"""
    pass


async def get_global_db() -> AsyncSession:
    """FastAPI Dependency: 取得 Global DB Session"""
    async with GlobalSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_global_db():
    """初始化 Global DB（建立所有表，跳過已存在的）"""
    import logging
    logger = logging.getLogger(__name__)
    try:
        async with global_engine.begin() as conn:
            await conn.run_sync(GlobalBase.metadata.create_all)
    except Exception as e:
        if "already exists" in str(e) or "duplicate key" in str(e):
            logger.info("ℹ️ Global DB 表已存在，跳過建立")
        else:
            raise


async def close_global_db():
    """關閉 Global DB 連線池"""
    await global_engine.dispose()
