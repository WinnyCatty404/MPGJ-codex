#!/usr/bin/env bash
# BMPBGS 启动（Linux 版，对应 Windows 的 bb-start.ps1）
# 用法：
#   bb-start.sh           后台启动，打印访问地址后退出（手动使用）
#   bb-start.sh --foreground  pg/前端后台启动，后端以当前进程前台运行（供 systemd Type=simple 调用）
set -u
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bb-common.sh"

BB_START_LOG="$BB_LOG_DIR/start.log"
log() { echo "$(date '+%H:%M:%S') [$1] $2" | tee -a "$BB_START_LOG"; }

FOREGROUND=0
[ "${1:-}" = "--foreground" ] && FOREGROUND=1

NODE="$(bb_resolve_node)" || { echo "缺少 Node，无法启动"; exit 1; }
log INFO "Node 运行时：$NODE"

# 1) 端口与 JWT 密钥（持久化到 bb-config.json，确定后固定，避免重启令牌/连接错乱）
PG_PORT="$(bb_cfg_get pgPort '')"
if [ -z "$PG_PORT" ]; then
  if [ -f "$BB_APP_ROOT/pgdata/PG_VERSION" ]; then
    PG_PORT="$(bb_pg_port_from_conf "$BB_APP_ROOT/pgdata")"
  fi
  [ -z "$PG_PORT" ] && PG_PORT="$(bb_find_free_port 54328 55000)"
fi
API_PORT="$(bb_cfg_get apiPort '')"; [ -z "$API_PORT" ] && API_PORT="$(bb_find_free_port 3100 3200)"
WEB_PORT="$(bb_cfg_get webPort '')"; [ -z "$WEB_PORT" ] && WEB_PORT="$(bb_find_free_port 5173 5300)"
JWT="$(bb_cfg_get jwtSecret '')"
if [ -z "$JWT" ]; then JWT="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"; fi
bb_cfg_set "pgPort=$PG_PORT" "apiPort=$API_PORT" "webPort=$WEB_PORT" "jwtSecret=$JWT"
log INFO "端口：PostgreSQL=$PG_PORT 后端=$API_PORT 前端=$WEB_PORT"

PATHS="$(bb_resolve_paths "$PG_PORT")"
PG_ROOT="${PATHS%%|*}"; rest="${PATHS#*|}"; PG_DATA="${rest%%|*}"
PG_CTL="$PG_ROOT/bin/pg_ctl"
if [ ! -x "$PG_CTL" ]; then
  log ERROR "未找到 PostgreSQL(pg_ctl)：$PG_CTL。请将 PostgreSQL 二进制放入 $BB_APP_ROOT/opt/pgsql/，或用 dnf 安装 postgresql-server。"
  exit 1
fi

# 2) 首次启动：初始化数据库
if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  log INFO "首次启动：正在初始化数据库（约 1-2 分钟）..."
  if ! bash "$BB_APP_ROOT/database/setup.sh" --postgres-root "$PG_ROOT" --data-dir "$PG_DATA" --port "$PG_PORT"; then
    log ERROR "数据库初始化失败，详见 $PG_DATA/postgresql.log"
    exit 1
  fi
  log INFO "数据库初始化完成"
fi

# 3) 启动 PostgreSQL 并等待真正接受连接
if ! "$PG_CTL" -D "$PG_DATA" status >/dev/null 2>&1; then
  log INFO "启动 PostgreSQL..."
  "$PG_CTL" -D "$PG_DATA" -l "$PG_DATA/postgresql.log" start
fi
ready=0
for i in $(seq 1 30); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PG_PORT") 2>/dev/null; then ready=1; exec 3>&-; break; fi
  sleep 1
done
[ "$ready" = "1" ] || { log ERROR "PostgreSQL 启动超时（端口 $PG_PORT 未监听）。日志：$PG_DATA/postgresql.log"; exit 1; }
log INFO "PostgreSQL 已就绪"

# 4) 自愈：历史版本中文行被跳过导致初始数据缺失（users 空表 -> 登录失败）。每次启动幂等补种。
CNT="$("$PG_ROOT/bin/psql" -h 127.0.0.1 -p "$PG_PORT" -U postgres -d bb_miping -tAc "SELECT count(*) FROM users" 2>/dev/null | tr -d ' ')"
if [ "$CNT" != "" ] && [ "$CNT" -lt 3 ] 2>/dev/null; then
  log WARN "检测到初始数据不完整（users=$CNT），正在补种初始数据..."
  PGPASSWORD='BbMiping-Local-2026!' PGCLIENTENCODING=UTF8 \
    "$PG_ROOT/bin/psql" -h 127.0.0.1 -p "$PG_PORT" -U postgres -d bb_miping -f "$BB_APP_ROOT/database/seed.sql" >/dev/null 2>&1
fi

# 5) 注入环境变量（仅当前进程树，不修改系统环境）
export PORT="$API_PORT"
export JWT_SECRET="$JWT"
export DATABASE_URL="postgresql://bb_miping_app:BbMiping-App-2026!@127.0.0.1:$PG_PORT/bb_miping"

# 6) 前端静态服务（端口未占用才启动，避免 systemd 重启时重复拉起）
if (exec 3<>"/dev/tcp/127.0.0.1/$WEB_PORT") 2>/dev/null; then
  exec 3>&-; log INFO "前端端口 $WEB_PORT 已被占用，跳过重复启动"
else
  log INFO "启动前端静态服务..."
  nohup "$NODE" "$BB_APP_ROOT/bb-serve-frontend.js" --dist "$BB_APP_ROOT/frontend/dist" \
    --port "$WEB_PORT" --api "http://127.0.0.1:$API_PORT" \
    >"$BB_LOG_DIR/frontend.out.log" 2>"$BB_LOG_DIR/frontend.err.log" &
  echo $! > "$BB_LOG_DIR/frontend.pid"
fi

# 7) 后端服务
if (exec 3<>"/dev/tcp/127.0.0.1/$API_PORT") 2>/dev/null; then
  exec 3>&-; log INFO "后端端口 $API_PORT 已被占用，跳过重复启动"
else
  log INFO "启动后端服务..."
  if [ "$FOREGROUND" = "1" ]; then
    # 前台运行，成为 systemd 主进程；PG/前端作为其子进程，停止时由 ExecStop 清理。
    exec "$NODE" "$BB_APP_ROOT/backend/dist/server.js"
  fi
  nohup "$NODE" "$BB_APP_ROOT/backend/dist/server.js" \
    >"$BB_LOG_DIR/backend.out.log" 2>"$BB_LOG_DIR/backend.err.log" &
  echo $! > "$BB_LOG_DIR/backend.pid"
fi

if [ "$FOREGROUND" = "1" ]; then exit 0; fi

# 8) 健康检查 + 摘要
sleep 3
api_ok=0; web_ok=0
(exec 3<>"/dev/tcp/127.0.0.1/$API_PORT") 2>/dev/null && api_ok=1
(exec 3<>"/dev/tcp/127.0.0.1/$WEB_PORT") 2>/dev/null && web_ok=1
URL="http://localhost:$WEB_PORT"
log INFO "健康检查：后端=$api_ok 前端=$web_ok"
echo
echo "================================================"
echo "  BMPBGS 启动完成（后台运行）"
echo "  浏览器地址： $URL"
echo "  后端 API ： http://localhost:$API_PORT"
echo "  日志目录 ： $BB_LOG_DIR"
echo "  停止     ： bb-stop.sh  或  systemctl stop bmpbgs"
echo "================================================"
echo
