# 停止 BMPBGS（结束前后端进程并停止 PostgreSQL）
# 用法：powershell -ExecutionPolicy Bypass -File bb-stop.ps1
# 注意：本文件含中文注释，保存时必须带 UTF-8 BOM。
param(
  [string]$AppRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition)
)
$ErrorActionPreference = 'Continue'
. (Join-Path $AppRoot 'bb-common.ps1')

$config  = Get-BBConfig -AppRoot $AppRoot
$apiPort = if ($config -and $config.apiPort) { [int]$config.apiPort } else { 3100 }
$webPort = if ($config -and $config.webPort) { [int]$config.webPort } else { 5173 }
$pgPort  = if ($config -and $config.pgPort)  { [int]$config.pgPort }  else { 54328 }

# 依据 pid 文件结束（精确结束本工具启动的进程）
$pidFile = Join-Path $env:TEMP 'bb-miping.pids'
if (Test-Path -LiteralPath $pidFile) {
  Get-Content -LiteralPath $pidFile | ForEach-Object {
    if ($_ -match '^(\w+)=(\d+)$') {
      $pidv = [int]$Matches[2]
      & taskkill /PID $pidv /T /F 2>$null | Out-Null
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

# 兜底：按监听端口结束（防止 pid 文件丢失时残留）
foreach ($port in @($apiPort, $webPort)) {
  Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object {
    & taskkill /PID $_.OwningProcess /T /F 2>$null | Out-Null
  }
}

# 停止 PostgreSQL
$configuredPgData = if ($config -and $config.pgData) { [string]$config.pgData } else { '' }
$p = Resolve-BBPaths -AppRoot $AppRoot -PgPort $pgPort -ConfiguredPgData $configuredPgData
$pgCtl = Join-Path $p.PgRoot 'bin\pg_ctl.exe'
if (Test-Path -LiteralPath $pgCtl) { & $pgCtl -D $p.PgData stop -m fast 2>$null | Out-Null }

Write-Host 'BMPBGS已停止。'
Read-Host '按回车退出'
