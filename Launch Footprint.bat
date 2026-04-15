@echo off
setlocal

set "PROJECT_ROOT=%~dp0"
if not exist "%PROJECT_ROOT%frontend\package.json" (
  set "PROJECT_ROOT=%USERPROFILE%\OneDrive\Documents\New project 3\"
)

if not exist "%PROJECT_ROOT%frontend\package.json" (
  echo Could not find the project root.
  pause
  exit /b 1
)

:: Clean up zombie ports from previous launches
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5173" ^| find "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| find ":8080" ^| find "LISTENING"') do taskkill /F /PID %%a >nul 2>&1

cd /d "%PROJECT_ROOT%backend"
go build -o bybit-engine.exe .
start "Bybit Footprint Backend" /min bybit-engine.exe
timeout /t 3 /nobreak >nul
start "Bybit Footprint Frontend" /min cmd /c "cd /d ""%PROJECT_ROOT%frontend"" && npm run dev"

timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"
