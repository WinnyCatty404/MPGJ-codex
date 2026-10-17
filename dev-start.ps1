# BMPBGS 源码开发环境安全启动器。不允许初始化或替换现有开发数据库。
param([string]$ProjectRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition))
$ErrorActionPreference = 'Stop'
. (Join-Path $ProjectRoot 'bb-common.ps1')

$pgData = 'D:\BBMipingDB\data'
$pgPort = 54329
$apiPort = 3101
$webPort = 5174
$pgVersion = Join-Path $pgData 'PG_VERSION'
if (-not (Test-Path -LiteralPath $pgVersion)) {
  throw "开发数据库保护已生效：未找到 $pgVersion，已中止，不会自动 initdb。"
}

$oldConfig = Get-BBConfig -AppRoot $ProjectRoot
$instanceId = Get-BBInstanceId -AppRoot $ProjectRoot -ConfiguredInstanceId $(if ($oldConfig -and $oldConfig.instanceId) { [string]$oldConfig.instanceId } else { '' })
if (-not $instanceId.StartsWith('source-dev-')) { $instanceId = Get-BBInstanceId -AppRoot $ProjectRoot }
$jwtSecret = if ($oldConfig -and $oldConfig.jwtSecret) { [string]$oldConfig.jwtSecret } else { [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') }
$config = [PSCustomObject]@{
  instanceId = $instanceId
  pgPort = $pgPort
  apiPort = $apiPort
  webPort = $webPort
  jwtSecret = $jwtSecret
  pgData = $pgData
}
Set-BBConfig -AppRoot $ProjectRoot -Config $config
$paths = [PSCustomObject]@{
  AppRoot = $ProjectRoot
  PgRoot = 'D:\BBMipingDB\PostgreSQL'
  PgData = $pgData
  DataRoot = $ProjectRoot
  PgPort = $pgPort
}

$pgCtl = Join-Path $paths.PgRoot 'bin\pg_ctl.exe'
$psql = Join-Path $paths.PgRoot 'bin\psql.exe'
if (-not (Test-Path -LiteralPath $pgCtl) -or -not (Test-Path -LiteralPath $psql)) { throw "未找到开发用 PostgreSQL：$($paths.PgRoot)" }

# 数据目录若已在旧端口运行，不自动停库，避免中断未知会话。
& $pgCtl -D $pgData status 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  $env:PGPASSWORD = 'BbMiping-Local-2026!'
  try { $runningDir = Get-BBTargetInstanceDataDir -Psql $psql -PgPort $pgPort } finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
  if (-not $runningDir -or -not (Test-BBSamePath $runningDir $pgData)) {
    $pidLines = @(Get-Content -LiteralPath (Join-Path $pgData 'postmaster.pid') -ErrorAction SilentlyContinue)
    $runningPort = if ($pidLines.Count -ge 4) { $pidLines[3] } else { '未知' }
    throw "开发数据库已在端口 $runningPort 运行，但预期为 $pgPort。请先执行 npm run dev:stop 后重试。"
  }
}

[void](Start-BBPostgres -Paths $paths -PgPassword 'BbMiping-Local-2026!')
$env:PORT = "$apiPort"
$env:VITE_API_PORT = "$apiPort"
$env:VITE_DEV_PORT = "$webPort"
$env:BB_DATA_ROOT = $ProjectRoot
$env:JWT_SECRET = $jwtSecret
$env:BMPBGS_INSTANCE_ID = $instanceId
$env:DATABASE_URL = "postgresql://bb_miping_app:BbMiping-App-2026!@127.0.0.1:$pgPort/bb_miping"

Write-Host "开发实例：$instanceId" -ForegroundColor Cyan
Write-Host "数据库：$pgData @ $pgPort（不会初始化）" -ForegroundColor Cyan
Write-Host "开发地址：http://127.0.0.1:$webPort" -ForegroundColor Green
Write-Host '停止开发环境：npm run dev:stop' -ForegroundColor DarkGray
$runtimeDir = Get-BBRuntimeDir -AppRoot $ProjectRoot -InstanceId $instanceId
$launcherPidFile = Join-Path $runtimeDir 'dev-launcher.pid'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
Set-Content -LiteralPath $launcherPidFile -Value $PID -Encoding ASCII
try {
  & npm.cmd run dev:raw
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $launcherPidFile -Force -ErrorAction SilentlyContinue
}
