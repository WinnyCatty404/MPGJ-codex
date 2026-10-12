#!/usr/bin/env bash
# BMPBGS Linux 安装脚本（需 root 运行）
# 用法：sudo bash install.sh [安装目录，默认 /opt/BMPBGS]
#
# 行为：
#  1. 创建专用系统用户 bmpbgs
#  2. 复制文件到安装目录
#  3. 若自带 opt/node，则用其安装后端依赖（npm install --omit=dev，首次需联网）
#  4. 若未自带 opt/pgsql，则回退使用系统已安装的 PostgreSQL（dnf install postgresql-server）
#  5. 注册 systemd 服务并设为开机自启
set -eu

[ "$(id -u)" = "0" ] || { echo "请使用 root 运行：sudo bash install.sh"; exit 1; }

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="${1:-/opt/BMPBGS}"

PG_FROM_SYSTEM=0
if [ ! -x "$SRC/opt/pgsql/bin/pg_ctl" ]; then
  if command -v pg_ctl >/dev/null 2>&1 \
     || ls /usr/pgsql-*/bin/pg_ctl >/dev/null 2>&1 \
     || ls /usr/lib/postgresql/*/bin/pg_ctl >/dev/null 2>&1; then
    PG_FROM_SYSTEM=1
    echo "[信息] 未检测到自带 PostgreSQL，将改用系统已安装的 PostgreSQL。"
  else
    echo "[警告] 未检测到自带 PostgreSQL，且系统也未安装。请二选一："
    echo "        a) 将 EDB 的 Linux PostgreSQL 二进制解压到 $SRC/opt/pgsql/ 后重装；"
    echo "        b) 先执行  dnf install -y postgresql-server postgresql  再重装。"
  fi
fi

# 创建专用用户（无登录、无家目录外权限）
if ! id bmpbgs >/dev/null 2>&1; then
  useradd -r -s /sbin/nologin -d /var/lib/bmpbgs -m bmpbgs
fi

echo "安装到 $INSTALL ..."
mkdir -p "$INSTALL"
cp -a "$SRC/." "$INSTALL/"

# 数据 / 日志 / 备份目录
mkdir -p /var/lib/bmpbgs/pgdata /var/log/bmpbgs /var/backups/bmpbgs
chown -R bmpbgs:bmpbgs "$INSTALL" /var/lib/bmpbgs /var/log/bmpbgs /var/backups/bmpbgs
chmod 755 "$INSTALL/bin"/*.sh
# Windows 打出的包在 Linux 解压后二进制缺少执行位，这里补上
chmod 755 "$INSTALL/opt/node/bin/node" 2>/dev/null || true
chmod 755 "$INSTALL/opt/node/bin"/* 2>/dev/null || true
chmod 755 "$INSTALL/opt/pgsql/bin"/* 2>/dev/null || true

# 安装后端依赖（使用自带 Node）
if [ ! -d "$INSTALL/backend/node_modules" ]; then
  NODE="$INSTALL/opt/node/bin/node"
  NPM_CLI="$INSTALL/opt/node/lib/node_modules/npm/bin/npm-cli.js"
  if [ -x "$NODE" ] && [ -f "$NPM_CLI" ]; then
    echo "正在安装后端依赖（首次需联网，约 1-3 分钟）..."
    su bmpbgs -s /bin/bash -c "cd '$INSTALL/backend' && '$NODE' '$NPM_CLI' install --omit=dev --no-audit --no-fund" \
      || echo "[警告] 依赖安装失败（可能无外网）。请在有网环境执行：cd $INSTALL/backend && $NODE $NPM_CLI install --omit=dev 后重启。"
  else
    echo "[警告] 未找到自带 Node（$NODE），无法安装后端依赖，后端将无法启动。"
  fi
fi

# 注册 systemd 服务
UNIT=/etc/systemd/system/bmpbgs.service
sed "s#__INSTALL__#$INSTALL#g" "$INSTALL/bmpbgs.service" > "$UNIT"
systemctl daemon-reload
systemctl enable bmpbgs

echo
echo "================================================"
echo "  安装完成。"
echo "  启动： systemctl start bmpbgs"
echo "  状态： systemctl status bmpbgs"
echo "  访问： http://<本机IP>:<web端口>"
echo "        web 端口见 $INSTALL/bb-config.json 的 webPort（默认 5173）"
echo "  日志： journalctl -u bmpbgs / $BB_LOG_DIR"
echo "================================================"
