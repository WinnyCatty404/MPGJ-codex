param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath($ProjectRoot)
. (Join-Path $project 'bb-common.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

Assert-True (Test-BBUncPath '\\192.168.43.68\信息安全\商用密码安全性评估\张晓冰\BMPBGS备份') '中文 UNC 路径未通过校验'
Assert-True (-not (Test-BBUncPath 'D:\BMPBGS-Data\backups')) '本地路径被误识别为 UNC'

foreach ($name in @('bb-common.ps1', 'bb-backup.ps1', 'bb-restore.ps1', 'bb-control.ps1')) {
  $path = Join-Path $project $name
  $bytes = [IO.File]::ReadAllBytes($path)
  Assert-True ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) "$name 缺少 UTF-8 BOM"
  $tokens = $null; $errors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
  Assert-True ($errors.Count -eq 0) "$name 存在 PowerShell 语法错误：$($errors[0].Message)"
}

$backupScript = Get-Content -LiteralPath (Join-Path $project 'bb-backup.ps1') -Raw
$restoreScript = Get-Content -LiteralPath (Join-Path $project 'bb-restore.ps1') -Raw
$controlScript = Get-Content -LiteralPath (Join-Path $project 'bb-control.ps1') -Raw
Assert-True ($backupScript -match '\[switch\]\$RemoteOnly' -and $backupScript -match 'BB_REMOTE_BACKUP_FAILED') '备份脚本缺少远程重试或部分成功语义'
Assert-True ($restoreScript.IndexOf('正在从 NAS 下载备份集') -lt $restoreScript.IndexOf('正在停止 Web/API')) 'NAS 恢复未在停止服务前完成下载'
Assert-True (($controlScript | Select-String -Pattern '\$btn(Start|Stop|Open|Backup|Restore)\s*=\s*New-Btn' -AllMatches).Matches.Count -eq 5) '控制台底部主按钮数量不是 5'
Assert-True ($controlScript -match 'Show-BBRemoteBackupSettings' -and $controlScript -match 'NAS 备份') '控制台缺少远程备份设置或恢复来源切换'

$tempRoot = Join-Path (Join-Path $project '.tmp-tests') ('bb-remote-backup-test-' + [guid]::NewGuid().ToString('N'))
$appRoot = Join-Path $tempRoot 'app'
$sourceRoot = Join-Path $tempRoot 'local'
$remoteRoot = Join-Path $tempRoot 'remote'
$setName = '20261017-120000'
$sourceSet = Join-Path $sourceRoot $setName
try {
  New-Item -ItemType Directory -Path $appRoot, (Join-Path $sourceSet 'storage'), (Join-Path $sourceSet 'uploads') -Force | Out-Null
  Set-BBConfig -AppRoot $appRoot -Config ([PSCustomObject]@{ pgPort = 54328; remoteBackup = [PSCustomObject]@{ enabled = $true; path = '\\nas\share\mine' } })
  Set-BBConfig -AppRoot $appRoot -Config ([PSCustomObject]@{ pgPort = 54329 })
  $merged = Get-BBConfig -AppRoot $appRoot
  Assert-True ($merged.pgPort -eq 54329 -and $merged.remoteBackup.path -eq '\\nas\share\mine') '分段写入配置时丢失了 remoteBackup'

  $dump = Join-Path $sourceSet 'bb_miping-20261017-120000.dump'
  [IO.File]::WriteAllText($dump, 'fake pg dump for copy verification')
  [IO.File]::WriteAllText((Join-Path $sourceSet 'storage\project.txt'), 'project')
  [IO.File]::WriteAllText((Join-Path $sourceSet 'uploads\evidence.txt'), 'evidence')
  $storage = Get-BBDirectoryStats (Join-Path $sourceSet 'storage')
  $uploads = Get-BBDirectoryStats (Join-Path $sourceSet 'uploads')
  $dumpItem = Get-Item -LiteralPath $dump
  [PSCustomObject]@{
    formatVersion = 1; createdAt = (Get-Date).ToString('o')
    database = [PSCustomObject]@{ name = 'bb_miping'; dumpFile = $dumpItem.Name; bytes = $dumpItem.Length; sha256 = (Get-FileHash $dump -Algorithm SHA256).Hash }
    storage = [PSCustomObject]@{ files = $storage.Count; bytes = $storage.Bytes }
    uploads = [PSCustomObject]@{ files = $uploads.Count; bytes = $uploads.Bytes }
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $sourceSet 'backup-manifest.json') -Encoding UTF8

  $sourceInfo = Get-BBBackupSetInfo -Path $sourceSet -Deep
  Assert-True $sourceInfo.Valid ('源备份集校验失败：' + $sourceInfo.Error)
  $copied = Copy-BBBackupSetAtomic -Source $sourceSet -DestinationRoot $remoteRoot
  Assert-True (Test-Path -LiteralPath $copied.Path) '原子远程复制未生成正式备份集'
  Assert-True (-not (Get-ChildItem -LiteralPath $remoteRoot -Directory | Where-Object { $_.Name.StartsWith('.pending-') })) '远程复制后残留 pending 目录'
  $retry = Copy-BBBackupSetAtomic -Source $sourceSet -DestinationRoot $remoteRoot
  Assert-True $retry.AlreadyExists '内容一致的远程备份未安全识别为已存在'

  # 同名远程备份的 dump 未变但附件被篡改时，必须拒绝当作“已存在且一致”。
  [IO.File]::WriteAllText((Join-Path $retry.Path 'uploads\evidence.txt'), 'changed evidence')
  $mismatchRejected = $false
  try { [void](Copy-BBBackupSetAtomic -Source $sourceSet -DestinationRoot $remoteRoot) }
  catch { $mismatchRejected = ($_.Exception.Message -match '同名但内容不一致') }
  Assert-True $mismatchRejected '远程附件内容变化后仍被误判为相同备份集'

  # 第 2 版清单必须具备数据库、storage、uploads 三类校验值。
  $invalidV2 = Join-Path $tempRoot 'invalid-v2'
  New-Item -ItemType Directory -Path (Join-Path $invalidV2 'storage'), (Join-Path $invalidV2 'uploads') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $invalidV2 'bb_miping-invalid.dump'), 'dump')
  [PSCustomObject]@{
    formatVersion = 2; createdAt = (Get-Date).ToString('o')
    database = [PSCustomObject]@{ dumpFile = 'bb_miping-invalid.dump'; bytes = 4 }
    storage = [PSCustomObject]@{ files = 0; bytes = 0 }
    uploads = [PSCustomObject]@{ files = 0; bytes = 0 }
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $invalidV2 'backup-manifest.json') -Encoding UTF8
  $invalidInfo = Get-BBBackupSetInfo -Path $invalidV2 -Deep
  Assert-True (-not $invalidInfo.Valid -and $invalidInfo.Error -match '校验') '缺少指纹的第 2 版清单未被拒绝'
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}

Write-Host 'PASS: NAS 路径、配置合并、备份集清单与原子复制检查通过。'
