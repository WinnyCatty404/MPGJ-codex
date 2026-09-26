# BB 密评协同管理系统

由现有 HTML 原型和 Word 业务模板重构的前后端分离应用。

## 技术栈

- 前端：Vue 3、TypeScript、Vite
- 后端：Node.js、Express、TypeScript
- 数据库：PostgreSQL 18
- 数据结构：关系表保存核心业务，JSONB 保存阶段表单的可扩展字段

## 本地运行

1. 复制 `.env.example` 为 `.env`，填写数据库口令和 JWT 密钥。
2. 执行 `database/setup.ps1` 初始化本地数据库。默认安装目录为 `D:\BBMipingDB`，端口为 `54328`。
3. 执行 `npm install`。
4. 执行 `npm run dev`。
5. 浏览器访问 `http://localhost:5173`。

日常启动可直接运行 `start-local.ps1`；数据库也可分别用 `database/start.ps1` 和 `database/stop.ps1` 启停。

初始管理员：`admin` / `Admin@123`。首次部署后请立即修改。
