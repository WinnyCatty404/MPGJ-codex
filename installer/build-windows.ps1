param(
  [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$installerRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = Split-Path -Parent $installerRoot
$buildRoot = Join-Path $installerRoot 'build\windows'
$stageRoot = Join-Path $buildRoot 'app'
$liteStageRoot = Join-Path $buildRoot 'app-lite'
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

function Resolve-InstalledNodePackage([string]$Name, [string]$FromDirectory) {
  $cursor = [IO.Path]::GetFullPath($FromDirectory)
  while ($cursor) {
    $candidate = Join-Path (Join-Path $cursor 'node_modules') $Name
    if (Test-Path -LiteralPath (Join-Path $candidate 'package.json') -PathType Leaf) { return $candidate }
    $parent = Split-Path -Parent $cursor
    if (-not $parent -or $parent -eq $cursor) { break }
    $cursor = $parent
  }
  return $null
}

# 从后端直接依赖出发递归复制生产运行依赖。复制整个包目录可保留包内嵌套依赖及 sharp 原生文件，
# 但不会携带 Vite、TypeScript、测试工具等只在构建期使用的顶层包。
function Copy-ProductionNodeModules([string]$Destination) {
  $sourceRoot = Join-Path $projectRoot 'node_modules'
  $backendPackage = Get-Content -LiteralPath (Join-Path $projectRoot 'backend\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $queue = [Collections.Generic.Queue[object]]::new()
  foreach ($property in $backendPackage.dependencies.PSObject.Properties) {
    $queue.Enqueue([PSCustomObject]@{ Name = $property.Name; From = $projectRoot })
  }
  $copied = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  while ($queue.Count) {
    $request = $queue.Dequeue()
    $source = Resolve-InstalledNodePackage -Name $request.Name -FromDirectory $request.From
    if (-not $source) { throw "精简版缺少生产依赖：$($request.Name)（请求方：$($request.From)）" }
    $resolved = [IO.Path]::GetFullPath($source)
    if (-not $copied.Add($resolved)) { continue }
    $relative = $resolved.Substring(([IO.Path]::GetFullPath($sourceRoot).TrimEnd('\') + '\').Length)
    if ($relative.StartsWith('..')) { throw "生产依赖不在项目 node_modules 中：$resolved" }
    Copy-Tree $resolved (Join-Path $Destination $relative)
    $package = Get-Content -LiteralPath (Join-Path $resolved 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($group in @($package.dependencies, $package.optionalDependencies)) {
      if (-not $group) { continue }
      foreach ($property in $group.PSObject.Properties) {
        $dependency = Resolve-InstalledNodePackage -Name $property.Name -FromDirectory $resolved
        if ($dependency) { $queue.Enqueue([PSCustomObject]@{ Name = $property.Name; From = $resolved }) }
        elseif ($group -eq $package.dependencies) { throw "生产依赖 $($package.name) 缺少必需包：$($property.Name)" }
      }
    }
  }
}

function Copy-ApplicationFiles([string]$Destination, [switch]$Lite) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($file in $rootFiles) {
    Assert-File (Join-Path $projectRoot $file) $file
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $Destination $file) -Force
  }
  Copy-Item -LiteralPath $launcherExe -Destination (Join-Path $Destination 'BMPBGS.exe') -Force
  Copy-Tree (Join-Path $projectRoot 'backend\dist') (Join-Path $Destination 'backend\dist')
  Copy-Tree (Join-Path $projectRoot 'frontend\dist') (Join-Path $Destination 'frontend\dist')
  Copy-Tree (Join-Path $projectRoot 'storage\templates') (Join-Path $Destination 'storage\templates')
  Copy-Tree (Join-Path $projectRoot 'pgsql') (Join-Path $Destination 'pgsql') @((Join-Path $projectRoot 'pgsql\pgAdmin 4'))
  if ($Lite) {
    New-Item -ItemType Directory -Path (Join-Path $Destination 'node') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'node\node.exe') -Destination (Join-Path $Destination 'node\node.exe') -Force
    if (Test-Path -LiteralPath (Join-Path $projectRoot 'node\LICENSE')) {
      Copy-Item -LiteralPath (Join-Path $projectRoot 'node\LICENSE') -Destination (Join-Path $Destination 'node\LICENSE') -Force
    }
    Copy-ProductionNodeModules (Join-Path $Destination 'node_modules')
  } else {
    Copy-Tree (Join-Path $projectRoot 'node') (Join-Path $Destination 'node')
    Copy-Tree (Join-Path $projectRoot 'node_modules') (Join-Path $Destination 'node_modules') @(
      (Join-Path $projectRoot 'node_modules\@types'),
      (Join-Path $projectRoot 'node_modules\typescript'),
      (Join-Path $projectRoot 'node_modules\.bin'),
      (Join-Path $projectRoot 'node_modules\.cache')
    )
  }
  New-Item -ItemType Directory -Path (Join-Path $Destination 'database') -Force | Out-Null
  foreach ($file in @('schema.sql', 'seed.sql', 'setup.ps1')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "database\$file") -Destination (Join-Path $Destination "database\$file") -Force
  }
}

function Assert-LiteRuntime([string]$Destination) {
  $nodeExe = Join-Path $Destination 'node\node.exe'
  $moduleRoot = Join-Path $Destination 'node_modules'
  $probe = @'
Promise.all([
  import('cors'), import('dotenv'), import('express'), import('jsonwebtoken'),
  import('jszip'), import('pg'), import('sharp'), import('zod')
]).then(async modules => {
  const sharp = modules[6].default;
  await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
  console.log('lite-runtime-ok');
}).catch(error => { console.error(error); process.exit(1); });
'@
  $previousNodePath = $env:NODE_PATH
  try {
    $env:NODE_PATH = $moduleRoot
    $probe | & $nodeExe --input-type=module -
    if ($LASTEXITCODE -ne 0) { throw '精简版 Node.js 生产依赖自检失败' }
  } finally { $env:NODE_PATH = $previousNodePath }
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

Write-Host '[1/6] 构建后端与前端生产文件...'
& npm.cmd run build -w backend
if ($LASTEXITCODE -ne 0) { throw '后端构建失败' }
& npm.cmd run build -w frontend
if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }

Assert-File $iconPath '应用图标'
Assert-File (Join-Path $projectRoot 'node\node.exe') 'Node.js 运行时'
Assert-File (Join-Path $projectRoot 'pgsql\bin\pg_ctl.exe') 'PostgreSQL 运行时'
Assert-File (Join-Path $projectRoot 'database\seed.sql') '初始用户数据'

Write-Host '[2/6] 编译无控制台 Windows 启动器...'
$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $csc) { throw '未找到 Windows .NET Framework C# 编译器 csc.exe' }
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
& $csc /nologo /target:winexe /optimize+ "/win32icon:$iconPath" "/out:$launcherExe" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'BMPBGS.exe 启动器编译失败' }

Write-Host '[3/6] 创建完整版与精简版 Windows 发布目录...'
$resolvedBuild = [System.IO.Path]::GetFullPath($buildRoot)
$resolvedInstaller = [System.IO.Path]::GetFullPath($installerRoot)
if (-not $resolvedBuild.StartsWith($resolvedInstaller + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "拒绝清理 installer 目录以外的路径：$resolvedBuild"
}
$rootFiles = @(
  'bb-backup.ps1', 'bb-common.ps1', 'bb-control.ps1', 'bb-restore.ps1',
  'bb-serve-frontend.js', 'bb-start.ps1', 'bb-stop.ps1',
  'bmpbgs.ico', 'logo-256.png', 'logo-512.png'
)
foreach ($destination in @($stageRoot, $liteStageRoot)) {
  $resolvedStage = [IO.Path]::GetFullPath($destination)
  if (-not $resolvedStage.StartsWith($resolvedBuild + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝清理 installer\build 以外的路径：$resolvedStage"
  }
  if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
}
Copy-ApplicationFiles -Destination $stageRoot
Copy-ApplicationFiles -Destination $liteStageRoot -Lite

Write-Host '[4/6] 验证精简版生产运行依赖...'
Assert-LiteRuntime $liteStageRoot

Write-Host '[5/6] 编译完整版与精简版 Windows 安装包...'
$iscc = Resolve-Iscc
if (-not $iscc) { throw '未找到 Inno Setup 6（ISCC.exe）' }
& $iscc '/Qp' (Join-Path $installerRoot 'BBMiPing-Setup.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup 编译失败' }
& $iscc '/Qp' '/DLiteBuild' (Join-Path $installerRoot 'BBMiPing-Setup.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup 精简版编译失败' }

Write-Host '[6/6] 生成两个安装包的校验文件...'
$setups = @(
  (Get-Item -LiteralPath (Join-Path $installerRoot 'out\BMPBGS-Windows-x64-Setup.exe'))
  (Get-Item -LiteralPath (Join-Path $installerRoot 'out\BMPBGS-Windows-x64-Setup-Lite.exe'))
)
$hashLines = foreach ($setup in $setups) {
  $hash = Get-FileHash -LiteralPath $setup.FullName -Algorithm SHA256
  Write-Host "完成：$($setup.FullName)"
  Write-Host ("大小：{0:N1} MB" -f ($setup.Length / 1MB))
  Write-Host "SHA256：$($hash.Hash.ToLowerInvariant())"
  "$($hash.Hash.ToLowerInvariant())  $($setup.Name)"
}
$hashLines | Set-Content -LiteralPath (Join-Path $installerRoot 'out\SHA256SUMS.txt') -Encoding ascii
