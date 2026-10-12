#!/usr/bin/env bash
# BMPBGS - Linux 公共函数（路径解析、配置读写、端口探测）
# 对应 Windows 的 bb-common.ps1。被 bb-start.sh / bb-stop.sh / bb-backup.sh / bb-restore.sh 通过 source 引入。
# 注意：本文件必须在 bash 下运行（用到 /dev/tcp）。

set -u

# 脚本自身所在目录即 AppRoot（与 Windows 布局一致：脚本位于安装根目录）。
BB_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BB_APP_ROOT="${BB_APP_ROOT:-$BB_SELF_DIR}"
BB_CONFIG="$BB_APP_ROOT/bb-config.json"
BB_LOG_DIR="${BB_LOG_DIR:-/var/log/bmpbgs}"

# 日志目录：手动运行时若无法写 /var/log，则退回到安装目录下的 logs。
if [ ! -w "$(dirname "$BB_LOG_DIR" 2>/dev/null)" ]; then
  BB_LOG_DIR="$BB_APP_ROOT/logs"
fi
mkdir -p "$BB_LOG_DIR" 2>/dev/null

# 解析私有 Node.js 运行时：优先使用安装目录内的 opt/node/bin/node（自包含），否则回退系统 PATH 中的 node。
bb_resolve_node() {
  local bundled="$BB_APP_ROOT/opt/node/bin/node"
  if [ -x "$bundled" ]; then echo "$bundled"; return 0; fi
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  echo "未找到 Node.js 运行时。请将 Linux 版 Node 二进制放入 $BB_APP_ROOT/opt/node/，或在系统 PATH 中安装 Node 18+。" >&2
  return 1
}

# 解析 PostgreSQL 二进制目录。
# 优先内置 opt/pgsql；其次常见系统安装位置（openEuler 用 dnf 装的 PostgreSQL）；最后回退开发机路径。
bb_resolve_pgroot() {
  local bundled="$BB_APP_ROOT/opt/pgsql"
  if [ -x "$bundled/bin/pg_ctl" ]; then echo "$bundled"; return 0; fi

  local sys
  sys="$(command -v pg_ctl 2>/dev/null || true)"
  if [ -n "$sys" ]; then echo "$(dirname "$sys")/.."; return 0; fi

  # /usr/pgsql-<ver>/bin（PGDG 仓库）或 /usr/lib/postgresql/<ver>/bin（Debian/Ubuntu 系）
  local found
  found="$(ls -d /usr/pgsql-*/bin /usr/lib/postgresql/*/bin 2>/dev/null | head -1)"
  if [ -n "$found" ]; then echo "${found%/bin}"; return 0; fi

  echo "$bundled"  # 找不到时返回首选路径，让调用方给出清晰报错
}

# 解析 PostgreSQL 数据目录：优先复用已初始化的，否则默认 /var/lib/bmpbgs/pgdata（必须可写）。
bb_resolve_paths() {
  local pgport="${1:-54328}"
  local pgroot; pgroot="$(bb_resolve_pgroot)"
  local bundled_data="$BB_APP_ROOT/pgdata"
  local sys_data="/var/lib/bmpbgs/pgdata"
  local fallback_data="/opt/BBMipingDB/data"
  local pgdata
  if [ -f "$bundled_data/PG_VERSION" ]; then pgdata="$bundled_data"
  elif [ -f "$sys_data/PG_VERSION" ]; then pgdata="$sys_data"
  elif [ -f "$fallback_data/PG_VERSION" ]; then pgdata="$fallback_data"
  else pgdata="$sys_data"; fi
  echo "$pgroot|$pgdata|$pgport"
}

# 读取配置（文件不存在时返回 '{}'）。
bb_read_config() {
  if [ -f "$BB_CONFIG" ]; then cat "$BB_CONFIG"; else echo '{}'; fi
}

# 读取某配置项：$1=key  $2=默认值。依赖 Node 解析 JSON（与 Windows 用 zod 解析同理，避免手写正则出错）。
bb_cfg_get() {
  local key="$1" def="${2:-}"
  local node; node="$(bb_resolve_node)" || return 1
  BB_KEY="$key" BB_DEF="$def" BB_CFG="$BB_CONFIG" "$node" -e '
    const fs=require("fs");
    const k=process.env.BB_KEY, def=process.env.BB_DEF;
    let v; try { const c=JSON.parse(fs.readFileSync(process.env.BB_CFG,"utf8")); v=c[k]; } catch(e){}
    process.stdout.write(v===undefined||v===null?def:String(v));
  ' 2>/dev/null
}

# 写入配置项（保留其它键）：$@ 形如 key=value。
bb_cfg_set() {
  local node; node="$(bb_resolve_node)" || return 1
  BB_CFG="$BB_CONFIG" "$node" -e '
    const fs=require("fs"); const p=process.env.BB_CFG;
    let c={}; try { c=JSON.parse(fs.readFileSync(p,"utf8")); } catch(e){}
    for (const s of process.argv.slice(1)) { const i=s.indexOf("="); if(i>0) c[s.slice(0,i)]=s.slice(i+1); }
    fs.writeFileSync(p, JSON.stringify(c,null,2));
  ' "$@"
}

# 在 [Start,End] 范围内探测第一个未被监听的 TCP 端口（用 /dev/tcp 连接试探，连接被拒即视为空闲）。
bb_find_free_port() {
  local start="${1:-54328}" end="${2:-55000}" port
  for ((port=start; port<=end; port++)); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      echo "$port"; return 0
    fi
  done
  echo "在 $start-$end 范围内未找到空闲端口" >&2; return 1
}

# 从已初始化的 postgresql.conf 中读取实际监听端口。
bb_pg_port_from_conf() {
  local pgdata="$1" conf="$pgdata/postgresql.conf"
  [ -f "$conf" ] || return 1
  grep -oE '^[[:space:]]*port[[:space:]]*=[[:space:]]*[0-9]+' "$conf" 2>/dev/null | head -1 | grep -oE '[0-9]+'
}
