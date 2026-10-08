# 启动 BMPBGS（后台运行，自带 Node 与 PostgreSQL，无需系统安装）
# 用法：powershell -ExecutionPolicy Bypass -File bb-start.ps1
# 行为：解析私有 Node/PG -> 端口避让并持久化 -> 首次自动初始化数据库 ->
#       后台启动后端与前端静态服务器 -> 健康检查 -> 打开浏览器。
# 注意：本文件含中文注释，保存时必须带 UTF-8 BOM。
param(
  [string]$AppRoot = (Split-Path -Parent $MyInvocation.MyCommand.Definition),
  [switch]$Silent
)
$ErrorActionPreference = 'Continue'
. (Join-Path $AppRoot 'bb-common.ps1')

# ---- 日志：同时输出到屏幕与日志文件，方便远程排查 ----
$logDir   = Join-Path $env:TEMP 'bb-miping-logs'
$startLog = Join-Path $logDir 'start.log'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
function Write-BBLog([string]$Msg, [string]$Level = 'INFO') {
  $line = "$(Get-Date -Format 'HH:mm:ss') [$Level] $Msg"
  Write-Host $line
  try { Add-Content -LiteralPath $startLog -Value $line -Encoding UTF8 } catch { }
}
try { "===== 启动 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') AppRoot=$AppRoot =====" | Out-File -LiteralPath $startLog -Encoding UTF8 } catch { }

Write-BBLog '开始启动 BMPBGS...'

# 1) 解析私有 Node
try {
  $nodeExe = Resolve-BBNode -AppRoot $AppRoot
  Write-BBLog "Node 运行时：$nodeExe"
} catch {
  Write-BBLog "$($_.Exception.Message)" 'ERROR'; if (-not $Silent) { Read-Host '按回车退出' }; exit 1
}

# 2) 端口、密钥和数据库目录（持久化到 bb-config.json）
try {
  $config = Get-BBConfig -AppRoot $AppRoot
  if ($config -and $config.pgPort) {
    $pgPort = [int]$config.pgPort
  } elseif (Test-Path -LiteralPath (Join-Path $AppRoot 'data\pgdata\PG_VERSION')) {
    $pgPort = Get-PGPortFromConf -PgData (Join-Path $AppRoot 'data\pgdata')
    if (-not $pgPort) { $pgPort = 54328 }
  } elseif (Test-Path -LiteralPath (Join-Path $AppRoot 'pgdata\PG_VERSION')) {
    $pgPort = Get-PGPortFromConf -PgData (Join-Path $AppRoot 'pgdata')
    if (-not $pgPort) { $pgPort = 54328 }
  } else {
    $pgPort = Get-FreePort -Start 54328 -End 55000
  }
  $apiPort   = if ($config -and $config.apiPort)   { [int]$config.apiPort }   else { Get-FreePort -Start 3100 -End 3200 }
  $webPort   = if ($config -and $config.webPort)   { [int]$config.webPort }   else { Get-FreePort -Start 5173 -End 5300 }
  $jwtSecret = if ($config -and $config.jwtSecret) { $config.jwtSecret } else { ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')) }
  $configuredPgData = if ($config -and $config.pgData) { [string]$config.pgData } else { '' }
  $p = Resolve-BBPaths -AppRoot $AppRoot -PgPort $pgPort -ConfiguredPgData $configuredPgData
  if (-not (Test-BBAsciiPath $p.PgData)) {
    throw "数据库目录包含中文或非英文字符：$($p.PgData)。请把 BMPBGS 安装到纯英文路径（例如 D:\BMPBGS）后再启动。"
  }
  Set-BBConfig -AppRoot $AppRoot -Config ([PSCustomObject]@{
    pgPort = $pgPort; apiPort = $apiPort; webPort = $webPort; jwtSecret = $jwtSecret; pgData = $p.PgData
  })
  Write-BBLog "端口：PostgreSQL=$pgPort  后端=$apiPort  前端=$webPort"
  Write-BBLog "数据库目录：$($p.PgData)"
} catch {
  Write-BBLog "端口/配置初始化失败：$($_.Exception.Message)" 'ERROR'; if (-not $Silent) { Read-Host '按回车退出' }; exit 1
}

$pgCtl = Join-Path $p.PgRoot 'bin\pg_ctl.exe'
if (-not (Test-Path -LiteralPath $pgCtl)) {
  Write-BBLog "未找到 PostgreSQL(pg_ctl)：$pgCtl。请将 PostgreSQL 二进制（bin/lib/share）放入 $($p.AppRoot)\pgsql\" 'ERROR'
  if (-not $Silent) { Read-Host '按回车退出' }; exit 1
}

# 3) 首次启动：初始化数据库
if (-not (Test-Path -LiteralPath (Join-Path $p.PgData 'PG_VERSION'))) {
  Write-BBLog '首次启动：正在初始化数据库（首次约需 1-2 分钟）...'
  try {
    & (Join-Path $AppRoot 'database\setup.ps1') -PostgresRoot $p.PgRoot -DataDir $p.PgData -Port $p.PgPort
    if ($LASTEXITCODE -ne 0) { throw "setup.ps1 退出码 $LASTEXITCODE" }
    Write-BBLog '数据库初始化完成'
  } catch {
    Write-BBLog "数据库初始化失败：$($_.Exception.Message)" 'ERROR'
    Write-BBLog "请查看：$(Join-Path $p.PgData 'postgresql.log')" 'ERROR'
    if (-not $Silent) { Read-Host '按回车退出' }; exit 1
  }
}

# 4) 启动 PostgreSQL 并等待其真正接受连接
Write-BBLog '启动 PostgreSQL...'
try {
  & $pgCtl -D $p.PgData status 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    & $pgCtl -D $p.PgData -l (Join-Path $p.PgData 'postgresql.log') start
  }
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if (Get-NetTCPConnection -LocalPort $p.PgPort -ErrorAction SilentlyContinue) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    Write-BBLog "PostgreSQL 启动超时（端口 $($p.PgPort) 未监听）。日志：$(Join-Path $p.PgData 'postgresql.log')" 'ERROR'
    if (-not $Silent) { Read-Host '按回车退出' }; exit 1
  }
  Write-BBLog 'PostgreSQL 已就绪'
} catch {
  Write-BBLog "PostgreSQL 启动异常：$($_.Exception.Message)" 'ERROR'
  if (-not $Silent) { Read-Host '按回车退出' }; exit 1
}

# 4.5) 自愈：历史版本初始化时中文行曾被跳过导致初始数据缺失（users 空表 -> 登录失败）。
# 每次启动检查初始账号是否齐全，缺失则用 UTF-8 编码补种 seed.sql（幂等，ON CONFLICT DO NOTHING）。
try {
  $psqlExe = Join-Path $p.PgRoot 'bin\psql.exe'
  if (Test-Path -LiteralPath $psqlExe) {
    $env:PGPASSWORD = 'BbMiping-Local-2026!'
    $env:PGCLIENTENCODING = 'UTF8'
    $cntRaw = & $psqlExe -h 127.0.0.1 -p $p.PgPort -U postgres -d bb_miping -tAc "SELECT count(*) FROM users" 2>$null
    $cnt = "$cntRaw".Trim()
    if ($LASTEXITCODE -eq 0 -and $cnt -match '^\d+$' -and [int]$cnt -lt 3) {
      Write-BBLog "检测到初始数据不完整（users=$cnt），正在补种初始数据..."
      & $psqlExe -h 127.0.0.1 -p $p.PgPort -U postgres -d bb_miping -f (Join-Path $AppRoot 'database\seed.sql') 2>&1 | Out-Null
      $cnt2 = & $psqlExe -h 127.0.0.1 -p $p.PgPort -U postgres -d bb_miping -tAc "SELECT count(*) FROM users" 2>$null
      Write-BBLog "补种完成，users=$("$cnt2".Trim())"
    }
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  }
} catch {
  Write-BBLog "初始数据检查/补种异常（不影响启动）：$($_.Exception.Message)" 'WARN'
}

# 5) 注入环境变量并后台启动后端与前端（使用私有 Node，不修改系统 PATH）
$env:PORT = "$apiPort"
$env:JWT_SECRET = $jwtSecret
$env:DATABASE_URL = "postgresql://bb_miping_app:BbMiping-App-2026!@127.0.0.1:$pgPort/bb_miping"

$pidFile     = Join-Path $env:TEMP 'bb-miping.pids'
# 注意：Windows PowerShell 5.1 不允许 RedirectStandardOutput 与 RedirectStandardError
# 指向同一个文件（PS7 才支持），必须分开，否则 Start-Process 直接报错。
$backendLog  = Join-Path $logDir 'backend.out.log'
$backendErr  = Join-Path $logDir 'backend.err.log'
$frontendLog = Join-Path $logDir 'frontend.out.log'
$frontendErr = Join-Path $logDir 'frontend.err.log'

Write-BBLog '启动后端服务...'
try {
  $backendProc = Start-Process -FilePath $nodeExe -ArgumentList 'dist/server.js' `
    -WorkingDirectory (Join-Path $AppRoot 'backend') `
    -RedirectStandardOutput $backendLog -RedirectStandardError $backendErr `
    -NoNewWindow -PassThru -ErrorAction Stop
  Write-BBLog "后端已启动，PID=$($backendProc.Id)"
} catch {
  Write-BBLog "后端启动失败：$($_.Exception.Message)" 'ERROR'
  Write-BBLog "可查看 $backendErr 进一步定位" 'ERROR'
  if (-not $Silent) { Read-Host '按回车退出' }; exit 1
}

Start-Sleep -Seconds 1
Write-BBLog '启动前端静态服务...'
try {
  $frontendProc = Start-Process -FilePath $nodeExe -ArgumentList "bb-serve-frontend.js --dist frontend/dist --port $webPort --api http://127.0.0.1:$apiPort" `
    -WorkingDirectory $AppRoot `
    -RedirectStandardOutput $frontendLog -RedirectStandardError $frontendErr `
    -NoNewWindow -PassThru -ErrorAction Stop
  Write-BBLog "前端已启动，PID=$($frontendProc.Id)"
} catch {
  Write-BBLog "前端启动失败：$($_.Exception.Message)" 'ERROR'
  if (-not $Silent) { Read-Host '按回车退出' }; exit 1
}

@"
backend=$($backendProc.Id)
frontend=$($frontendProc.Id)
pgPort=$pgPort
apiPort=$apiPort
webPort=$webPort
"@ | Set-Content -LiteralPath $pidFile -Encoding UTF8

# 6) 健康检查：确认端口真的在监听
function Test-BBPort([int]$Port, [int]$Seconds = 25) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    try {
      $c = New-Object System.Net.Sockets.TcpClient
      $r = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
      if ($r.AsyncWaitHandle.WaitOne(1000)) { $c.EndConnect($r); $c.Close(); return $true }
      $c.Close()
    } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}
$apiOk = Test-BBPort -Port $apiPort
$webOk = Test-BBPort -Port $webPort
Write-BBLog "健康检查：后端=$apiOk  前端=$webOk"

if (-not $apiOk) {
  Write-BBLog "后端未监听端口 $apiPort，最近后端日志：" 'ERROR'
  foreach ($lf in @($backendLog, $backendErr)) {
    if (Test-Path -LiteralPath $lf) {
      Get-Content -LiteralPath $lf -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-BBLog "  | $_" 'ERROR' }
    }
  }
} elseif (-not $webOk) {
  Write-BBLog "前端未监听端口 $webPort，最近前端日志：" 'ERROR'
  foreach ($lf in @($frontendLog, $frontendErr)) {
    if (Test-Path -LiteralPath $lf) {
      Get-Content -LiteralPath $lf -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-BBLog "  | $_" 'ERROR' }
    }
  }
}

# 7) 打开浏览器（多种方式回退，失败会明确提示）
$url = "http://localhost:$webPort"
Write-BBLog "准备打开浏览器：$url"
if ($apiOk -and $webOk) {
  $opened = $false
  try { Start-Process -FilePath $url -ErrorAction Stop; $opened = $true } catch { }
  if (-not $opened) {
    try { & cmd.exe /c start "" "$url"; $opened = $true; Write-BBLog '已用备用方式打开浏览器' } catch { }
  }
  if (-not $opened) { Write-BBLog "无法自动打开浏览器，请手动访问：$url" 'WARN' }
} else {
  Write-BBLog "服务未就绪，暂不自动打开浏览器。请手动访问：$url" 'WARN'
}

# 8) 摘要
Write-Host ''
Write-Host '================================================'
Write-Host '   BMPBGS启动完成（服务在后台持续运行）'
Write-Host "   浏览器地址： $url"
Write-Host "   后端 API  ： http://localhost:$apiPort"
Write-Host "   日志目录  ： $logDir"
Write-Host '   停止请使用快捷方式"停止BMPBGS"'
Write-Host '================================================'
Write-Host ''

if (-not $Silent) { Read-Host '按回车关闭本窗口（工具继续在后台运行）' }
