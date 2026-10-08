$ErrorActionPreference = 'Stop'

$pgCtl = 'D:\BBMipingDB\PostgreSQL\bin\pg_ctl.exe'
$dataDir = 'D:\BBMipingDB\data'
& $pgCtl -D $dataDir status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  & $pgCtl -D $dataDir -l (Join-Path $dataDir 'postgresql.log') start
}

npm run dev

