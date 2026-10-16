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
  - 方案：改真正只读连接（`PRAGMA query_only=ON`）；无法改底层时，强制 `WITH` 必须以 `SELECT`/`VALUES` 结束，正则拒绝 `insert|update|delete|replace|drop|alter|create`。

- [ ] **反馈生成链路对 LLM 输出零清洗零校验** — `src/xdf/feedbackPrompt.ts` / `src/xdf/tools.ts`（`generate_daily_feedback`）/ `src/xdf/markdown.ts`（`upsertAiBlock`）
  - 现象：模型输出原样作为 `content` 落盘；`upsertAiBlock` 只 `trim()`，无围栏剥离、无前言过滤、无空壳校验。
  - 影响：前言 / 代码围栏 / 思考过程可能写进学生可见块；空壳静默落盘。
  - 方案：改用 `response_format` 结构化输出取字段（见 B）；过渡期做「去围栏 + 去首尾解释句 + 最小长度校验 + 空壳拒绝」，**校验失败不落盘**并返回 error。

- [ ] **extract_raw / extract_feedback / extract_content 的「日期」入参失效** — `src/xdf/tools.ts` / `src/xdf/markdown.ts`（`parseLessonRange`）
  - 现象：三者统一走 `parseLessonRange`，该函数只认课次号/区间，日期字符串 `2026-07-01` 解析为 `NaN` 被过滤 → 返回空数组且无报错。
  - 影响：Schema 声明接受日期，但传日期必然静默空结果。
  - 方案：`parseLessonRange` 增加日期分支（`^\d{4}-\d{2}-\d{2}$` → 查 lessons 转课次号），或 extract 工具单独处理日期；`nums` 为空时返回明确 error。

### A. 代码审查整改（高）

- [ ] **stop() 可能永久挂起，导致改端口/卸载无法重启** — `src/mcp/httpServer.ts`
  - 现象：`GET /mcp` 返回 `text/event-stream` 且从不 `res.end`，连接长期 keep-alive；`stop()` 等 `srv.close` 回调 → 永不 resolve。
  - 方案：`stop()` 调 `srv.closeAllConnections?.()` 或记录并主动 `destroy` 连接；SSE 加超时/断开监听，`close` 设兜底超时。

- [ ] **读-改-写全程无并发保护（丢失更新）** — `src/xdf/tools.ts`（write_feedback / write_raw / write_teaching_content / update_archive_index / write_checkbox）、`src/xdf/archiveCreate.ts`（appendNextLink）
  - 现象：全部 `readFile` → 内存改写 → `writeFile`，无文件锁/版本校验。
  - 方案：引入按路径的异步互斥队列（`Map<path, Promise>` 串行化）；用 `app.vault.process`（原子 read-modify-write）替代裸 read+write。

- [ ] **bindLan 叠加空 token 时服务无鉴权** — `src/mcp/httpServer.ts` / `src/settings.ts` / `src/main.ts`
  - 现象：鉴权仅当 `token` 非空才生效；设置页可清空 token，运行中不再补。
  - 方案：`bindLan=true` 时强制非空 token（空则拒绝启动）；设置页在 bindLan 开启且 token 为空时阻止保存或自动生成。

- [ ] **LLM 请求无超时、无 max_tokens** — `src/model.ts` / 调用点
  - 现象：请求体只传 `model/messages/temperature`，`requestUrl` 无 timeout。
  - 方案：请求体加 `max_tokens`；用 `AbortController`/`Promise.race` 包超时（如 60s），超时抛错并由调用方「失败不落盘」。

### A. 代码审查整改（中）

- [ ] **query_db 先在内存全量取回再 JS 切片** — `src/xdf/tools.ts`
  - 方案：对已确认的 SELECT/WITH、且未含 LIMIT 时安全追加 `LIMIT n`；或对返回行数设硬上限。
- [ ] **明显 N+1 查询** — `src/xdf/tools.ts`（list_classes / list_one_on_one / list_all_students / list_lessons / list_student_lessons）
  - 方案：JOIN + GROUP BY 一次性聚合，或批量查询后内存 join。
- [ ] **参数未经 schema 校验，`Number()` 可能产生 NaN，enum 未校验** — `src/xdf/tools.ts` / `src/mcp/httpServer.ts`
  - 方案：`callTool` 入口按 `TOOL_DEFS.inputSchema` 做轻量校验；lesson 必须正整数；enum 白名单校验并报错。
- [ ] **路径未净化，可越界写入** — `src/xdf/tools.ts`（lessonFolder）/ `src/xdf/archiveCreate.ts`
  - 方案：抽出统一 `sanitizeVaultPath`（拒绝 `..`、盘符、`\0`，校验仍在预期根目录下），所有拼路径处调用。
- [ ] **create_one_on_one 覆盖已有档案** — `src/xdf/archiveCreate.ts`（`createVipArchive` 用 `writeOrUpdate`）
  - 方案：改为 `writeIfNotExists`，与班课一致；更新走明确的 update 工具。
- [ ] **total_lessons 用「最大课次号」而非课程数量** — `src/xdf/tools.ts`（update_archive_index）/ `src/xdf/templates.ts`
  - 方案：改为 `lessons.length`（或 `COUNT(*)`）。
- [ ] **HTTP 请求体无大小上限** — `src/mcp/httpServer.ts`
  - 方案：累计字节超阈值（1–2MB）即 `413` 并销毁连接。
- [ ] **API Key 明文存储/回显** — `src/settings.ts` / `src/main.ts`
  - 方案：设置页用 password 输入 + 掩码显示；评估加密/钥匙串存储；确认日志不打印 key。
- [ ] **错误识别依赖字符串匹配** — `src/xdf/tools.ts`（`ok()`/`err()`）/ `src/mcp/httpServer.ts`
  - 方案：`callTool` 返回结构化对象（`{ok, data|error}`），isError 由字段判定（与 B 的「内部调用改函数直调」一并做）。
- [ ] **两份重复 LLM 调用实现** — 已于 2026-10-17 抽取 `src/model.ts` 解决（残留的 `response_format`/超时参数化并入 B）。
- [ ] **学员名按子串匹配易串扰** — `src/xdf/tools.ts`（generate_daily_feedback 内）
  - 方案：改为按 `## 👤 <name>` 精确匹配（复用 `findStudentBlock` 语义），提名字后做等值比较而非 `includes`。

### A. 代码审查整改（低）

- [ ] **query_db 默认 limit 文档与实现不一致** — description 写「默认 100」，实现为 200 → 统一数值。
- [ ] **write_checkbox 会把 CRLF 改成 LF** — `src/xdf/tools.ts` → 检测原行尾并还原。
- [ ] **token 非恒定时间比较** — `src/mcp/httpServer.ts` → 用 `crypto.timingSafeEqual`。
- [ ] **CORS 通配** — `src/mcp/httpServer.ts` → 收紧 `Access-Control-Allow-Origin`，bindLan 时尤其收紧。
- [ ] **语气提取用贪婪正则 + `JSON.parse`（脆弱解析）** — `src/settings.ts` → 纳入 B 的结构化输出改造。
- [ ] **`parseLessonRange` 对越界/超长区间无上限** — `src/xdf/markdown.ts` → 区间跨度设上限（如 ≤200）并报错。
- [ ] **`loadArchiveInfo` 非 db 分支返回空对象，未读 md** — `src/xdf/archiveCreate.ts` → 明确与 `loadArchiveInfoAsync` 的职责或合并。

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

### E. 结班反馈 & OCR / 评分体系迁移（🟡 中优先）

- [ ] 结班反馈 v2 工作流（`Grader` 路由器 + `BaseGrader` + 雅思学术类评分 + 初级教材评分）。
- [ ] OCR / 图片处理脚本（答题卡识别、批改、图片压缩、缓存初始化）。
- [ ] 评分配置文件（初/中级教材与讲义 JSON）。
- 说明：结班反馈 v1 已有 v2 路线，**跳过 v1**；上述为长任务，受"进程内同步"架构限制（见 ARCHITECTURE 第 7 节）。

### F. 任务管理基础设施（🟢 低优先）

- [ ] 进度文件（`progress/` JSON，每步更新）、日志文件（`logs/`）、子进程管理。
- [ ] `query_task_progress` / `cancel_task` 实质实现 —— 若保持同步架构则**无需**。
