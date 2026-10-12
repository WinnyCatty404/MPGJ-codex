#!/usr/bin/env bash
# BMPBGS 数据库初始化（Linux 版，对应 Windows 的 database/setup.ps1）
# 首次启动由 bb-start.sh 调用：initdb -> 创建角色/库 -> 执行 schema.sql / seed.sql。
set -u

PG_ROOT=""; DATA_DIR=""; PORT=54328
SUPER_PW='BbMiping-Local-2026!'; APP_PW='BbMiping-App-2026!'
while [ $# -gt 0 ]; do
  case "$1" in
    --postgres-root) PG_ROOT="$2"; shift 2;;
    --data-dir) DATA_DIR="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --super-password) SUPER_PW="$2"; shift 2;;
    --app-password) APP_PW="$2"; shift 2;;
    *) shift;;
  esac
done

BIN="$PG_ROOT/bin"
INITDB="$BIN/initdb"; PGCTL="$BIN/pg_ctl"; PSQL="$BIN/psql"; CREATEDB="$BIN/createdb"
[ -x "$INITDB" ] || { echo "未找到 initdb：$INITDB"; exit 1; }

mkdir -p "$DATA_DIR"

if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
  # 移除可能残留的配置文件，确保 initdb 重新生成
  rm -f "$DATA_DIR/postgresql.conf"
  PWFILE="$(mktemp)"
  printf '%s' "$SUPER_PW" > "$PWFILE"   # 无换行，避免密码被注入换行
  # 关键点：用 libc + C locale。openEuler 默认即 UTF-8，应用层只按时间/数字/枚举排序，不依赖中文排序规则。
  "$INITDB" -D "$DATA_DIR" -U postgres -A scram-sha-256 --pwfile="$PWFILE" \
    --encoding=UTF8 --locale-provider=libc --locale=C \
    || { echo "initdb 失败（退出码 $?）"; rm -f "$PWFILE"; exit 1; }
  rm -f "$PWFILE"
  printf '\nport = %s\nlisten_addresses = %s\n' "$PORT" "127.0.0.1" >> "$DATA_DIR/postgresql.conf"
fi

if ! "$PGCTL" -D "$DATA_DIR" status >/dev/null 2>&1; then
  "$PGCTL" -D "$DATA_DIR" -l "$DATA_DIR/postgresql.log" start \
    || { echo "pg_ctl start 失败（退出码 $?）"; exit 1; }
  sleep 2
fi

export PGPASSWORD="$SUPER_PW"
export PGCLIENTENCODING=UTF8   # Linux 默认已是 UTF-8，此处保持与 Windows 一致，确保中文 COMMENT/INSERT 不丢

ROLE="$("$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='bb_miping_app'" 2>/dev/null)"
if [ "$ROLE" != "1" ]; then
  "$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -c "CREATE ROLE bb_miping_app LOGIN PASSWORD '$APP_PW'" \
    || { echo "创建应用角色失败"; exit 1; }
fi

DB="$("$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='bb_miping'" 2>/dev/null)"
if [ "$DB" != "1" ]; then
  "$CREATEDB" -h 127.0.0.1 -p "$PORT" -U postgres -O bb_miping_app -E UTF8 bb_miping \
    || { echo "创建业务数据库失败"; exit 1; }
fi

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d bb_miping -f "$THIS_DIR/schema.sql" \
  || { echo "创建数据表失败"; exit 1; }
"$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d bb_miping -f "$THIS_DIR/seed.sql" \
  || { echo "写入初始数据失败"; exit 1; }

echo "Database ready at 127.0.0.1:$PORT / bb_miping"
echo "App connection: postgresql://bb_miping_app:<password>@127.0.0.1:$PORT/bb_miping"
