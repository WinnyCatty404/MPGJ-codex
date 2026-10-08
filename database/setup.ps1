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
  # 用无 BOM 的 UTF-8 写密码文件，避免 PS5.1 的 Set-Content -Encoding utf8 把 BOM 混进密码
  [System.IO.File]::WriteAllText($passwordFile, $SuperuserPassword, [System.Text.UTF8Encoding]::new($false))
  # 注意：不要用 --locale-provider=icu --icu-locale=zh-CN。
  # PG 16+ 在 initdb 后续初始化会导入 ICU 系统排序规则，ICU 按系统显示语言返回
  # GBK 编码的中文显示名，被按 UTF-8 校验导致"无效的 UTF8 编码字节顺序: 0xc3 0xdc"。
  # 应用层只按时间/数字/枚举排序，不依赖中文排序规则，故用 libc + C 最稳妥。
  & $initdb -D $DataDir -U postgres -A scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale-provider=libc --locale=C
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
# 关键：schema.sql/seed.sql 均为 UTF-8 保存，但中文 Windows 上 psql 默认按 GBK(系统区域)读文件，
# 含中文的 COMMENT/INSERT 会报 "encoding GBK has no equivalent in encoding UTF8" 并被跳过
#（会导致默认账号等初始数据缺失）。强制 psql 以 UTF-8 解读文件内容。
$env:PGCLIENTENCODING = 'UTF8'

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
