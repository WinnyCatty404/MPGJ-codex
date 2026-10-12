#!/usr/bin/env bash
# BMPBGS 数据恢复（Linux 版，对应 Windows 的 bb-restore.ps1）
# 重建数据库 + 还原 storage/uploads。用法：bb-restore.sh [备份集目录或时间戳]
set -u
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bb-common.sh"

PG_PORT="$(bb_cfg_get pgPort 54328)"
PG_ROOT="$(bb_resolve_pgroot)"
PSQL="$PG_ROOT/bin/psql"
PGREST="$PG_ROOT/bin/pg_restore"
[ -x "$PGREST" ] || { echo "未找到 pg_restore：$PGREST"; exit 1; }

BACKUP_ROOT="${BB_BACKUP_ROOT:-/var/backups/bmpbgs}"

if [ -z "${1:-}" ]; then
  echo "可用备份集："
  i=0
  while IFS= read -r s; do echo "  [$i] $s"; i=$((i+1)); done < <(ls -1 "$BACKUP_ROOT" 2>/dev/null | sort -r)
  read -r idx
  SET="$BACKUP_ROOT/$(ls -1 "$BACKUP_ROOT" 2>/dev/null | sort -r | sed -n "$((idx+1))p")"
else
  SET="$1"
fi

DUMP="$(ls "$SET"/bb_miping-*.dump 2>/dev/null | head -1)"
[ -f "$DUMP" ] || { echo "备份集中未找到数据库 dump 文件：$SET"; exit 1; }

export PGPASSWORD='BbMiping-Local-2026!'
"$PSQL" -h 127.0.0.1 -p "$PG_PORT" -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='bb_miping' AND pid<>pg_backend_pid();" >/dev/null 2>&1
"$PSQL" -h 127.0.0.1 -p "$PG_PORT" -U postgres -d postgres -c "DROP DATABASE IF EXISTS bb_miping;"
"$PSQL" -h 127.0.0.1 -p "$PG_PORT" -U postgres -d postgres -c "CREATE DATABASE bb_miping OWNER bb_miping_app ENCODING 'UTF8';"
"$PGREST" -h 127.0.0.1 -p "$PG_PORT" -U postgres -d bb_miping -F c "$DUMP" \
  || { echo "数据库恢复失败（请确认 PostgreSQL 正在运行、postgres 密码正确）。"; exit 1; }

for d in storage uploads; do
  [ -d "$SET/$d" ] && cp -a "$SET/$d" "$BB_APP_ROOT/$d"
done

echo "恢复完成：$SET（恢复后请重启 BMPBGS：bb-stop.sh && bb-start.sh 或 systemctl restart bmpbgs）"
