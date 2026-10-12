#!/usr/bin/env bash
# BMPBGS 停止（Linux 版，对应 Windows 的 bb-stop.ps1）
# 结束前后端进程并停止 PostgreSQL。
set -u
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bb-common.sh"

PG_PORT="$(bb_cfg_get pgPort 54328)"
API_PORT="$(bb_cfg_get apiPort 3100)"
WEB_PORT="$(bb_cfg_get webPort 5173)"
PG_ROOT="$(bb_resolve_pgroot)"

# 1) 按进程命令行精确结束本工具启动的 Node 进程（避免误杀其它 node）
pkill -f "$BB_APP_ROOT/backend/dist/server.js" 2>/dev/null
pkill -f "bb-serve-frontend.js --dist $BB_APP_ROOT/frontend/dist" 2>/dev/null

# 2) 兜底：按监听端口结束（pid 文件丢失时仍有用）
for port in "$API_PORT" "$WEB_PORT"; do
  pid="$(fuser "$port/tcp" 2>/dev/null | tr -d ' ')"
  [ -n "$pid" ] && kill -TERM $pid 2>/dev/null
done

# 3) 停止 PostgreSQL
PG_CTL="$PG_ROOT/bin/pg_ctl"
if [ -x "$PG_CTL" ]; then
  PG_DATA="$(bb_resolve_paths "$PG_PORT" | awk -F'|' '{print $2}')"
  if [ -d "$PG_DATA/base" ]; then
    "$PG_CTL" -D "$PG_DATA" stop -m fast 2>/dev/null
  fi
fi

# 4) 清理 pid 文件
rm -f "$BB_LOG_DIR"/*.pid 2>/dev/null
echo "BMPBGS 已停止。"
