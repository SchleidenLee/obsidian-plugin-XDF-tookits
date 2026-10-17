# DEVLOG — XDF Toolkits

> 变更时间线，**只追加不回改**。每条：日期 + 改了什么 + **为什么**。
> 面向"人肉可读的历史决策"；面向用户的 Release 说明由流水线自动生成，此处不重复。

---

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
