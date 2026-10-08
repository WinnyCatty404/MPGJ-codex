# 恢复 BMPBGS数据（重建数据库 + 还原 storage/uploads）
# 用法：powershell -ExecutionPolicy Bypass -File bb-restore.ps1
# 注意：本文件含中文注释，保存时必须带 UTF-8 BOM。
param(
  [string]$AppRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition),
  [string]$SuperUser = 'postgres',
  [string]$AppUser = 'bb_miping_app',
  [string]$DbName = 'bb_miping',
  [string]$PgPassword = 'BbMiping-Local-2026!',
  [string]$BackupRoot = '',
  [string]$BackupSet = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $AppRoot 'bb-common.ps1')
if (-not $BackupRoot) { $BackupRoot = Join-Path $AppRoot 'data\backups' }

$config  = Get-BBConfig -AppRoot $AppRoot
$pgPort  = if ($config -and $config.pgPort) { [int]$config.pgPort } else { 54328 }
$configuredPgData = if ($config -and $config.pgData) { [string]$config.pgData } else { '' }
$p = Resolve-BBPaths -AppRoot $AppRoot -PgPort $pgPort -ConfiguredPgData $configuredPgData

$psql = Join-Path $p.PgRoot 'bin\psql.exe'
$pgRestore = Join-Path $p.PgRoot 'bin\pg_restore.exe'
if (-not (Test-Path -LiteralPath $pgRestore)) { Write-Error "未找到 pg_restore：$pgRestore"; Read-Host '按回车退出'; exit 1 }

# 选择备份集
if (-not $BackupSet) {
  $sets = Get-ChildItem -Directory $BackupRoot -ErrorAction SilentlyContinue | Sort-Object Name -Descending
  if ($sets.Count -eq 0) { Write-Error "未找到任何备份：$BackupRoot"; Read-Host '按回车退出'; exit 1 }
  Write-Host '可用备份集：'
  for ($i = 0; $i -lt $sets.Count; $i++) { Write-Host "  [$i] $($sets[$i].Name)" }
  $idx = Read-Host '请输入要恢复的备份集编号'
  $BackupSet = $sets[[int]$idx].FullName
}

$sqlFile = Get-Item (Join-Path $BackupSet "$DbName-*.dump") -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $sqlFile) { Write-Error '备份集中未找到数据库 dump 文件。'; Read-Host '按回车退出'; exit 1 }

$env:PGPASSWORD = $PgPassword
# 终止连接并重建数据库
& $psql -h 127.0.0.1 -p $p.PgPort -U $SuperUser -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DbName' AND pid <> pg_backend_pid();" 2>$null
& $psql -h 127.0.0.1 -p $p.PgPort -U $SuperUser -d postgres -c "DROP DATABASE IF EXISTS $DbName;"
& $psql -h 127.0.0.1 -p $p.PgPort -U $SuperUser -d postgres -c "CREATE DATABASE $DbName OWNER $AppUser ENCODING 'UTF8';"
& $pgRestore -h 127.0.0.1 -p $p.PgPort -U $SuperUser -d $DbName -F c $sqlFile.FullName
if ($LASTEXITCODE -ne 0) { Write-Error '数据库恢复失败（请确认 PostgreSQL 正在运行、postgres 密码正确）。'; Read-Host '按回车退出'; exit 1 }

# 恢复文件目录
foreach ($d in @('storage', 'uploads')) {
  $src = Join-Path $BackupSet $d
  if (Test-Path -LiteralPath $src) { robocopy $src (Join-Path $p.AppRoot $d) /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null }
}

Write-Host "恢复完成：$BackupSet（恢复后请重启 BMPBGS）"
Read-Host '按回车退出'
