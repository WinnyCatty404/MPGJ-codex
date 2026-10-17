# 备份 BMPBGS数据（PostgreSQL 数据库 + storage/uploads 目录）
# 用法：powershell -ExecutionPolicy Bypass -File bb-backup.ps1
# 注意：本文件含中文注释，保存时必须带 UTF-8 BOM。
param(
  [string]$AppRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition),
  [string]$DbUser = 'postgres',
  [string]$DbName = 'bb_miping',
  [string]$PgPassword = 'BbMiping-Local-2026!',
  [string]$BackupRoot,
  [string]$BackupSet,
  [switch]$RemoteOnly,
  [switch]$Silent
)
$ErrorActionPreference = 'Stop'
. (Join-Path $AppRoot 'bb-common.ps1')
if (-not $BackupRoot) { $BackupRoot = Get-BBBackupRoot $AppRoot }

$config  = Get-BBConfig -AppRoot $AppRoot
$pgPort  = if ($config -and $config.pgPort) { [int]$config.pgPort } else { 54328 }
$configuredPgData = if ($config -and $config.pgData) { [string]$config.pgData } else { '' }
$p = Resolve-BBPaths -AppRoot $AppRoot -PgPort $pgPort -ConfiguredPgData $configuredPgData

function Set-BBRemoteBackupResult {
  param([bool]$Success, [string]$Message, [string]$RemotePath)
  $latestConfig = Get-BBConfig -AppRoot $AppRoot
  $existing = if ($latestConfig -and $latestConfig.remoteBackup) { $latestConfig.remoteBackup } else { $null }
  $remote = [ordered]@{
    enabled = [bool]($existing -and $existing.enabled)
    path = if ($existing -and $existing.path) { [string]$existing.path } else { '' }
    lastAttemptAt = (Get-Date).ToString('o')
    lastStatus = if ($Success) { 'success' } else { 'failed' }
    lastMessage = $Message
    lastRemotePath = $RemotePath
  }
  if ($Success) { $remote.lastSuccessAt = (Get-Date).ToString('o') }
  elseif ($existing -and $existing.lastSuccessAt) { $remote.lastSuccessAt = [string]$existing.lastSuccessAt }
  Set-BBConfig -AppRoot $AppRoot -Config ([PSCustomObject]@{ remoteBackup = [PSCustomObject]$remote })
}

function Invoke-BBRemoteBackup {
  param([string]$LocalSet)
  $latestConfig = Get-BBConfig -AppRoot $AppRoot
  $remote = if ($latestConfig) { $latestConfig.remoteBackup } else { $null }
  if (-not $remote -or -not $remote.enabled) { return $null }
  $remoteRoot = ([string]$remote.path).Trim().TrimEnd('\')
  if (-not (Test-BBUncPath $remoteRoot)) { throw '远程备份路径不是有效的 UNC 路径，请在控制台设置中重新选择。' }
  Write-Host "正在上传 NAS：$remoteRoot"
  return Copy-BBBackupSetAtomic -Source $LocalSet -DestinationRoot $remoteRoot
}

$setDir = $null
if ($RemoteOnly) {
  if (-not $BackupSet -or -not (Test-Path -LiteralPath $BackupSet -PathType Container)) {
    Write-Error '仅重试远程上传时必须提供有效的 -BackupSet。'; if (-not $Silent) { Read-Host '按回车退出' }; exit 1
  }
  $setDir = [IO.Path]::GetFullPath($BackupSet)
} else {
  $pgDump = Join-Path $p.PgRoot 'bin\pg_dump.exe'
  if (-not (Test-Path -LiteralPath $pgDump)) { Write-Error "未找到 pg_dump：$pgDump"; if (-not $Silent) { Read-Host '按回车退出' }; exit 1 }

  # 实例身份校验在创建备份目录前完成，防止两套实例串台。
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
      sourceMachine = $env:COMPUTERNAME
      instanceId = if ($config -and $config.instanceId) { [string]$config.instanceId } else { '' }
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
    Write-Host "本地备份完成：$setDir"
  } catch {
    Remove-Item -LiteralPath $pendingDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Error "备份失败：$($_.Exception.Message)"
    if (-not $Silent) { Read-Host '按回车退出' }
    exit 1
  } finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  }
}

Write-Host "BB_LOCAL_BACKUP_SET=$setDir"
$latestConfig = Get-BBConfig -AppRoot $AppRoot
$remoteEnabled = [bool]($latestConfig -and $latestConfig.remoteBackup -and $latestConfig.remoteBackup.enabled)
if ($RemoteOnly -and -not $remoteEnabled) { Write-Error '远程备份尚未启用。'; if (-not $Silent) { Read-Host '按回车退出' }; exit 1 }
if ($remoteEnabled) {
  try {
    $remoteResult = Invoke-BBRemoteBackup -LocalSet $setDir
    $remoteMessage = if ($remoteResult.AlreadyExists) { '远程备份已存在且校验一致' } else { '远程备份上传成功' }
    Set-BBRemoteBackupResult -Success $true -Message $remoteMessage -RemotePath $remoteResult.Path
    Write-Host "$remoteMessage：$($remoteResult.Path)"
  } catch {
    $remoteError = $_.Exception.Message
    if ($remoteError -match '1219|multiple connections|多个连接') { $remoteError += '。Windows 已用另一套账号连接同一 NAS，请先在资源管理器中处理该连接。' }
    try { Set-BBRemoteBackupResult -Success $false -Message $remoteError -RemotePath '' } catch { }
    Write-Host "警告：本地备份已成功，但 NAS 备份失败：$remoteError"
    Write-Host "BB_REMOTE_BACKUP_FAILED=$remoteError"
    if (-not $Silent) { Read-Host '按回车退出' }
    exit 2
  }
}
if (-not $Silent) { Read-Host '按回车退出' }
