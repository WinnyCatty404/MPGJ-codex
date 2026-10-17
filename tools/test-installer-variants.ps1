param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath($ProjectRoot)
$verifyRoot = [IO.Path]::GetFullPath((Join-Path $project 'installer\verify-out'))
$setups = @('BMPBGS-Windows-x64-Setup.exe', 'BMPBGS-Windows-x64-Setup-Lite.exe')

foreach ($setupName in $setups) {
  $tag = [guid]::NewGuid().ToString('N')
  $appRoot = Join-Path $verifyRoot "variant-$tag"
  $dataRoot = Join-Path ([IO.Path]::GetPathRoot($project)) "BMPBGS-variant-verify-$tag"
  $setup = Join-Path $project "installer\out\$setupName"
  $installed = $false
  try {
    if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw "缺少安装包：$setup" }
    $arguments = @('/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS',
      ('/DIR="' + $appRoot + '"'), ('/DATADIR="' + $dataRoot + '"'))
    $process = Start-Process -FilePath $setup -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "安装失败：$setupName，退出码 $($process.ExitCode)" }
    $installed = $true

    $nodeExe = Join-Path $appRoot 'node\node.exe'
    $moduleRoot = Join-Path $appRoot 'node_modules'
    $probe = "Promise.all([import('express'),import('pg'),import('sharp'),import('jszip')]).then(async m=>{await m[2].default({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer();console.log('runtime-ok')}).catch(e=>{console.error(e);process.exit(1)})"
    $previousNodePath = $env:NODE_PATH
    try {
      $env:NODE_PATH = $moduleRoot
      & $nodeExe --input-type=module -e $probe
      if ($LASTEXITCODE -ne 0) { throw "安装后的生产依赖自检失败：$setupName" }
    } finally { $env:NODE_PATH = $previousNodePath }

    foreach ($required in @('backend\dist\server.js', 'frontend\dist\index.html', 'database\schema.sql', 'storage\templates\report\default-report-template.docx')) {
      if (-not (Test-Path -LiteralPath (Join-Path $appRoot $required) -PathType Leaf)) { throw "安装后缺少文件：$required" }
    }
    Write-Host "PASS [$setupName]: 静默安装、生产依赖与关键文件检查通过"
  } finally {
    if ($installed -and (Test-Path -LiteralPath (Join-Path $appRoot 'unins000.exe'))) {
      Start-Process -FilePath (Join-Path $appRoot 'unins000.exe') -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait -WindowStyle Hidden | Out-Null
    }
    $expectedApp = [IO.Path]::GetFullPath((Join-Path $verifyRoot "variant-$tag"))
    $expectedData = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetPathRoot($project)) "BMPBGS-variant-verify-$tag"))
    if ([IO.Path]::GetFullPath($appRoot) -ne $expectedApp -or
        -not $expectedApp.StartsWith($verifyRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFullPath($dataRoot) -ne $expectedData -or $tag -notmatch '^[a-f0-9]{32}$') {
      throw '测试目录路径校验失败，拒绝清理'
    }
    if (Test-Path -LiteralPath $appRoot) { Remove-Item -LiteralPath $appRoot -Recurse -Force }
    if (Test-Path -LiteralPath $dataRoot) { Remove-Item -LiteralPath $dataRoot -Recurse -Force }
  }
}
