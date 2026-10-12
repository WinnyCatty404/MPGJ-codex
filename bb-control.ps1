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

function Invoke-Script([string]$Name) {
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $AppRoot $Name)) `
    -WindowStyle Hidden | Out-Null
}

function Invoke-ScriptSilent([string]$Name, [string[]]$Extra) {
  $a = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $AppRoot $Name) + '"')) + ($Extra | ForEach-Object { '"' + $_ + '"' })
  Start-Process -FilePath 'powershell.exe' -ArgumentList $a -WindowStyle Hidden | Out-Null
}

# ---- 窗体 ----
$form = New-Object Windows.Forms.Form
$form.Text = 'BMPBGS 控制台'
$form.Size = New-Object Drawing.Size(760, 520)
$form.StartPosition = 'CenterScreen'
$form.MaximizeBox = $false
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
  $logBox.SelectionStart = $logBox.TextLength
  $logBox.SelectionLength = 0
  $logBox.SelectionColor = $C_SUBTEXT
  $logBox.AppendText('[' + (Get-Date -Format 'HH:mm:ss') + ']  ')
  $logBox.SelectionColor = $color
  $logBox.AppendText($msg + "`r`n")
  $logBox.SelectionColor = $logBox.ForeColor
  $logBox.ScrollToCaret()
}

# ---- 底部按钮区 ----
$panel = New-Object Windows.Forms.Panel
$panel.Dock = 'Bottom'
$panel.Height = 82
$panel.BackColor = $C_CARD
$form.Controls.Add($panel)
$panel.BringToFront()

function New-Btn([string]$text, [System.Drawing.Color]$base, [System.Drawing.Color]$hover, [int]$x) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $text
  $b.Bounds = New-Object Drawing.Rectangle($x, 19, 108, 44)
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderSize = 0
  $b.FlatAppearance.MouseOverBackColor = $hover
  $b.FlatAppearance.MouseDownBackColor = $hover
  $b.BackColor = $base
  $b.ForeColor = [System.Drawing.Color]::White
  $b.Cursor = 'Hand'
  $b.Font = New-Object Drawing.Font('微软雅黑', 10.5, [System.Drawing.FontStyle]::Bold)
  $b.TabStop = $false
  $panel.Controls.Add($b)
  return $b
}

$btnStart   = New-Btn '启动系统' $C_GREEN  ([System.Drawing.Color]::FromArgb(23, 143, 80))   16
$btnStop    = New-Btn '停止系统' $C_RED    ([System.Drawing.Color]::FromArgb(200, 68, 64))   138
$btnOpen    = New-Btn '打开系统' $C_PRIMARY([System.Drawing.Color]::FromArgb(22, 91, 187))   260
$btnBackup  = New-Btn '备份数据' ([System.Drawing.Color]::FromArgb(240, 150, 30)) ([System.Drawing.Color]::FromArgb(214, 130, 20)) 382
$btnRestore = New-Btn '恢复数据' ([System.Drawing.Color]::FromArgb(120, 90, 200)) ([System.Drawing.Color]::FromArgb(102, 76, 172)) 504
$btnExit    = New-Btn '退出'     $C_GRAY   ([System.Drawing.Color]::FromArgb(116, 121, 128)) 626

$btnStart.Add_Click({
  $btnStart.Enabled = $false
  $statusPill.Text = '● 正在启动，请稍候（首次约 1-2 分钟）…'
  $statusPill.ForeColor = $C_PRIMARY
  $statusPill.BackColor = [System.Drawing.Color]::FromArgb(232, 240, 252)
  Write-Log '启动中：初始化数据库并拉起前后端服务…' $C_PRIMARY
  Invoke-ScriptSilent 'bb-start.ps1' @('-Silent')
  Write-Log '启动脚本已在后台执行，完成后浏览器自动打开。' $C_TEXT
})
$btnStop.Add_Click({
  $btnStop.Enabled = $false
  $statusPill.Text = '● 正在停止…'
  $statusPill.ForeColor = $C_RED
  $statusPill.BackColor = $C_STOPBG
  Write-Log '停止中：结束前后端进程并停止数据库…' $C_RED
  Invoke-ScriptSilent 'bb-stop.ps1' @('-Silent')
  Write-Log '停止脚本已在后台执行。' $C_TEXT
})
$btnBackup.Add_Click({
  $btnBackup.Enabled = $false
  Write-Log '正在备份数据（数据库 + 上传文件），后台执行中…' ([System.Drawing.Color]::FromArgb(240, 150, 30))
  Invoke-ScriptSilent 'bb-backup.ps1' @('-Silent')
  Write-Log ('备份已启动，完成后写入：' + (Get-BBBackupRoot $AppRoot) + '\<时间戳>') $C_TEXT
  $btnBackup.Enabled = $true
})
$btnRestore.Add_Click({
  $btnRestore.Enabled = $false
  if ((Test-Port $webPort) -or (Test-Port $apiPort)) {
    Write-Log '恢复前请先点击「停止系统」，确认服务完全停止后再恢复。' $C_RED
    $btnRestore.Enabled = $true
    return
  }
  $bkRoot = Get-BBBackupRoot $AppRoot
  $sets = Get-ChildItem -Directory $bkRoot -ErrorAction SilentlyContinue | Sort-Object Name -Descending
  if ($sets.Count -eq 0) { Write-Log ('未找到任何备份集：' + $bkRoot) $C_RED; $btnRestore.Enabled = $true; return }
  $answer = [System.Windows.Forms.MessageBox]::Show(
    ('将用备份「' + $sets[0].Name + '」覆盖当前数据库和文件，是否继续？'),
    '确认恢复数据',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Warning
  )
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
    Write-Log '已取消恢复。' $C_TEXT
    $btnRestore.Enabled = $true
    return
  }
  Write-Log ('正在恢复最新备份集：' + $sets[0].Name + '（后台执行中）') ([System.Drawing.Color]::FromArgb(120, 90, 200))
  Invoke-ScriptSilent 'bb-restore.ps1' @('-BackupSet', $sets[0].FullName, '-Silent')
  Write-Log '恢复已启动，完成后请点「启动系统」重新拉起服务。' $C_TEXT
  $btnRestore.Enabled = $true
})
$btnOpen.Add_Click({ Start-Process ('http://127.0.0.1:' + $webPort) })
$btnExit.Add_Click({ $form.Close() })

# ---- 状态轮询 ----
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
  if (Test-Port $webPort) {
    $statusPill.Text = '● 系统运行中    Web  http://127.0.0.1:' + $webPort
    $statusPill.ForeColor = $C_GREEN
    $statusPill.BackColor = $C_OKBG
    $btnStart.Enabled = $false; $btnStop.Enabled = $true
  } elseif ((Test-Port $apiPort) -or (Test-Port $pgPort)) {
    $statusPill.Text = '● 正在启动，服务未就绪…'
    $statusPill.ForeColor = $C_PRIMARY
    $statusPill.BackColor = [System.Drawing.Color]::FromArgb(232, 240, 252)
    $btnStart.Enabled = $false; $btnStop.Enabled = $true
  } else {
    $statusPill.Text = '● 系统未启动'
    $statusPill.ForeColor = $C_GRAY
    $statusPill.BackColor = [System.Drawing.Color]::FromArgb(240, 241, 243)
    $btnStart.Enabled = $true; $btnStop.Enabled = $false
  }
})
$timer.Start()

Write-Log 'BMPBGS 控制台已就绪，点击「启动系统」开始使用。' $C_TEXT
$form.Topmost = $true

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
