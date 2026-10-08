# BMPBGS · 安装包构建与分发说明

本目录用于把「BB 密评协同管理系统」打包成可分发的 Windows 安装包（.exe），安装后在
**开始菜单**和**桌面**提供四个快捷方式：启动 / 停止 / 备份 / 恢复。

## 目录内容
- `BBMiPing-Setup.iss` —— Inno Setup 安装脚本（核心，文件名用纯英文避免 cmd 编码问题）
- `build-installer.bat` —— 一键编译：先用 robocopy 生成干净暂存目录 `pkgsrc\`，再调用 ISCC 打包
- `install.ps1` / `uninstall.ps1` —— 开发机免 Inno 快速创建/移除快捷方式（仅本地测试用）
- 根目录 `bb-*.ps1` + `bb-common.ps1` —— 四个运行脚本与公共路径解析（会被安装包一起打包）

> 注意：`.bat` 与 `.iss` 的文件名和内容均使用纯英文/ASCII，避免 cmd 按 GBK 误读中文导致
> "不是内部或外部命令"乱码错误（2026-10-06 实际踩过此坑）。

## 一、准备可自包含的依赖（分发前必做）
安装包通过把 **私有 Node.js** 与 **私有 PostgreSQL** 一并打包，做到目标机**无需安装任何运行时**。
请在本机（开发机）按下面两步把依赖放入项目根目录，再编译安装包。

### 1) 打包私有 Node.js（让拿到安装包的人不用装 Node）
- 下载 Node.js Windows 64 位 ZIP（18+，如 20.x LTS）：https://nodejs.org/dist/
- 解压后，把其中的 `node.exe` 及依赖文件（`node.lib`、`fsevents` 等可选）整体放入项目根目录的
  **`node/`** 文件夹，使 **`node\node.exe`** 存在。
- 四个运行脚本会优先使用 `{安装目录}\node\node.exe`，不会去碰系统 PATH。

### 2) 打包私有 PostgreSQL（专属数据目录，不与本机现有 PG 冲突）
- 下载 PostgreSQL Windows 64 位 ZIP（如 16.x，约 30–50MB）：
  https://www.postgresql.org/download/windows/ 或直接取 EnterpriseDB 的 ZIP 版。
- 解压后，把其中的 `bin`、`lib`、`share` 等目录整体放入项目根目录的 **`pgsql/`** 文件夹，
  使 **`pgsql\bin\pg_ctl.exe`** 存在。
- 脚本优先使用 `{安装目录}\pgsql`；若不存在则回退到 `D:\BBMipingDB`（开发机默认）。
- 数据库使用专属数据目录 `{安装目录}\data\pgdata`，端口默认 54328 且被占用时自动避让，不会干扰本机已有 PostgreSQL。
- 安装向导要求选择纯英文路径（例如 `D:\BMPBGS`），避免 PostgreSQL 在中文路径下初始化失败。
  如果默认目录包含中文用户名，请在向导中改选其他磁盘的纯英文目录。

> 数据库默认超级用户密码为 `BbMiping-Local-2026!`（见 `database/setup.ps1`）。
> 任何正式/对外环境请修改该密码，并相应更新 `bb-backup.ps1` / `bb-restore.ps1` 的默认密码。

### 3) 目标机前置运行库（几乎都自带，列在此处以防万一）
- PostgreSQL 的 Windows 版依赖 **Microsoft Visual C++ Redistributable（2015–2022）**。
  绝大多数 Windows 已自带；若对方机器缺少，请从
  https://learn.microsoft.com/zh-CN/cpp/windows/latest-supported-vc-redist 安装 x64 版本。
- Node.js 官方 ZIP 与本项目所用的 `sharp` 原生模块一般不额外依赖，但同样受益于上述运行库。

## 二、构建安装包
1. 安装 Inno Setup 6（免费）：https://jrsoftware.org/isdl.php
   （安装时务必勾选安装语言翻译文件，否则 `Languages\ChineseSimplified.isl` 缺失会编译失败）
2. 双击 `build-installer.bat`（脚本会自动定位 ISCC，包括 D:\Inno Setup 6 等非默认路径）。
3. 生成的安装包位于 `installer\out\BMPBGS安装包.exe`（约 126 MB）。
4. `build-installer.bat` 会先用 robocopy 把项目复制到 `installer\pkgsrc\`（排除 .env、日志、
   用户数据、pgAdmin 4 等），Inno 只打包 `pkgsrc\`；下次构建会自动重建该目录。

## 三、安装后的使用
- **启动BMPBGS**：首次会自动初始化 PostgreSQL 数据库并启动前后端；
  浏览器访问 http://localhost:5173 （前端）、http://localhost:3100 （后端）。
- **停止BMPBGS**：结束运行进程并停止 PostgreSQL。
- **备份BMPBGS数据**：在 `{安装目录}\data\backups\<时间戳>\` 生成数据库 dump 与文件副本。
- **恢复BMPBGS数据**：选择备份集，重建数据库并还原文件。

## 四、安装位置与数据说明
默认安装到当前用户的 `%LOCALAPPDATA%\BMPBGS`，也可在安装向导中选择其他磁盘的纯英文目录，
**无需管理员权限**。运行期数据（数据库 `data\pgdata`、备份 `data\backups`、上传 `uploads`、
项目 `storage\projects`、`bb-config.json`）均写在实际安装目录下。
为保证"升级安装不覆盖用户数据"，安装脚本**不会**把这些目录写入安装包，也不会在卸载时删除它们；
如需彻底清理，请手动删除安装目录。
