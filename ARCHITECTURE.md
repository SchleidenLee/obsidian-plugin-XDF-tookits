# ARCHITECTURE — XDF Toolkits

> 现状架构说明。定位与使用见 [README.md](./README.md)；待办见 [PENDING.md](./PENDING.md)；变更史见 [DEVLOG.md](./DEVLOG.md)。

## 1. 定位

Obsidian 桌面端插件（`isDesktopOnly: true`，id `xdf-toolkits`）。启用后在本机起一个 HTTP MCP 服务，把「教学档案」的查询/写入/建档能力暴露给同库 Agent 插件或任意 MCP 客户端。上游蓝本是 Python 版 [MCP-XDF-Assistant](https://github.com/SchleidenLee/MCP-XDF-Assistant)，仅移植**工具面**，OCR/评分/结班反馈仍留在 Python/VPS 侧。

## 2. 目录结构

```
src/
├── main.ts               插件生命周期入口（Plugin 子类）
├── settings.ts           设置模型 + 设置页（SettingTab）+ 语气预设
├── model.ts              LLM 传输层（文本 / 视觉两套 provider）
├── mcp/
│   └── httpServer.ts     HTTP MCP 服务端（JSON-RPC over HTTP）
└── xdf/
    ├── tools.ts          31 个工具定义（TOOL_DEFS）+ callTool 分发
    ├── db.ts             通过 xdf-base 插件 API 查 SQLite，返回行数组
    ├── markdown.ts       Vault 读写与 Markdown 解析工具函数
    ├── templates.ts      档案 / 课次页模板与时间戳工具
    ├── archiveCreate.ts  建档逻辑（班级 / 一对一 / 课次 / 测试反馈页）
    └── feedbackPrompt.ts 反馈生成的 system/user prompt 与语气提取 prompt
```

配套资源：`migration/`（原始素材迁移脚本与数据）、`references/MCP-XDF-Assistant/`（上游 Python 源码，**真理来源**）、`test-grader/`（结班反馈实验脚本，未纳入插件）。

## 3. 模块职责

| 模块 | 职责 | 关键点 |
|------|------|--------|
| `main.ts` | 加载设置、补随机 token、起停 MCP、注册命令（重启 / 复制 URL）、状态栏、对外暴露 `plugin.api` | `restartServer()` 是唯一的起停入口 |
| `settings.ts` | 设置接口 + 默认值 + 设置页 UI；文本模型组、视觉模型组、「提取语气」按钮与预设 | 视觉 provider 与文本 provider 独立配置 |
| `model.ts` | 唯一 LLM 传输层：`resolveTextProvider` / `resolveVisionProvider` → `chatRequest` → `chatText` / `chatVision` | OpenAI 兼容 `POST {baseUrl}/chat/completions`，Bearer 鉴权；无内建超时（超时归业务层） |
| `mcp/httpServer.ts` | `http.createServer` + JSON-RPC：`initialize` / `tools/list` / `tools/call`；端口冲突自动 ±1 递增；Bearer 鉴权；`GET /mcp` 留 SSE 探活 | `listenHost` 由 `bindLan` 决定 `0.0.0.0` / `127.0.0.1` |
| `xdf/tools.ts` | `TOOL_DEFS`（31 工具 schema）+ `callTool(name, args, ctx)` 分发 + `createXdfDb` | `ok()` / `err()` 返回 JSON 字符串；MCP 层用字符串匹配判错误 |
| `xdf/db.ts` | 解析并调用 xdf-base 的查询口，兼容 `_xdfBase.getDBApi()` 与 `api.db.query` 两种挂法，规整返回行 | 无 xdf-base 时抛错 |
| `xdf/markdown.ts` | 读文件、解析 `## 👤` 学员块、按 section 提取、AI 块 upsert | 反馈正文写入 `<!-- AI_GENERATED_* -->` 块 |
| `xdf/archiveCreate.ts` | 建档：班级 / VIP 档案页、课次页、测试反馈页，nav 链接追加 | — |
| `xdf/templates.ts` | 档案/课次页 Markdown 模板、`updateArchiveTimestamps` 等 | — |
| `xdf/feedbackPrompt.ts` | `DAILY_FEEDBACK_SYSTEM_PROMPT`、`buildDailyFeedbackUserPrompt`、`TONE_EXTRACT_SYSTEM` | — |

## 4. 数据流

```
Agent / MCP 客户端
   │  POST http://127.0.0.1:27183/mcp   (JSON-RPC, Bearer token)
   ▼
McpHttpServer (httpServer.ts)  ── tools/list ──▶ TOOL_DEFS
   │  tools/call
   ▼
callTool(name, args, ctx)  (tools.ts)
   ├─ 读：ctx.db.query(...) ──▶ db.ts ──▶ xdf-base 插件 ──▶ vault/.xdf/xdb.db（SQLite）
   ├─ 读：Vault API（app.vault）读 Markdown 原始记录 / 反馈块
   ├─ 写：read-modify-write Markdown 文件；建档写入档案页/课次页
   └─ 生成：model.ts → chatText / chatVision ──▶ 外部 LLM（NewAPI 兼容口）
```

- **数据源优先级**：优先走 `.xdf/xdb.db`（由 xdf-base 建镜像）；DB 不可用时部分工具回退读 Markdown，部分直接报错。
- **LLM 只在少数工具中使用**：`generate_daily_feedback`（文本）、设置页「提取语气」（文本）；视觉通道（`chatVision`）供后续识图能力使用。
- **写盘模型**：全部为「read → 内存改写 → write」，当前无文件级锁（并发丢失更新为已知待办，见 PENDING）。

## 5. MCP 服务

- 默认地址 `http://127.0.0.1:27183/mcp`，端口冲突时按 +1/-1/+2/-2… 自动让位（最多 50 次）。
- 鉴权：Header `Authorization: Bearer <token>`；`bindLan=false` 时监听 `127.0.0.1`，`true` 时监听 `0.0.0.0`。
- 对外接口：`plugin.api.getStatus()` / `plugin.api.getConfig()`，同库 Agent 可自动探测。

## 6. 工具分类（31）

- **查询（13）**：`list_classes` `list_one_on_one` `list_all_students` `list_lessons` `list_lessons_by_date` `list_student_lessons` `find_lessons` `get_lesson_detail` `extract_raw` `extract_feedback` `extract_content` `check_feedback` `check_todo` `list_pending` `query_db`
- **写入（5）**：`write_feedback` `write_raw` `write_teaching_content` `write_checkbox` `update_archive_index`
- **建档（5）**：`create_class` `create_one_on_one` `create_class_lesson` `create_one_on_one_lesson` `create_test_feedback`
- **生成（2）**：`generate_student_summary` `generate_daily_feedback`
- **未实现桩（3）**：`generate_end_of_class_feedback` `generate_end_of_class_feedback_v2` `query_task_progress` `cancel_task`（明确拒绝 / 返回桩值）

## 7. 迁移状态与已知缺口

上游 Python 31 工具中：**26 个已完整迁移**，`generate_daily_feedback` 部分迁移（缺智能原始记录补充、出勤跳过、异步进度），`generate_end_of_class_feedback`(+v2) / `cancel_task` 为桩或未实现，`query_task_progress` 返回 `unknown`。

未迁移的独立模块（仍留 Python/VPS）：OCR 脚本（答题卡识别/压缩）、评分配置（初/中级教材与讲义 JSON）、Grader 评分体系（路由器 + BaseGrader + 雅思/初级教材）、异步任务基础设施（进度文件/日志/子进程）。

架构性差异：Python 用子进程 + 后台异步，TS 是 Obsidian 进程内同步 → 长任务（结班反馈）无法直接迁移；DB 访问由直连 SQLite 改为经 xdf-base 插件 API。

可行动项已拆分进 [PENDING.md](./PENDING.md)。

## 8. 约定

- LLM 调用**一律**经 `src/model.ts`，不要在业务文件里另起 `requestUrl`。
- 工具返回走 `ok()` / `err()`（JSON 字符串，历史约定）；错误态判定目前依赖字符串匹配（待改造）。
- 构建：`npm run build` = `tsc -noEmit -skipLibCheck` + `esbuild` 产出 `dist/main.js`（manifest.json 与 styles.css 一并复制进 dist）。
- 版本号三处需一致：`package.json` / `manifest.json` / release tag。
