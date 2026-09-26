param(
  [string]$PostgresRoot = 'D:\BBMipingDB\PostgreSQL',
  [string]$DataDir = 'D:\BBMipingDB\data'
)

$pgCtl = Join-Path $PostgresRoot 'bin\pg_ctl.exe'
& $pgCtl -D $DataDir -l (Join-Path $DataDir 'postgresql.log') start

