# PENDING — XDF Toolkits

> 待办清单。分区：**⚪ 待定**（方案未定）/ **🟡 已定待做**（方案已定，等动手）/ **🟢 进行中**。
> 完成一项后：从本文件**删除**该条 → 在 [DEVLOG.md](./DEVLOG.md) 追加一行 → 现状变了就更新 [ARCHITECTURE.md](./ARCHITECTURE.md)。

> 注：下方「代码审查整改」的行号基准为 **2026-10-04** 的源码快照，`src/model.ts` 抽取后部分行号已偏移，动手时以实际代码为准。

---

## 🟢 进行中

（无）

---

## 🟡 已定待做

### A. 代码审查整改（严重）

- [ ] **query_db 的「只读」可被 CTE-DML 绕过** — `src/xdf/tools.ts`（`query_db` 实现）
  - 现象：仅取首关键字校验（`select`/`with`/`explain`）且仅拦「非末尾分号」；`WITH x AS (SELECT 1) DELETE FROM archives` 可通过校验并执行。
  - 影响：任意 MCP 客户端可改库，破坏只读承诺。
  - 方案（2026-10-24 更新）：toolkits 不持有连接——查询均经 xdf-base 的 `_xdfBase.getDBApi().query` 执行，只读闸须加在 **base 侧**：给 base 的 `getDBApi` 加可选参数（如 `{ readonly: true }`），本插件 `query_db` 调用时带上；先决条件：在 base 的 PENDING.md 立项。过渡期维持现有黑名单校验（强制 `WITH` 以 `SELECT`/`VALUES` 结束，正则拒绝 `insert|update|delete|replace|drop|alter|create`）。

- [ ] **反馈生成链路对 LLM 输出零清洗零校验** — `src/xdf/feedbackPrompt.ts` / `src/xdf/tools.ts`（`generate_daily_feedback`）/ `src/xdf/markdown.ts`（`upsertAiBlock`）
  - 现象：模型输出原样作为 `content` 落盘；`upsertAiBlock` 只 `trim()`，无围栏剥离、无前言过滤、无空壳校验。
  - 影响：前言 / 代码围栏 / 思考过程可能写进学生可见块；空壳静默落盘。
  - 方案：改用 `response_format` 结构化输出取字段（见 B）；过渡期做「去围栏 + 去首尾解释句 + 最小长度校验 + 空壳拒绝」，**校验失败不落盘**并返回 error。

### A. 代码审查整改（高）

- [ ] **LLM 请求无超时** — `src/model.ts` / 调用点
  - 现象：`requestUrl` 无 timeout（`max_tokens` 已于 2026-10-24 兜底 8000）。
  - 方案：用 `AbortController`/`Promise.race` 包超时（如 60s），超时抛错并由调用方「失败不落盘」。

### A. 代码审查整改（中）

- [ ] **query_db 先在内存全量取回再 JS 切片** — `src/xdf/tools.ts`
  - 方案：对已确认的 SELECT/WITH、且未含 LIMIT 时安全追加 `LIMIT n`；或对返回行数设硬上限。
- [ ] **明显 N+1 查询** — `src/xdf/tools.ts`（list_classes / list_one_on_one / list_all_students / list_lessons / list_student_lessons）
  - 方案：JOIN + GROUP BY 一次性聚合，或批量查询后内存 join。
  - 注（2026-10-24）：list 类工具的课次区间目前为「穷举区间逐条验证」（原 19-4），一并改为直接 SQL 聚合。
- [ ] **路径未净化，可越界写入** — `src/xdf/tools.ts`（lessonFolder）/ `src/xdf/archiveCreate.ts`
  - 方案：抽出统一 `sanitizeVaultPath`（拒绝 `..`、盘符、`\0`，校验仍在预期根目录下），所有拼路径处调用。
- [ ] **HTTP 请求体无大小上限** — `src/mcp/httpServer.ts`
  - 方案：累计字节超阈值（1–2MB）即 `413` 并销毁连接。
- [ ] **错误识别依赖字符串匹配** — `src/xdf/tools.ts`（`ok()`/`err()`）/ `src/mcp/httpServer.ts`
  - 方案：`callTool` 返回结构化对象（`{ok, data|error}`），isError 由字段判定（与 B 的「内部调用改函数直调」一并做）。
- [ ] **两份重复 LLM 调用实现** — 已于 2026-10-17 抽取 `src/model.ts` 解决（残留的 `response_format`/超时参数化并入 B）。
- [ ] **学员名按子串匹配易串扰** — `src/xdf/tools.ts`（generate_daily_feedback / extract_raw / extract_feedback / extract_content 共 5 处 `includes(student)`；`list_student_lessons` 的 SQL `LIKE`）
  - 方案：markdown.ts 加 `isStudentHeading`（`👤 名字` 后跟行尾或分隔符）替换 5 处 includes；SQL `LIKE` 改锚定模式；提名字后做等值比较而非 `includes`。
  - 注：改严格后需配真实库回归验证（原查得到的可能查不到）。

### A. 代码审查整改（低）

- [ ] **CORS 通配** — `src/mcp/httpServer.ts` → 收紧 `Access-Control-Allow-Origin`，bindLan 时尤其收紧。注：2026-10-24 曾直接删除 CORS，导致 Obsidian 内 chatbot（`app://obsidian.md` 源）预检失败断连，已回滚恢复通配；收紧需连同 Obsidian 内调用方的连接方式一并评估。
- [ ] **语气提取用贪婪正则 + `JSON.parse`（脆弱解析）** — `src/settings.ts` → 纳入 B 的结构化输出改造。
- [ ] **`parseLessonRange` 对越界/超长区间无上限** — `src/xdf/markdown.ts` → 区间跨度设上限（如 ≤200）并报错。
- [ ] **`loadArchiveInfo` 非 db 分支返回空对象，未读 md** — `src/xdf/archiveCreate.ts` → 明确与 `loadArchiveInfoAsync` 的职责或合并。
- [ ] **双锁文件（npm + pnpm 并存易漂移）** — 待用户点头后删除 `package-lock.json`（留 `pnpm-lock.yaml`），并在 package.json 补 `packageManager` 字段对齐 Base（pnpm@10.32.1）。

### B. 结构化输出改造（重点）

背景：目标模型（v4.1 flash）支持结构化输出，把「数据清洗」改为「模型结构化输出」。两条链路：

- [ ] **链路一 · 反馈生成**：请求体加 `response_format`（`json_schema`，`name: daily_feedback`，字段 `feedback`，`strict:true` + `additionalProperties:false`）；落盘改为取 `feedback` 字段后再写；`upsertAiBlock` 保留为最后防线。
- [ ] **链路二 · 语气提取**：`src/settings.ts` 的贪婪正则 + `JSON.parse` 改为 `response_format`（`name: tone_extract`，字段 `address/avoid/style`）+ schema 校验，非法则拒绝写入。
- [ ] **内部调用改函数直调**：写盘改为直接调用函数（如 `writeFeedback()`）返回结构化对象，去掉 JSON 字符串往返与子串判定。
- [ ] **兜底策略**（上游不支持结构化时）：去代码围栏 → 去首尾解释句 → 长度校验（拒绝「（无）/待生成」空壳）→ **校验失败不落盘**并返回 error。
- [ ] **兼容性实测**：确认 v4.1 flash 是否支持 `json_schema` 严格模式 / `json_object`；确认 `max_tokens`、`temperature` 在结构化下的行为；确认截断（`finish_reason=length`）需重试。

### C. 设置页 UI 改造

现状问题：无 Banner（直接 `h2`）、所有设置线性排列、无版本/作者信息。

- [ ] 添加 Banner（图标 + 标题 `XDF Toolkits` + 副标题 `教学档案 MCP 服务端`）。
- [ ] 设置分区：首页放高频项（服务状态、启用开关、端口、允许局域网）；「高级设置」折叠区放访问令牌、模型配置（文本 + 视觉）。
- [ ] 添加 Footer（版本号 + 作者）。
- 改动文件：`src/settings.ts`。

---

## ⚪ 待定

> 来自上游 Python 版迁移差距（详见 [ARCHITECTURE.md](./ARCHITECTURE.md) 第 7 节）。方案未定，先记需求。

### D. 日常反馈增强（🔴 高优先）

- [ ] **智能原始记录补充**：学员原始记录 < 5 条时，提取授课内容 + 近 2 课反馈 → LLM 补造 3 条。
- [ ] **出勤感知跳过**：检查 DB checkbox 的 `leave` 状态，跳过缺勤学员。
- [ ] **等待 DB 同步**：轮询 files 表 mtime，确保 Obsidian 插件写入完成。
- [ ] **异步任务 + 进度**：后台执行 + 进度跟踪（依赖 F）。

### E. 结班反馈 & OCR / 评分体系（🟡 中优先 · 走 n8n）

> 方向更新（2026-10-24）：不再迁移进插件——执行放自有服务器 n8n，本插件 MCP 只负责传数据、拿结果。以下条目作为 n8n 侧所需能力备查。

- [ ] 结班反馈 v2 工作流（`Grader` 路由器 + `BaseGrader` + 雅思学术类评分 + 初级教材评分）。
- [ ] OCR / 图片处理脚本（答题卡识别、批改、图片压缩、缓存初始化）。
- [ ] 评分配置文件（初/中级教材与讲义 JSON）。
- 说明：结班反馈 v1 已有 v2 路线，**跳过 v1**；上述为长任务，受"进程内同步"架构限制（见 ARCHITECTURE 第 7 节）。

### F. 任务管理基础设施（🟢 低优先）

- [ ] 进度文件（`progress/` JSON，每步更新）、日志文件（`logs/`）、子进程管理。
- [ ] `query_task_progress` / `cancel_task` 实质实现 —— 若保持同步架构则**无需**。
