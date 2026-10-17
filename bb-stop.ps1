# 停止 BMPBGS（结束前后端进程并停止 PostgreSQL）
# 用法：powershell -ExecutionPolicy Bypass -File bb-stop.ps1
# 注意：本文件含中文注释，保存时必须带 UTF-8 BOM。
param(
  [string]$AppRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition),
  [switch]$Silent,
  [switch]$KeepPostgres,
  [string]$PgRoot = ''
)
$ErrorActionPreference = 'Continue'
. (Join-Path $AppRoot 'bb-common.ps1')

$config  = Get-BBConfig -AppRoot $AppRoot
$apiPort = if ($config -and $config.apiPort) { [int]$config.apiPort } else { 3100 }
$webPort = if ($config -and $config.webPort) { [int]$config.webPort } else { 5173 }
$pgPort  = if ($config -and $config.pgPort)  { [int]$config.pgPort }  else { 54328 }
$instanceId = Get-BBInstanceId -AppRoot $AppRoot -ConfiguredInstanceId $(if ($config -and $config.instanceId) { [string]$config.instanceId } else { '' })
$ownedPids = @{}

# 依据 pid 文件结束（精确结束本工具启动的进程）
# 注意：pid 文件里同时写着 pgPort/apiPort/webPort 等端口行，绝不能当 PID 处理。
# 历史上用 ^(\w+)=(\d+)$ 宽匹配，把 54328/3100/5173 当进程号 taskkill：
#   1) 这些"进程"不存在时 taskkill 返回 128，污染 $LASTEXITCODE，导致
#      bb-restore.ps1 的 Assert-BBNativeSuccess 误判"停止 Web/API 失败"，
#      恢复在第一步就被中止（2026-10-17 安装版实际踩坑）；
#   2) 若恰好有无关进程占用这些 PID，/T /F 会误杀整棵进程树。
# 因此这里只认进程键（backend/frontend），端口行一律跳过。
$pidFile = Join-Path (Get-BBRuntimeDir -AppRoot $AppRoot -InstanceId $instanceId) 'processes.pids'
if (Test-Path -LiteralPath $pidFile) {
  Get-Content -LiteralPath $pidFile | ForEach-Object {
    if ($_ -match '^(backend|frontend)=(\d+)$') {
      $role = $Matches[1]
      $pidv = [int]$Matches[2]
      if (Test-BBAppProcess -ProcessId $pidv -Role $role -AppRoot $AppRoot -WebPort $webPort) {
        & taskkill /PID $pidv /T /F 2>$null | Out-Null
        $ownedPids[$pidv] = $true
      } elseif (Get-Process -Id $pidv -ErrorAction SilentlyContinue) {
        Write-Warning "跳过 PID $pidv：无法确认它属于当前 BMPBGS $role 进程。"
      }
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

# 兜底：按监听端口结束（防止 pid 文件丢失时残留）
foreach ($port in @($apiPort, $webPort)) {
  # 只处理真正处于 Listen 的连接：进程退出后会残留 OwningProcess=0 的 TIME_WAIT 项，
  # 把它们当成"监听者"会刷出一串无法确认归属的告警（2026-10-17 实测）。
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $pidv = [int]$_.OwningProcess
    if ($pidv -le 0) { return }
    $role = if ($port -eq $apiPort) { 'backend' } else { 'frontend' }
    if (-not $ownedPids[$pidv] -and (Test-BBAppProcess -ProcessId $pidv -Role $role -AppRoot $AppRoot -WebPort $webPort)) {
      & taskkill /PID $pidv /T /F 2>$null | Out-Null
      $ownedPids[$pidv] = $true
    } elseif (-not $ownedPids[$pidv]) {
      Write-Warning "端口 $port 由 PID $pidv 监听，但无法确认它属于当前 BMPBGS，已拒绝强制结束。"
    }
  }
}

# taskkill 对"进程已不存在"返回 128，对停止操作而言这是预期结果；不清零会顺着
# $LASTEXITCODE 泄漏给调用方（bb-restore.ps1 的 Assert-BBNativeSuccess 等）。
$global:LASTEXITCODE = 0

# 恢复和一致性维护只停止 Web/API，数据库需继续提供本机恢复连接。
if (-not $KeepPostgres) {
  $configuredPgData = if ($config -and $config.pgData) { [string]$config.pgData } else { '' }
  if ($PgRoot) {
    if (-not $configuredPgData) { Write-Error '缺少 PostgreSQL 数据目录配置。'; exit 1 }
    $p = [PSCustomObject]@{ PgRoot = $PgRoot; PgData = $configuredPgData; PgPort = $pgPort }
  } else {
    $p = Resolve-BBPaths -AppRoot $AppRoot -PgPort $pgPort -ConfiguredPgData $configuredPgData
  }
  $pgCtl = Join-Path $p.PgRoot 'bin\pg_ctl.exe'
  if (Test-Path -LiteralPath $pgCtl) {
    & $pgCtl -D $p.PgData stop -m fast 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      & $pgCtl -D $p.PgData status 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { Write-Error 'PostgreSQL 停止失败。'; exit 1 }
    }
  }
}

Write-Host 'BB_TASK_OK=stopping'
Write-Host $(if ($KeepPostgres) { 'BMPBGS Web/API 已停止，PostgreSQL 保持运行。' } else { 'BMPBGS已停止。' })
if (-not $Silent) { Read-Host '按回车退出' }
