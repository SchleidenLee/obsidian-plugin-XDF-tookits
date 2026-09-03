# XDF Toolkits

新东方教学档案 **MCP 服务端插件**。从 [MCP-XDF-Assistant](https://github.com/SchleidenLee/MCP-XDF-Assistant) 的工具面移植到 Obsidian：开启后在本机提供 HTTP MCP，给 Agent 插件或其它 MCP 客户端调用。

结班测 OCR / 估分工作流**不在本插件**，仍走原来的 Python / VPS。

## 需要

- Obsidian 桌面端（`isDesktopOnly`）
- 建议同时启用 **XDF-Base**，查询走 vault 里的 `.xdf/xdf.db`

## 安装

BRAT 填仓库：`SchleidenLee/obsidian-plugin-XDF-tookits`  
或从 [Releases](https://github.com/SchleidenLee/obsidian-plugin-XDF-tookits/releases) 下载 `main.js` / `manifest.json` / `styles.css` 放到 `.obsidian/plugins/xdf-toolkits/`。

## 使用

1. 启用插件，状态栏出现 `XDF MCP :27183`
2. 设置里复制 MCP 配置，或让同库的 Agent 插件自动探测 `app.plugins.plugins['xdf-toolkits'].api`
3. 默认地址：`http://127.0.0.1:27183/mcp`  
   Header：`Authorization: Bearer <设置里的令牌>`

模型走设置里的 NewAPI 兼容口，只给 `generate_daily_feedback` 用。

## 工具

查询：`list_classes` `list_one_on_one` `list_all_students` `list_lessons` `list_lessons_by_date` `list_student_lessons` `find_lessons` `get_lesson_detail` `extract_*` `check_feedback` `check_todo` `list_pending` `query_db`

写入：`write_feedback` `write_raw` `write_teaching_content` `write_checkbox` `update_archive_index`

建档：`create_class` `create_one_on_one` `create_class_lesson` `create_one_on_one_lesson` `create_test_feedback`

生成：`generate_student_summary` `generate_daily_feedback`

明确拒绝：`generate_end_of_class_feedback` / `v2`

## 开发

```bash
npm install
npm run build
```

产物：`main.js`。
