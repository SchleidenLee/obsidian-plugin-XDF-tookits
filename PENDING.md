# PENDING — XDF Toolkits

> 待办清单。分区：**⚪ 待定**（方案未定）/ **🟡 已定待做**（方案已定，等动手）/ **🟢 进行中**。
> 完成一项后：从本文件**删除**该条 → 在 [DEVLOG.md](./DEVLOG.md) 追加一行 → 现状变了就更新 [ARCHITECTURE.md](./ARCHITECTURE.md)。
> 每条带「白话」解释 + 一个 💬 回复框，看完在框里写你的意见即可（不改也行、有别的想法也写这）。

---

## 🟢 进行中

（无）

---

## 🟡 已定待做

### A. 代码审查整改

#### A2. AI 写反馈没人把关 🔴严重

- [ ] **反馈生成链路对 LLM 输出零清洗零校验** — `src/xdf/feedbackPrompt.ts` / `src/xdf/tools.ts`（`generate_daily_feedback`）/ `src/xdf/markdown.ts`（`upsertAiBlock`）
  - 白话：生成日常反馈时，模型返回什么就**原样写进学生档案**，中间不做任何检查。模型要是回了"好的，以下是反馈："这种开场白、带代码围栏、或者干脆回个空壳（"（无）"），都会照写不误——这是学生能看到的页面。
  - 方案：改用 `response_format` 结构化输出取字段（见 B）；过渡期做「去围栏 + 去首尾解释句 + 最小长度校验 + 空壳拒绝」，**校验失败不落盘**并返回 error。
  - 💬 回复：

#### A3. 调 AI 没有超时 🟠高

- [ ] **LLM 请求无超时** — `src/model.ts` / 调用点
  - 白话：请求模型接口时没有设"最多等多久"，对面服务器卡住就一直干等着。
  - 现象：`requestUrl` 无 timeout（`max_tokens` 已于 2026-10-24 兜底 8000）。
  - 方案：用 `AbortController`/`Promise.race` 包超时（如 60s），超时抛错并由调用方「失败不落盘」。
  - 💬 回复：

#### A4. 数据库查询方式笨 🟡中

- [ ] **query_db 先在内存全量取回再 JS 切片** — `src/xdf/tools.ts`
  - 白话：查库把结果**整表拉回内存**，再在 JS 里砍掉多余行。表一大就浪费内存。
  - 方案：对已确认的 SELECT/WITH、且未含 LIMIT 时安全追加 `LIMIT n`；或对返回行数设硬上限。
  - 💬 回复：
- [ ] **明显 N+1 查询** — `src/xdf/tools.ts`（list_classes / list_one_on_one / list_all_students / list_lessons / list_student_lessons）
  - 白话：明明一句话能问完的，现在是"问一个、再问一个"地循环问数据库，来回跑很多趟，慢。list 类工具的课次区间还是"穷举 1~N 逐条验证有没有这节课"（原 19-4），更笨。
  - 方案：JOIN + GROUP BY 一次性聚合，或批量查询后内存 join；穷举区间一并改为直接 SQL 聚合（2026-10-24 注）。
  - 💬 回复：

#### A5. 写文件路径不设防 🟡中

- [ ] **路径未净化，可越界写入** — `src/xdf/tools.ts`（lessonFolder）/ `src/xdf/archiveCreate.ts`
  - 白话：写文件的路径是直接拼出来的，传 `../xxx` 这种名字能写到档案库**外面**去。前提是攻击者已经能调 MCP，属于加固项，不急。
  - 方案：抽出统一 `sanitizeVaultPath`（拒绝 `..`、盘符、`\0`，校验仍在预期根目录下），所有拼路径处调用。
  - 💬 回复：

#### A6. HTTP 服务没有"包裹大小"上限 🟡中

- [ ] **HTTP 请求体无大小上限** — `src/mcp/httpServer.ts`
  - 白话：来多大的请求都照收，恶意程序可以发超大包把服务撑爆。
  - 方案：累计字节超阈值（1–2MB）即 `413` 并销毁连接。
  - 💬 回复：

#### A7. 成败判断靠"看关键字" 🟡中

- [ ] **错误识别依赖字符串匹配** — `src/xdf/tools.ts`（`ok()`/`err()`）/ `src/mcp/httpServer.ts`
  - 白话：判断"这次操作是成功还是失败"，现在靠在返回文本里找关键字。文本里碰巧含那个词就会误判。历史遗留。
  - 方案：`callTool` 返回结构化对象（`{ok, data|error}`），isError 由字段判定（与 B 的「内部调用改函数直调」一并做）。
  - 💬 回复：
- [ ] **两份重复 LLM 调用实现** — 已于 2026-10-17 抽取 `src/model.ts` 解决（残留的 `response_format`/超时参数化并入 B）。✅ 无需回复

#### A8. 按名字找人靠"包含" 🟡中

- [ ] **学员名按子串匹配易串扰** — `src/xdf/tools.ts`（generate_daily_feedback / extract_raw / extract_feedback / extract_content 共 5 处 `includes(student)`；`list_student_lessons` 的 SQL `LIKE`）
  - 白话：找学生的依据是"这段文字里包含这个名字"——**张宇会匹配到张宇彤**，反馈可能写错人。
  - 方案：markdown.ts 加 `isStudentHeading`（`👤 名字` 后跟行尾或分隔符）替换 5 处 includes；SQL `LIKE` 改锚定模式；提名字后做等值比较而非 `includes`。
  - 注：改严格后需配真实库回归验证（原查得到的可能查不到）。
  - 💬 回复：

#### A9. 小加固 🟢低

- [ ] **CORS 通配** — `src/mcp/httpServer.ts` → 收紧 `Access-Control-Allow-Origin`，bindLan 时尤其收紧。
  - 白话：HTTP 服务对**任何网站**都发放行卡。如果配合空 token，你浏览的任意网页都能悄悄操作你的教学数据库。
  - ⚠ 回滚教训（2026-10-24）：曾尝试"直接删 CORS 头"，导致 chatbot 插件页（`app://obsidian.md` 源）预检失败断连，已回滚恢复通配。Obsidian 内插件互连也是浏览器语境——**CORS 应答必须保留且位于 token 校验之前**，收紧时只改 Origin 策略，并连同 Obsidian 内调用方的连接方式一并评估。
  - 💬 回复：
- [ ] **语气提取用贪婪正则 + `JSON.parse`（脆弱解析）** — `src/settings.ts` → 纳入 B 的结构化输出改造。
  - 白话：从 AI 回复里抠 JSON 用的是正则硬抠，模型多回一句话就解析崩。跟 B 组一起改。
  - 💬 回复：
- [ ] **`parseLessonRange` 对越界/超长区间无上限** — `src/xdf/markdown.ts` → 区间跨度设上限（如 ≤200）并报错。
  - 白话：传"1-99999"它就老实排一万个数，加个上限直接报错。
  - 💬 回复：
- [ ] **`loadArchiveInfo` 非 db 分支返回空对象，未读 md** — `src/xdf/archiveCreate.ts` → 明确与 `loadArchiveInfoAsync` 的职责或合并。
  - 白话：这个函数有个分支只返回空壳不读文件，职责不清，理一理。
  - 💬 回复：
- [ ] **双锁文件（npm + pnpm 并存易漂移）** — 待用户点头后删除 `package-lock.json`（留 `pnpm-lock.yaml`），并在 package.json 补 `packageManager` 字段对齐 Base（pnpm@10.32.1）。
  - 白话：npm 和 pnpm 是两种"装依赖工具"，各留一份"版本清单"，两份并存容易打架。留 pnpm（工作区 Base 标准），删另一份。**等你点头。**
  - 💬 回复：

### B. 结构化输出改造（重点）

> 白话：A2 的根治版——让模型按**固定 JSON 格式**返回（比如 `{"feedback": "..."}`），程序取字段、做校验，不合格不落盘。从"碰运气洗文本"变成"合同验货"。

背景：目标模型（v4.1 flash）支持结构化输出，把「数据清洗」改为「模型结构化输出」。两条链路：

- [ ] **链路一 · 反馈生成**：请求体加 `response_format`（`json_schema`，`name: daily_feedback`，字段 `feedback`，`strict:true` + `additionalProperties:false`）；落盘改为取 `feedback` 字段后再写；`upsertAiBlock` 保留为最后防线。
- [ ] **链路二 · 语气提取**：`src/settings.ts` 的贪婪正则 + `JSON.parse` 改为 `response_format`（`name: tone_extract`，字段 `address/avoid/style`）+ schema 校验，非法则拒绝写入。
- [ ] **内部调用改函数直调**：写盘改为直接调用函数（如 `writeFeedback()`）返回结构化对象，去掉 JSON 字符串往返与子串判定。（白话：现在是"自己给自己寄信"——内部调用也走一遍 HTTP/JSON 字符串，改成直接调函数。）
- [ ] **兜底策略**（上游不支持结构化时）：去代码围栏 → 去首尾解释句 → 长度校验（拒绝「（无）/待生成」空壳）→ **校验失败不落盘**并返回 error。
- [ ] **兼容性实测**：确认 v4.1 flash 是否支持 `json_schema` 严格模式 / `json_object`；确认 `max_tokens`、`temperature` 在结构化下的行为；确认截断（`finish_reason=length`）需重试。
- 💬 回复：

### C. 设置页 UI 改造

> 白话：设置页美化——顶部加个标题牌，设置项按"常用的放外面、高级的收起来"分区，底部加版本号作者。

现状问题：无 Banner（直接 `h2`）、所有设置线性排列、无版本/作者信息。

- [ ] 添加 Banner（图标 + 标题 `XDF Toolkits` + 副标题 `教学档案 MCP 服务端`）。
- [ ] 设置分区：首页放高频项（服务状态、启用开关、端口、允许局域网）；「高级设置」折叠区放访问令牌、模型配置（文本 + 视觉）。
- [ ] 添加 Footer（版本号 + 作者）。
- 改动文件：`src/settings.ts`。
- 💬 回复：

---

## ⚪ 待定

> 来自上游 Python 版迁移差距（详见 [ARCHITECTURE.md](./ARCHITECTURE.md) 第 7 节）。方案未定，先记需求。

### D. 日常反馈增强（🔴 高优先）

> 白话：给"生成日常反馈"补上几个缺的功能。

- [ ] **智能原始记录补充**：学员原始记录 < 5 条时，提取授课内容 + 近 2 课反馈 → LLM 补造 3 条。（白话：记录太少时 AI 自己补几条像样的。）
- [ ] **出勤感知跳过**：检查 DB checkbox 的 `leave` 状态，跳过缺勤学员。（白话：请假的学生不生成反馈。）
- [ ] **等待 DB 同步**：轮询 files 表 mtime，确保 Obsidian 插件写入完成。（白话：等数据真正落库再动手。）
- [ ] **异步任务 + 进度**：后台执行 + 进度跟踪（依赖 F）。
- 💬 回复：

### E. 结班反馈 & OCR / 评分体系（🟡 中优先 · 走 n8n）

> 白话：结班反馈、答题卡识别（OCR）、打分这些重活，**不在 Obsidian 插件里做**——放到你自己的 n8n 服务器上跑，插件只负责传数据、拿结果。（2026-10-24 定的方向，以下条目仅作 n8n 侧需要什么能力的备忘。）

- [ ] 结班反馈 v2 工作流（`Grader` 路由器 + `BaseGrader` + 雅思学术类评分 + 初级教材评分）。
- [ ] OCR / 图片处理脚本（答题卡识别、批改、图片压缩、缓存初始化）。
- [ ] 评分配置文件（初/中级教材与讲义 JSON）。
- 说明：结班反馈 v1 已有 v2 路线，**跳过 v1**；上述为长任务，受"进程内同步"架构限制（见 ARCHITECTURE 第 7 节）。
- 💬 回复：

### F. 任务管理基础设施（🟢 低优先）

> 白话：给"跑很久的任务"配的后台设施——进度记录、日志、任务取消。D 组的异步功能要用它。

- [ ] 进度文件（`progress/` JSON，每步更新）、日志文件（`logs/`）、子进程管理。
- [ ] `query_task_progress` / `cancel_task` 实质实现 —— 若保持同步架构则**无需**。
- 💬 回复：
