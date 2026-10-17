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
$instanceId = Get-BBInstanceId -AppRoot $AppRoot -ConfiguredInstanceId $(if ($config -and $config.instanceId) { [string]$config.instanceId } else { '' })

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
    return ($health.ok -eq $true -and $health.database -eq 'bb_miping' -and $health.instanceId -eq $instanceId)
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

$btnSettings = New-Object Windows.Forms.Button
$btnSettings.Text = '⚙ 设置'
$btnSettings.Dock = 'Right'
$btnSettings.Width = 76
$btnSettings.FlatStyle = 'Flat'
$btnSettings.FlatAppearance.BorderSize = 0
$btnSettings.BackColor = $C_CARD
$btnSettings.ForeColor = $C_PRIMARY
$btnSettings.Cursor = 'Hand'
$statusBar.Controls.Add($btnSettings)
$btnSettings.BringToFront()

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
    $scrollToEnd = [Action]{
      $logBox.SelectionStart = $logBox.TextLength
      $logBox.SelectionLength = 0
      $logBox.ScrollToCaret()
    }
    if ($logBox.IsHandleCreated) {
      # 同步 ScrollToCaret 在文本刚追加、布局未重算完成时会少滚一行，
      # 必须投递到消息队列等布局结束后再执行
      [void]$logBox.BeginInvoke($scrollToEnd)
    } else {
      $scrollToEnd.Invoke()
    }
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
$controlLogDir = Get-BBRuntimeDir -AppRoot $AppRoot -InstanceId $instanceId
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
  $hasLocal = [bool](Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
    Where-Object { -not $_.Name.StartsWith('.') -and (Get-ChildItem -LiteralPath $_.FullName -Filter 'bb_miping-*.dump' -File -ErrorAction SilentlyContinue | Select-Object -First 1) } |
    Select-Object -First 1)
  if ($hasLocal) { return $true }
  $latest = Get-BBConfig -AppRoot $AppRoot
  return [bool]($latest -and $latest.remoteBackup -and $latest.remoteBackup.enabled -and $latest.remoteBackup.path)
}

function Set-ControlState([string]$State) {
  $busy = $State -in @('starting', 'stopping', 'backingup', 'remoteupload', 'restoring')
  $btnSettings.Enabled = -not $busy
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

function Test-BBRemoteWriteAccess([string]$Path) {
  if (-not (Test-BBUncPath $Path)) { throw '请输入完整的 NAS UNC 路径，例如 \\\\192.168.43.68\\信息安全\\个人文件夹\\BMPBGS备份。' }
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
  $probe = Join-Path $Path ('.bmpbgs-write-test-' + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [IO.File]::WriteAllText($probe, 'BMPBGS NAS write test', [Text.UTF8Encoding]::new($false))
    if (-not (Test-Path -LiteralPath $probe)) { throw '写入测试文件失败' }
  } finally { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue }
  return $true
}

function Show-BBRemoteBackupSettings {
  $currentConfig = Get-BBConfig -AppRoot $AppRoot
  $current = if ($currentConfig -and $currentConfig.remoteBackup) { $currentConfig.remoteBackup } else { $null }
  $dialog = New-Object Windows.Forms.Form
  $dialog.Text = '远程备份设置'
  $dialog.Size = New-Object Drawing.Size(720, 360)
  $dialog.MinimumSize = New-Object Drawing.Size(650, 340)
  $dialog.StartPosition = 'CenterParent'; $dialog.ShowIcon = $false; $dialog.MaximizeBox = $false; $dialog.Font = $form.Font

  $enabled = New-Object Windows.Forms.CheckBox
  $enabled.Text = '启用 NAS 远程备份（每次本地备份成功后自动上传）'
  $enabled.Location = New-Object Drawing.Point(24, 22); $enabled.AutoSize = $true; $enabled.Checked = [bool]($current -and $current.enabled)
  $dialog.Controls.Add($enabled)

  $pathLabel = New-Object Windows.Forms.Label
  $pathLabel.Text = 'NAS 备份目录'; $pathLabel.Location = New-Object Drawing.Point(24, 62); $pathLabel.AutoSize = $true
  $dialog.Controls.Add($pathLabel)
  $pathBox = New-Object Windows.Forms.TextBox
  $pathBox.Location = New-Object Drawing.Point(24, 86); $pathBox.Size = New-Object Drawing.Size(530, 28)
  $pathBox.Anchor = 'Top,Left,Right'; $pathBox.Text = if ($current -and $current.path) { [string]$current.path } else { '' }
  $dialog.Controls.Add($pathBox)
  $browse = New-Object Windows.Forms.Button
  $browse.Text = '浏览…'; $browse.Location = New-Object Drawing.Point(568, 83); $browse.Size = New-Object Drawing.Size(105, 32); $browse.Anchor = 'Top,Right'
  $dialog.Controls.Add($browse)

  $help = New-Object Windows.Forms.Label
  $help.Location = New-Object Drawing.Point(24, 124); $help.Size = New-Object Drawing.Size(650, 48); $help.Anchor = 'Top,Left,Right'
  $help.ForeColor = $C_SUBTEXT
  $help.Text = '请选择你自己的最终备份文件夹。BMPBGS 不保存 NAS 密码，直接使用 Windows 已记住的网络凭据。'
  $dialog.Controls.Add($help)

  $status = New-Object Windows.Forms.Label
  $status.Location = New-Object Drawing.Point(24, 175); $status.Size = New-Object Drawing.Size(650, 42); $status.Anchor = 'Top,Left,Right'
  $status.Text = if ($current -and $current.lastStatus) { '最近结果：' + [string]$current.lastMessage } else { '尚未执行远程备份。' }
  $status.ForeColor = $C_SUBTEXT; $dialog.Controls.Add($status)

  $test = New-Object Windows.Forms.Button; $test.Text = '检测连接'; $test.Location = New-Object Drawing.Point(24, 225); $test.Size = New-Object Drawing.Size(110, 34)
  $login = New-Object Windows.Forms.Button; $login.Text = '打开 NAS 并登录'; $login.Location = New-Object Drawing.Point(144, 225); $login.Size = New-Object Drawing.Size(145, 34)
  $open = New-Object Windows.Forms.Button; $open.Text = '打开备份目录'; $open.Location = New-Object Drawing.Point(299, 225); $open.Size = New-Object Drawing.Size(130, 34)
  $dialog.Controls.Add($test); $dialog.Controls.Add($login); $dialog.Controls.Add($open)

  $save = New-Object Windows.Forms.Button; $save.Text = '保存'; $save.Location = New-Object Drawing.Point(482, 274); $save.Size = New-Object Drawing.Size(92, 36); $save.Anchor = 'Bottom,Right'
  $cancel = New-Object Windows.Forms.Button; $cancel.Text = '取消'; $cancel.Location = New-Object Drawing.Point(582, 274); $cancel.Size = New-Object Drawing.Size(92, 36); $cancel.Anchor = 'Bottom,Right'; $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
  $dialog.Controls.Add($save); $dialog.Controls.Add($cancel); $dialog.CancelButton = $cancel

  $browse.Add_Click({
    $picker = New-Object Windows.Forms.FolderBrowserDialog
    $picker.Description = '选择 NAS 远程备份目录'; $picker.ShowNewFolderButton = $true
    if ($pathBox.Text -and (Test-Path -LiteralPath $pathBox.Text -ErrorAction SilentlyContinue)) { $picker.SelectedPath = $pathBox.Text }
    if ($picker.ShowDialog($dialog) -eq [Windows.Forms.DialogResult]::OK) { $pathBox.Text = $picker.SelectedPath }
  })
  $login.Add_Click({ if ($pathBox.Text.Trim()) { Start-Process explorer.exe -ArgumentList ('"' + $pathBox.Text.Trim() + '"') } else { [void][Windows.Forms.MessageBox]::Show('请先输入 NAS 路径。', '远程备份') } })
  $open.Add_Click({ if ($pathBox.Text.Trim()) { Start-Process explorer.exe -ArgumentList ('"' + $pathBox.Text.Trim() + '"') } })
  $test.Add_Click({
    $dialog.UseWaitCursor = $true
    try { [void](Test-BBRemoteWriteAccess $pathBox.Text.Trim()); $status.Text = '连接成功：目录可读写。'; $status.ForeColor = $C_GREEN }
    catch {
      $message = $_.Exception.Message
      if ($message -match '1219|multiple connections|多个连接') { $message += '。Windows 已用另一套账号连接同一 NAS，请先在资源管理器中处理该连接。' }
      $status.Text = '连接失败：' + $message; $status.ForeColor = $C_RED
    }
    finally { $dialog.UseWaitCursor = $false }
  })
  $save.Add_Click({
    $path = $pathBox.Text.Trim().TrimEnd('\')
    if ($enabled.Checked -and -not (Test-BBUncPath $path)) { [void][Windows.Forms.MessageBox]::Show('启用远程备份时必须填写有效的 NAS UNC 路径。', '无法保存', 'OK', 'Warning'); return }
    $remote = [ordered]@{ enabled = $enabled.Checked; path = $path }
    if ($current) { foreach ($property in $current.PSObject.Properties) { if (-not $remote.Contains($property.Name)) { $remote[$property.Name] = $property.Value } } }
    Set-BBConfig -AppRoot $AppRoot -Config ([PSCustomObject]@{ remoteBackup = [PSCustomObject]$remote })
    $dialog.DialogResult = [Windows.Forms.DialogResult]::OK; $dialog.Close()
  })
  [void]$dialog.ShowDialog($form)
}

function Select-BBBackupSet {
  $dialog = New-Object Windows.Forms.Form
  $dialog.Text = '选择要恢复的备份集'
  $dialog.Size = New-Object Drawing.Size(790, 500)
  $dialog.MinimumSize = New-Object Drawing.Size(700, 420)
  $dialog.StartPosition = 'CenterParent'
  $dialog.ShowIcon = $false
  $dialog.MaximizeBox = $true
  $dialog.Font = $form.Font
  $dialog.Tag = $null

  $tip = New-Object Windows.Forms.Label
  $tip.Dock = 'Top'; $tip.Height = 42; $tip.Padding = New-Object Windows.Forms.Padding(14, 10, 10, 0)
  $tip.Text = '远程备份会先完整下载到本地并校验，通过后才停止服务并恢复。'
  $dialog.Controls.Add($tip)

  $sourcePanel = New-Object Windows.Forms.Panel
  $sourcePanel.Dock = 'Top'; $sourcePanel.Height = 48; $sourcePanel.Padding = New-Object Windows.Forms.Padding(14, 7, 10, 5)
  $localRadio = New-Object Windows.Forms.RadioButton; $localRadio.Text = '本地备份'; $localRadio.Location = New-Object Drawing.Point(18, 13); $localRadio.AutoSize = $true; $localRadio.Checked = $true
  $remoteRadio = New-Object Windows.Forms.RadioButton; $remoteRadio.Text = 'NAS 备份'; $remoteRadio.Location = New-Object Drawing.Point(130, 13); $remoteRadio.AutoSize = $true
  $refresh = New-Object Windows.Forms.Button; $refresh.Text = '刷新'; $refresh.Location = New-Object Drawing.Point(590, 8); $refresh.Size = New-Object Drawing.Size(75, 32); $refresh.Anchor = 'Top,Right'
  $openSource = New-Object Windows.Forms.Button; $openSource.Text = '打开目录'; $openSource.Location = New-Object Drawing.Point(671, 8); $openSource.Size = New-Object Drawing.Size(90, 32); $openSource.Anchor = 'Top,Right'
  $sourcePanel.Controls.Add($localRadio); $sourcePanel.Controls.Add($remoteRadio); $sourcePanel.Controls.Add($refresh); $sourcePanel.Controls.Add($openSource)
  $dialog.Controls.Add($sourcePanel); $sourcePanel.BringToFront()

  $list = New-Object Windows.Forms.ListView
  $list.Dock = 'Fill'; $list.View = 'Details'; $list.FullRowSelect = $true; $list.GridLines = $true; $list.HideSelection = $false
  [void]$list.Columns.Add('备份集', 150); [void]$list.Columns.Add('备份时间', 145); [void]$list.Columns.Add('数据库', 95); [void]$list.Columns.Add('附件', 95); [void]$list.Columns.Add('状态', 225)
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

  $getSelectedRoot = {
    if ($remoteRadio.Checked) {
      $latest = Get-BBConfig -AppRoot $AppRoot
      if ($latest -and $latest.remoteBackup -and $latest.remoteBackup.path) { return ([string]$latest.remoteBackup.path).Trim().TrimEnd('\') }
      return ''
    }
    return Get-BBBackupRoot $AppRoot
  }
  $loadSets = {
    $list.Items.Clear(); $ok.Enabled = $false
    $root = & $getSelectedRoot
    if (-not $root) { [void][Windows.Forms.MessageBox]::Show('尚未配置 NAS 备份目录，请先在控制台设置中完成配置。', '未配置远程备份'); return }
    $dialog.UseWaitCursor = $true
    try {
      $sets = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction Stop | Where-Object { -not $_.Name.StartsWith('.') } | Sort-Object Name -Descending)
      $defaultItem = $null
      foreach ($set in $sets) {
        $info = Get-BBBackupSetInfo -Path $set.FullName
        $item = New-Object Windows.Forms.ListViewItem($set.Name)
        [void]$item.SubItems.Add($(if ($info.CreatedAt) { ([datetime]$info.CreatedAt).ToString('yyyy-MM-dd HH:mm:ss') } else { '—' }))
        [void]$item.SubItems.Add($(if ($info.DumpBytes -gt 0) { Format-BBSize $info.DumpBytes } else { '—' }))
        [void]$item.SubItems.Add((Format-BBSize ([int64]$info.StorageBytes + [int64]$info.UploadBytes)))
        $stateText = if ($info.Valid) { if ($info.Legacy) { '旧版备份；恢复前将预检' } else { '完整备份' } } else { '不可用：' + $info.Error }
        [void]$item.SubItems.Add($stateText)
        $item.Tag = [PSCustomObject]@{ Path = $set.FullName; Valid = [bool]$info.Valid }
        if (-not $info.Valid) { $item.ForeColor = $C_RED }
        [void]$list.Items.Add($item)
        if (-not $defaultItem -and $info.Valid) { $defaultItem = $item }
      }
      if ($defaultItem) { $defaultItem.Selected = $true; $defaultItem.Focused = $true; $defaultItem.EnsureVisible() }
      if (-not $sets.Count) { $tip.Text = '当前目录没有可用备份：' + $root }
    } catch {
      $tip.Text = '无法读取备份目录：' + $_.Exception.Message
      [void][Windows.Forms.MessageBox]::Show(($tip.Text + [Environment]::NewLine + '可点击“打开目录”由 Windows 完成 NAS 登录后重试。'), '读取备份失败', 'OK', 'Warning')
    } finally { $dialog.UseWaitCursor = $false }
  }
  $localRadio.Add_CheckedChanged({ if ($localRadio.Checked) { & $loadSets } })
  $remoteRadio.Add_CheckedChanged({ if ($remoteRadio.Checked) { & $loadSets } })
  $refresh.Add_Click({ & $loadSets })
  $openSource.Add_Click({ $root = & $getSelectedRoot; if ($root) { Start-Process explorer.exe -ArgumentList ('"' + $root + '"') } })
  & $loadSets
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
      for ($i = $offset; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -and $lines[$i] -notmatch '^BB_(LOCAL_BACKUP_SET|REMOTE_BACKUP_FAILED|BACKUP_RESTART_FAILED|TASK_OK)') { Write-Log ([string]$lines[$i]) $stream.Color }
      }
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
      'remoteupload' { '● 正在重试 NAS 上传…' }
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
  $taskOutput = if (Test-Path -LiteralPath $script:activeTask.OutPath) { Get-Content -LiteralPath $script:activeTask.OutPath -ErrorAction SilentlyContinue } else { @() }
  $localSetMarker = $taskOutput | Where-Object { $_ -match '^BB_LOCAL_BACKUP_SET=(.+)$' } | Select-Object -Last 1
  $localSet = if ($localSetMarker -and $localSetMarker -match '^BB_LOCAL_BACKUP_SET=(.+)$') { $Matches[1] } else { '' }
  # 任务脚本成功时输出 BB_TASK_OK=<kind> 标记；进程退出码在部分环境下读不到（为空），
  # 因此以显式标记为第一判据，退出码仅作兜底，两者都读不到时如实提示"无法确认"。
  # 只认与本任务种类一致的标记：嵌套脚本（如恢复流程内停 Web/API 的 bb-stop）也会
  # 输出自己的 BB_TASK_OK=<kind>，不限定种类会把失败任务误判成成功（2026-10-17 实测：
  # 恢复在角色检查失败回退退出，控制台却因嵌套的 BB_TASK_OK=stopping 显示"恢复成功完成"）。
  $taskOk = [bool]($taskOutput | Where-Object { $_ -match "^BB_TASK_OK=$kind\s*$" })
  $codeReadable = ($null -ne $code -and "$code".Trim() -ne '')
  # 备份数据已落盘（本地与 NAS 均已完成），只是备份后没能把 Web/API 自动拉起：
  # 这不是失败，不能红字报"任务执行失败"，也不能显示成"备份成功完成"让用户察觉不到系统已停。
  $restartFailed = [bool]($taskOutput | Where-Object { $_ -match '^BB_BACKUP_RESTART_FAILED' })
  # NAS 上传失败更严重（可重试上传），优先走退出码 2 的分支，不在此处吞掉
  $remoteFailed = [bool]($taskOutput | Where-Object { $_ -match '^BB_REMOTE_BACKUP_FAILED=' })
  $script:activeTask = $null
  if ($restartFailed -and -not $remoteFailed -and $kind -eq 'backingup') {
    Write-Log '备份已完成，但 Web/API 未能自动启动。请点击“启动系统”手动恢复。' ([System.Drawing.Color]::FromArgb(240, 150, 30))
    Set-ControlState 'stopped'
    return $false
  }
  if ($taskOk -and (-not $codeReadable -or $code -eq 0)) {
    switch ($kind) {
      'starting' { $script:launchStartedAt = Get-Date; Write-Log '启动脚本执行完成，正在确认服务健康状态。' $C_GREEN }
      'stopping' { $script:restoreAwaitingStart = $false; Write-Log '系统已停止。' $C_GREEN; Set-ControlState 'stopped' }
      'backingup' {
        Write-Log '备份成功完成。' $C_GREEN
        if ($script:offerRemoteSetupAfterBackup) {
          $script:offerRemoteSetupAfterBackup = $false
          $answer = [Windows.Forms.MessageBox]::Show('本地备份已完成。是否现在配置 NAS 远程备份？', '配置远程备份', 'YesNo', 'Question')
          if ($answer -eq [Windows.Forms.DialogResult]::Yes) { Show-BBRemoteBackupSettings }
        }
      }
      'remoteupload' { Write-Log 'NAS 备份重试成功。' $C_GREEN }
      'restoring' { $script:restoreAwaitingStart = $true; Write-Log '恢复成功完成；请点击“启动系统”。' $C_GREEN; Set-ControlState 'restore-ready' }
    }
  } elseif ($codeReadable -and $code -eq 2 -and $kind -eq 'backingup') {
    Write-Log ("本地备份已成功，但 NAS 备份失败。详细日志：$controlLogDir") $C_RED
    Set-ControlState 'running'
    if ($localSet) {
      $retry = [Windows.Forms.MessageBox]::Show('本地备份已保留，NAS 上传失败。是否现在重试远程上传？', '远程备份失败', 'YesNo', 'Warning')
      if ($retry -eq [Windows.Forms.DialogResult]::Yes) { Start-ControlTask 'remoteupload' 'bb-backup.ps1' @('-RemoteOnly', '-BackupSet', $localSet, '-Silent') }
    }
  } elseif (-not $codeReadable) {
    Write-Log ("任务已结束，但无法确认执行结果（退出码不可用）。请依据以上日志判断，必要时重试。日志：$controlLogDir") $C_PRIMARY
    $script:launchFailed = ($kind -eq 'starting')
    Set-ControlState 'partial'
  } else {
    Write-Log ("任务执行失败：$kind，退出码 $code。日志：$controlLogDir") $C_RED
    $script:launchFailed = ($kind -eq 'starting')
    Set-ControlState 'partial'
  }
  return $false
}

$btnLogBottom.Add_Click({ $logBox.SelectionStart = $logBox.TextLength; $logBox.SelectionLength = 0; $logBox.ScrollToCaret(); $logBox.Focus() })
$btnOpenLog.Add_Click({ if (-not (Test-Path -LiteralPath $controlLogDir)) { New-Item -ItemType Directory -Path $controlLogDir -Force | Out-Null }; Start-Process explorer.exe -ArgumentList ('"' + $controlLogDir + '"') })
$btnSettings.Add_Click({ if (-not $script:activeTask) { Show-BBRemoteBackupSettings } })

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
  $latestConfig = Get-BBConfig -AppRoot $AppRoot
  $script:offerRemoteSetupAfterBackup = -not ($latestConfig -and $latestConfig.remoteBackup)
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
