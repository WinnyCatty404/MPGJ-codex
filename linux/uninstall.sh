#!/usr/bin/env bash
# BMPBGS Linux 卸载脚本（需 root 运行）
# 用法：sudo bash uninstall.sh [安装目录，默认 /opt/BMPBGS]
set -eu
[ "$(id -u)" = "0" ] || { echo "请使用 root 运行：sudo bash uninstall.sh"; exit 1; }

INSTALL="${1:-/opt/BMPBGS}"
systemctl stop bmpbgs 2>/dev/null || true
systemctl disable bmpbgs 2>/dev/null || true
rm -f /etc/systemd/system/bmpbgs.service
systemctl daemon-reload 2>/dev/null || true
rm -rf "$INSTALL"

echo "已卸载 BMPBGS 程序（/var/lib/bmpbgs 中的数据库与上传文件已保留）。"
echo "如需彻底清理数据，请手动执行： rm -rf /var/lib/bmpbgs /var/log/bmpbgs /var/backups/bmpbgs"
