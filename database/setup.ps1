param(
  [string]$PostgresRoot = 'D:\BBMipingDB\PostgreSQL',
  [string]$DataDir = 'D:\BBMipingDB\data',
  [int]$Port = 54328,
  [string]$SuperuserPassword = 'BbMiping-Local-2026!',
  [string]$AppPassword = 'BbMiping-App-2026!'
)

$ErrorActionPreference = 'Stop'
$bin = Join-Path $PostgresRoot 'bin'
$initdb = Join-Path $bin 'initdb.exe'
$pgCtl = Join-Path $bin 'pg_ctl.exe'
$psql = Join-Path $bin 'psql.exe'
$createdb = Join-Path $bin 'createdb.exe'

function Assert-NativeSuccess([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "$Step 失败，退出码：$LASTEXITCODE" }
}

if (-not (Test-Path -LiteralPath $initdb)) {
  throw "PostgreSQL 未找到：$initdb"
}

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $DataDir 'PG_VERSION'))) {
  $staleConfig = Join-Path $DataDir 'postgresql.conf'
  if (Test-Path -LiteralPath $staleConfig) {
    Remove-Item -LiteralPath $staleConfig -Force
  }
  $passwordFile = Join-Path ([System.IO.Path]::GetTempPath()) 'bb-miping-pg-password.txt'
  Set-Content -LiteralPath $passwordFile -Value $SuperuserPassword -NoNewline -Encoding utf8
  & $initdb -D $DataDir -U postgres -A scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale-provider=icu --icu-locale=zh-CN
  Assert-NativeSuccess '初始化 PostgreSQL 数据目录'
  Remove-Item -LiteralPath $passwordFile -Force
  Add-Content -LiteralPath (Join-Path $DataDir 'postgresql.conf') -Value "`nport = $Port`nlisten_addresses = '127.0.0.1'`n"
}

& $pgCtl -D $DataDir status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  & $pgCtl -D $DataDir -l (Join-Path $DataDir 'postgresql.log') start
  Assert-NativeSuccess '启动 PostgreSQL'
  Start-Sleep -Seconds 2
}
$env:PGPASSWORD = $SuperuserPassword

$roleExists = & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='bb_miping_app'"
if ($roleExists -ne '1') {
  $escapedAppPassword = $AppPassword.Replace("'", "''")
  & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -c "CREATE ROLE bb_miping_app LOGIN PASSWORD '$escapedAppPassword'"
  Assert-NativeSuccess '创建应用数据库角色'
}
$dbExists = & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='bb_miping'"
if ($dbExists -ne '1') {
  & $createdb -h 127.0.0.1 -p $Port -U postgres -O bb_miping_app -E UTF8 bb_miping
  Assert-NativeSuccess '创建业务数据库'
}

& $psql -h 127.0.0.1 -p $Port -U postgres -d bb_miping -f (Join-Path $PSScriptRoot 'schema.sql')
Assert-NativeSuccess '创建数据表'
& $psql -h 127.0.0.1 -p $Port -U postgres -d bb_miping -f (Join-Path $PSScriptRoot 'seed.sql')
Assert-NativeSuccess '写入初始数据'

Write-Host "Database ready at 127.0.0.1:$Port / bb_miping"
Write-Host "App connection: postgresql://bb_miping_app:<password>@127.0.0.1:$Port/bb_miping"
