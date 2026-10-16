# 备份 BMPBGS数据（PostgreSQL 数据库 + storage/uploads 目录）
# 用法：powershell -ExecutionPolicy Bypass -File bb-backup.ps1
# 注意：本文件含中文注释，保存时必须带 UTF-8 BOM。
param(
  [string]$AppRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition),
  [string]$DbUser = 'postgres',
  [string]$DbName = 'bb_miping',
  [string]$PgPassword = 'BbMiping-Local-2026!',
  [string]$BackupRoot,
  [switch]$Silent
)
$ErrorActionPreference = 'Stop'
. (Join-Path $AppRoot 'bb-common.ps1')
if (-not $BackupRoot) { $BackupRoot = Get-BBBackupRoot $AppRoot }

$config  = Get-BBConfig -AppRoot $AppRoot
$pgPort  = if ($config -and $config.pgPort) { [int]$config.pgPort } else { 54328 }
$configuredPgData = if ($config -and $config.pgData) { [string]$config.pgData } else { '' }
$p = Resolve-BBPaths -AppRoot $AppRoot -PgPort $pgPort -ConfiguredPgData $configuredPgData

$pgDump = Join-Path $p.PgRoot 'bin\pg_dump.exe'
if (-not (Test-Path -LiteralPath $pgDump)) { Write-Error "未找到 pg_dump：$pgDump"; if (-not $Silent) { Read-Host '按回车退出' }; exit 1 }

# 实例身份校验：脚本是按端口连接的，若端口已被另一个 PostgreSQL 实例占用
# （例如另一套 BMPBGS 或开发集群），会把别人的库和本应用的文件目录拼成一份错位备份。
# 必须放在“创建备份目录”之前，这样校验不通过时不会留下空的备份集。
$psqlExe = Join-Path $p.PgRoot 'bin\psql.exe'
$env:PGPASSWORD = $PgPassword
$actualDataDir = Get-BBTargetInstanceDataDir -Psql $psqlExe -PgPort $p.PgPort -DbUser $DbUser
if (-not $actualDataDir) {
  Write-Error "无法校验 PostgreSQL 实例身份：请确认端口 $($p.PgPort) 上的 PostgreSQL 正在运行、且超级用户 $DbUser 口令正确。"
  if (-not $Silent) { Read-Host '按回车退出' }; exit 1
}
if (-not (Test-BBSamePath $actualDataDir $p.PgData)) {
  Write-Error "端口 $($p.PgPort) 上的 PostgreSQL 实例不是本应用的数据目录，已中止备份。期望：$($p.PgData)  实际：$actualDataDir（请停掉占用该端口的其他实例后重试）"
  if (-not $Silent) { Read-Host '按回车退出' }; exit 1
}

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$setDir = Join-Path $BackupRoot $ts
New-Item -ItemType Directory -Path $setDir -Force | Out-Null

$sqlFile = Join-Path $setDir "$DbName-$ts.dump"
$env:PGPASSWORD = $PgPassword
& $pgDump -h 127.0.0.1 -p $p.PgPort -U $DbUser -F c -f $sqlFile $DbName
if ($LASTEXITCODE -ne 0) { Write-Error '数据库备份失败（请确认 PostgreSQL 正在运行、postgres 密码正确）。'; if (-not $Silent) { Read-Host '按回车退出' }; exit 1 }

# 备份文件目录（若存在）
foreach ($d in @('storage', 'uploads')) {
  $src = Join-Path $p.DataRoot $d
  if (Test-Path -LiteralPath $src) { robocopy $src (Join-Path $setDir $d) /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null }
}

# robocopy 用位图表示结果（1=复制了文件），直接泄漏会让本脚本以非零退出码结束。
$global:LASTEXITCODE = 0
Write-Host "备份完成：$setDir"
if (-not $Silent) { Read-Host '按回车退出' }
