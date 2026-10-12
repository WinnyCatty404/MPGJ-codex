#!/usr/bin/env bash
# BMPBGS 数据备份（Linux 版，对应 Windows 的 bb-backup.ps1）
# 备份 PostgreSQL 数据库（自定义格式）+ storage/uploads 目录。
set -u
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bb-common.sh"

PG_PORT="$(bb_cfg_get pgPort 54328)"
PG_ROOT="$(bb_resolve_pgroot)"
PG_DUMP="$PG_ROOT/bin/pg_dump"
[ -x "$PG_DUMP" ] || { echo "未找到 pg_dump：$PG_DUMP（请确认 PostgreSQL 可用）"; exit 1; }

BACKUP_ROOT="${BB_BACKUP_ROOT:-/var/backups/bmpbgs}"
TS="$(date '+%Y%m%d-%H%M%S')"
SET="$BACKUP_ROOT/$TS"
mkdir -p "$SET" || { echo "无法创建备份目录 $SET"; exit 1; }

export PGPASSWORD='BbMiping-Local-2026!'
"$PG_DUMP" -h 127.0.0.1 -p "$PG_PORT" -U postgres -F c -f "$SET/bb_miping-$TS.dump" bb_miping \
  || { echo "数据库备份失败（请确认 PostgreSQL 正在运行、postgres 密码正确）。"; exit 1; }

# 备份文件目录（若存在）
for d in storage uploads; do
  src="$BB_APP_ROOT/$d"
  [ -d "$src" ] && cp -a "$src" "$SET/$d"
done

echo "备份完成：$SET"
