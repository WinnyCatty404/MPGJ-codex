# BMPBGS Windows 安装包

本目录只构建 Windows x64 安装包。发布包内置 Node.js、PostgreSQL、后端、前端、模板及初始数据库脚本，目标电脑不需要另行安装这些组件。

## 构建

开发机需要：

- 项目根目录存在 `node\node.exe`
- 项目根目录存在 `pgsql\bin\pg_ctl.exe`
- 已安装 Inno Setup 6
- 已执行过项目依赖安装

双击 `build-installer.bat`，或在项目根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build-windows.ps1
```

脚本会重新构建前后端，按白名单创建干净的 Windows 发布目录，编译无控制台的 `BMPBGS.exe` 启动器，然后生成：

- `installer\out\BMPBGS-Windows-x64-Setup.exe`
- `installer\out\SHA256SUMS.txt`

`installer\build\` 和 `installer\out\` 都是生成目录，不提交到 Git。

## 图标与启动方式

安装程序、桌面快捷方式、开始菜单、原生启动器和 BMPBGS 控制台统一使用项目根目录的 `bmpbgs.ico`。`BMPBGS.exe` 是 Windows GUI 程序，启动控制台和后台服务时不会弹出命令行窗口。

## 安装和数据位置

每次安装均显示程序安装位置页，允许中文路径。随后显示独立的数据存储位置页，默认使用安装盘的 `BMPBGS-Data`，检查写入权限并自动创建。数据目录必须是本地磁盘的英文绝对路径；没有权限时可改选其他目录。静默安装可使用 `/DATADIR=D:\BMPBGS-Data`。

运行数据均位于所选数据目录：

- 数据库：`pgdata`
- 备份：`backups`
- 上传文件：`uploads`
- 项目文件：`storage\projects`
- 中文安装路径下的 PostgreSQL 运行时：`runtime\pgsql`

安装目录中的 `bb-data-path.txt` 记录数据目录，`bb-config.json` 保存端口等运行配置。升级时自动复用记录的数据目录；更换目录不会自动迁移旧数据，可先备份，再在新目录恢复。

安装时会补齐数据目录中缺失的出厂模板，并更新本版指定的原始记录模板；其余已有模板保持原样。模板已更新。如您此前自行修改过模板，请按需重新导入或替换。

升级安装和卸载不会主动删除上述用户数据。
