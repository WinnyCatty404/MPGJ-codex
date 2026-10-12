#!/usr/bin/env bash
# BMPBGS Linux 部署包构建脚本（在构建机运行，可用 Windows git-bash 或 Linux）
# 产物： build/BMPBGS-linux-x64.tar.gz
#
# 行为：
#   1. 下载内置 Linux 版 Node（国内镜像，可达）到 opt/node
#   2. 尝试下载内置 Linux 版 PostgreSQL（EDB 二进制）；若被网络拦截则跳过，
#      安装时自动回退到系统 PostgreSQL（dnf 安装），并在包内留说明
#   3. 复制 backend/dist、frontend/dist、database、脚本、systemd 单元等到包内
#   4. 打包为 tar.gz
set -eu

# 仓库根目录（本脚本位于 linux/ 下）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_VER="20.18.1"
# 优先用国内镜像（nodejs.org 在本环境被严重限速），-L 跟随重定向
NODE_URL="https://registry.npmmirror.com/-/binary/node/v${NODE_VER}/node-v${NODE_VER}-linux-x64.tar.xz"
# EDB 官方 Linux x64 二进制（部分网络环境会 403，失败时回退系统 PG）
PG_VER="16.6"
PG_URL="https://get.enterprisedb.com/postgresql/postgresql-${PG_VER}-1-linux-x64-binaries.tar.gz"

STAGE="$SCRIPT_DIR/build/BMPBGS"
DL="$SCRIPT_DIR/build/dl"
rm -rf "$STAGE" "$DL"
mkdir -p "$STAGE/opt/node" "$STAGE/opt/pgsql" "$STAGE/bin" "$STAGE/database" \
         "$STAGE/backend" "$STAGE/frontend" "$DL"

PY="$(command -v python3 || command -v python || true)"

# 在 git-bash(Windows) 与 Linux 下都能正确解压：把路径转成 Python 能识别的形式
# （git-bash 的 /tmp 与 Windows Python 看到的路径不一致，故下载到仓库内 dl/ 目录）
extract() {
  local src="$1" dst="$2" mode="$3"   # mode: xz | gz
  mkdir -p "$dst"
  local wsrc="$src" wdst="$dst"
  if command -v cygpath >/dev/null 2>&1; then
    wsrc="$(cygpath -w "$src")"; wdst="$(cygpath -w "$dst")"
  fi
  if [ -n "$PY" ]; then
    "$PY" -c "import tarfile; tarfile.open(r'$wsrc', 'r:$mode').extractall(r'$wdst')"
  else
    if [ "$mode" = "xz" ]; then tar -xJf "$src" -C "$dst"; else tar -xzf "$src" -C "$dst"; fi
  fi
}

echo "==> 下载内置 Node $NODE_VER ..."
curl -fSL --retry 3 "$NODE_URL" -o "$DL/node.tar.xz"
echo "==> 解压 Node ..."
extract "$DL/node.tar.xz" "$STAGE/opt/node.tmp" xz
mv "$STAGE"/opt/node.tmp/*/* "$STAGE/opt/node/"
rm -rf "$STAGE/opt/node.tmp" "$DL/node.tar.xz"
echo "    Node: $("$STAGE/opt/node/bin/node" -v 2>/dev/null || echo '解压后请检查')"

echo "==> 下载内置 PostgreSQL $PG_VER（可能受网络限制）..."
if curl -fSL --retry 2 "$PG_URL" -o "$DL/pg.tar.gz" 2>/dev/null; then
  echo "==> 解压 PostgreSQL ..."
  extract "$DL/pg.tar.gz" "$STAGE/opt/pgsql.tmp" gz
  # EDB 包顶层目录形如 postgresql-16.6-1-linux-x64-binaries/
  mv "$STAGE"/opt/pgsql.tmp/*/* "$STAGE/opt/pgsql/" 2>/dev/null || mv "$STAGE"/opt/pgsql.tmp/* "$STAGE/opt/pgsql/" 2>/dev/null || true
  rm -rf "$STAGE/opt/pgsql.tmp" "$DL/pg.tar.gz"
  echo "    PostgreSQL 已内置到 opt/pgsql/"
else
  echo "    [跳过] 无法下载 PostgreSQL 二进制（网络受限/403）。"
  echo "    安装时将自动回退使用系统 PostgreSQL；如需完全自包含，请手动把 EDB"
  echo "    Linux x64 二进制解压到 opt/pgsql/ 后重新打包。"
  cat > "$STAGE/opt/pgsql/README.txt" <<EOF
未内置 PostgreSQL 二进制（构建机无法从 EDB 下载，可能被网络拦截）。
两种处置方式（二选一）：
  A) 完全自包含：从 https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
     下载 Linux x86_64 的 PostgreSQL ${PG_VER} 二进制压缩包，解压后把 bin/ lib/ share/ 放进此目录，
     再重新运行 build-linux.sh 打包。
  B) 使用系统 PostgreSQL：在目标机执行  dnf install -y postgresql-server postgresql
     然后重跑 install.sh，启动脚本会自动探测并使用系统 pg_ctl。
EOF
fi

echo "==> 复制后端（排除 node_modules / tmp）..."
tar cf - --exclude=node_modules --exclude=tmp -C "$REPO_ROOT/backend" . | tar xf - -C "$STAGE/backend"
echo "==> 复制前端构建产物 ..."
cp -a "$REPO_ROOT/frontend/dist" "$STAGE/frontend/dist"
echo "==> 复制数据库脚本 ..."
cp "$REPO_ROOT/database/schema.sql" "$REPO_ROOT/database/seed.sql" "$STAGE/database/"
cp "$SCRIPT_DIR/database/setup.sh" "$STAGE/database/"
echo "==> 复制启动脚本 / systemd 单元 / 安装脚本 ..."
cp "$SCRIPT_DIR/bin"/*.sh "$STAGE/bin/"
cp "$SCRIPT_DIR/bmpbgs.service" "$SCRIPT_DIR/install.sh" "$SCRIPT_DIR/uninstall.sh" "$SCRIPT_DIR/README.md" "$STAGE/"
cp "$REPO_ROOT/bb-serve-frontend.js" "$STAGE/"

echo "==> 打包 ..."
tar czf "$SCRIPT_DIR/build/BMPBGS-linux-x64.tar.gz" -C "$SCRIPT_DIR/build" BMPBGS
rm -rf "$STAGE"
echo
echo "完成： $SCRIPT_DIR/build/BMPBGS-linux-x64.tar.gz"
du -h "$SCRIPT_DIR/build/BMPBGS-linux-x64.tar.gz"
