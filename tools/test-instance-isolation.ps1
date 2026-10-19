param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath($ProjectRoot)
$scripts = @(
  'bb-common.ps1', 'bb-start.ps1', 'bb-stop.ps1', 'bb-control.ps1',
  'dev-start.ps1', 'dev-stop.ps1', 'dev-status.ps1', 'start-local.ps1'
)

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

foreach ($name in $scripts) {
  $path = Join-Path $project $name
  $bytes = [IO.File]::ReadAllBytes($path)
  Assert-True ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) "$name 缺少 UTF-8 BOM"
  $tokens = $null
  $errors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
  Assert-True ($errors.Count -eq 0) "$name 存在 PowerShell 语法错误：$($errors[0].Message)"
}

$package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
Assert-True ($package.scripts.dev -match 'dev-start\.ps1') 'npm run dev 未使用安全开发启动器'
Assert-True ($package.scripts.'dev:stop' -match 'dev-stop\.ps1') '缺少开发停止入口'
Assert-True ($package.scripts.'dev:status' -match 'dev-status\.ps1') '缺少开发状态入口'

$devStart = Get-Content -LiteralPath (Join-Path $project 'dev-start.ps1') -Raw
$devStop = Get-Content -LiteralPath (Join-Path $project 'dev-stop.ps1') -Raw
$server = Get-Content -LiteralPath (Join-Path $project 'backend\src\server.ts') -Raw
$vite = Get-Content -LiteralPath (Join-Path $project 'frontend\vite.config.ts') -Raw
Assert-True ($devStart.Contains("`$pgData = 'D:\BBMipingDB\data'") -and $devStart -match '\$pgPort\s*=\s*54329') '开发库目录或 PostgreSQL 端口不固定'
Assert-True ($devStart -match '\$apiPort\s*=\s*3101' -and $devStart -match '\$webPort\s*=\s*5174') '开发 API/Web 端口不固定'
Assert-True ($devStart -notmatch 'AllowInitialize') '开发启动器不得初始化数据库'
Assert-True ($devStart -match 'Get-BBLocalInstanceDataDir') '开发启动器未使用本地 PostgreSQL 实例身份校验'
Assert-True ($devStop.Contains("-PgRoot 'D:\BBMipingDB\PostgreSQL'")) '开发停止器未固定 PostgreSQL 运行时'
Assert-True ($server -match 'const databaseUrl = process\.env\.DATABASE_URL' -and $server -match 'if \(!databaseUrl\)' -and $server -notmatch "process\.env\.DATABASE_URL\s*\|\|") '后端仍可能猜测默认数据库'
Assert-True ($server -match 'instanceId' -and $server -match 'databasePort') '健康接口缺少实例身份字段'
Assert-True ($vite -match 'VITE_DEV_PORT' -and $vite -match 'VITE_API_PORT' -and $vite -match 'strictPort:\s*true') 'Vite 未固定开发端口或仍会静默避让'

. (Join-Path $project 'bb-common.ps1')
$sourceId = Get-BBInstanceId -AppRoot $project
$installedId = Get-BBInstanceId -AppRoot 'D:\BMPBGS'
Assert-True ($sourceId -ne $installedId) '源码版与安装版实例标识发生冲突'
Assert-True ((Get-BBRuntimeDir -AppRoot $project) -ne (Get-BBRuntimeDir -AppRoot 'D:\BMPBGS')) '源码版与安装版运行目录发生冲突'

$common = Get-Content -LiteralPath (Join-Path $project 'bb-common.ps1') -Raw
Assert-True ($common -match 'function Get-BBLocalInstanceDataDir' -and $common -match 'postmaster\.pid' -and $common -match "status -ne 'ready'") 'PostgreSQL 本地实例身份校验不完整'
Assert-True ($common -match 'Get-BBLocalInstanceDataDir -PgCtl \$pgCtl -PgData \$Paths\.PgData -PgPort \$Paths\.PgPort') 'PostgreSQL 启动未使用无口令本地身份校验'

Write-Host 'PASS: 开发固定端口、数据库保护、实例身份、运行目录及启动入口检查通过。'
