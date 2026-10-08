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
  param([string]$AppRoot)

  $bundled  = Join-Path $AppRoot 'pgsql'
  $fallback = 'D:\BBMipingDB\PostgreSQL'

  if (-not (Test-Path -LiteralPath (Join-Path $bundled 'bin\pg_ctl.exe'))) {
    if (Test-Path -LiteralPath (Join-Path $fallback 'bin\pg_ctl.exe')) { return $fallback }
    return $bundled  # 找不到时返回首选路径，让调用方给出清晰报错
  }

  if (Test-BBAsciiPath $bundled) { return $bundled }

  $ascii = Join-Path $env:ProgramData 'BBMiPing\pgsql'
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

  $pgRoot = Resolve-BBPgRoot -AppRoot $AppRoot

  $installData  = Join-Path $AppRoot 'data\pgdata'
  $legacyBundledData = Join-Path $AppRoot 'pgdata'
  $fallbackData = 'D:\BBMipingDB\data'
  $legacyProgramData = Join-Path $env:ProgramData 'BBMiPing\pgdata'
  if ($ConfiguredPgData) { $pgData = [System.IO.Path]::GetFullPath($ConfiguredPgData) }
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
    DataRoot = Split-Path -Parent $pgData
    PgPort  = $PgPort
  }
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
