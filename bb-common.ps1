# BMPBGS - 公共函数（路径解析、配置读写、端口探测）
# 本文件被 bb-start.ps1 / bb-stop.ps1 / bb-backup.ps1 / bb-restore.ps1 通过点源 (. ) 引入。
# 注意：本文件含中文注释，保存时必须带 UTF-8 BOM，否则 PowerShell 会按 GBK 误读导致语法错误。

# 解析私有 Node.js 运行时：优先使用安装目录内的 node\node.exe（自包含），否则回退系统 PATH 中的 node。
function Resolve-BBNode {
  param([string]$AppRoot)
  $bundled = Join-Path $AppRoot 'node\node.exe'
  if (Test-Path -LiteralPath $bundled) { return $bundled }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "未找到 Node.js 运行时。请将 Node 二进制（node.exe 及其依赖）放入 $AppRoot\node\，或在系统 PATH 中安装 Node.js 18+。"
}

# 判断路径是否只含可打印 ASCII 字符。
function Test-BBAsciiPath {
  param([string]$Path)
  return ($Path -match '^[\x20-\x7E]+$')
}

# 解析 PostgreSQL 二进制目录。
# 关键坑（已在两台机器实测验证）：PG 在 Windows 上，二进制/share 目录路径若含中文，
# initdb 后续初始化会报"invalid byte sequence for encoding UTF8: 0xc3 0xdc"——
# GBK 中文路径字节被按 UTF-8 校验失败。因此路径含非 ASCII 时，
# 自动把 pgsql 复制到全 ASCII 的 C:\ProgramData\BBMiPing\pgsql 后使用（只复制一次）。
function Resolve-BBPgRoot {
  param([string]$AppRoot, [string]$DataRoot)

  $bundled  = Join-Path $AppRoot 'pgsql'
  $fallback = 'D:\BBMipingDB\PostgreSQL'

  if (-not (Test-Path -LiteralPath (Join-Path $bundled 'bin\pg_ctl.exe'))) {
    if (Test-Path -LiteralPath (Join-Path $fallback 'bin\pg_ctl.exe')) { return $fallback }
    return $bundled  # 找不到时返回首选路径，让调用方给出清晰报错
  }

  if (Test-BBAsciiPath $bundled) { return $bundled }

  $ascii = if ($DataRoot -and (Test-BBAsciiPath $DataRoot)) { Join-Path $DataRoot 'runtime\pgsql' } else { Join-Path $env:ProgramData 'BBMiPing\pgsql' }
  $asciiPgCtl = Join-Path $ascii 'bin\pg_ctl.exe'
  $marker = Join-Path $ascii '.bb-src-marker'
  $srcStamp = (Get-Item -LiteralPath (Join-Path $bundled 'bin\pg_ctl.exe')).LastWriteTimeUtc.Ticks
  $needCopy = $true
  if ((Test-Path -LiteralPath $asciiPgCtl) -and (Test-Path -LiteralPath $marker)) {
    $needCopy = ((Get-Content -LiteralPath $marker -Raw).Trim() -ne "$srcStamp")
  }
  if ($needCopy) {
    Write-Host "检测到安装路径包含中文/非英文字符，正在把 PostgreSQL 复制到 $ascii ..."
    robocopy $bundled $ascii /E /R:1 /W:1 /NFL /NDL /NJH /NJS /XD (Join-Path $bundled 'pgAdmin 4') | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "复制 PostgreSQL 到 $ascii 失败（robocopy 退出码 $LASTEXITCODE）" }
    Set-Content -LiteralPath $marker -Value "$srcStamp" -Encoding ascii
  }
  return $ascii
}

# 解析 PostgreSQL 安装目录与数据目录：二进制优先安装目录内的 pgsql\（自包含），否则回退。
# 新安装默认把数据库放到“实际安装目录\data\pgdata”，让数据跟随用户选择的安装盘。
# 升级时优先复用配置文件或历史版本中已初始化的数据目录，避免出现空库。
# PostgreSQL 数据目录必须是纯 ASCII 路径，中文路径会导致 initdb 报 UTF8 编码错误。
function Resolve-BBPaths {
  param(
    [string]$AppRoot,
    [int]$PgPort = 54328,
    [string]$ConfiguredPgData = ''
  )

  $dataRoot = Get-BBDataRoot -AppRoot $AppRoot
  $pgRoot = Resolve-BBPgRoot -AppRoot $AppRoot -DataRoot $dataRoot

  $installData  = Join-Path $AppRoot 'data\pgdata'
  $legacyBundledData = Join-Path $AppRoot 'pgdata'
  $fallbackData = 'D:\BBMipingDB\data'
  $legacyProgramData = Join-Path $env:ProgramData 'BBMiPing\pgdata'
  if (Test-Path -LiteralPath (Join-Path $AppRoot 'bb-data-path.txt')) { $pgData = Join-Path $dataRoot 'pgdata' }
  elseif ($ConfiguredPgData) { $pgData = [System.IO.Path]::GetFullPath($ConfiguredPgData) }
  elseif (Test-Path -LiteralPath (Join-Path $installData 'PG_VERSION')) { $pgData = $installData }
  elseif (Test-Path -LiteralPath (Join-Path $legacyBundledData 'PG_VERSION')) { $pgData = $legacyBundledData }
  elseif (Test-Path -LiteralPath (Join-Path $legacyProgramData 'PG_VERSION')) { $pgData = $legacyProgramData }
  # D:\BBMipingDB\data 仅用于兼容源码开发环境，安装包中没有 .git，不会误用开发库。
  elseif ((Test-Path -LiteralPath (Join-Path $AppRoot '.git')) -and (Test-Path -LiteralPath (Join-Path $fallbackData 'PG_VERSION'))) { $pgData = $fallbackData }
  else { $pgData = $installData }

  [PSCustomObject]@{
    AppRoot = $AppRoot
    PgRoot  = $pgRoot
    PgData  = $pgData
    DataRoot = $dataRoot
    PgPort  = $PgPort
  }
}

# 安装器写入的独立数据目录；旧版继续使用原有文件位置。
function Get-BBDataRoot {
  param([string]$AppRoot)
  $marker = Join-Path $AppRoot 'bb-data-path.txt'
  if (Test-Path -LiteralPath $marker) {
    $selected = (Get-Content -LiteralPath $marker -Raw -Encoding UTF8).Trim()
    if (-not (Test-BBAsciiPath $selected) -or -not [IO.Path]::IsPathRooted($selected)) { throw '数据存储位置必须是绝对英文路径。' }
    return [IO.Path]::GetFullPath($selected)
  }
  return $AppRoot
}

function Get-BBBackupRoot {
  param([string]$AppRoot)
  if (Test-Path -LiteralPath (Join-Path $AppRoot 'bb-data-path.txt')) { return Join-Path (Get-BBDataRoot $AppRoot) 'backups' }
  return Join-Path $AppRoot 'data\backups'
}

# 读取端口上正在运行的 PostgreSQL 实例的数据目录。
# 读不到则返回 $null（服务未运行 / 认证失败 / 权限不足），由调用方决定是中止还是仅告警。
function Get-BBTargetInstanceDataDir {
  param(
    [string]$Psql,
    [int]$PgPort,
    [string]$DbUser = 'postgres'
  )
  if (-not $Psql -or -not (Test-Path -LiteralPath $Psql)) { return $null }
  $actual = ''
  try {
    $actual = (& $Psql -h 127.0.0.1 -p $PgPort -U $DbUser -d postgres -tAc "SHOW data_directory" 2>$null |
               Select-Object -First 1)
  } catch { return $null }
  $actual = ([string]$actual).Trim()
  if (-not $actual) { return $null }
  return $actual
}

# 数据目录归一化比较：PG 返回正斜杠（D:/x/pgdata），配置里是反斜杠（D:\x\pgdata），
# 盘符大小写、尾部斜杠都要抹平后再比。
function Test-BBSamePath {
  param([string]$A, [string]$B)
  if (-not $A -or -not $B) { return $false }
  $norm = {
    param([string]$p)
    (($p -replace '\\', '/').Trim() -replace '/+$', '').ToLowerInvariant()
  }
  return ((& $norm $A) -eq (& $norm $B))
}

# 返回 bb-config.json 的绝对路径（端口与密钥的持久化文件，位于安装目录根）。
function Get-BBConfigPath {
  param([string]$AppRoot)
  return Join-Path $AppRoot 'bb-config.json'
}

# 读取配置；文件不存在或解析失败时返回 $null。
function Get-BBConfig {
  param([string]$AppRoot)
  $p = Get-BBConfigPath -AppRoot $AppRoot
  if (Test-Path -LiteralPath $p) {
    try { return (Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json) }
    catch { return $null }
  }
  return $null
}

# 写入配置（端口/密钥一旦确定即固定，避免重启后 JWT 令牌失效或数据库连接错乱）。
function Set-BBConfig {
  param([string]$AppRoot, $Config)
  $p = Get-BBConfigPath -AppRoot $AppRoot
  $Config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $p -Encoding UTF8
}

# 在 [Start, End] 范围内探测第一个未被监听的 TCP 端口。
function Get-FreePort {
  param([int]$Start = 54328, [int]$End = 55000)
  for ($port = $Start; $port -le $End; $port++) {
    $occupied = $false
    try {
      $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
      if ($conns) { $occupied = $true }
    } catch { }
    if (-not $occupied) { return $port }
  }
  throw "在 $Start-$End 范围内未找到空闲端口。"
}

# 从已初始化的 postgresql.conf 中读取实际监听端口（用于找回未记录配置时的真实端口）。
function Get-PGPortFromConf {
  param([string]$PgData)
  $conf = Join-Path $PgData 'postgresql.conf'
  if (-not (Test-Path -LiteralPath $conf)) { return $null }
  $m = Select-String -Path $conf -Pattern '^\s*port\s*=\s*(\d+)' | Select-Object -First 1
  if ($m) { return [int]$m.Matches.Groups[1].Value }
  return $null
}

# 原生命令在 Windows PowerShell 5.1 中即使退出码非零也不一定触发 catch，统一显式检查。
function Assert-BBNativeSuccess {
  param([string]$Step, [int]$ExitCode = $global:LASTEXITCODE)
  if ($ExitCode -ne 0) { throw "$Step 失败，退出码：$ExitCode" }
}

function Test-BBDirectoryEmpty {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  return -not (Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop | Select-Object -First 1)
}

function Get-BBDirectoryStats {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return [PSCustomObject]@{ Count = 0; Bytes = 0 } }
  $measure = Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum
  return [PSCustomObject]@{ Count = [int]$measure.Count; Bytes = [int64]($measure.Sum -as [int64]) }
}

function Invoke-BBRobocopy {
  param([string]$Source, [string]$Destination, [switch]$Mirror)
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  if (-not (Test-Path -LiteralPath $Source)) { return }
  $mode = if ($Mirror) { '/MIR' } else { '/E' }
  & robocopy $Source $Destination $mode /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  $code = $LASTEXITCODE
  if ($code -ge 8) { throw "复制目录失败：$Source -> $Destination（robocopy 退出码 $code）" }
  $global:LASTEXITCODE = 0
}

# 只初始化 PostgreSQL 集群，不创建业务数据库。恢复脚本可在 pgdata 被删除时安全复用。
function Initialize-BBPostgresCluster {
  param(
    [string]$PgRoot,
    [string]$PgData,
    [int]$PgPort,
    [string]$SuperUser = 'postgres',
    [string]$SuperuserPassword = 'BbMiping-Local-2026!'
  )
  if (Test-Path -LiteralPath (Join-Path $PgData 'PG_VERSION')) { return $false }
  if (-not (Test-BBDirectoryEmpty -Path $PgData)) {
    throw "数据库目录非空但缺少 PG_VERSION，可能存在损坏或残留数据，拒绝自动初始化：$PgData"
  }
  $initdb = Join-Path $PgRoot 'bin\initdb.exe'
  if (-not (Test-Path -LiteralPath $initdb)) { throw "未找到 initdb：$initdb" }
  New-Item -ItemType Directory -Path $PgData -Force | Out-Null
  $passwordFile = Join-Path ([IO.Path]::GetTempPath()) ('bb-miping-pg-password-' + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    [IO.File]::WriteAllText($passwordFile, $SuperuserPassword, [Text.UTF8Encoding]::new($false))
    & $initdb -D $PgData -U $SuperUser -A scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale-provider=libc --locale=C
    Assert-BBNativeSuccess '初始化 PostgreSQL 数据目录'
    Add-Content -LiteralPath (Join-Path $PgData 'postgresql.conf') -Value "`nport = $PgPort`nlisten_addresses = '127.0.0.1'`n"
  } finally {
    Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
  }
  return $true
}

function Start-BBPostgres {
  param(
    $Paths,
    [string]$SuperUser = 'postgres',
    [string]$PgPassword = 'BbMiping-Local-2026!',
    [switch]$AllowInitialize
  )
  $pgCtl = Join-Path $Paths.PgRoot 'bin\pg_ctl.exe'
  $psql = Join-Path $Paths.PgRoot 'bin\psql.exe'
  if (-not (Test-Path -LiteralPath $pgCtl)) { throw "未找到 pg_ctl：$pgCtl" }
  $initialized = $false
  if (-not (Test-Path -LiteralPath (Join-Path $Paths.PgData 'PG_VERSION'))) {
    if (-not $AllowInitialize) { throw "数据库目录尚未初始化：$($Paths.PgData)" }
    $initialized = Initialize-BBPostgresCluster -PgRoot $Paths.PgRoot -PgData $Paths.PgData -PgPort $Paths.PgPort -SuperUser $SuperUser -SuperuserPassword $PgPassword
  }
  $env:PGPASSWORD = $PgPassword
  try {
    $existing = Get-BBTargetInstanceDataDir -Psql $psql -PgPort $Paths.PgPort -DbUser $SuperUser
    if ($existing -and -not (Test-BBSamePath $existing $Paths.PgData)) {
      throw "端口 $($Paths.PgPort) 已被其他 PostgreSQL 实例占用。期望：$($Paths.PgData)；实际：$existing"
    }
    if (-not $existing) {
      & $pgCtl -D $Paths.PgData status 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) {
        & $pgCtl -D $Paths.PgData -l (Join-Path $Paths.PgData 'postgresql.log') start
        Assert-BBNativeSuccess '启动 PostgreSQL'
      }
    }
    for ($i = 0; $i -lt 30; $i++) {
      $actual = Get-BBTargetInstanceDataDir -Psql $psql -PgPort $Paths.PgPort -DbUser $SuperUser
      if ($actual) {
        if (-not (Test-BBSamePath $actual $Paths.PgData)) {
          throw "端口 $($Paths.PgPort) 上的 PostgreSQL 实例身份不符。期望：$($Paths.PgData)；实际：$actual"
        }
        return [PSCustomObject]@{ Initialized = [bool]$initialized; DataDirectory = $actual }
      }
      Start-Sleep -Seconds 1
    }
    throw "PostgreSQL 启动超时：端口 $($Paths.PgPort) 未能通过实例身份校验"
  } finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  }
}

function Ensure-BBAppRole {
  param(
    $Paths,
    [string]$SuperUser = 'postgres',
    [string]$PgPassword = 'BbMiping-Local-2026!',
    [string]$AppUser = 'bb_miping_app',
    [string]$AppPassword = 'BbMiping-App-2026!'
  )
  $psql = Join-Path $Paths.PgRoot 'bin\psql.exe'
  $env:PGPASSWORD = $PgPassword
  try {
    $exists = (& $psql -h 127.0.0.1 -p $Paths.PgPort -U $SuperUser -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$AppUser'" 2>$null | Select-Object -First 1)
    Assert-BBNativeSuccess '检查应用数据库角色'
    if (([string]$exists).Trim() -ne '1') {
      $safePassword = $AppPassword.Replace("'", "''")
      & $psql -h 127.0.0.1 -p $Paths.PgPort -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE $AppUser LOGIN PASSWORD '$safePassword'"
      Assert-BBNativeSuccess '创建应用数据库角色'
    }
  } finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  }
}
