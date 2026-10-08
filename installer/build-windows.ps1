param(
  [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$installerRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = Split-Path -Parent $installerRoot
$buildRoot = Join-Path $installerRoot 'build\windows'
$stageRoot = Join-Path $buildRoot 'app'
$launcherSource = Join-Path $installerRoot 'windows\BMPBGS-Launcher.cs'
$launcherExe = Join-Path $buildRoot 'BMPBGS.exe'
$iconPath = Join-Path $projectRoot 'bmpbgs.ico'

function Assert-File([string]$Path, [string]$Description) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "缺少$Description：$Path" }
}

function Copy-Tree([string]$Source, [string]$Destination, [string[]]$ExcludeDirs = @()) {
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "缺少目录：$Source" }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $args = @($Source, $Destination, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($ExcludeDirs.Count) { $args += '/XD'; $args += $ExcludeDirs }
  & robocopy @args | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "复制失败：$Source -> $Destination（robocopy=$LASTEXITCODE）" }
}

function Resolve-Iscc {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    'D:\Inno Setup 6\ISCC.exe'
  )
  return $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
}

Write-Host '[1/5] 构建后端与前端生产文件...'
& npm.cmd run build -w backend
if ($LASTEXITCODE -ne 0) { throw '后端构建失败' }
& npm.cmd run build -w frontend
if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }

Assert-File $iconPath '应用图标'
Assert-File (Join-Path $projectRoot 'node\node.exe') 'Node.js 运行时'
Assert-File (Join-Path $projectRoot 'pgsql\bin\pg_ctl.exe') 'PostgreSQL 运行时'
Assert-File (Join-Path $projectRoot 'database\seed.sql') '初始用户数据'

Write-Host '[2/5] 编译无控制台 Windows 启动器...'
$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $csc) { throw '未找到 Windows .NET Framework C# 编译器 csc.exe' }
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
& $csc /nologo /target:winexe /optimize+ "/win32icon:$iconPath" "/out:$launcherExe" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'BMPBGS.exe 启动器编译失败' }

Write-Host '[3/5] 创建最小化 Windows 发布目录...'
$resolvedBuild = [System.IO.Path]::GetFullPath($buildRoot)
$resolvedInstaller = [System.IO.Path]::GetFullPath($installerRoot)
if (-not $resolvedBuild.StartsWith($resolvedInstaller + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "拒绝清理 installer 目录以外的路径：$resolvedBuild"
}
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

$rootFiles = @(
  'bb-backup.ps1', 'bb-common.ps1', 'bb-control.ps1', 'bb-restore.ps1',
  'bb-serve-frontend.js', 'bb-start.ps1', 'bb-stop.ps1',
  'bmpbgs.ico', 'logo-256.png', 'logo-512.png'
)
foreach ($file in $rootFiles) {
  Assert-File (Join-Path $projectRoot $file) $file
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $stageRoot $file) -Force
}
Copy-Item -LiteralPath $launcherExe -Destination (Join-Path $stageRoot 'BMPBGS.exe') -Force

Copy-Tree (Join-Path $projectRoot 'backend\dist') (Join-Path $stageRoot 'backend\dist')
Copy-Tree (Join-Path $projectRoot 'frontend\dist') (Join-Path $stageRoot 'frontend\dist')
Copy-Tree (Join-Path $projectRoot 'storage\templates') (Join-Path $stageRoot 'storage\templates')
Copy-Tree (Join-Path $projectRoot 'node') (Join-Path $stageRoot 'node')
Copy-Tree (Join-Path $projectRoot 'pgsql') (Join-Path $stageRoot 'pgsql') @((Join-Path $projectRoot 'pgsql\pgAdmin 4'))
Copy-Tree (Join-Path $projectRoot 'node_modules') (Join-Path $stageRoot 'node_modules') @(
  (Join-Path $projectRoot 'node_modules\@types'),
  (Join-Path $projectRoot 'node_modules\typescript'),
  (Join-Path $projectRoot 'node_modules\.bin'),
  (Join-Path $projectRoot 'node_modules\.cache')
)
New-Item -ItemType Directory -Path (Join-Path $stageRoot 'database') -Force | Out-Null
foreach ($file in @('schema.sql', 'seed.sql', 'setup.ps1')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "database\$file") -Destination (Join-Path $stageRoot "database\$file") -Force
}

Write-Host '[4/5] 编译 Windows 安装包...'
$iscc = Resolve-Iscc
if (-not $iscc) { throw '未找到 Inno Setup 6（ISCC.exe）' }
& $iscc '/Qp' (Join-Path $installerRoot 'BBMiPing-Setup.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup 编译失败' }

Write-Host '[5/5] 生成校验文件...'
$setup = Get-Item -LiteralPath (Join-Path $installerRoot 'out\BMPBGS-Windows-x64-Setup.exe')
$hash = Get-FileHash -LiteralPath $setup.FullName -Algorithm SHA256
"$($hash.Hash.ToLowerInvariant())  $($setup.Name)" | Set-Content -LiteralPath (Join-Path $setup.DirectoryName 'SHA256SUMS.txt') -Encoding ascii
Write-Host "完成：$($setup.FullName)"
Write-Host ("大小：{0:N1} MB" -f ($setup.Length / 1MB))
Write-Host "SHA256：$($hash.Hash.ToLowerInvariant())"
