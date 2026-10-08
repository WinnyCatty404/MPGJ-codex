param(
  [string]$PostgresRoot = 'D:\BBMipingDB\PostgreSQL',
  [string]$DataDir = 'D:\BBMipingDB\data'
)

$pgCtl = Join-Path $PostgresRoot 'bin\pg_ctl.exe'
& $pgCtl -D $DataDir stop -m fast

