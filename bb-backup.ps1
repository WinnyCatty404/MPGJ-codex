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
$apiPort = if ($config -and $config.apiPort) { [int]$config.apiPort } else { 3100 }
$webPort = if ($config -and $config.webPort) { [int]$config.webPort } else { 5173 }
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
  # 以能否独占绑定端口判断服务是否可能运行，避免 Get-NetTCPConnection 中 PID 0
  # 的过期监听项让备份误以为服务仍在运行。
  $portsWereListening = (-not (Test-BBPortBindable -Port $apiPort)) -or (-not (Test-BBPortBindable -Port $webPort))
  $resumeServices = $false
  $restartError = ''
  if (Test-Path -LiteralPath $setDir) { throw "备份集已存在，请稍后重试：$setDir" }
  New-Item -ItemType Directory -Path $pendingDir -Force | Out-Null

  try {
    if ($portsWereListening) {
      try {
        $health = Invoke-RestMethod -Uri ("http://127.0.0.1:$webPort/api/health") -TimeoutSec 3
        $instanceId = Get-BBInstanceId -AppRoot $AppRoot -ConfiguredInstanceId $(if ($config -and $config.instanceId) { [string]$config.instanceId } else { '' })
        if ($health.ok -ne $true -or $health.database -ne $DbName -or $health.instanceId -ne $instanceId) { throw '实例身份不符' }
        $resumeServices = $true
      } catch {
        throw "配置端口正在使用，但无法确认是当前 BMPBGS 实例，已拒绝停止进程：$($_.Exception.Message)"
      }
      Write-Host '正在暂停 Web/API，保证数据库与附件处于同一备份时间点...'
      & (Join-Path $AppRoot 'bb-stop.ps1') -AppRoot $AppRoot -Silent -KeepPostgres
      $leftover = Wait-BBPortsReleased -Ports @($apiPort, $webPort) -TimeoutSeconds 5
      if ($leftover) { throw "暂停 Web/API 失败：端口 $($leftover.LocalPort) 仍在监听（PID $($leftover.OwningProcess)）" }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $p.DataRoot 'storage') -PathType Container)) {
      throw '数据目录缺少 storage，已中止备份，避免生成不完整备份集。'
    }
    $sqlFile = Join-Path $pendingDir "$DbName-$ts.dump"
    Write-Host '正在备份数据库...'
    & $pgDump -h 127.0.0.1 -p $p.PgPort -U $DbUser -F c -f $sqlFile $DbName
    Assert-BBNativeSuccess '数据库备份'
    if (-not (Test-Path -LiteralPath $sqlFile) -or (Get-Item -LiteralPath $sqlFile).Length -le 0) { throw '数据库备份文件为空。' }

    foreach ($d in @('storage', 'uploads')) {
      Write-Host "正在备份 $d..."
      Invoke-BBRobocopy -Source (Join-Path $p.DataRoot $d) -Destination (Join-Path $pendingDir $d)
    }

    $storageStats = Get-BBDirectoryFingerprint (Join-Path $pendingDir 'storage')
    $uploadStats = Get-BBDirectoryFingerprint (Join-Path $pendingDir 'uploads')
    $dumpItem = Get-Item -LiteralPath $sqlFile
    $manifest = [ordered]@{
      formatVersion = 2
      createdAt = (Get-Date).ToString('o')
      sourceMachine = $env:COMPUTERNAME
      instanceId = if ($config -and $config.instanceId) { [string]$config.instanceId } else { '' }
      database = [ordered]@{
        name = $DbName
        dumpFile = $dumpItem.Name
        bytes = [int64]$dumpItem.Length
        sha256 = (Get-FileHash -LiteralPath $sqlFile -Algorithm SHA256).Hash
      }
      storage = [ordered]@{ files = $storageStats.Count; bytes = $storageStats.Bytes; sha256 = $storageStats.Sha256; sourcePresent = $true }
      uploads = [ordered]@{ files = $uploadStats.Count; bytes = $uploadStats.Bytes; sha256 = $uploadStats.Sha256; sourcePresent = (Test-Path -LiteralPath (Join-Path $p.DataRoot 'uploads') -PathType Container) }
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
    if ($resumeServices) {
      Write-Host '正在恢复备份前的 Web/API 运行状态...'
      & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $AppRoot 'bb-start.ps1') -AppRoot $AppRoot -Silent -NoBrowser
      if ($LASTEXITCODE -ne 0) { $restartError = "备份数据已处理，但 Web/API 自动恢复失败，退出码：$LASTEXITCODE" }
    }
  }
  # 此处不能因"服务未自动恢复"就退出：本地备份已成功，提前退出会跳过 NAS 上传，
  # 且控制台收不到 BB_LOCAL_BACKUP_SET 与成功标记，会把成功的备份显示成失败
  # （2026-10-17：本轮加固引入的"假失败"回归）。警告与退出码延后到统一出口处理。
}

Write-Host "BB_LOCAL_BACKUP_SET=$setDir"
if ($restartError) {
  Write-Host "警告：$restartError"
  Write-Host 'BB_BACKUP_RESTART_FAILED'
}
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
if ($restartError) {
  # 3 = 本地备份（含 NAS，如已启用）已完成，仅 Web/API 未自动恢复运行
  Write-Host '请在控制台点击“启动系统”手动恢复 Web/API。'
  if (-not $Silent) { Read-Host '按回车退出' }
  exit 3
}
# 控制台据此判定任务成功（进程退出码在某些环境下读不到，不能单独依赖）
$taskKind = if ($RemoteOnly) { 'remoteupload' } else { 'backingup' }
Write-Host "BB_TASK_OK=$taskKind"
if (-not $Silent) { Read-Host '按回车退出' }
# 显式以 0 退出：robocopy 用位图作退出码（1=复制了文件），会泄漏成进程退出码，
# 导致控制台把成功的备份误判为失败。
exit 0
