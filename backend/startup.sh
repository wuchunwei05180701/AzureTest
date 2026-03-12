#!/bin/bash

# ============================================
# Azure App Service Startup Script - CTBC AI Portal
# 預先打包套件版本 - 不依賴 Oryx build
# 前端靜態檔案已 build 到 static/ 目錄，FastAPI 統一 serve
# ============================================

set -e

SITE_PACKAGES="/home/site/wwwroot/.python_packages/lib/site-packages"

echo "=== CTBC AI Portal Startup Begin ==="
echo "Python version: $(python3 --version)"

# 清理 Oryx 殘留（避免覆蓋已打包的 .python_packages）
if [ -f /home/site/wwwroot/oryx-manifest.toml ]; then
    echo "Removing stale Oryx manifest..."
    rm -f /home/site/wwwroot/oryx-manifest.toml
fi
if [ -f /home/site/wwwroot/output.tar.zst ]; then
    echo "Removing stale Oryx output archive..."
    rm -f /home/site/wwwroot/output.tar.zst
fi

if [ ! -d "$SITE_PACKAGES" ]; then
    echo "ERROR: Package directory not found: $SITE_PACKAGES"
    ls -la /home/site/wwwroot/
    exit 1
fi

export PYTHONPATH="$SITE_PACKAGES:${PYTHONPATH:-}"
echo "PYTHONPATH: $PYTHONPATH"

# 驗證關鍵模組
echo "Verifying modules..."
python3 -c "import uvicorn; print(f'  uvicorn {uvicorn.__version__} OK')"
python3 -c "import fastapi; print(f'  fastapi {fastapi.__version__} OK')"

cd /home/site/wwwroot

# 檢查前端靜態檔案
if [ -d "static" ] && [ -f "static/index.html" ]; then
    echo "Frontend static files: OK"
else
    echo "WARNING: static/index.html not found - frontend will not be served"
fi

# 啟動 FastAPI（uvicorn，同時 serve API + 前端靜態檔）
echo "Starting uvicorn on port ${PORT:-8180}..."
exec python3 -m uvicorn \
    main:app \
    --host 0.0.0.0 \
    --port ${PORT:-8180} \
    --workers 2 \
    --timeout-keep-alive 600 \
    --access-log
