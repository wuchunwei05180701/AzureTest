#!/bin/bash
# AzureTest 本地開發環境啟動腳本
# - Frontend (Vite):  localhost:8079  [HMR hot-reload, proxy → 8180]
# - Backend:          localhost:8180  [uvicorn --reload]
# - 基礎設施共用 Neurocore Docker containers

set -e

PROJECT_ROOT="/home/wuchunwei/neurocore/AzureTest"
NVM_DIR="/home/wuchunwei/.nvm"

LOG_DIR="$PROJECT_ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

# ============================================================
# 顏色輸出
# ============================================================
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[azuretest]${NC} $1"; }
warn() { echo -e "${YELLOW}[azuretest]${NC} $1"; }
err() { echo -e "${RED}[azuretest]${NC} $1"; }

# ============================================================
# 清理殘留進程
# ============================================================
kill_stale() {
    local pattern=$1
    local pids
    pids=$(pgrep -f "$pattern" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        warn "清理殘留進程 ($pattern): $pids"
        kill $pids 2>/dev/null || true
        sleep 1
        kill -9 $pids 2>/dev/null || true
    fi
}

log "=== 清理殘留進程 ==="
kill_stale "uvicorn.*8180"
kill_stale "vite.*8079"
pm2 stop azuretest-fe 2>/dev/null || true

PIDS=()

cleanup() {
    echo ""
    warn "正在停止所有服務..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    kill_stale "uvicorn.*8180"
    kill_stale "vite.*8079"
    log "所有服務已停止"
    exit 0
}

trap cleanup SIGINT SIGTERM

# ============================================================
# 1. 檢查 Docker 基礎設施
# ============================================================
log "=== 檢查 Docker 基礎設施 ==="
for container in neurocore-postgres neurocore-mongodb; do
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        log "$container 運行中"
    else
        err "$container 未運行！請先執行 ~/neurocore/dev.sh 或手動啟動 Docker"
        exit 1
    fi
done

# ============================================================
# 2. 檢查 .env
# ============================================================
if [ ! -f "$PROJECT_ROOT/backend/.env" ]; then
    err "backend/.env 不存在！"
    exit 1
fi
log ".env 已就位"

# ============================================================
# 3. 啟動 Backend (uvicorn --reload, port 8180)
# ============================================================
log "=== 啟動 Backend (port 8180, --reload) ==="
(
    cd "$PROJECT_ROOT/backend"
    source .venv/bin/activate
    exec uvicorn main:app --host 0.0.0.0 --port 8180 --reload \
        > "$LOG_DIR/backend.log" 2>&1
) &
PIDS+=($!)
log "Backend PID: $!"

# ============================================================
# 4. 啟動 Frontend (Vite dev, port 8079, proxy → 8180)
# ============================================================
log "=== 啟動 Frontend (port 8079, HMR) ==="
(
    . "$NVM_DIR/nvm.sh"
    cd "$PROJECT_ROOT/azure-portal"
    exec npm run dev > "$LOG_DIR/frontend.log" 2>&1
) &
PIDS+=($!)
log "Frontend PID: $!"

# ============================================================
# 5. 顯示狀態
# ============================================================
sleep 3
echo ""
echo "============================================"
log "AzureTest 開發環境已啟動！"
echo "============================================"
echo ""
echo "  Frontend  (HMR):    http://localhost:8079"
echo "  Backend   (reload): http://localhost:8180"
echo "  API Docs:           http://localhost:8180/docs"
echo ""
echo "  基礎設施（共用 Neurocore Docker）："
echo "    PostgreSQL: localhost:5432"
echo "    MongoDB:    localhost:27018"
echo ""
echo "  Agatha Partner API: $(grep AGATHA_API_BASE_URL $PROJECT_ROOT/backend/.env | cut -d= -f2)"
echo ""
echo "  Log 位置: $LOG_DIR/"
echo "    tail -f $LOG_DIR/backend.log"
echo "    tail -f $LOG_DIR/frontend.log"
echo ""
echo "  按 Ctrl+C 停止所有服務"
echo "============================================"

wait
