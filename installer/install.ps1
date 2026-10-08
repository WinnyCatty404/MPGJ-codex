# 开发机快速创建快捷方式（无需 Inno Setup）。
# 正式分发给他人请改用 BBMiPing-Setup.iss 编译安装包。
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$appRoot = $scriptDir
if ((Split-Path -Leaf $appRoot) -eq 'installer') { $appRoot = Split-Path -Parent $appRoot }

$group = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\BMPBGS'
$desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')

$shortcuts = @(
  @{Name = 'BMPBGS控制台'; Script = 'bb-control.vbs'; Vbs = $true }
)

function New-Shortcut($linkPath, $s) {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($linkPath)
  if ($s.Vbs) {
    # VBS 启动器：不产生控制台黑窗
    $lnk.TargetPath = Join-Path $appRoot $s.Script
    $lnk.Arguments = ''
  } else {
    $lnk.TargetPath = 'powershell.exe'
    $lnk.Arguments = "-ExecutionPolicy Bypass -File ""$appRoot\$($s.Script)"""
  }
  $lnk.WorkingDirectory = $appRoot
  $lnk.Description = "BMPBGS - $($s.Script)"
  $iconPath = Join-Path $appRoot 'bmpbgs.ico'
  if (Test-Path $iconPath) { $lnk.IconLocation = "$iconPath,0" }
  $lnk.Save()
}

New-Item -ItemType Directory -Path $group -Force | Out-Null
foreach ($s in $shortcuts) {
  New-Shortcut (Join-Path $group ($s.Name + '.lnk')) $s
  New-Shortcut (Join-Path $desktop ($s.Name + '.lnk')) $s
}
Write-Host "已创建快捷方式："
Write-Host "  开始菜单：$group"
Write-Host "  公共桌面：$desktop"
Write-Host "（如需移除，运行 installer\uninstall.ps1）"
