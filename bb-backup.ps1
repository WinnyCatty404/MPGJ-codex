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
$pendingDir = Join-Path $BackupRoot ('.pending-' + $ts + '-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $setDir) { throw "备份集已存在，请稍后重试：$setDir" }
New-Item -ItemType Directory -Path $pendingDir -Force | Out-Null

try {
  $sqlFile = Join-Path $pendingDir "$DbName-$ts.dump"
  Write-Host '正在备份数据库...'
  & $pgDump -h 127.0.0.1 -p $p.PgPort -U $DbUser -F c -f $sqlFile $DbName
  Assert-BBNativeSuccess '数据库备份'
  if (-not (Test-Path -LiteralPath $sqlFile) -or (Get-Item -LiteralPath $sqlFile).Length -le 0) { throw '数据库备份文件为空。' }

  foreach ($d in @('storage', 'uploads')) {
    Write-Host "正在备份 $d..."
    Invoke-BBRobocopy -Source (Join-Path $p.DataRoot $d) -Destination (Join-Path $pendingDir $d)
  }

  $storageStats = Get-BBDirectoryStats (Join-Path $pendingDir 'storage')
  $uploadStats = Get-BBDirectoryStats (Join-Path $pendingDir 'uploads')
  $dumpItem = Get-Item -LiteralPath $sqlFile
  $manifest = [ordered]@{
    formatVersion = 1
    createdAt = (Get-Date).ToString('o')
    database = [ordered]@{
      name = $DbName
      dumpFile = $dumpItem.Name
      bytes = [int64]$dumpItem.Length
      sha256 = (Get-FileHash -LiteralPath $sqlFile -Algorithm SHA256).Hash
    }
    storage = [ordered]@{ files = $storageStats.Count; bytes = $storageStats.Bytes }
    uploads = [ordered]@{ files = $uploadStats.Count; bytes = $uploadStats.Bytes }
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $pendingDir 'backup-manifest.json') -Encoding UTF8
  Move-Item -LiteralPath $pendingDir -Destination $setDir
  Write-Host "备份完成：$setDir"
} catch {
  Remove-Item -LiteralPath $pendingDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Error "备份失败：$($_.Exception.Message)"
  if (-not $Silent) { Read-Host '按回车退出' }
  exit 1
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
if (-not $Silent) { Read-Host '按回车退出' }
