# BMPBGS 密评工具箱 — Linux 部署包（openEuler / RHEL 系 x86_64）

本包与 Windows 安装包功能完全一致（自带 Node + PostgreSQL，业务代码零改动），用于在国产 Linux
（统信 UOS 服务器版、openEuler、麒麟、CentOS/RHEL 8 等 glibc ≥ 2.28 的 x86_64 发行版）上以
`systemd` 服务方式部署。

> 与 Windows 包互不干扰：本目录 `linux/` 下为全新脚本，原 `installer/`、`*.ps1` 等 Windows 文件保持不变。

## 目录结构（安装后位于 /opt/BMPBGS）

```
/opt/BMPBGS/
├── bin/
│   ├── bb-common.sh        # 公共函数：路径解析、配置读写、端口探测
│   ├── bb-start.sh         # 启动（后台模式 / --foreground 供 systemd）
│   ├── bb-stop.sh          # 停止
│   ├── bb-backup.sh        # 备份（数据库 + storage/uploads）
│   └── bb-restore.sh       # 恢复
├── database/
│   ├── setup.sh            # 数据库初始化（initdb + 建库 + schema/seed）
│   ├── schema.sql
│   └── seed.sql
├── backend/                # Node/Express 后端（含编译产物 dist/）
├── frontend/dist/          # 构建后的前端静态资源
├── bb-serve-frontend.js    # 前端静态服务器 + /api 反向代理
├── opt/node/               # 内置 Linux 版 Node（自包含，无需系统安装）
├── opt/pgsql/              # 内置 Linux 版 PostgreSQL（可选；缺省则回退系统 PG）
├── bmpbgs.service          # systemd 单元模板
└── bb-config.json          # 端口与 JWT 密钥（首次启动自动生成并持久化）
```

## 一键安装

```bash
sudo bash install.sh            # 默认装到 /opt/BMPBGS
# 或指定目录： sudo bash install.sh /srv/bmpbgs
```

安装脚本会：创建专用用户 `bmpbgs` → 复制文件 → 用内置 Node 安装后端依赖（首次需联网） →
注册并开机自启 `bmpbgs` 服务。

启动 / 停止 / 查看：

```bash
sudo systemctl start bmpbgs
sudo systemctl status bmpbgs
sudo systemctl stop bmpbgs
journalctl -u bmpbgs -f         # 查看日志
```

浏览器访问 `http://<本机IP>:<web端口>`（web 端口见 `/opt/BMPBGS/bb-config.json` 的 `webPort`，
默认 5173）。本机访问用 `http://localhost:5173`。

## 关于 PostgreSQL 运行时

- **推荐（完全自包含）**：把 EDB 官方的 Linux x64 PostgreSQL 二进制解压到 `opt/pgsql/`
  （含 `bin/ lib/ share/`）。这样目标机无需任何系统依赖。
- **回退方案**：若 `opt/pgsql` 缺失，启动脚本会自动探测并使用系统已安装的 PostgreSQL
  （`dnf install -y postgresql-server postgresql` 后重装即可）。

## 数据备份与恢复

```bash
sudo /opt/BMPBGS/bin/bb-backup.sh     # 备份到 /var/backups/bmpbgs/<时间戳>
sudo /opt/BMPBGS/bin/bb-restore.sh     # 交互选择备份集恢复
```

## 卸载

```bash
sudo bash /opt/BMPBGS/uninstall.sh
```
（数据库与上传文件保留在 `/var/lib/bmpbgs`，如需彻底清理请手动删除。）

## 端口说明

首次启动自动探测空闲端口并写入 `bb-config.json`（确定后固定）：

| 用途 | 默认 | 说明 |
|---|---|---|
| PostgreSQL | 54328 | 仅监听 127.0.0.1 |
| 后端 API | 3100 | |
| 前端 Web | 5173 | |

如与其它服务冲突，修改 `bb-config.json` 中对应端口后重启服务即可。

## 与现有服务共存

本工具以独立用户 `bmpbgs` 运行，使用独立数据目录，不修改系统 PATH / 环境变量，仅占用上述端口，
可与同机其它服务和平共处。
