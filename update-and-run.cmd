@echo off
REM Pull the latest main and (re)start the PoE2 Stonks dev server on port 5173.
REM Double-click this file, or run it from a terminal. Leave the window open —
REM it hosts the dev server; close it (or Ctrl+C) to stop.
setlocal

REM Always operate from this script's own folder (the repo root).
cd /d "%~dp0"

echo === Pulling latest from main ===
git pull origin main || goto :error

echo.
echo === Installing dependencies ===
call npm install || goto :error

echo.
echo === Freeing port 5173 (stopping any existing server) ===
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173" ^| findstr LISTENING') do (
  echo   stopping PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

echo.
echo === Starting dev server on http://localhost:5173 ===
call npm run dev -- --port 5173 --strictPort

goto :eof

:error
echo.
echo *** Something went wrong (exit code %errorlevel%). ***
pause
