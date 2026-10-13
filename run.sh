#!/usr/bin/env bash
# =============================================================================
# Fintel — Linux/macOS Automated Startup Script
# =============================================================================

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "======================================================================="
echo "        Fintel AML Investigation Copilot - Startup Script"
echo "======================================================================="
echo ""

# Cleanup handler on manual exit (Ctrl+C)
cleanup() {
    echo ""
    echo "Stopping Fintel services..."
    pkill -9 -f "next-server" 2>/dev/null || true
    pkill -9 -f "next dev" 2>/dev/null || true
    pkill -9 -f "uvicorn" 2>/dev/null || true
    fuser -k -9 3000/tcp 2>/dev/null || true
    fuser -k -9 8000/tcp 2>/dev/null || true
    fuser -k -9 5433/tcp 2>/dev/null || true
    /usr/lib/postgresql/18/bin/pg_ctl -D "$PROJECT_ROOT/.pgdata" stop 2>/dev/null || true
    echo "Fintel stopped cleanly."
    exit 0
}
trap cleanup SIGINT SIGTERM

# 0. Free ports 3000 and 8000 if lingering from previous sessions
echo "[0/4] Checking and freeing ports 3000 & 8000..."
pkill -9 -f "next-server" 2>/dev/null || true
pkill -9 -f "next dev" 2>/dev/null || true
pkill -9 -f "uvicorn" 2>/dev/null || true
fuser -k -9 3000/tcp 2>/dev/null || true
fuser -k -9 8000/tcp 2>/dev/null || true
sleep 1.5


# 1. Check / Start PostgreSQL
echo "[1/4] Checking PostgreSQL database..."
if ss -tulpn 2>/dev/null | grep -q ":5433 "; then
    echo "      PostgreSQL is already active on port 5433."
else
    echo "      Starting local PostgreSQL on port 5433..."
    if [ ! -d "$PROJECT_ROOT/.pgdata" ]; then
        /usr/lib/postgresql/18/bin/initdb -D "$PROJECT_ROOT/.pgdata" -U Fintel --auth=trust >/dev/null 2>&1
    fi
    /usr/lib/postgresql/18/bin/pg_ctl -D "$PROJECT_ROOT/.pgdata" -o "-p 5433 -k /tmp" -l "$PROJECT_ROOT/.pgdata/logfile" start
    sleep 2
    /usr/lib/postgresql/18/bin/createdb -h localhost -p 5433 -U Fintel Fintel 2>/dev/null || true
    /usr/lib/postgresql/18/bin/psql -h localhost -p 5433 -U Fintel -d Fintel -f "$PROJECT_ROOT/docker/init-db.sql" >/dev/null 2>&1 || true
fi

# 2. Start FastAPI Backend
echo "[2/4] Starting FastAPI Backend on http://localhost:8000..."
if [ -f "$PROJECT_ROOT/.venv/bin/uvicorn" ]; then
    UVICORN_EXEC="$PROJECT_ROOT/.venv/bin/uvicorn"
else
    UVICORN_EXEC="uvicorn"
fi

cd "$PROJECT_ROOT/backend"
$UVICORN_EXEC app.main:app --host 0.0.0.0 --port 8000 --reload > /dev/null 2>&1 &
BACKEND_PID=$!
cd "$PROJECT_ROOT"

# Wait for backend health check
echo "      Waiting for backend to be ready..."
for i in {1..20}; do
    if curl -s http://localhost:8000/health | grep -q "ok"; then
        echo "      Backend is live at http://localhost:8000"
        break
    fi
    sleep 1
done

# 3. Seed Database if needed
echo "[3/4] Ensuring database is seeded with alerts & KYC profiles..."
curl -s -X POST http://localhost:8000/seed/all > /dev/null 2>&1 || true
curl -s -X POST http://localhost:8000/seed/customers > /dev/null 2>&1 || true
curl -s -X POST http://localhost:8000/rag/seed-typologies > /dev/null 2>&1 || true

# 4. Start Next.js Frontend
echo "[4/4] Starting Next.js Frontend on http://localhost:3000..."
cd "$PROJECT_ROOT/frontend"
npm run dev &
FRONTEND_PID=$!
cd "$PROJECT_ROOT"

echo ""
echo "======================================================================="
echo "   Fintel is live and ready!"
echo "   - Web Dashboard:  http://localhost:3000"
echo "   - Case Copilot:   http://localhost:3000/alerts/<id>"
echo "   - Monitoring:     http://localhost:3000/monitoring"
echo "   - API Docs:       http://localhost:8000/docs"
echo "   - Prometheus:     http://localhost:8000/metrics"
echo "======================================================================="
echo "Press Ctrl+C to stop all services."
echo ""

# Keep running continuously until user presses Ctrl+C
while true; do
    sleep 2
done

