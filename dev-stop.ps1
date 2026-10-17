# 仅停止当前源码开发实例。
param([string]$ProjectRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition))
$ErrorActionPreference = 'Stop'
. (Join-Path $ProjectRoot 'bb-common.ps1')
$config = Get-BBConfig -AppRoot $ProjectRoot
if (-not $config -or [int]$config.pgPort -ne 54329 -or [int]$config.apiPort -ne 3101 -or [int]$config.webPort -ne 5174 -or -not (Test-BBSamePath ([string]$config.pgData) 'D:\BBMipingDB\data')) {
  throw '源码开发配置不完整或身份不符，已拒绝执行停止，以免影响安装版。'
}
& (Join-Path $ProjectRoot 'bb-stop.ps1') -AppRoot $ProjectRoot -Silent -PgRoot 'D:\BBMipingDB\PostgreSQL'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$runtimeDir = Get-BBRuntimeDir -AppRoot $ProjectRoot -InstanceId ([string]$config.instanceId)
$launcherPidFile = Join-Path $runtimeDir 'dev-launcher.pid'
if (Test-Path -LiteralPath $launcherPidFile) {
  $launcherPid = [int](Get-Content -LiteralPath $launcherPidFile -Raw)
  if ($launcherPid -gt 0 -and $launcherPid -ne $PID) {
    $launcherProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $launcherPid" -ErrorAction SilentlyContinue
    if ($launcherProcess -and $launcherProcess.Name -ieq 'powershell.exe' -and $launcherProcess.CommandLine -match 'dev-start\.ps1') {
      & taskkill /PID $launcherPid /T /F 2>$null | Out-Null
    }
  }
  Remove-Item -LiteralPath $launcherPidFile -Force -ErrorAction SilentlyContinue
}
Write-Host '源码开发实例已停止。' -ForegroundColor Green
