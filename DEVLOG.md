# DEVLOG — XDF Toolkits

> 变更时间线，**只追加不回改**。每条：日期 + 改了什么 + **为什么**。
> 面向"人肉可读的历史决策"；面向用户的 Release 说明由流水线自动生成，此处不重复。

---

## 2026-10-24 · 安全整改批次一

- `src/mcp/httpServer.ts`：token 校验改 `crypto.timingSafeEqual` 恒定时间比较；SSE 连接登记 + `closeAllConnections`（修 stop() 挂起，2 秒兜底）；`version` 改由构造参数传入（取 manifest.version）。
- `src/main.ts`：API Key 迁入 Obsidian SecretStorage（旧明文配置自动迁移），设置页剥离密钥明文；bindLan 且无 token 时拒绝启动服务。
- 新增 `src/xdf/validateArgs.ts` 轻量入参校验，`callTool` 入口统一校验；lesson 传日期入参改为明确报错；write_checkbox 保留 CRLF；query_db limit 文档统一 200；`createVipArchive` 改 `writeIfNotExists` 防覆盖档案；LLM `max_tokens` 兜底 8000。
- manifest `minAppVersion` 提至 1.11.0；设置页新增「复制连接凭证 / 重新生成 token」。
- **为什么**：工具把教学数据经 HTTP 暴露给外部 agent，属敏感面；先堵「一眼就能被滥用」的问题（明文密钥、token 时序泄露、入参裸奔），修法全部走最小改动。

## 2026-10-24 · 构建产物统一落盘 dist

- `esbuild.config.mjs` 产出从根目录 `main.js` 改为 `dist/main.js`，manifest.json 与 styles.css 一并复制进 dist；`release.yml` 的 `ARTIFACT_DIR` 同步改 `dist`；`.gitignore` 补 `dist/`、`main.js`，删除历史根目录 main.js。
- **为什么**：系统内其他插件（base / ClassTracker / gateway）产物均落 dist，tookits 是例外；统一后产物路径只有一种答案，release 收取目录不再特判。

## 2026-10-24 · CORS 删除回滚（事故记录）

- 上批安全整改误删 httpServer.ts 入口的 CORS 头与 OPTIONS 分支（净减 3 行），导致 AI Chatbot 插件页（`app://obsidian.md` 源）fetch 本服务全部被预检拦截而断连，已原样恢复并加注释。
- **为什么**：Obsidian 内插件互连也是浏览器语境——带 Authorization 等自定义头的请求必先发预检，而预检不带 Authorization，故 CORS 应答必须位于 token 校验之前。教训：删代码前先确认每处行为谁在依赖。

## 2026-10-17 · 清理历史裸 tag `0.1.5`

- 删除裸 tag `0.1.5` 及其 Release（非流水线产物，属旧 `tag-version-prefix: ""` 时代的遗留），仓库 tag 自此全部为 `v*`。
- **为什么**：流水线只由 `v*` 触发，裸 tag 不触发构建；且非 `v` 前缀会搅乱「取最新 tag」类脚本的排序。

## 2026-10-17 · 抽取 LLM 传输层为 `src/model.ts`

- 新建 `src/model.ts`：文本 / 视觉两套独立 provider（`resolveTextProvider` / `resolveVisionProvider`）→ 统一 `chatRequest` → `chatText` / `chatVision`。
- 删除 `src/xdf/tools.ts` 的 `chatComplete` 与 `src/settings.ts` 的 `chatJson`，调用点（日常反馈生成、设置页测试连接 / 提取语气）改用 `chatText`。
- 设置页新增「视觉模型」独立配置组（Base URL / API Key / 模型名），测试连接用 1×1 PNG 走 `chatVision`。
- **为什么**：原先两处 LLM 调用实现重复、只改一处会漂移；视觉能力需要独立供应商配置。传输层收口后，超时/`max_tokens`/`response_format` 只需在 `model.ts` 一处演进。

## 2026-10-16 · 统一发布流水线

- 新增 `.github/workflows/release.yml`：推送 `v*` tag 触发，校验 `package.json` / `manifest.json` / tag 三者版本一致后构建并发布，release notes 自动生成。
- **为什么**：统一发布口径，避免手搓 Release 与版本不一致。

## 2026-10-16 · 文档与测试资产

- `PENDING` 补充「代码审查整改计划（2026-10-04）」。
- 纳入 `test-grader/` 测试脚本与 prompts，忽略本地测试数据。

## 2026-09-14 · v0.1.13 / v0.1.14 Tool Schema 规范化

- 补全所有工具参数的 description，修正 `dates` 参数类型（string → string|array）。
- **为什么**：外部 agent 反馈 `target` 无描述、`dates` 类型写错导致试错。

## 2026-09-11 ~ 09-13 · 语气与索引体验

- v0.1.9：语气设置重构、测试连接按钮、端口冲突自动处理。
- v0.1.11 / v0.1.12：语气预设组 + Subject 注入 + 称呼加姓名；称呼说明细化、禁止第二人称、要求第三人称。
- 改用 `requestUrl` 替代 `fetch`（解决 CORS）。
- v0.1.8 / v0.1.9（索引）：档案页课程索引链接补全 nav 文件名；统一课程索引显示格式、去掉课型分隔符；新课型插入时删除原分隔符、块自身带 `---`。

## 2026-09-03 ~ 09-09 · 移植与建档

- 2026-09-03：把 XDF MCP 工具移植进 Obsidian HTTP 插件（首个可用版本）；通过 `_xdfBase.getDBApi` 绑定 xdf-base，恢复原始档案模板。
- 2026-09-04：对齐 Python MCP 逻辑，修复 4 个核心问题（v0.1.5）；反馈按 `md_utils` 完整学员块生成，禁止空名单班课建课（v0.1.4）；v0.1.6 统一 description 格式并加入 `references/` 上游目录。
- 2026-09-09：v0.1.7 frontmatter links 补全 nav 文件路径。
