# 备份 BMPBGS数据（PostgreSQL 数据库 + storage/uploads 目录）
# 用法：powershell -ExecutionPolicy Bypass -File bb-backup.ps1
# 注意：本文件含中文注释，保存时必须带 UTF-8 BOM。
param(
  [string]$AppRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition),
  [string]$DbUser = 'postgres',
  [string]$DbName = 'bb_miping',
  [string]$PgPassword = 'BbMiping-Local-2026!',
  [string]$BackupRoot = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $AppRoot 'bb-common.ps1')
if (-not $BackupRoot) { $BackupRoot = Join-Path $AppRoot 'data\backups' }

$config  = Get-BBConfig -AppRoot $AppRoot
$pgPort  = if ($config -and $config.pgPort) { [int]$config.pgPort } else { 54328 }
$configuredPgData = if ($config -and $config.pgData) { [string]$config.pgData } else { '' }
$p = Resolve-BBPaths -AppRoot $AppRoot -PgPort $pgPort -ConfiguredPgData $configuredPgData

$pgDump = Join-Path $p.PgRoot 'bin\pg_dump.exe'
if (-not (Test-Path -LiteralPath $pgDump)) { Write-Error "未找到 pg_dump：$pgDump"; Read-Host '按回车退出'; exit 1 }

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$setDir = Join-Path $BackupRoot $ts
New-Item -ItemType Directory -Path $setDir -Force | Out-Null

$sqlFile = Join-Path $setDir "$DbName-$ts.dump"
$env:PGPASSWORD = $PgPassword
& $pgDump -h 127.0.0.1 -p $p.PgPort -U $DbUser -F c -f $sqlFile $DbName
if ($LASTEXITCODE -ne 0) { Write-Error '数据库备份失败（请确认 PostgreSQL 正在运行、postgres 密码正确）。'; Read-Host '按回车退出'; exit 1 }

# 备份文件目录（若存在）
foreach ($d in @('storage', 'uploads')) {
  $src = Join-Path $p.AppRoot $d
  if (Test-Path -LiteralPath $src) { robocopy $src (Join-Path $setDir $d) /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null }
}

Write-Host "备份完成：$setDir"
Read-Host '按回车退出'
