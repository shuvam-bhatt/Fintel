@echo off
REM ===========================================================================
REM Fintel — Windows Automated Startup Script
REM ===========================================================================
setlocal enabledelayedexpansion

echo =======================================================================
echo          Fintel AML Investigation Copilot - Startup
echo =======================================================================
echo.

REM Check if Docker is requested or local mode
if "%1"=="docker" goto DOCKER_MODE

REM ---------------------------------------------------------------------------
REM Local Native Mode (Python + Node.js)
REM ---------------------------------------------------------------------------
echo [1/4] Checking Python environment...
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.11+ from https://www.python.org/
    pause
    exit /b 1
)

echo [2/4] Checking Node.js environment...
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

echo [3/4] Starting FastAPI Backend on port 8000...
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)
start "Fintel Backend API" cmd /k "cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

echo Waiting 3 seconds for Backend to initialize...
timeout /t 3 /nobreak >nul

echo [4/4] Starting Next.js Frontend on port 3000...
start "Fintel Frontend UI" cmd /k "cd frontend && npm run dev"

echo.
echo =======================================================================
echo   Fintel is starting up!
echo   - Web Dashboard:  http://localhost:3000
echo   - API Backend:    http://localhost:8000
echo   - API Swagger:    http://localhost:8000/docs
echo   - Metrics:        http://localhost:8000/metrics
echo =======================================================================
echo.
echo Note: If your database is empty, seed it by running:
echo   curl -X POST http://localhost:8000/seed/all
echo.
pause
exit /b 0

:DOCKER_MODE
echo Checking Docker Desktop...
docker info >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Docker daemon is not running!
    echo Please start Docker Desktop first and wait until it is ready.
    pause
    exit /b 1
)

echo Starting Fintel via Docker Compose...
docker compose up --build
pause
exit /b 0
