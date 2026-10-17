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
    # 先收集全部输出再取第一行：native 命令直接 "| Select-Object -First 1" 时，
    # PowerShell 收到第一行即停止上游管道，把尚未退出的进程杀掉，$LASTEXITCODE
    # 被污染为 -1（.NET Kill 退出码）；本函数不检查退出码所以长期无症状，
    # 但污染值会残留给调用方（恢复脚本 Ensure-BBAppRole 随后断言退出码即误炸）。
    $lines = @(& $Psql -h 127.0.0.1 -p $PgPort -U $DbUser -d postgres -tAc "SHOW data_directory" 2>$null)
    $actual = if ($lines.Count -gt 0) { $lines[0] } else { $null }
  } catch { return $null }
  $actualText = [string]$actual
  if ([string]::IsNullOrWhiteSpace($actualText)) { return $null }
  return $actualText.Trim()
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
  # 启动、备份和控制台分别维护不同配置段，写入时保留调用方未显式提供的字段。
  $merged = [ordered]@{}
  $existing = Get-BBConfig -AppRoot $AppRoot
  if ($existing) {
    foreach ($property in $existing.PSObject.Properties) { $merged[$property.Name] = $property.Value }
  }
  foreach ($property in $Config.PSObject.Properties) { $merged[$property.Name] = $property.Value }
  ([PSCustomObject]$merged) | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $p -Encoding UTF8
}

# 为每个安装/源码目录生成稳定实例标识，避免 PID 与日志在同一台机器上互相覆盖。
function Get-BBInstanceId {
  param([string]$AppRoot, [string]$ConfiguredInstanceId = '')
  if ($ConfiguredInstanceId -and $ConfiguredInstanceId -match '^[A-Za-z0-9_-]{1,64}$') { return $ConfiguredInstanceId }
  $fullPath = [IO.Path]::GetFullPath($AppRoot).TrimEnd('\').ToLowerInvariant()
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fullPath)))).Replace('-', '').Substring(0, 8).ToLowerInvariant()
  } finally { $sha.Dispose() }
  $kind = if (Test-Path -LiteralPath (Join-Path $AppRoot '.git')) { 'source-dev' } else { 'installed' }
  return "$kind-$hash"
}

function Get-BBRuntimeDir {
  param([string]$AppRoot, [string]$InstanceId = '')
  $resolvedId = Get-BBInstanceId -AppRoot $AppRoot -ConfiguredInstanceId $InstanceId
  return Join-Path (Join-Path $env:TEMP 'bb-miping') $resolvedId
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

function Test-BBPortListening {
  param([int]$Port)
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Wait-BBPortsReleased {
  param([int[]]$Ports, [int]$TimeoutSeconds = 5)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $leftover = @($Ports | ForEach-Object {
      Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue
    } | Select-Object -First 1)
    if ($leftover.Count -eq 0) { return $null }
    if ((Get-Date) -ge $deadline) { return $leftover[0] }
    Start-Sleep -Milliseconds 250
  } while ($true)
}

# 防止 PID 文件过期或端口被其他程序占用时误杀无关进程。
function Test-BBAppProcess {
  param(
    [int]$ProcessId,
    [ValidateSet('backend', 'frontend')][string]$Role,
    [string]$AppRoot,
    [int]$WebPort
  )
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    if (-not $process) { return $false }
    $expectedNode = Resolve-BBNode -AppRoot $AppRoot
    if (-not (Test-BBSamePath ([string]$process.ExecutablePath) $expectedNode)) { return $false }
    $commandLine = [string]$process.CommandLine
    if ($Role -eq 'backend') { return ($commandLine -match '(?i)dist[\\/]server\.js(?:\s|"|$)') }
    return ($commandLine -match '(?i)bb-serve-frontend\.js' -and $commandLine -match "(?i)--port\s+`"?$WebPort(?:\s|`"|$)")
  } catch { return $false }
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

# 对目录内容生成稳定指纹：同时覆盖相对路径、文件长度和每个文件的 SHA256。
function Get-BBDirectoryFingerprint {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    return [PSCustomObject]@{ Count = 0; Bytes = 0L; Sha256 = ''; Exists = $false }
  }
  $root = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction Stop | Sort-Object FullName)
  $lines = New-Object 'System.Collections.Generic.List[string]'
  [int64]$bytes = 0
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($root.Length).TrimStart('\').Replace('\', '/')
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $bytes += [int64]$file.Length
    $lines.Add("$relative`t$($file.Length)`t$hash")
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $payload = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
    $treeHash = ([BitConverter]::ToString($sha.ComputeHash($payload))).Replace('-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
  return [PSCustomObject]@{ Count = $files.Count; Bytes = $bytes; Sha256 = $treeHash; Exists = $true }
}

function Test-BBUncPath {
  param([string]$Path)
  return [bool]($Path -and $Path.Trim() -match '^\\\\[^\\]+\\[^\\]+(?:\\.*)?$')
}

# 统一读取备份集状态；Deep 模式用于上传/恢复前的完整校验。
function Get-BBBackupSetInfo {
  param([string]$Path, [string]$DbName = 'bb_miping', [switch]$Deep)
  $result = [ordered]@{
    Path = $Path; Name = ''; Valid = $false; Error = ''; Legacy = $false
    CreatedAt = $null; DumpFile = $null; DumpBytes = 0L; DumpSha256 = ''
    StorageFiles = 0; StorageBytes = 0L; StorageSha256 = ''
    UploadFiles = 0; UploadBytes = 0L; UploadSha256 = ''
  }
  try {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "备份集不存在：$Path" }
    $item = Get-Item -LiteralPath $Path
    $result.Name = $item.Name
    $result.CreatedAt = $item.LastWriteTime
    $manifestPath = Join-Path $Path 'backup-manifest.json'
    $manifest = $null
    if (Test-Path -LiteralPath $manifestPath) {
      $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($manifest.createdAt) { $result.CreatedAt = [datetime]$manifest.createdAt }
      if (-not $manifest.database.dumpFile) { throw '备份清单缺少 dump 文件名' }
      $dumpPath = Join-Path $Path ([string]$manifest.database.dumpFile)
    } else {
      $result.Legacy = $true
      $legacyDump = Get-ChildItem -LiteralPath $Path -Filter "$DbName-*.dump" -File -ErrorAction SilentlyContinue | Select-Object -First 1
      $dumpPath = if ($legacyDump) { $legacyDump.FullName } else { '' }
    }
    if (-not $dumpPath -or -not (Test-Path -LiteralPath $dumpPath -PathType Leaf)) { throw '缺少数据库 dump 文件' }
    $dump = Get-Item -LiteralPath $dumpPath
    $result.DumpFile = $dump.FullName
    $result.DumpBytes = [int64]$dump.Length
    if ($manifest -and $manifest.database.bytes -ne $null -and [int64]$manifest.database.bytes -ne $result.DumpBytes) { throw 'dump 文件大小与清单不一致' }

    $storagePath = Join-Path $Path 'storage'
    $uploadPath = Join-Path $Path 'uploads'
    if ($manifest -and (-not (Test-Path -LiteralPath $storagePath -PathType Container) -or -not (Test-Path -LiteralPath $uploadPath -PathType Container))) {
      throw '备份集缺少 storage 或 uploads 目录'
    }
    if ($manifest -and -not $Deep) {
      $storageStats = [PSCustomObject]@{ Count = [int]$manifest.storage.files; Bytes = [int64]$manifest.storage.bytes; Sha256 = [string]$manifest.storage.sha256 }
      $uploadStats = [PSCustomObject]@{ Count = [int]$manifest.uploads.files; Bytes = [int64]$manifest.uploads.bytes; Sha256 = [string]$manifest.uploads.sha256 }
    } else {
      $storageStats = Get-BBDirectoryFingerprint $storagePath
      $uploadStats = Get-BBDirectoryFingerprint $uploadPath
    }
    $result.StorageFiles = $storageStats.Count; $result.StorageBytes = $storageStats.Bytes
    $result.UploadFiles = $uploadStats.Count; $result.UploadBytes = $uploadStats.Bytes
    $result.StorageSha256 = [string]$storageStats.Sha256; $result.UploadSha256 = [string]$uploadStats.Sha256
    if ($Deep -and $manifest) {
      if ($manifest.database.sha256) {
        $result.DumpSha256 = (Get-FileHash -LiteralPath $dump.FullName -Algorithm SHA256).Hash
        if ($result.DumpSha256 -ne [string]$manifest.database.sha256) { throw 'dump 文件校验值与清单不一致' }
      }
      if ($manifest.storage) {
        if ([int]$manifest.storage.files -ne $result.StorageFiles -or [int64]$manifest.storage.bytes -ne $result.StorageBytes) { throw 'storage 文件统计与清单不一致' }
        if ($manifest.storage.sha256 -and [string]$manifest.storage.sha256 -ne $result.StorageSha256) { throw 'storage 文件校验值与清单不一致' }
      }
      if ($manifest.uploads) {
        if ([int]$manifest.uploads.files -ne $result.UploadFiles -or [int64]$manifest.uploads.bytes -ne $result.UploadBytes) { throw 'uploads 文件统计与清单不一致' }
        if ($manifest.uploads.sha256 -and [string]$manifest.uploads.sha256 -ne $result.UploadSha256) { throw 'uploads 文件校验值与清单不一致' }
      }
    }
    $result.Valid = $true
  } catch { $result.Error = $_.Exception.Message }
  return [PSCustomObject]$result
}

function Copy-BBBackupSetAtomic {
  param([string]$Source, [string]$DestinationRoot)
  $sourceInfo = Get-BBBackupSetInfo -Path $Source -Deep
  if (-not $sourceInfo.Valid) { throw "本地备份集校验失败：$($sourceInfo.Error)" }
  New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
  $setName = (Get-Item -LiteralPath $Source).Name
  $finalPath = Join-Path $DestinationRoot $setName
  if (Test-Path -LiteralPath $finalPath) {
    $existingInfo = Get-BBBackupSetInfo -Path $finalPath -Deep
    if ($existingInfo.Valid -and $existingInfo.DumpBytes -eq $sourceInfo.DumpBytes -and $existingInfo.DumpSha256 -eq $sourceInfo.DumpSha256) {
      return [PSCustomObject]@{ Path = $finalPath; AlreadyExists = $true }
    }
    throw "远程目录已存在同名但内容不一致的备份集：$finalPath"
  }
  $pending = Join-Path $DestinationRoot ('.pending-' + $setName + '-' + [guid]::NewGuid().ToString('N'))
  try {
    Invoke-BBRobocopy -Source $Source -Destination $pending -Mirror
    $remoteInfo = Get-BBBackupSetInfo -Path $pending -Deep
    if (-not $remoteInfo.Valid) { throw "远程备份集校验失败：$($remoteInfo.Error)" }
    if ($remoteInfo.DumpBytes -ne $sourceInfo.DumpBytes -or $remoteInfo.DumpSha256 -ne $sourceInfo.DumpSha256) { throw '远程 dump 与本地备份不一致' }
    [IO.Directory]::Move($pending, $finalPath)
    return [PSCustomObject]@{ Path = $finalPath; AlreadyExists = $false }
  } catch {
    Remove-Item -LiteralPath $pending -Recurse -Force -ErrorAction SilentlyContinue
    throw
  }
}

function Invoke-BBRobocopy {
  param([string]$Source, [string]$Destination, [switch]$Mirror)
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  if (-not (Test-Path -LiteralPath $Source)) { return }
  $mode = if ($Mirror) { '/MIR' } else { '/E' }
  $copyOutput = @(& robocopy $Source $Destination $mode /R:1 /W:1 /NFL /NDL /NJH /NJS)
  $code = $LASTEXITCODE
  if ($code -ge 8) {
    $detail = (($copyOutput | Where-Object { $_ } | Select-Object -Last 5) -join ' ').Trim()
    throw "复制目录失败：$Source -> $Destination（robocopy 退出码 $code）$(if ($detail) { '：' + $detail } else { '' })"
  }
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
  # 保存调用方已有的 PGPASSWORD 并在结束时还原（而非直接删除）：bb-restore.ps1 在
  # 脚本级设置该变量，后续恢复/回退 SQL 仍依赖它；此前直接 Remove-Item 会让调用方
  # 后续的 psql 因无密码进入交互式等待，在控制台隐藏窗口中永久挂起（2026-10-17
  # 恢复卡死、控制台无法关闭的事故根因之一）。
  $callerPgPassword = $env:PGPASSWORD
  $env:PGPASSWORD = $PgPassword
  try {
    $existing = Get-BBTargetInstanceDataDir -Psql $psql -PgPort $Paths.PgPort -DbUser $SuperUser
    if ($existing -and -not (Test-BBSamePath $existing $Paths.PgData)) {
      throw "端口 $($Paths.PgPort) 已被其他 PostgreSQL 实例占用。期望：$($Paths.PgData)；实际：$existing"
    }
    if (-not $existing) {
      & $pgCtl -D $Paths.PgData status 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) {
        # 命令行端口优先于历史 postgresql.conf，使同机的开发版和安装版可固定使用不同端口。
        # 启动日志放在数据目录外，避免异常关机恢复时 fsync 与日志写入互相占用。
        $pgLogDir = Get-BBRuntimeDir -AppRoot $Paths.AppRoot
        New-Item -ItemType Directory -Path $pgLogDir -Force | Out-Null
        $pgLog = Join-Path $pgLogDir 'postgresql.log'
        # pg_ctl 启动的 postgres 会长期持有继承的标准句柄；直接用调用运算符时，
        # PowerShell 在某些宿主中会一直等待该句柄关闭。单独等待 pg_ctl 进程可避免启动器假死。
        $pgStartInfo = [Diagnostics.ProcessStartInfo]::new()
        $pgStartInfo.FileName = $pgCtl
        $pgStartInfo.Arguments = ('-D "{0}" -l "{1}" -o "-p {2}" -w -t 120 start' -f $Paths.PgData, $pgLog, $Paths.PgPort)
        $pgStartInfo.UseShellExecute = $false
        $pgStartInfo.CreateNoWindow = $true
        $pgStart = [Diagnostics.Process]::new()
        $pgStart.StartInfo = $pgStartInfo
        if (-not $pgStart.Start()) { throw "无法启动 pg_ctl：$pgCtl" }
        if (-not $pgStart.WaitForExit(120000)) {
          try { $pgStart.Kill() } catch { }
          throw "启动 PostgreSQL 超时，请查看：$pgLog"
        }
        $pgExitCode = $pgStart.ExitCode
        $pgStart.Dispose()
        if ($pgExitCode -ne 0) {
          throw "启动 PostgreSQL 失败（退出码 $pgExitCode），请查看：$pgLog"
        }
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
    if ($null -ne $callerPgPassword) { $env:PGPASSWORD = $callerPgPassword }
    else { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
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
  # 同 Start-BBPostgres：保存并还原调用方的 PGPASSWORD，而不是删除。
  $callerPgPassword = $env:PGPASSWORD
  $env:PGPASSWORD = $PgPassword
  try {
    # 同 Get-BBTargetInstanceDataDir：禁用 native 命令直连 Select-Object -First 1。
    # 2026-10-17 恢复实测：该管道模式下 psql 多数次被提前杀掉，$LASTEXITCODE = -1，
    # 下面的断言必误炸（"检查应用数据库角色 失败，退出码：-1"）。
    $roleLines = @(& $psql -h 127.0.0.1 -p $Paths.PgPort -U $SuperUser -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$AppUser'" 2>$null)
    Assert-BBNativeSuccess '检查应用数据库角色'
    $exists = if ($roleLines.Count -gt 0) { $roleLines[0] } else { $null }
    if (([string]$exists).Trim() -ne '1') {
      $safePassword = $AppPassword.Replace("'", "''")
      & $psql -h 127.0.0.1 -p $Paths.PgPort -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE $AppUser LOGIN PASSWORD '$safePassword'"
      Assert-BBNativeSuccess '创建应用数据库角色'
    }
  } finally {
    if ($null -ne $callerPgPassword) { $env:PGPASSWORD = $callerPgPassword }
    else { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
  }
}
