param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath($ProjectRoot)
$verifyRoot = [IO.Path]::GetFullPath((Join-Path $project 'installer\verify-out'))
$tag = [guid]::NewGuid().ToString('N')
$appRoot = Join-Path $verifyRoot "template-install-$tag"
$dataRoot = Join-Path ([IO.Path]::GetPathRoot($project)) "BMPBGS-template-verify-$tag"
$setup = Join-Path $project 'installer\out\BMPBGS-Windows-x64-Setup.exe'
$factory = Join-Path $project 'storage\templates'
$updated = @(
  '1-系统基本情况调查表（二级）.docx',
  '1-系统基本情况调查表（三级）.docx',
  '2-测评方案-init.docx',
  '2-测评方案-last.docx',
  '3-测评方案评审表.docx'
)
$untouched = '10-项目交接单.docx'
$installed = $false

function Assert-HashMatch([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) { throw "缺少模板：$Destination" }
  if ((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash) {
    throw "模板内容不一致：$Destination"
  }
}

function Install-Quietly {
  $args = @('/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS',
    ('/DIR="' + $appRoot + '"'), ('/DATADIR="' + $dataRoot + '"'))
  $process = Start-Process -FilePath $setup -ArgumentList $args -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "安装失败：$($process.ExitCode)" }
}

try {
  if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw "缺少安装包：$setup" }
  Install-Quietly
  $installed = $true
  $factoryFiles = Get-ChildItem -LiteralPath $factory -Recurse -File
  foreach ($file in $factoryFiles) {
    $relative = $file.FullName.Substring($factory.Length).TrimStart('\')
    Assert-HashMatch $file.FullName (Join-Path (Join-Path $dataRoot 'storage\templates') $relative)
  }

  $updatedPath = Join-Path $dataRoot ('storage\templates\records\' + $updated[0])
  $untouchedPath = Join-Path $dataRoot ('storage\templates\records\' + $untouched)
  [IO.File]::WriteAllText($updatedPath, 'customized updated template')
  [IO.File]::WriteAllText($untouchedPath, 'customized untouched template')
  Install-Quietly
  foreach ($name in $updated) {
    Assert-HashMatch (Join-Path $factory ('records\' + $name)) (Join-Path $dataRoot ('storage\templates\records\' + $name))
  }
  if ([IO.File]::ReadAllText($untouchedPath) -ne 'customized untouched template') {
    throw '未列入更新范围的模板被覆盖'
  }

  $uninstaller = Join-Path $appRoot 'unins000.exe'
  $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait -PassThru -WindowStyle Hidden
  if ($uninstall.ExitCode -ne 0) { throw "卸载失败：$($uninstall.ExitCode)" }
  $installed = $false
  if (-not (Test-Path -LiteralPath $updatedPath -PathType Leaf) -or
      [IO.File]::ReadAllText($untouchedPath) -ne 'customized untouched template') {
    throw '卸载误删数据目录中的模板'
  }
  Write-Host "PASS: 新安装补齐 $($factoryFiles.Count) 个模板；重装更新指定模板并保留其他模板；卸载保留数据目录"
} finally {
  if ($installed -and (Test-Path -LiteralPath (Join-Path $appRoot 'unins000.exe'))) {
    Start-Process -FilePath (Join-Path $appRoot 'unins000.exe') -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait -WindowStyle Hidden | Out-Null
  }
  $expectedApp = [IO.Path]::GetFullPath((Join-Path $verifyRoot "template-install-$tag"))
  $expectedData = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetPathRoot($project)) "BMPBGS-template-verify-$tag"))
  if ([IO.Path]::GetFullPath($appRoot) -ne $expectedApp -or
      -not $expectedApp.StartsWith($verifyRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFullPath($dataRoot) -ne $expectedData -or $tag -notmatch '^[a-f0-9]{32}$') {
    throw '测试目录路径校验失败，拒绝清理'
  }
  if (Test-Path -LiteralPath $appRoot) { Remove-Item -LiteralPath $appRoot -Recurse -Force }
  if (Test-Path -LiteralPath $dataRoot) { Remove-Item -LiteralPath $dataRoot -Recurse -Force }
}
