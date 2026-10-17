# 显示源码开发实例的端口和数据库身份。
param([string]$ProjectRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition))
$ErrorActionPreference = 'Stop'
. (Join-Path $ProjectRoot 'bb-common.ps1')
$config = Get-BBConfig -AppRoot $ProjectRoot
if (-not $config) { Write-Host '开发配置尚未生成，请先执行 npm run dev。'; exit 1 }
$paths = [PSCustomObject]@{ PgRoot = 'D:\BBMipingDB\PostgreSQL'; PgData = [string]$config.pgData; PgPort = [int]$config.pgPort }
$psql = Join-Path $paths.PgRoot 'bin\psql.exe'
$env:PGPASSWORD = 'BbMiping-Local-2026!'
try { $actualDir = Get-BBTargetInstanceDataDir -Psql $psql -PgPort ([int]$config.pgPort) } finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
function Test-DevPort([int]$Port) {
  $client = New-Object Net.Sockets.TcpClient
  try { $wait = $client.BeginConnect('127.0.0.1', $Port, $null, $null); return ($wait.AsyncWaitHandle.WaitOne(400) -and $client.Connected) } catch { return $false } finally { $client.Close() }
}
[PSCustomObject]@{
  InstanceId = [string]$config.instanceId
  PgPort = [int]$config.pgPort
  PgReady = (Test-DevPort ([int]$config.pgPort))
  PgDataExpected = [string]$config.pgData
  PgDataActual = $actualDir
  ApiPort = [int]$config.apiPort
  ApiReady = (Test-DevPort ([int]$config.apiPort))
  WebPort = [int]$config.webPort
  WebReady = (Test-DevPort ([int]$config.webPort))
} | Format-List
