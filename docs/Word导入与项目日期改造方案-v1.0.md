# Word 导入与项目日期改造方案 v1.0

用途：作为密评工具下一阶段开发的需求与实施依据。本方案尚未实施。

## 1. 背景与目标

当前「项目开始时间 / 结束时间」由新建项目时填写，是报告日期体系的唯一权威来源，并向下派生到测评计划、测评情况简介、附录 B、Word 导出等位置。导入 Word 报告时这些内容不会被覆盖，导致同一份报告存在两套日期来源，容易出现不一致。

本次改造把日期权威来源从「项目管理」搬到「测评计划的 1.3 测评过程」，并让 Word 导入能够回填阶段时间与项目组成员，从而做到报告与系统数据同源。

### 1.1 语义约定

- 项目**开始时间** = 报告 1.3.1 测评准备阶段的开始日期。
- 项目**结束时间** = 报告 1.3.4 分析与报告编制阶段的结束日期。
- 与现有代码一致：报告模板中 1.3.4 的结束占位符本身就是「测评结束时间」，对应页面字段 `plan-phase-4-end`。

## 2. 已确认的决策

1. 取消新建 / 编辑项目弹窗的「开始时间 / 结束时间」输入；`projects.start_date`、`projects.end_date` 保留为**派生副本**，由测评计划字段回写。
2. 复制为复测项目弹窗的两个必填日期一并取消。
3. 导入 Word 时解析 1.3 测评过程四段时间，写入 8 个阶段日期字段，并回写项目起止。
4. 导入 Word 时解析表 1-1 成员，动态增行并自动选中系统用户；系统用户表中不存在的姓名**仅提示、由人工补建**；导出报告的表 1-1 也按实际人数逐行输出。

## 3. 现状事实（改造依据）

### 3.1 报告侧结构

依据 `storage/templates/report/default-report-template.docx`：

- 1.3.1 ~ 1.3.4 每段末尾各有一句阶段时间：
  - `测评准备阶段时间：{{测评准备阶段开始日期}}-{{测评准备阶段结束日期}}`
  - `方案编制阶段时间：{{方案编制阶段开始日期}}-{{方案编制阶段结束日期}}`
  - `现场测评阶段时间：{{现场测评阶段开始日期}}-{{现场测评阶段结束日期}}`
  - `分析与报告编制阶段时间：{{分析与报告编制开始日期}}- {{测评结束时间}}`
- **表 1-1 = 测评项目组成员**，列为「角色 / 姓名 / 任务分工 / 是否通过密评人员考核」；模板只有 2 个数据行（项目负责人、测评项目组成员），多人姓名以「、」合并写入「测评人员」单元格。

### 3.2 页面侧结构

- 阶段日期字段共 8 个：`plan-phase-1..4-start` / `plan-phase-1..4-end`。
- 成员表为 `#plan-tab-7 table.mi-table`，列与报告表 1-1 完全对应；姓名列是**从系统用户目录选择的 select**（`plan-member-N-name`），目前**仅 2 行硬编码、无增删行按钮**。
- `getPlanMembers()` 已按 tbody 遍历，天然支持多行。

### 3.3 日期链路现状

- 唯一权威源：`projects.start_date` / `end_date`（`database/schema.sql`）。
- 写入入口：`POST /api/projects`（日期可选）、`PUT /api/projects/:id`、`POST /api/projects/:id/copy`（日期必填并校验"结束不早于开始"）。
- 派生消费点：
  - 进入项目时 `fillPlanPhaseTemplates` 用项目日期填 `plan-phase-1-start` / `plan-phase-4-end`；
  - `openImplement` 末尾用项目日期**强制覆盖**这两个字段（注释：项目起止日期是报告统一来源）；
  - 后端 `syncProjectDatesInStageData` 在编辑项目、保存任意阶段时把阶段数据中的旧日期文本整体替换为新日期（匹配 ISO 与中文两种写法），并强制写回上述两个字段；
  - 附录 B「评审时间」读取 `plan-phase-4-end`；
  - Word 导出占位符 `project_starttime` / `project_endtime` 及 `evaluate_plan_date`、`evaluate_report_date`、`evaluate_reviewer_date`、`evaluate_archieve_date`、各层面 `evaluate_*_start_date_pic` / `end_date_pic` 均由这些日期派生。
- Word 导入**不覆盖**：系统名称、8 个阶段日期、测评情况简介（`plan-eval-intro`）、测评目的（`plan-eval-purpose`）、附录 B 全部字段；只覆盖系统简介（`plan-sys-intro`）以及资产、测评对象、指标、报告编制内容、现场记录等。

## 4. 改动清单

### A. 前端（原型页需改两份并同步 `frontend/dist/`）

`frontend/src/report-generator.html` 与 `frontend/public/prototype.html` 内容基本一致，运行页为 `frontend/dist/prototype.html`，改完必须复制到 dist。

| 编号 | 内容 |
| --- | --- |
| A1 | 删除新建 / 编辑项目弹窗的两个日期表单项及其 JS 读写（`input-start-date`、`input-end-date` 及相关赋值与保存逻辑） |
| A2 | 复制为复测项目弹窗去掉两个日期输入（原型页与 Vue `App.vue` 的 `copyForm`） |
| A3 | `openImplement` 末段"用项目日期强制覆盖 `plan-phase-1-start` / `plan-phase-4-end`"改为"用阶段数据回填"；项目周期显示改为从计划派生，空值显示「—」 |
| A4 | 成员表由 2 行硬编码改为行模板 + 「＋新增成员 / 删除行」按钮；id 继续使用 `plan-member-N-role/-name/-task/-exam-yes/no`，删除行不重排已有 id（保证历史快照按 id 恢复不错位）；`fillPlanPhaseTemplates` 中对成员行的硬重置改为"确保至少两行 + 仅重置默认角色与任务"；`renderEvalUserSelects` 需覆盖新增行 |
| A5 | `applyWordImport` 新增两块解析：① 1.3 四段时间；② 表 1-1 成员 |
| A6 | 导入日志新增两组信息：「阶段时间变更（原值 → 报告值）」「用户表中缺失的成员姓名」 |

### B. 后端

| 编号 | 内容 | 文件 |
| --- | --- | --- |
| B1 | 保存阶段数据时同步方向反转：从 data 的 `plan-phase-1-start` / `plan-phase-4-end` 取新值 → 更新 `projects.start_date` / `end_date` → 再用旧项目日期做正文文本替换 | `server.ts`（PUT stages 路由） |
| B2 | `syncProjectDatesInStageData` 语义调整，明确**单一方向**：计划字段为源、项目列为副本，避免来回覆盖 | `project-date-sync.ts` |
| B3 | 复制项目接口 `startDate` / `endDate` 改为可选，去掉正则与"结束不早于开始"校验 | `server.ts`（copy 路由） |
| B4 | Word 导出的 `project_starttime` / `project_endtime` 取值顺序反转为**计划字段优先**，否则导出会取回旧的项目列值 | `raw-records.ts` |
| B5 | 新增**表格数据行复制能力**，使报告表 1-1 按成员人数逐行输出（需处理行样式、边框、表题关联；可复用现有 `preventRowSplit` / `addKeepNext` 工具函数），并相应调整 `evaluate_group_leader` / `evaluate_tech_member` 等占位符用法 | `report-template.ts` + `raw-records.ts` |

### C. 数据库

无需改表结构，`projects.start_date` / `end_date` 两列保留。

## 5. 实施顺序（建议分三批）

1. **批次一：日期权威源反转 + 成员行动态化**（A1–A4、B1–B4）。
   验收目标：填计划日期 → 项目周期显示正确 → 导出报告日期一致。做完可先手填计划日期跑通全流程。
2. **批次二：Word 导入解析**（A5–A6）。
   验收目标：导入真实报告后 8 个日期与成员表正确回填，日志可核对。
3. **批次三：报告表 1-1 动态逐行导出**（B5）。
   放最后，因导出回归面最大，单独一批便于定位问题。

分批的好处：批次一完成后，导入出问题时能立刻判断是新解析逻辑还是源头改造引起。

## 6. 风险与对策

- **双向同步打架**：明确"计划为源、项目为副本"，只在「保存阶段数据」与「导入 Word」两个时机回写。
- **日期替换断链**：正文日期被手写成非标准格式（如 `2026.4.1`）时匹配不到 → 保留现有替换逻辑，并把未匹配情况写入日志，不静默失败。
- **表 1-1 解析脆弱**：表题丢失、多人挤一格、合并单元格 → 增加回退识别（角色列含"项目负责人"）与日志告警。
- **历史项目**：老数据项目列与计划字段都有值，首次回写会改变项目列 → 建议仅在"计划字段有值"时才回写。
- **动态行与快照**：删除行不重排已有 id，避免历史快照错位还原。
- **导出加行排版**：保证行不跨页断裂、表题与表格同页。

## 7. 验收清单

1. 新建项目不再出现日期输入；建完项目周期显示「—」，不报错。
2. 测评计划手填 8 个阶段日期并保存 → 项目列表周期等于计划中的开始 / 结束时间；导出报告 1.3 四段时间与页面一致；正文其它位置的旧日期同步替换。
3. 导入一份真实报告：8 个日期与报告一致，导入日志列出日期变更明细；表 1-1 按报告人数建行并自动选中已有用户；缺失姓名在日志中列出。
4. 导出报告表 1-1 与页面成员逐人对应，排版正常（不跨页断裂、表题不脱离）。
5. 复制为复测项目不再要求填日期，复制后日期随新项目的计划走。
6. 审核页、现场测评、风险分析等既有功能不受影响。

## 8. 相关文件索引

- 前端运行页：`frontend/public/prototype.html`（源：`frontend/src/report-generator.html`；运行副本：`frontend/dist/prototype.html`）
- Vue 骨架：`frontend/src/App.vue`
- 后端：`backend/src/server.ts`、`backend/src/project-date-sync.ts`、`backend/src/raw-records.ts`、`backend/src/report-template.ts`
- 数据表：`database/schema.sql`
- 报告模板：`storage/templates/report/default-report-template.docx`（源：`报告模板/密评报告模板_三级.docx`）
- 相关测试：`tools/test-project-date-sync.mjs`、`tools/test-project-edit-live.mjs`
