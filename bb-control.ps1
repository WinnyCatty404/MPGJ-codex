# BMPBGS 控制台 - 启动/停止合一管理窗口（PowerShell WinForms，无需额外依赖）
# 用法：powershell -ExecutionPolicy Bypass -File bb-control.ps1
param(
  [string]$AppRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition)
)
$ErrorActionPreference = 'Stop'
. (Join-Path $AppRoot 'bb-common.ps1')

# 隐藏自身控制台窗口（双击/右键"使用 PowerShell 运行"时避免黑窗残留）
try {
  Add-Type -Namespace Native -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam); [DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern int SetCurrentProcessExplicitAppUserModelID(string AppID);'
  [void][Native.Win]::ShowWindow([Native.Win]::GetConsoleWindow(), 0)
  # PowerShell 是实际持有 WinForms 窗口的进程。为它设置产品自己的 AppUserModelID，
  # 避免任务栏把窗口归到 powershell.exe 并沿用 PowerShell 的默认图标/缓存。
  [void][Native.Win]::SetCurrentProcessExplicitAppUserModelID('BMPBGS.Desktop.ControlPanel')
} catch {}

$config  = Get-BBConfig -AppRoot $AppRoot
$pgPort  = if ($config -and $config.pgPort)  { [int]$config.pgPort }  else { 54328 }
$apiPort = if ($config -and $config.apiPort) { [int]$config.apiPort } else { 3100 }
$webPort = if ($config -and $config.webPort) { [int]$config.webPort } else { 5173 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# ---- 配色（与 MP logo 蓝青渐变呼应）----
$C_BG        = [System.Drawing.Color]::FromArgb(245, 247, 250)
$C_CARD      = [System.Drawing.Color]::White
$C_PRIMARY   = [System.Drawing.Color]::FromArgb(28, 108, 219)   # 品牌蓝
$C_GREEN     = [System.Drawing.Color]::FromArgb(28, 168, 94)    # 启动
$C_RED       = [System.Drawing.Color]::FromArgb(224, 79, 74)    # 停止
$C_GRAY      = [System.Drawing.Color]::FromArgb(138, 144, 153)  # 退出
$C_TEXT      = [System.Drawing.Color]::FromArgb(38, 42, 48)
$C_SUBTEXT   = [System.Drawing.Color]::FromArgb(130, 138, 148)
$C_OKBG      = [System.Drawing.Color]::FromArgb(232, 247, 238)
$C_STOPBG    = [System.Drawing.Color]::FromArgb(253, 235, 234)
$C_LOGBG     = [System.Drawing.Color]::FromArgb(251, 252, 254)

function Test-Port([int]$Port) {
  $c = New-Object Net.Sockets.TcpClient
  try { $r = $c.BeginConnect('127.0.0.1', $Port, $null, $null); $ok = $r.AsyncWaitHandle.WaitOne(400); if ($ok -and $c.Connected) { return $true } } catch {}
  finally { $c.Close() }
  return $false
}

function Test-BBWebReady {
  if (-not (Test-Port $webPort)) { return $false }
  try {
    $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $webPort + '/api/health') -TimeoutSec 2
    return ($health.ok -eq $true -and $health.database -eq 'bb_miping')
  } catch { return $false }
}

# ---- 窗体 ----
$form = New-Object Windows.Forms.Form
$form.Text = 'BMPBGS 控制台'
$form.Size = New-Object Drawing.Size(900, 620)
$form.MinimumSize = New-Object Drawing.Size(760, 520)
$form.StartPosition = 'CenterScreen'
$form.MaximizeBox = $true
$form.ShowIcon = $true
$form.ShowInTaskbar = $true
$form.BackColor = $C_BG
$form.Font = New-Object Drawing.Font('微软雅黑', 9)
try { $form.Icon = New-Object Drawing.Icon((Join-Path $AppRoot 'bmpbgs.ico')) } catch {}

# ---- 顶部品牌区 ----
$header = New-Object Windows.Forms.Panel
$header.Dock = 'Top'
$header.Height = 78
$header.BackColor = $C_CARD
$form.Controls.Add($header)

$logoBox = New-Object Windows.Forms.PictureBox
$logoBox.Size = New-Object Drawing.Size(46, 46)
$logoBox.Location = New-Object Drawing.Point(22, 16)
$logoBox.SizeMode = 'Zoom'
try { $logoBox.Image = [System.Drawing.Image]::FromFile((Join-Path $AppRoot 'logo-256.png')) } catch {}
$header.Controls.Add($logoBox)

$lblTitle = New-Object Windows.Forms.Label
$lblTitle.Text = 'BMPBGS 控制台'
$lblTitle.Font = New-Object Drawing.Font('微软雅黑', 14, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = $C_TEXT
$lblTitle.Location = New-Object Drawing.Point(82, 14)
$lblTitle.AutoSize = $true
$header.Controls.Add($lblTitle)

$lblSub = New-Object Windows.Forms.Label
$lblSub.Text = '本地服务管理 · 数据库 / API / Web 一键启停'
$lblSub.Font = New-Object Drawing.Font('微软雅黑', 9)
$lblSub.ForeColor = $C_SUBTEXT
$lblSub.Location = New-Object Drawing.Point(84, 46)
$lblSub.AutoSize = $true
$header.Controls.Add($lblSub)

# ---- 状态条 ----
$statusBar = New-Object Windows.Forms.Panel
$statusBar.Dock = 'Top'
$statusBar.Height = 42
$statusBar.BackColor = $C_BG
$statusBar.Padding = New-Object Windows.Forms.Padding(22, 0, 22, 0)
$form.Controls.Add($statusBar)
$statusBar.BringToFront()

$statusPill = New-Object Windows.Forms.Label
$statusPill.Dock = 'Fill'
$statusPill.Font = New-Object Drawing.Font('微软雅黑', 10, [System.Drawing.FontStyle]::Bold)
$statusPill.TextAlign = 'MiddleLeft'
$statusPill.Padding = New-Object Windows.Forms.Padding(14, 0, 0, 0)
$statusPill.BackColor = $C_OKBG
$statusPill.ForeColor = $C_GREEN
$statusPill.Text = '● 正在检测服务状态…'
$statusBar.Controls.Add($statusPill)

$btnOpenLog = New-Object Windows.Forms.Button
$btnOpenLog.Text = '打开日志'
$btnOpenLog.Dock = 'Right'
$btnOpenLog.Width = 86
$btnOpenLog.FlatStyle = 'Flat'
$btnOpenLog.FlatAppearance.BorderSize = 0
$btnOpenLog.BackColor = $C_CARD
$btnOpenLog.ForeColor = $C_PRIMARY
$btnOpenLog.Cursor = 'Hand'
$statusBar.Controls.Add($btnOpenLog)
$btnOpenLog.BringToFront()

$btnLogBottom = New-Object Windows.Forms.Button
$btnLogBottom.Text = '滚动到底部'
$btnLogBottom.Dock = 'Right'
$btnLogBottom.Width = 98
$btnLogBottom.FlatStyle = 'Flat'
$btnLogBottom.FlatAppearance.BorderSize = 0
$btnLogBottom.BackColor = $C_CARD
$btnLogBottom.ForeColor = $C_PRIMARY
$btnLogBottom.Cursor = 'Hand'
$statusBar.Controls.Add($btnLogBottom)
$btnLogBottom.BringToFront()

# ---- 日志区 ----
$logHost = New-Object Windows.Forms.Panel
$logHost.Dock = 'Fill'
$logHost.BackColor = $C_BG
$logHost.Padding = New-Object Windows.Forms.Padding(22, 6, 22, 6)
$form.Controls.Add($logHost)
$logHost.BringToFront()

$logBox = New-Object Windows.Forms.RichTextBox
$logBox.Dock = 'Fill'
$logBox.ReadOnly = $true
$logBox.BackColor = $C_LOGBG
$logBox.BorderStyle = 'None'
$logBox.Font = New-Object Drawing.Font('Consolas', 9.75)
$logBox.WordWrap = $false
$logBox.ScrollBars = 'Both'
$logBox.DetectUrls = $false
$logHost.Controls.Add($logBox)

function Write-Log([string]$msg, [System.Drawing.Color]$color) {
  $followTail = $true
  $firstVisible = 0
  if ($logBox.TextLength -gt 0) {
    $firstVisible = $logBox.GetCharIndexFromPosition((New-Object Drawing.Point(2, 2)))
    $lastPoint = $logBox.GetPositionFromCharIndex($logBox.TextLength - 1)
    $followTail = ($lastPoint.Y -ge 0 -and $lastPoint.Y -le ($logBox.ClientSize.Height + $logBox.Font.Height))
  }
  $oldStart = $logBox.SelectionStart
  $oldLength = $logBox.SelectionLength
  $logBox.SelectionStart = $logBox.TextLength
  $logBox.SelectionLength = 0
  $logBox.SelectionColor = $C_SUBTEXT
  $logBox.AppendText('[' + (Get-Date -Format 'HH:mm:ss') + ']  ')
  $logBox.SelectionColor = $color
  $logBox.AppendText($msg + "`r`n")
  $logBox.SelectionColor = $logBox.ForeColor
  if ($followTail) {
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
  } else {
    $logBox.Select($firstVisible, 0)
    $logBox.ScrollToCaret()
    $logBox.Select($oldStart, $oldLength)
  }
  if ($script:controlLogPath) {
    try { Add-Content -LiteralPath $script:controlLogPath -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg) -Encoding UTF8 } catch { }
  }
}

# ---- 底部按钮区 ----
$panel = New-Object Windows.Forms.Panel
$panel.Dock = 'Bottom'
$panel.Height = 82
$panel.BackColor = $C_CARD
$form.Controls.Add($panel)
$panel.BringToFront()

$buttonLayout = New-Object Windows.Forms.TableLayoutPanel
$buttonLayout.Dock = 'Fill'
$buttonLayout.Padding = New-Object Windows.Forms.Padding(12, 14, 12, 14)
$buttonLayout.ColumnCount = 5
$buttonLayout.RowCount = 1
for ($i = 0; $i -lt 5; $i++) { $buttonLayout.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle([Windows.Forms.SizeType]::Percent, 20))) }
$panel.Controls.Add($buttonLayout)

function New-Btn([string]$text, [System.Drawing.Color]$base, [System.Drawing.Color]$hover, [int]$column) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $text
  $b.Dock = 'Fill'
  $b.Margin = New-Object Windows.Forms.Padding(8, 4, 8, 4)
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderSize = 0
  $b.FlatAppearance.MouseOverBackColor = $hover
  $b.FlatAppearance.MouseDownBackColor = $hover
  $b.BackColor = $base
  $b.ForeColor = [System.Drawing.Color]::White
  $b.Cursor = 'Hand'
  $b.Font = New-Object Drawing.Font('微软雅黑', 10.5, [System.Drawing.FontStyle]::Bold)
  $b.TabStop = $false
  $b.Tag = [PSCustomObject]@{ Base = $base; Hover = $hover }
  $buttonLayout.Controls.Add($b, $column, 0)
  return $b
}

$btnStart   = New-Btn '启动系统' $C_GREEN  ([System.Drawing.Color]::FromArgb(23, 143, 80)) 0
$btnStop    = New-Btn '停止系统' $C_RED    ([System.Drawing.Color]::FromArgb(200, 68, 64)) 1
$btnOpen    = New-Btn '打开系统' $C_PRIMARY([System.Drawing.Color]::FromArgb(22, 91, 187)) 2
$btnBackup  = New-Btn '备份数据' ([System.Drawing.Color]::FromArgb(240, 150, 30)) ([System.Drawing.Color]::FromArgb(214, 130, 20)) 3
$btnRestore = New-Btn '恢复数据' ([System.Drawing.Color]::FromArgb(120, 90, 200)) ([System.Drawing.Color]::FromArgb(102, 76, 172)) 4
$script:launchStartedAt = $null
$script:launchFailed = $false
$script:restoreAwaitingStart = $false
$controlLogDir = Join-Path $env:TEMP 'bb-miping-logs'
New-Item -ItemType Directory -Path $controlLogDir -Force | Out-Null
$startLogPath = Join-Path $controlLogDir 'start.log'
$script:controlLogPath = Join-Path $controlLogDir ('control-' + (Get-Date -Format 'yyyyMMdd') + '.log')
$script:activeTask = $null

function Set-BBButtonEnabled($Button, [bool]$Enabled) {
  $Button.Enabled = $Enabled
  if ($Enabled) {
    $Button.BackColor = $Button.Tag.Base
    $Button.ForeColor = [Drawing.Color]::White
    $Button.Cursor = 'Hand'
    $Button.FlatAppearance.MouseOverBackColor = $Button.Tag.Hover
  } else {
    $Button.BackColor = [Drawing.Color]::FromArgb(213, 217, 222)
    $Button.ForeColor = [Drawing.Color]::FromArgb(142, 148, 156)
    $Button.Cursor = 'Default'
    $Button.FlatAppearance.MouseOverBackColor = $Button.BackColor
  }
}

function Test-BBHasBackupSet {
  $root = Get-BBBackupRoot $AppRoot
  return [bool](Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
    Where-Object { -not $_.Name.StartsWith('.') -and (Get-ChildItem -LiteralPath $_.FullName -Filter 'bb_miping-*.dump' -File -ErrorAction SilentlyContinue | Select-Object -First 1) } |
    Select-Object -First 1)
}

function Set-ControlState([string]$State) {
  $busy = $State -in @('starting', 'stopping', 'backingup', 'restoring')
  if ($busy) {
    foreach ($button in @($btnStart, $btnStop, $btnOpen, $btnBackup, $btnRestore)) { Set-BBButtonEnabled $button $false }
    return
  }
  $hasBackup = Test-BBHasBackupSet
  switch ($State) {
    'running' {
      Set-BBButtonEnabled $btnStart $false; Set-BBButtonEnabled $btnStop $true
      Set-BBButtonEnabled $btnOpen $true; Set-BBButtonEnabled $btnBackup $true; Set-BBButtonEnabled $btnRestore $hasBackup
    }
    'stopped' {
      Set-BBButtonEnabled $btnStart $true; Set-BBButtonEnabled $btnStop $false
      Set-BBButtonEnabled $btnOpen $false; Set-BBButtonEnabled $btnBackup $false; Set-BBButtonEnabled $btnRestore $hasBackup
    }
    'restore-ready' {
      Set-BBButtonEnabled $btnStart $true; Set-BBButtonEnabled $btnStop $true
      Set-BBButtonEnabled $btnOpen $false; Set-BBButtonEnabled $btnBackup $false; Set-BBButtonEnabled $btnRestore $hasBackup
    }
    default {
      Set-BBButtonEnabled $btnStart $true; Set-BBButtonEnabled $btnStop $true
      Set-BBButtonEnabled $btnOpen $false; Set-BBButtonEnabled $btnBackup $false; Set-BBButtonEnabled $btnRestore $hasBackup
    }
  }
}

function Format-BBSize([int64]$Bytes) {
  if ($Bytes -ge 1GB) { return ('{0:N1} GB' -f ($Bytes / 1GB)) }
  if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
  if ($Bytes -ge 1KB) { return ('{0:N0} KB' -f ($Bytes / 1KB)) }
  return "$Bytes B"
}

function Select-BBBackupSet {
  $root = Get-BBBackupRoot $AppRoot
  $sets = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
    Where-Object { -not $_.Name.StartsWith('.') } | Sort-Object Name -Descending)
  if (-not $sets.Count) { Write-Log ('未找到任何备份集：' + $root) $C_RED; return $null }

  $dialog = New-Object Windows.Forms.Form
  $dialog.Text = '选择要恢复的备份集'
  $dialog.Size = New-Object Drawing.Size(760, 460)
  $dialog.MinimumSize = New-Object Drawing.Size(680, 400)
  $dialog.StartPosition = 'CenterParent'
  $dialog.ShowIcon = $false
  $dialog.MaximizeBox = $true
  $dialog.Font = $form.Font
  $dialog.Tag = $null

  $tip = New-Object Windows.Forms.Label
  $tip.Dock = 'Top'; $tip.Height = 48; $tip.Padding = New-Object Windows.Forms.Padding(14, 12, 10, 0)
  $tip.Text = '默认选中最新备份。旧版备份可继续使用，确认后还会执行数据库归档预检。'
  $dialog.Controls.Add($tip)

  $list = New-Object Windows.Forms.ListView
  $list.Dock = 'Fill'; $list.View = 'Details'; $list.FullRowSelect = $true; $list.GridLines = $true; $list.HideSelection = $false
  [void]$list.Columns.Add('备份集', 150); [void]$list.Columns.Add('备份时间', 145); [void]$list.Columns.Add('数据库', 95); [void]$list.Columns.Add('附件', 95); [void]$list.Columns.Add('状态', 225)
  $defaultItem = $null
  foreach ($set in $sets) {
    $dump = Get-ChildItem -LiteralPath $set.FullName -Filter 'bb_miping-*.dump' -File -ErrorAction SilentlyContinue | Select-Object -First 1
    $manifestPath = Join-Path $set.FullName 'backup-manifest.json'
    $attachmentBytes = 0L
    $createdAt = $set.LastWriteTime
    $status = if ($dump) { '旧版备份；确认后执行完整性预检' } else { '不可用：缺少数据库 dump' }
    if (Test-Path -LiteralPath $manifestPath) {
      try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.createdAt) { $createdAt = [datetime]$manifest.createdAt }
        if ($manifest.database.dumpFile) {
          $expectedDump = Join-Path $set.FullName ([string]$manifest.database.dumpFile)
          $dump = if (Test-Path -LiteralPath $expectedDump) { Get-Item -LiteralPath $expectedDump } else { $null }
        }
        $attachmentBytes = [int64]$manifest.storage.bytes + [int64]$manifest.uploads.bytes
        $status = if ($dump) { '完整备份' } else { '不可用：清单中的 dump 缺失' }
      } catch { $status = if ($dump) { '清单异常；将按旧版备份预检' } else { '不可用：清单异常且缺少 dump' } }
    } else {
      $attachmentBytes = (Get-BBDirectoryStats (Join-Path $set.FullName 'storage')).Bytes + (Get-BBDirectoryStats (Join-Path $set.FullName 'uploads')).Bytes
    }
    $item = New-Object Windows.Forms.ListViewItem($set.Name)
    [void]$item.SubItems.Add($createdAt.ToString('yyyy-MM-dd HH:mm:ss'))
    [void]$item.SubItems.Add($(if ($dump) { Format-BBSize $dump.Length } else { '—' }))
    [void]$item.SubItems.Add((Format-BBSize $attachmentBytes))
    [void]$item.SubItems.Add($status)
    $item.Tag = [PSCustomObject]@{ Path = $set.FullName; Valid = [bool]$dump }
    if (-not $dump) { $item.ForeColor = $C_RED }
    [void]$list.Items.Add($item)
    if (-not $defaultItem -and $dump) { $defaultItem = $item }
  }
  $dialog.Controls.Add($list); $list.BringToFront()

  $actions = New-Object Windows.Forms.FlowLayoutPanel
  $actions.Dock = 'Bottom'; $actions.Height = 58; $actions.FlowDirection = 'RightToLeft'; $actions.Padding = New-Object Windows.Forms.Padding(8)
  $cancel = New-Object Windows.Forms.Button; $cancel.Text = '取消'; $cancel.Width = 96; $cancel.Height = 34
  $ok = New-Object Windows.Forms.Button; $ok.Text = '使用所选备份'; $ok.Width = 130; $ok.Height = 34; $ok.Enabled = $false
  $actions.Controls.Add($cancel); $actions.Controls.Add($ok); $dialog.Controls.Add($actions); $actions.BringToFront()
  $list.Add_SelectedIndexChanged({ $ok.Enabled = ($list.SelectedItems.Count -eq 1 -and $list.SelectedItems[0].Tag.Valid) })
  $cancel.Add_Click({ $dialog.Close() })
  $ok.Add_Click({ if ($list.SelectedItems.Count -eq 1 -and $list.SelectedItems[0].Tag.Valid) { $dialog.Tag = $list.SelectedItems[0].Tag.Path; $dialog.Close() } })
  $list.Add_DoubleClick({ if ($ok.Enabled) { $ok.PerformClick() } })
  if ($defaultItem) { $defaultItem.Selected = $true; $defaultItem.Focused = $true; $defaultItem.EnsureVisible() }
  [void]$dialog.ShowDialog($form)
  return [string]$dialog.Tag
}

function Read-ControlTaskOutput {
  if (-not $script:activeTask) { return }
  $streams = @(
    [PSCustomObject]@{ Path = 'OutPath'; Offset = 'OutLines'; Color = $C_TEXT },
    [PSCustomObject]@{ Path = 'ErrPath'; Offset = 'ErrLines'; Color = $C_RED }
  )
  foreach ($stream in $streams) {
    $path = $script:activeTask.($stream.Path)
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $lines = @(Get-Content -LiteralPath $path -ErrorAction SilentlyContinue)
    $offset = [int]$script:activeTask.($stream.Offset)
    if ($lines.Count -gt $offset) {
      for ($i = $offset; $i -lt $lines.Count; $i++) { if ($lines[$i]) { Write-Log ([string]$lines[$i]) $stream.Color } }
      $script:activeTask.($stream.Offset) = $lines.Count
    }
  }
}

function Start-ControlTask([string]$Kind, [string]$ScriptName, [string[]]$Extra) {
  if ($script:activeTask) { Write-Log '已有维护任务正在执行，请等待完成。' $C_RED; return }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outPath = Join-Path $controlLogDir ("$Kind-$stamp.out.log")
  $errPath = Join-Path $controlLogDir ("$Kind-$stamp.err.log")
  $args = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $AppRoot $ScriptName) + '"')) + ($Extra | ForEach-Object { '"' + $_ + '"' })
  try {
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WindowStyle Hidden -RedirectStandardOutput $outPath -RedirectStandardError $errPath -PassThru
    $script:activeTask = [PSCustomObject]@{ Kind = $Kind; Process = $process; OutPath = $outPath; ErrPath = $errPath; OutLines = 0; ErrLines = 0 }
    Set-ControlState $Kind
    $statusPill.Text = switch ($Kind) {
      'starting' { '● 正在启动系统…' }
      'stopping' { '● 正在停止系统…' }
      'backingup' { '● 正在备份数据…' }
      'restoring' { '● 正在恢复数据…' }
      default { '● 正在执行维护任务…' }
    }
    $statusPill.ForeColor = $C_PRIMARY
    $statusPill.BackColor = [Drawing.Color]::FromArgb(232, 240, 252)
  } catch {
    Write-Log ('无法执行脚本：' + $_.Exception.Message) $C_RED
    $script:activeTask = $null
  }
}

function Update-ControlTask {
  if (-not $script:activeTask) { return $false }
  Read-ControlTaskOutput
  $process = $script:activeTask.Process
  if (-not $process.HasExited) { return $true }
  $process.WaitForExit(); Read-ControlTaskOutput
  $kind = $script:activeTask.Kind
  $code = $process.ExitCode
  $script:activeTask = $null
  if ($code -eq 0) {
    switch ($kind) {
      'starting' { $script:launchStartedAt = Get-Date; Write-Log '启动脚本执行完成，正在确认服务健康状态。' $C_GREEN }
      'stopping' { $script:restoreAwaitingStart = $false; Write-Log '系统已停止。' $C_GREEN; Set-ControlState 'stopped' }
      'backingup' { Write-Log '备份成功完成。' $C_GREEN }
      'restoring' { $script:restoreAwaitingStart = $true; Write-Log '恢复成功完成；请点击“启动系统”。' $C_GREEN; Set-ControlState 'restore-ready' }
    }
  } else {
    Write-Log ("任务执行失败：$kind，退出码 $code。日志：$controlLogDir") $C_RED
    $script:launchFailed = ($kind -eq 'starting')
    Set-ControlState 'partial'
  }
  return $false
}

$btnLogBottom.Add_Click({ $logBox.SelectionStart = $logBox.TextLength; $logBox.SelectionLength = 0; $logBox.ScrollToCaret(); $logBox.Focus() })
$btnOpenLog.Add_Click({ if (-not (Test-Path -LiteralPath $controlLogDir)) { New-Item -ItemType Directory -Path $controlLogDir -Force | Out-Null }; Start-Process explorer.exe -ArgumentList ('"' + $controlLogDir + '"') })

$btnStart.Add_Click({
  $script:restoreAwaitingStart = $false
  $script:launchStartedAt = Get-Date
  $script:launchFailed = $false
  $statusPill.Text = '● 正在启动，请稍候（首次约 1-2 分钟）…'
  $statusPill.ForeColor = $C_PRIMARY
  $statusPill.BackColor = [System.Drawing.Color]::FromArgb(232, 240, 252)
  Write-Log '启动中：初始化数据库并拉起前后端服务…' $C_PRIMARY
  Start-ControlTask 'starting' 'bb-start.ps1' @('-Silent')
})
$btnStop.Add_Click({
  $statusPill.Text = '● 正在停止…'
  $statusPill.ForeColor = $C_RED
  $statusPill.BackColor = $C_STOPBG
  Write-Log '停止中：结束前后端进程并停止数据库…' $C_RED
  Start-ControlTask 'stopping' 'bb-stop.ps1' @('-Silent')
})
$btnBackup.Add_Click({
  Write-Log '正在备份数据（数据库 + storage/uploads）…' ([System.Drawing.Color]::FromArgb(240, 150, 30))
  Start-ControlTask 'backingup' 'bb-backup.ps1' @('-Silent')
})
$btnRestore.Add_Click({
  $selectedSet = Select-BBBackupSet
  if (-not $selectedSet) { return }
  $setName = Split-Path -Leaf $selectedSet
  $answer = [System.Windows.Forms.MessageBox]::Show(
    ('将停止 Web/API，并用备份「' + $setName + '」覆盖当前数据库和文件。失败时会自动回退，是否继续？'),
    '确认恢复数据',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Warning
  )
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
    Write-Log '已取消恢复。' $C_TEXT
    return
  }
  Write-Log ('正在恢复备份集：' + $setName) ([System.Drawing.Color]::FromArgb(120, 90, 200))
  Start-ControlTask 'restoring' 'bb-restore.ps1' @('-BackupSet', $selectedSet, '-Silent')
})
$btnOpen.Add_Click({ Start-Process ('http://127.0.0.1:' + $webPort) })

function Confirm-BBCloseControl {
  if ($script:activeTask) {
    [void][Windows.Forms.MessageBox]::Show('当前维护任务仍在执行，请等待完成后再关闭控制台。', '任务执行中', [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Information)
    return $false
  }
  if (-not ((Test-Port $webPort) -or (Test-Port $apiPort) -or (Test-Port $pgPort) -or $script:activeTask)) { return $true }
  $registryPath = 'HKCU:\Software\BMPBGS'
  try {
    if ((Get-ItemProperty -Path $registryPath -Name SuppressControlCloseNotice -ErrorAction SilentlyContinue).SuppressControlCloseNotice -eq 1) { return $true }
  } catch { }
  $notice = New-Object Windows.Forms.Form
  $notice.Text = '关闭 BMPBGS 控制台'
  $notice.Size = New-Object Drawing.Size(500, 245)
  $notice.StartPosition = 'CenterParent'; $notice.FormBorderStyle = 'FixedDialog'; $notice.MaximizeBox = $false; $notice.MinimizeBox = $false; $notice.ShowIcon = $false
  $label = New-Object Windows.Forms.Label
  $label.Location = New-Object Drawing.Point(24, 22); $label.Size = New-Object Drawing.Size(440, 92)
  $label.Font = New-Object Drawing.Font('微软雅黑', 10)
  $label.Text = '这里只关闭管理窗口，不会停止 PostgreSQL、API 或 Web 服务，已经打开的系统仍可继续使用。'
  $notice.Controls.Add($label)
  $check = New-Object Windows.Forms.CheckBox
  $check.Text = '以后不再提示'; $check.Location = New-Object Drawing.Point(28, 120); $check.AutoSize = $true
  $notice.Controls.Add($check)
  $closeButton = New-Object Windows.Forms.Button
  $closeButton.Text = '关闭控制台'; $closeButton.Bounds = New-Object Drawing.Rectangle(248, 155, 110, 36); $closeButton.DialogResult = [Windows.Forms.DialogResult]::OK
  $cancelButton = New-Object Windows.Forms.Button
  $cancelButton.Text = '取消'; $cancelButton.Bounds = New-Object Drawing.Rectangle(368, 155, 90, 36); $cancelButton.DialogResult = [Windows.Forms.DialogResult]::Cancel
  $notice.Controls.Add($closeButton); $notice.Controls.Add($cancelButton); $notice.AcceptButton = $closeButton; $notice.CancelButton = $cancelButton
  $result = $notice.ShowDialog($form)
  if ($result -ne [Windows.Forms.DialogResult]::OK) { return $false }
  if ($check.Checked) {
    try { New-Item -Path $registryPath -Force | Out-Null; Set-ItemProperty -Path $registryPath -Name SuppressControlCloseNotice -Type DWord -Value 1 } catch { }
  }
  return $true
}

$form.Add_FormClosing({ param($sender, $eventArgs); if (-not (Confirm-BBCloseControl)) { $eventArgs.Cancel = $true } })

# ---- 状态轮询 ----
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
  if (Update-ControlTask) { return }
  if ($script:restoreAwaitingStart -and -not (Test-Port $webPort) -and -not (Test-Port $apiPort)) {
    $statusPill.Text = '● 恢复完成，请点击“启动系统”'
    $statusPill.ForeColor = $C_PRIMARY
    $statusPill.BackColor = [Drawing.Color]::FromArgb(232, 240, 252)
    Set-ControlState 'restore-ready'
    return
  }
  if (Test-BBWebReady) {
    if ($script:launchStartedAt) { Write-Log '启动成功，网页和后端均已就绪。' $C_GREEN }
    $script:launchStartedAt = $null
    $script:launchFailed = $false
    $statusPill.Text = '● 系统运行中    Web  http://127.0.0.1:' + $webPort
    $statusPill.ForeColor = $C_GREEN
    $statusPill.BackColor = $C_OKBG
    Set-ControlState 'running'
  } elseif ($script:launchStartedAt -and ((Get-Date) - $script:launchStartedAt).TotalSeconds -lt 120) {
    $recentError = $null
    if (Test-Path -LiteralPath $startLogPath) {
      $logFile = Get-Item -LiteralPath $startLogPath
      if ($logFile.LastWriteTime -ge $script:launchStartedAt) {
        $recentError = Get-Content -LiteralPath $startLogPath -Tail 12 -ErrorAction SilentlyContinue |
          Where-Object { $_ -match '\[ERROR\]' } | Select-Object -Last 1
      }
    }
    if ($recentError) {
      Write-Log ('启动失败：' + $recentError) $C_RED
      $script:launchStartedAt = $null
      $script:launchFailed = $true
      $statusPill.Text = '● 启动失败，可再次点击启动系统'
      $statusPill.ForeColor = $C_RED
      $statusPill.BackColor = $C_STOPBG
    } else {
      $statusPill.Text = '● 正在启动，请稍候（首次约 1-2 分钟）…'
      $statusPill.ForeColor = $C_PRIMARY
      $statusPill.BackColor = [System.Drawing.Color]::FromArgb(232, 240, 252)
    }
    Set-ControlState $(if ($script:launchFailed) { 'partial' } else { 'starting' })
  } elseif ((Test-Port $webPort) -or (Test-Port $apiPort) -or (Test-Port $pgPort)) {
    if ($script:launchStartedAt) {
      Write-Log ('启动超时，请查看：' + $startLogPath) $C_RED
      $script:launchFailed = $true
    }
    $script:launchStartedAt = $null
    $statusPill.Text = if ($script:launchFailed) { '● 启动失败，可再次点击启动系统' } else { '● 部分服务已启动，网页未就绪；可点击启动系统重试' }
    $statusPill.ForeColor = if ($script:launchFailed) { $C_RED } else { $C_PRIMARY }
    $statusPill.BackColor = if ($script:launchFailed) { $C_STOPBG } else { [System.Drawing.Color]::FromArgb(232, 240, 252) }
    Set-ControlState 'partial'
  } else {
    if ($script:launchStartedAt) {
      Write-Log ('启动超时，请查看：' + $startLogPath) $C_RED
      $script:launchFailed = $true
    }
    $script:launchStartedAt = $null
    $statusPill.Text = if ($script:launchFailed) { '● 启动失败，可再次点击启动系统' } else { '● 系统未启动' }
    $statusPill.ForeColor = if ($script:launchFailed) { $C_RED } else { $C_GRAY }
    $statusPill.BackColor = if ($script:launchFailed) { $C_STOPBG } else { [System.Drawing.Color]::FromArgb(240, 241, 243) }
    Set-ControlState $(if ($script:launchFailed) { 'partial' } else { 'stopped' })
  }
})
$timer.Start()

Write-Log 'BMPBGS 控制台已就绪，点击「启动系统」开始使用。' $C_TEXT
$form.Topmost = $false

# 强制刷新任务栏/Alt-Tab 图标：任务栏取窗口 ICON_BIG，PowerShell 宿主下默认回落为
# powershell.exe 的图标（标题栏小图标正常、任务栏显示 PS 图标）。句柄创建后显式
# 发送 WM_SETICON 把 32x32（任务栏）与 16x16（标题栏）都钉为本工具图标。
try {
  $script:IcoPath  = Join-Path $AppRoot 'bmpbgs.ico'
  $script:IcoBig   = New-Object Drawing.Icon($script:IcoPath, 32, 32)
  $script:IcoSmall = New-Object Drawing.Icon($script:IcoPath, 16, 16)
  [void]$form.Handle  # 强制创建窗口句柄
  [void][Native.Win]::SendMessage($form.Handle, 0x0080, [IntPtr]1, $script:IcoBig.Handle)   # ICON_BIG
  [void][Native.Win]::SendMessage($form.Handle, 0x0080, [IntPtr]0, $script:IcoSmall.Handle) # ICON_SMALL
} catch {}

[void]$form.ShowDialog()
