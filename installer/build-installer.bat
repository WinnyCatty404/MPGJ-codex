@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo [FAIL] Windows installer build failed with exit code %RC%.
pause
exit /b %RC%
