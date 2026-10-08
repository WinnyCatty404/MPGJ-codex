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

默认安装到 `%LOCALAPPDATA%\BMPBGS`，用户可在安装向导中选择任意磁盘，但路径必须只含英文、数字和常用符号，例如 `D:\BMPBGS`。

运行数据均位于实际安装目录：

- 数据库：`data\pgdata`
- 备份：`data\backups`
- 上传文件：`uploads`
- 项目文件：`storage\projects`
- 运行配置：`bb-config.json`

升级安装和卸载不会主动删除上述用户数据。
