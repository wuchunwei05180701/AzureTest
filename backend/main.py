"""
CTBC AI Portal - FastAPI 應用程式入口
同時 serve 前端靜態檔案 + API
"""
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from core.database import init_global_db, close_global_db
from core.local_database import local_db_factory
from core.portal_mongo import init_portal_mongo, close_portal_mongo

# 設定 logging
logging.basicConfig(
    level=logging.INFO if settings.APP_ENV == "production" else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """應用程式生命週期管理"""
    # === 啟動 ===
    logger.info("🚀 CTBC AI Portal Backend 啟動中...")
    logger.info(f"   環境: {settings.APP_ENV}")
    logger.info(f"   Port: {settings.APP_PORT}")

    # 初始化 Global DB
    try:
        await init_global_db()
        logger.info("✅ Global DB (台灣 PostgreSQL) 已連線")
    except Exception as e:
        logger.error(f"❌ Global DB 連線失敗: {e}")

    # 初始化 Local DB（PostgreSQL 必要，MongoDB 選填）
    try:
        await local_db_factory.init_all()
        logger.info("✅ Local DB 連線已初始化")
    except Exception as e:
        logger.warning(f"⚠️ Local DB 初始化部分失敗（應用程式仍可運行）: {e}")

    # 初始化 Portal MongoDB（對話歷史專用）
    try:
        await init_portal_mongo()
    except Exception as e:
        logger.warning(f"⚠️ Portal MongoDB 初始化失敗（對話歷史功能將無法使用）: {e}")

    # 初始化 PII 服務（預載入 Presidio 模型）
    try:
        from services.pii_service import get_pii_service
        pii_svc = get_pii_service()
        status = pii_svc.get_status()
        logger.info(f"🔒 PII 服務: enabled={status['enabled']}, engine={status['engine']}")
    except Exception as e:
        logger.warning(f"⚠️ PII 服務初始化失敗（PII 功能將無法使用）: {e}")

    yield

    # === 關閉 ===
    logger.info("🛑 CTBC AI Portal Backend 關閉中...")
    await close_global_db()
    await local_db_factory.close_all()
    await close_portal_mongo()
    logger.info("✅ 所有資料庫連線已關閉")


# 建立 FastAPI 應用程式
app = FastAPI(
    title="CTBC AI Portal API",
    description="CTBC AI Portal 後端 API - Centralized Compute + Country-level Data Residency",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# === 註冊 API 路由 ===
from api.auth_api import router as auth_router
from api.user_api import router as user_router
from api.agent_api import router as agent_router
from api.announcement_api import router as announcement_router
from api.library_api import router as library_router
from api.chat_api import router as chat_router
from api.country_api import router as country_router
from api.pii_api import router as pii_router
from api.audit_api import router as audit_router

app.include_router(auth_router, prefix="/api/auth", tags=["認證"])
app.include_router(user_router, prefix="/api/users", tags=["使用者管理"])
app.include_router(agent_router, prefix="/api/agents", tags=["Agent"])
app.include_router(announcement_router, prefix="/api/announcements", tags=["公告"])
app.include_router(library_router, prefix="/api/library", tags=["圖書館"])
app.include_router(chat_router, prefix="/api/chat", tags=["對話"])
app.include_router(country_router, prefix="/api/countries", tags=["國家"])
app.include_router(pii_router, prefix="/api/pii", tags=["PII 偵測"])
app.include_router(audit_router, prefix="/api/audit-logs", tags=["稽核日誌"])


# === 健康檢查 ===
@app.get("/api/health", tags=["系統"])
async def health_check():
    return {
        "status": "ok",
        "service": "CTBC AI Portal API",
        "version": "1.0.0",
        "environment": settings.APP_ENV,
    }


# === 前端靜態檔案 Serve ===
STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
    # 掛載靜態資源（CSS, JS, images 等）
    # vite build 的 base 是 /AzureTest/，所以靜態資源路徑是 /AzureTest/assets/...
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/AzureTest/assets", StaticFiles(directory=assets_dir), name="static-assets")

    # SPA Fallback：所有非 /api 的請求都回傳 index.html
    @app.get("/{full_path:path}", tags=["前端"])
    async def serve_spa(request: Request, full_path: str):
        """SPA fallback - 非 API 路由都回傳 index.html"""
        # 嘗試找靜態檔案
        file_path = STATIC_DIR / full_path
        if full_path and file_path.is_file():
            return FileResponse(file_path)
        # 否則回傳 index.html（讓 React Router 處理路由）
        return FileResponse(STATIC_DIR / "index.html")

    logger.info(f"📁 前端靜態檔案目錄: {STATIC_DIR}")
else:
    @app.get("/{full_path:path}", tags=["前端"])
    async def no_frontend(full_path: str):
        """前端尚未建置"""
        return HTMLResponse(
            "<h1>Frontend not built</h1>"
            "<p>Run: <code>cd Azure/azure-portal && npm run build</code></p>",
            status_code=404,
        )

    logger.warning(f"⚠️ 前端靜態檔案不存在: {STATIC_DIR}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=settings.APP_PORT,
        reload=settings.APP_ENV == "development",
    )
