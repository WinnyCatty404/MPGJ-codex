# BMPBGS 控制台 - 启动/停止合一管理窗口（PowerShell WinForms，无需额外依赖）
# 用法：powershell -ExecutionPolicy Bypass -File bb-control.ps1
param(
  [string]$AppRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition)
)
$ErrorActionPreference = 'Stop'
. (Join-Path $AppRoot 'bb-common.ps1')

# 隐藏自身控制台窗口（双击/右键"使用 PowerShell 运行"时避免黑窗残留）
try {
  Add-Type -Namespace Native -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();'
  [void][Native.Win]::ShowWindow([Native.Win]::GetConsoleWindow(), 0)
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

# ---- 窗体 ----
$form = New-Object Windows.Forms.Form
$form.Text = 'BMPBGS 控制台'
$form.Size = New-Object Drawing.Size(640, 520)
$form.StartPosition = 'CenterScreen'
$form.MaximizeBox = $false
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
  $b.Bounds = New-Object Drawing.Rectangle($x, 19, 132, 44)
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

$btnStart = New-Btn '启动系统' $C_GREEN  ([System.Drawing.Color]::FromArgb(23, 143, 80))  22
$btnStop  = New-Btn '停止系统' $C_RED    ([System.Drawing.Color]::FromArgb(200, 68, 64))  162
$btnOpen  = New-Btn '打开系统' $C_PRIMARY([System.Drawing.Color]::FromArgb(22, 91, 187))  302
$btnExit  = New-Btn '退出'     $C_GRAY   ([System.Drawing.Color]::FromArgb(116, 121, 128)) 442

$btnStart.Add_Click({
  $btnStart.Enabled = $false
  $statusPill.Text = '● 正在启动，请稍候（首次约 1-2 分钟）…'
  $statusPill.ForeColor = $C_PRIMARY
  $statusPill.BackColor = [System.Drawing.Color]::FromArgb(232, 240, 252)
  Write-Log '启动中：初始化数据库并拉起前后端服务…' $C_PRIMARY
  Invoke-Script 'bb-start.ps1'
  Write-Log '启动脚本已在后台执行，完成后浏览器自动打开。' $C_TEXT
})
$btnStop.Add_Click({
  $btnStop.Enabled = $false
  $statusPill.Text = '● 正在停止…'
  $statusPill.ForeColor = $C_RED
  $statusPill.BackColor = $C_STOPBG
  Write-Log '停止中：结束前后端进程并停止数据库…' $C_RED
  Invoke-Script 'bb-stop.ps1'
  Write-Log '停止脚本已在后台执行。' $C_TEXT
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
[void]$form.ShowDialog()
