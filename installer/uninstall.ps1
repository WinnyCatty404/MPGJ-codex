# 移除由 install.ps1 创建的快捷方式
$group = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\BMPBGS'
$desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
@('BMPBGS控制台', '备份BMPBGS数据', '恢复BMPBGS数据') | ForEach-Object {
  Remove-Item (Join-Path $group "$_.lnk") -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $desktop "$_.lnk") -Force -ErrorAction SilentlyContinue
}
Remove-Item $group -Recurse -Force -ErrorAction SilentlyContinue
Write-Host '已移除 BMPBGS 快捷方式。'
