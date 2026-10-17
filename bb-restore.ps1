# 恢复 BMPBGS数据（重建数据库 + 还原 storage/uploads）
# 用法：powershell -ExecutionPolicy Bypass -File bb-restore.ps1
# 注意：本文件含中文注释，保存时必须带 UTF-8 BOM。
param(
  [string]$AppRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition),
  [string]$SuperUser = 'postgres',
  [string]$AppUser = 'bb_miping_app',
  [string]$DbName = 'bb_miping',
  [string]$PgPassword = 'BbMiping-Local-2026!',
  [string]$BackupRoot,
  [string]$BackupSet,
  [switch]$Silent
)
$ErrorActionPreference = 'Stop'
. (Join-Path $AppRoot 'bb-common.ps1')
if (-not $BackupRoot) { $BackupRoot = Get-BBBackupRoot $AppRoot }

$config  = Get-BBConfig -AppRoot $AppRoot
$pgPort  = if ($config -and $config.pgPort) { [int]$config.pgPort } else { 54328 }
$configuredPgData = if ($config -and $config.pgData) { [string]$config.pgData } else { '' }
$p = Resolve-BBPaths -AppRoot $AppRoot -PgPort $pgPort -ConfiguredPgData $configuredPgData

$psql = Join-Path $p.PgRoot 'bin\psql.exe'
$pgRestore = Join-Path $p.PgRoot 'bin\pg_restore.exe'
if (-not (Test-Path -LiteralPath $pgRestore)) { Write-Error "未找到 pg_restore：$pgRestore"; if (-not $Silent) { Read-Host '按回车退出' }; exit 1 }

$remoteRestoreStage = $null
function Remove-BBRemoteRestoreStage {
  if ($script:remoteRestoreStage -and (Test-Path -LiteralPath $script:remoteRestoreStage)) {
    Remove-Item -LiteralPath $script:remoteRestoreStage -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# 选择备份集
if (-not $BackupSet) {
  $sets = Get-ChildItem -Directory $BackupRoot -ErrorAction SilentlyContinue | Sort-Object Name -Descending
  if ($sets.Count -eq 0) { Write-Error "未找到任何备份：$BackupRoot"; if (-not $Silent) { Read-Host '按回车退出' }; exit 1 }
  if ($Silent) {
    $BackupSet = $sets[0].FullName
    Write-Host "静默模式自动选择最新备份集：$($sets[0].Name)"
  } else {
    Write-Host '可用备份集：'
    for ($i = 0; $i -lt $sets.Count; $i++) { Write-Host "  [$i] $($sets[$i].Name)" }
    $idx = Read-Host '请输入要恢复的备份集编号'
    $BackupSet = $sets[[int]$idx].FullName
  }
}

# NAS 备份先完整下载并校验，在此之前不停止任何服务。
if (Test-BBUncPath $BackupSet) {
  $remoteSource = $BackupSet
  $remoteRestoreStage = Join-Path $p.DataRoot ('.remote-restore-download-' + [guid]::NewGuid().ToString('N'))
  $script:remoteRestoreStage = $remoteRestoreStage
  try {
    Write-Host "正在从 NAS 下载备份集：$remoteSource"
    Invoke-BBRobocopy -Source $remoteSource -Destination $remoteRestoreStage -Mirror
    $downloadInfo = Get-BBBackupSetInfo -Path $remoteRestoreStage -DbName $DbName -Deep
    if (-not $downloadInfo.Valid) { throw $downloadInfo.Error }
    $BackupSet = $remoteRestoreStage
    Write-Host '远程备份已下载并通过清单校验。'
  } catch {
    Remove-BBRemoteRestoreStage
    Write-Error "NAS 备份下载或校验失败，现有数据未修改：$($_.Exception.Message)"
    if (-not $Silent) { Read-Host '按回车退出' }
    exit 1
  }
}

$sqlFile = Get-Item (Join-Path $BackupSet "$DbName-*.dump") -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $sqlFile) { Remove-BBRemoteRestoreStage; Write-Error '备份集中未找到数据库 dump 文件。'; if (-not $Silent) { Read-Host '按回车退出' }; exit 1 }
$backupInfo = Get-BBBackupSetInfo -Path $BackupSet -DbName $DbName -Deep
if (-not $backupInfo.Valid) { Remove-BBRemoteRestoreStage; Write-Error "备份集完整性校验失败：$($backupInfo.Error)"; if (-not $Silent) { Read-Host '按回车退出' }; exit 1 }
$sqlFile = Get-Item -LiteralPath $backupInfo.DumpFile
foreach ($d in @('storage', 'uploads')) {
  if (-not (Test-Path -LiteralPath (Join-Path $BackupSet $d) -PathType Container)) {
    Remove-BBRemoteRestoreStage; Write-Error "备份集缺少 $d 目录，已中止恢复，现有数据未修改。"; if (-not $Silent) { Read-Host '按回车退出' }; exit 1
  }
}

function Invoke-RestoreSql {
  param([string]$Database, [string]$Sql, [string]$Step, [switch]$ReturnValue)
  $result = & $psql -h 127.0.0.1 -p $p.PgPort -U $SuperUser -d $Database -v ON_ERROR_STOP=1 -tAc $Sql
  Assert-BBNativeSuccess $Step
  if ($ReturnValue) { return ([string]($result | Select-Object -First 1)).Trim() }
}

# 在停止服务和修改数据前先验证归档目录，损坏备份不会进入破坏性阶段。
Write-Host "正在预检备份集：$BackupSet"
$manifestPath = Join-Path $BackupSet 'backup-manifest.json'
if (Test-Path -LiteralPath $manifestPath) {
  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.database.dumpFile -and $manifest.database.dumpFile -ne $sqlFile.Name) { throw '清单中的 dump 文件名与实际文件不一致' }
    if ($manifest.database.bytes -and [int64]$manifest.database.bytes -ne [int64]$sqlFile.Length) { throw '数据库 dump 文件大小与清单不一致' }
    if ($manifest.database.sha256) {
      $actualHash = (Get-FileHash -LiteralPath $sqlFile.FullName -Algorithm SHA256).Hash
      if ($actualHash -ne [string]$manifest.database.sha256) { throw '数据库 dump 校验值与清单不一致' }
    }
  } catch { Remove-BBRemoteRestoreStage; Write-Error "备份清单校验失败：$($_.Exception.Message)"; if (-not $Silent) { Read-Host '按回车退出' }; exit 1 }
}
& $pgRestore -l $sqlFile.FullName 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Remove-BBRemoteRestoreStage; Write-Error '数据库 dump 无法读取，恢复已中止，现有数据未修改。'; if (-not $Silent) { Read-Host '按回车退出' }; exit 1 }

$tag = (Get-Date -Format 'yyyyMMddHHmmss') + '_' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$tempDb = 'bb_restore_' + $tag
$oldDb = 'bb_before_' + $tag
$stageRoot = Join-Path $p.DataRoot ('.restore-stage-' + $tag)
$rollbackRoot = Join-Path $p.DataRoot ('.restore-rollback-' + $tag)
$hadOriginalDb = $false
$oldDbRenamed = $false
$dbSwapped = $false
$initializedForRestore = $false
$movedOriginal = @{}
$activated = @{}
$env:PGPASSWORD = $PgPassword

try {
  Write-Host '正在停止 Web/API，PostgreSQL 将保持或自动恢复运行...'
  & (Join-Path $AppRoot 'bb-stop.ps1') -AppRoot $AppRoot -Silent -KeepPostgres
  # 停止脚本内部 taskkill 的退出码会污染 $LASTEXITCODE，Assert-BBNativeSuccess 不可靠；
  # 以端口实际释放为准（最多重试 5 秒）。
  $apiPort = if ($config -and $config.apiPort) { [int]$config.apiPort } else { 3100 }
  $webPort = if ($config -and $config.webPort) { [int]$config.webPort } else { 5173 }
  $leftover = Wait-BBPortsReleased -Ports @($apiPort, $webPort) -TimeoutSeconds 5
  if ($leftover) { throw "停止 Web/API 失败：端口 $($leftover.LocalPort) 仍在监听（PID $($leftover.OwningProcess)）" }

  Write-Host '正在准备 PostgreSQL...'
  $pgState = Start-BBPostgres -Paths $p -SuperUser $SuperUser -PgPassword $PgPassword -AllowInitialize
  $initializedForRestore = [bool]$pgState.Initialized
  if ($pgState.Initialized) { Write-Host '检测到 pgdata 已删除，已初始化新的最小 PostgreSQL 集群。' }
  Ensure-BBAppRole -Paths $p -SuperUser $SuperUser -PgPassword $PgPassword -AppUser $AppUser

  Write-Host '正在暂存 storage/uploads...'
  New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
  foreach ($d in @('storage', 'uploads')) {
    Invoke-BBRobocopy -Source (Join-Path $BackupSet $d) -Destination (Join-Path $stageRoot $d) -Mirror
  }
  $hadOriginalDb = (Invoke-RestoreSql -Database postgres -Sql "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='$DbName')" -Step '检查当前数据库' -ReturnValue) -eq 't'
  Invoke-RestoreSql -Database postgres -Sql "CREATE DATABASE $tempDb OWNER $AppUser ENCODING 'UTF8'" -Step '创建临时恢复数据库'
  Write-Host '正在恢复数据库到临时库...'
  & $pgRestore -h 127.0.0.1 -p $p.PgPort -U $SuperUser -d $tempDb -F c --exit-on-error $sqlFile.FullName
  Assert-BBNativeSuccess '恢复数据库归档'
  $coreCount = Invoke-RestoreSql -Database $tempDb -Sql "SELECT count(*) FROM (VALUES ('users'),('projects'),('project_stage_records'),('system_settings')) AS required(name) WHERE to_regclass('public.' || name) IS NOT NULL" -Step '校验恢复数据库' -ReturnValue
  if ($coreCount -ne '4') { throw "恢复后的数据库缺少核心表（通过 $coreCount/4）" }

  Write-Host '正在切换数据库...'
  if ($hadOriginalDb) {
    Invoke-RestoreSql -Database postgres -Sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DbName' AND pid <> pg_backend_pid()" -Step '终止原数据库连接'
    Invoke-RestoreSql -Database postgres -Sql "ALTER DATABASE $DbName RENAME TO $oldDb" -Step '保留原数据库用于回退'
    $oldDbRenamed = $true
  }
  Invoke-RestoreSql -Database postgres -Sql "ALTER DATABASE $tempDb RENAME TO $DbName" -Step '启用恢复数据库'
  $dbSwapped = $true

  Write-Host '正在切换 storage/uploads...'
  New-Item -ItemType Directory -Path $rollbackRoot -Force | Out-Null
  foreach ($d in @('storage', 'uploads')) {
    $active = Join-Path $p.DataRoot $d
    $stagedDir = Join-Path $stageRoot $d
    $rollbackDir = Join-Path $rollbackRoot $d
    $movedOriginal[$d] = $false
    $activated[$d] = $false
    if (Test-Path -LiteralPath $active) {
      Move-Item -LiteralPath $active -Destination $rollbackDir
      $movedOriginal[$d] = $true
    }
    Move-Item -LiteralPath $stagedDir -Destination $active
    $activated[$d] = $true
  }

  $activeStorage = Get-BBDirectoryFingerprint (Join-Path $p.DataRoot 'storage')
  $activeUploads = Get-BBDirectoryFingerprint (Join-Path $p.DataRoot 'uploads')
  if ($activeStorage.Count -ne $backupInfo.StorageFiles -or $activeStorage.Bytes -ne $backupInfo.StorageBytes) { throw '启用后的 storage 与备份集统计不一致' }
  if ($activeUploads.Count -ne $backupInfo.UploadFiles -or $activeUploads.Bytes -ne $backupInfo.UploadBytes) { throw '启用后的 uploads 与备份集统计不一致' }
  if ($backupInfo.StorageSha256 -and $activeStorage.Sha256 -ne $backupInfo.StorageSha256) { throw '启用后的 storage 校验值与备份集不一致' }
  if ($backupInfo.UploadSha256 -and $activeUploads.Sha256 -ne $backupInfo.UploadSha256) { throw '启用后的 uploads 校验值与备份集不一致' }

  Write-Host '正在启动应用执行恢复后健康检查...'
  try {
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $AppRoot 'bb-start.ps1') -AppRoot $AppRoot -Silent -NoBrowser -ValidationOnly
    Assert-BBNativeSuccess '启动恢复后的 Web/API'
    $health = Invoke-RestMethod -Uri ("http://127.0.0.1:$webPort/api/health") -TimeoutSec 5
    $instanceId = Get-BBInstanceId -AppRoot $AppRoot -ConfiguredInstanceId $(if ($config -and $config.instanceId) { [string]$config.instanceId } else { '' })
    if ($health.ok -ne $true -or $health.database -ne $DbName -or $health.instanceId -ne $instanceId) { throw '恢复后的应用健康检查返回了错误的数据库或实例身份' }
  } finally {
    & (Join-Path $AppRoot 'bb-stop.ps1') -AppRoot $AppRoot -Silent -KeepPostgres
    # node 退出到端口真正可重新绑定需要几秒；这里比流程开头的停止多给一些余量，
    # 判定依据是 Test-BBPortBindable（能否自行绑定），不再受过期 TCB 干扰。
    $healthStopLeftover = Wait-BBPortsReleased -Ports @($apiPort, $webPort) -TimeoutSeconds 12
    if ($healthStopLeftover) { throw "健康检查后停止 Web/API 失败：端口 $($healthStopLeftover.LocalPort) 仍在监听" }
  }

  if ($hadOriginalDb) {
    Invoke-RestoreSql -Database postgres -Sql "DROP DATABASE $oldDb" -Step '清理原数据库副本'
  }
  Remove-Item -LiteralPath $rollbackRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "恢复完成：$BackupSet"
  Write-Host 'BB_TASK_OK=restoring'
  Write-Host 'Web/API 当前保持停止，请在控制台点击“启动系统”。'
} catch {
  $failure = $_.Exception.Message
  # 回退 SQL 同样需要密码：Start-BBPostgres/Ensure-BBAppRole 在异常路径可能已还原
  # PGPASSWORD，这里显式兜底，防止回退的 psql 因无密码进入交互式等待，在控制台
  # 隐藏窗口中永久挂起（2026-10-17 恢复卡死、控制台无法关闭的事故根因）。
  $env:PGPASSWORD = $PgPassword
  Write-Host "恢复失败，正在回退：$failure"
  foreach ($d in @('uploads', 'storage')) {
    $active = Join-Path $p.DataRoot $d
    $rollbackDir = Join-Path $rollbackRoot $d
    if ($activated[$d] -and (Test-Path -LiteralPath $active)) { Remove-Item -LiteralPath $active -Recurse -Force -ErrorAction SilentlyContinue }
    if ($movedOriginal[$d] -and (Test-Path -LiteralPath $rollbackDir)) { Move-Item -LiteralPath $rollbackDir -Destination $active -ErrorAction SilentlyContinue }
  }
  if ($dbSwapped) {
    try {
      Invoke-RestoreSql -Database postgres -Sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DbName' AND pid <> pg_backend_pid()" -Step '终止失败恢复库连接'
      Invoke-RestoreSql -Database postgres -Sql "DROP DATABASE IF EXISTS $DbName" -Step '移除失败恢复库'
      if ($hadOriginalDb) { Invoke-RestoreSql -Database postgres -Sql "ALTER DATABASE $oldDb RENAME TO $DbName" -Step '恢复原数据库' }
    } catch { Write-Host "数据库自动回退失败：$($_.Exception.Message)" }
  } else {
    try {
      Invoke-RestoreSql -Database postgres -Sql "DROP DATABASE IF EXISTS $tempDb" -Step '清理临时恢复库'
      if ($oldDbRenamed) { Invoke-RestoreSql -Database postgres -Sql "ALTER DATABASE $oldDb RENAME TO $DbName" -Step '恢复原数据库名称' }
    } catch { Write-Host "数据库自动回退失败：$($_.Exception.Message)" }
  }
  Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $rollbackRoot -Recurse -Force -ErrorAction SilentlyContinue
  if ($initializedForRestore -and (Test-Path -LiteralPath (Join-Path $p.PgData 'PG_VERSION'))) {
    try {
      $pgCtl = Join-Path $p.PgRoot 'bin\pg_ctl.exe'
      & $pgCtl -D $p.PgData stop -m fast 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "pg_ctl 退出码 $LASTEXITCODE" }
      Remove-Item -LiteralPath $p.PgData -Recurse -Force
      Write-Host '已移除本次恢复临时初始化的 PostgreSQL 数据目录。'
    } catch { Write-Host "清理本次初始化的 PostgreSQL 目录失败：$($_.Exception.Message)" }
  }
  Write-Error "恢复失败：$failure。现有数据已尽可能回退，Web/API 保持停止。"
  if (-not $Silent) { Read-Host '按回车退出' }
  exit 1
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-BBRemoteRestoreStage
}
if (-not $Silent) { Read-Host '按回车退出' }
# 显式以 0 退出：内部 native 命令（robocopy/pg_ctl 等）的退出码会泄漏成进程退出码，
# 导致控制台把成功的恢复误判为失败。
exit 0
