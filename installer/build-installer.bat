@echo off
REM Build the BB MiPing installer with Inno Setup 6.
REM Step 1: stage a clean copy of the project (robocopy with explicit excludes)
REM Step 2: compile installer\BBMiPing-Setup.iss (it packs the staging folder)
REM Output: installer\out\*.exe
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."
set "STAGING=%~dp0pkgsrc"
set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=D:\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" (
  echo [ERROR] Inno Setup 6 not found. Install it from https://jrsoftware.org/isdl.php
  pause
  exit /b 1
)

echo [1/2] Preparing clean staging folder...
if exist "%STAGING%" rd /s /q "%STAGING%"
if exist "%STAGING%" (
  echo [ERROR] Cannot remove old staging folder, close programs using it and retry.
  pause
  exit /b 1
)
robocopy "%ROOT%" "%STAGING%" /E /R:1 /W:1 /NFL /NDL /NJH /NJS ^
  /XF .env bb-config.json *.log ~$*.docx *.tsbuildinfo .DS_Store ^
  /XD "%ROOT%\.git" "%ROOT%\tmp" "%ROOT%\.runtime-logs" "%ROOT%\.qoder" "%ROOT%\.workbuddy" ^
      "%ROOT%\installer" "%ROOT%\storage\projects" "%ROOT%\uploads" "%ROOT%\pgdata" "%ROOT%\data" ^
      "%ROOT%\pgsql\pgAdmin 4" ^
      "%ROOT%\node_modules\@types" "%ROOT%\node_modules\typescript" "%ROOT%\node_modules\.bin" "%ROOT%\node_modules\.cache" ^
      "%ROOT%\backend\node_modules\@types" "%ROOT%\backend\node_modules\typescript" "%ROOT%\backend\node_modules\.bin" "%ROOT%\backend\node_modules\.cache"
if errorlevel 8 (
  echo [ERROR] Staging copy failed, robocopy exit code: !errorlevel!
  pause
  exit /b 1
)

echo [2/2] Compiling installer...
"%ISCC%" "%~dp0BBMiPing-Setup.iss"
if %errorlevel%==0 (
  echo.
  echo [OK] Installer created in installer\out\
) else (
  echo.
  echo [FAIL] Compile failed. Check messages above.
)
pause
