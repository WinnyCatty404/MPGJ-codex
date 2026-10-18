param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath($ProjectRoot)
$scripts = @('bb-common.ps1', 'bb-start.ps1', 'bb-stop.ps1', 'bb-backup.ps1', 'bb-restore.ps1', 'bb-control.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

foreach ($name in $scripts) {
  $path = Join-Path $project $name
  $bytes = [IO.File]::ReadAllBytes($path)
  Assert-True ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) "$name 缺少 UTF-8 BOM"
  $tokens = $null
  $errors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
  Assert-True ($errors.Count -eq 0) "$name 存在 PowerShell 语法错误：$($errors[0].Message)"
}

$common = Get-Content -LiteralPath (Join-Path $project 'bb-common.ps1') -Raw
$start = Get-Content -LiteralPath (Join-Path $project 'bb-start.ps1') -Raw
$stop = Get-Content -LiteralPath (Join-Path $project 'bb-stop.ps1') -Raw
$backup = Get-Content -LiteralPath (Join-Path $project 'bb-backup.ps1') -Raw
$restore = Get-Content -LiteralPath (Join-Path $project 'bb-restore.ps1') -Raw
$control = Get-Content -LiteralPath (Join-Path $project 'bb-control.ps1') -Raw

Assert-True ($common -match 'function Start-BBPostgres' -and $start -match 'Start-BBPostgres') '启动与恢复未共用 PostgreSQL 启动逻辑'
Assert-True ($stop -match '\[switch\]\$KeepPostgres' -and $restore -match 'KeepPostgres') '恢复流程未保留 PostgreSQL'
Assert-True ($backup -match '\.pending-' -and $backup -match 'backup-manifest\.json') '备份未使用临时集和完成清单'
Assert-True ($restore -match 'pgRestore -l' -and $restore -match 'bb_restore_' -and $restore -match '正在回退') '恢复缺少预检、临时库或回退流程'
Assert-True ($restore -match 'Wait-BBPortsReleased' -and $restore -match 'ValidationOnly' -and $restore -match '/api/health') '恢复缺少端口等待或应用健康检查'
Assert-True ($restore -match 'Get-BBDirectoryFingerprint' -and $restore -match '启用后的 storage') '恢复后未校验附件目录内容'
Assert-True ($backup -match '正在暂停 Web/API' -and $backup -match 'formatVersion\s*=\s*2' -and $backup -match 'sha256 = \$storageStats\.Sha256') '备份未暂停写入或未生成附件指纹'
Assert-True ($stop -match 'Test-BBAppProcess' -and $stop -match '拒绝强制结束') '停止脚本未校验进程归属'
Assert-True ($control -match 'function Select-BBBackupSet' -and $control -match '使用所选备份') '控制台缺少备份集选择'
Assert-True ($control -match 'Resolve-BBTaskOutcome' -and $common -match 'function Resolve-BBTaskOutcome') '控制台未使用统一任务结果判定'
Assert-True ($backup -match 'BB_BACKUP_RESTART_FAILED' -and $backup -notmatch '\$restartError\]\s*\{\s*Write-Error') '备份未标记"服务未自动恢复"，或仍在成功落盘前提前退出'
Assert-True ($common -match 'BB_BACKUP_RESTART_FAILED' -and $control -match 'Web/API 未能自动启动') '控制台未区分"备份成功但服务未自动启动"'
Assert-True ($backup -match '\$taskKind\s*=\s*if\s*\(\$RemoteOnly\)[\s\S]*remoteupload[\s\S]*backingup') '远程重试未输出与任务种类一致的成功标记'
Assert-True ($control -notmatch '\$form\.Topmost\s*=\s*\$true' -and $control -notmatch '\$btnExit') '控制台仍然置顶或保留退出按钮'
Assert-True ($control -match 'DataGridView' -and $control -notmatch 'New-Object Windows\.Forms\.RichTextBox' -and $control -match '\$rootLayout') '日志区未使用独立行布局，末行仍可能被裁切'
Assert-True ($control -match '''running''[\s\S]*Set-BBButtonEnabled \$btnStart \$false') '系统运行后启动按钮没有禁用'
Assert-True ($control -match 'Add_FormClosing' -and $control -match '不会停止 PostgreSQL') '关闭控制台语义未明确'

# 用临时目录验证公共复制封装能够镜像并删除目标中的旧文件，不接触真实数据目录。
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('bb-control-test-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $tempRoot 'source'
$destination = Join-Path $tempRoot 'destination'
try {
  New-Item -ItemType Directory -Path $source, $destination -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $source 'current.txt'), 'current')
  [IO.File]::WriteAllText((Join-Path $destination 'stale.txt'), 'stale')
  . (Join-Path $project 'bb-common.ps1')
  $success = Resolve-BBTaskOutcome -Kind 'remoteupload' -Output @('BB_TASK_OK=remoteupload') -ExitCode $null -ExitCodeReadable $false
  Assert-True ($success.Outcome -eq 'success') '退出码不可读时未按 remoteupload 成功标记判定成功'
  $wrongMarker = Resolve-BBTaskOutcome -Kind 'restoring' -Output @('BB_TASK_OK=stopping') -ExitCode $null -ExitCodeReadable $false
  Assert-True ($wrongMarker.Outcome -eq 'unknown') '嵌套停止脚本标记被误认为恢复成功'
  $partial = Resolve-BBTaskOutcome -Kind 'backingup' -Output @('BB_LOCAL_BACKUP_SET=X', 'BB_REMOTE_BACKUP_FAILED=offline', 'BB_BACKUP_RESTART_FAILED') -ExitCode $null -ExitCodeReadable $false
  Assert-True ($partial.Outcome -eq 'remote-failed' -and $partial.RestartFailed) 'NAS 与服务重启同时失败时结果优先级错误'
  $restartOnly = Resolve-BBTaskOutcome -Kind 'backingup' -Output @('BB_BACKUP_RESTART_FAILED') -ExitCode 3 -ExitCodeReadable $true
  Assert-True ($restartOnly.Outcome -eq 'restart-failed') '备份成功但服务重启失败未被单独识别'
  Invoke-BBRobocopy -Source $source -Destination $destination -Mirror
  Assert-True (Test-Path -LiteralPath (Join-Path $destination 'current.txt')) '镜像复制未写入当前文件'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $destination 'stale.txt'))) '镜像复制未清除旧文件'
  $fingerprint1 = Get-BBDirectoryFingerprint $source
  $fingerprint2 = Get-BBDirectoryFingerprint $destination
  Assert-True ($fingerprint1.Sha256 -eq $fingerprint2.Sha256 -and $fingerprint1.Count -eq 1) '目录指纹不稳定或文件数错误'
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}

Write-Host 'PASS: 控制台状态、备份清单、恢复预检/回退、UTF-8 BOM 与目录镜像检查通过。'
