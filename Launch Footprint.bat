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

start "" cmd /k "cd /d ""%PROJECT_ROOT%frontend"" && npm run dev"
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"
