# MCP-XDF-Assistant → XDF Toolkits 迁移差距统计

> 对比 `references/MCP-XDF-Assistant/`（Python）与 `src/`（TypeScript）的功能差异

---

## 一、工具级对比总览

| Python 工具 | TS 状态 | 差距说明 |
|---|---|---|
| `list_classes` | ✅ 已迁移 | — |
| `list_one_on_one` | ✅ 已迁移 | — |
| `list_all_students` | ✅ 已迁移 | — |
| `list_lessons` | ✅ 已迁移 | — |
| `list_lessons_by_date` | ✅ 已迁移 | — |
| `list_student_lessons` | ✅ 已迁移 | — |
| `find_lessons` | ✅ 已迁移 | — |
| `get_lesson_detail` | ✅ 已迁移 | — |
| `extract_raw` | ✅ 已迁移 | — |
| `extract_feedback` | ✅ 已迁移 | — |
| `extract_content` | ✅ 已迁移 | — |
| `check_feedback` | ✅ 已迁移 | — |
| `check_todo` | ✅ 已迁移 | — |
| `list_pending` | ✅ 已迁移 | — |
| `query_db` | ✅ 已迁移 | — |
| `write_feedback` | ✅ 已迁移 | — |
| `write_raw` | ✅ 已迁移 | — |
| `write_teaching_content` | ✅ 已迁移 | — |
| `update_archive_index` | ✅ 已迁移 | — |
| `write_checkbox` | ✅ 已迁移 | — |
| `create_class` | ✅ 已迁移 | — |
| `create_one_on_one` | ✅ 已迁移 | — |
| `create_class_lesson` | ✅ 已迁移 | — |
| `create_one_on_one_lesson` | ✅ 已迁移 | — |
| `create_test_feedback` | ✅ 已迁移 | — |
| `generate_student_summary` | ✅ 已迁移 | — |
| `generate_daily_feedback` | ⚠️ 部分迁移 | 缺少智能原始记录补充、出勤跳过、异步任务 |
| `generate_end_of_class_feedback` | ❌ 未迁移 | 整个结班反馈 v1 工作流缺失 |
| `generate_end_of_class_feedback_v2` | ❌ 未迁移 | 整个结班反馈 v2 工作流缺失 |
| `query_task_progress` | ⚠️ 桩实现 | 返回 unknown，无实际功能 |
| `cancel_task` | ⚠️ 桩实现 | 返回 noop，无实际功能 |

---

## 二、缺失功能详细清单

### 2.1 结班反馈 v1 工作流（整条链路缺失）

**来源**: `scripts/workflows/end_of_class_feedback_generator.py`

| 子功能 | 说明 |
|---|---|
| 缓存初始化 | 扫描学员花名册 + 答题卡图片 + 配置文件 + 历史反馈，生成 cache JSON |
| 答题卡 OCR | 调用多模态视觉 LLM，识别答题卡图片中的 40 道题答案 |
| 图片压缩 | 超过 4MB 的图片自动压缩后再送 OCR |
| IELTS 评分 | 对比标准答案，计算原始分 → 换算雅思 band 分 |
| 结班反馈生成 | 综合评分结果 + 历史反馈，LLM 生成结班总结 |
| 并行处理 | ThreadPoolExecutor 3 线程并行 OCR 和反馈生成 |
| 断点续跑 | 支持 `full` / `ocr` / `resume` 三种模式 |

### 2.2 结班反馈 v2 工作流 + Grader 体系（整条链路缺失）

**来源**: `scripts/v2_workflows/`

| 子功能 | 来源文件 | 说明 |
|---|---|---|
| Grader 路由器 | `grader.py` | 按 course_type 动态分发到对应评分模块 |
| BaseGrader 基类 | `graders/base.py` | 抽象评分接口 + T/F/NG 匹配 + LLM 翻译题评分 |
| IELTS Academic 评分 | `graders/default.py` | 标准 40 题雅思学术类评分 |
| 初级教材评分 | `graders/初级教材.py` | 100 分制，6 种题型，翻译题用 LLM 梯度评分 |
| 结班反馈 v2 | `end_of_class_feedback.py` | 同 v1 流程，但用 Grader 体系替代硬编码评分 |

### 2.3 OCR / 图片处理脚本（全部缺失）

**来源**: `scripts/ocr/`

| 脚本 | 说明 |
|---|---|
| `ocr_answer_sheet.py` | 答题卡 OCR，多模态视觉 API，支持单张/批量，自动压缩 |
| `grade_answer_sheet.py` | 答案批改 + band 分换算，支持 Academic / General 两种公式 |
| `compress_images.py` | 图片压缩（Pillow），控制尺寸和 JPEG 质量 |
| `init_end_of_class_cache.py` | 结班反馈缓存初始化（花名册 + 图片匹配 + 配置 + 历史） |

### 2.4 评分配置文件（全部缺失）

**来源**: `configs/`

| 文件 | 说明 |
|---|---|
| `初级教材.json` | L1 教材，100 分制，6 大题，含翻译题 grammar_focus |
| `初级讲义.json` | L1 讲义评分配置 |
| `中级教材.json` | L2 教材评分配置 |
| `中级讲义.json` | L2 讲义评分配置 |

### 2.5 日常反馈增强功能（部分缺失）

**来源**: `scripts/workflows/daily_feedback_generator.py`

| 子功能 | Python 行为 | TS 现状 |
|---|---|---|
| 智能原始记录补充 | 学员 <5 条原始记录时，提取授课内容 + 近 2 课反馈 → LLM 补造 3 条 | ❌ 未实现 |
| 出勤感知 | 检查 DB checkbox 中的 "leave" 状态，跳过缺勤学员 | ❌ 未实现 |
| 异步任务 + 进度 | 后台进程执行，5 步进度跟踪，支持轮询 | ❌ 同步执行，无进度 |
| 等待 DB 同步 | `wait_for_sync()` 轮询 files 表 mtime 确保 Obsidian 插件写入完成 | ❌ 未实现 |

### 2.6 任务管理基础设施（缺失）

| 子功能 | Python 行为 | TS 现状 |
|---|---|---|
| 进度文件 | `progress/` 目录，JSON 格式，每步更新 | ❌ 无 |
| 日志文件 | `logs/` 目录，运行时日志 | ❌ 无 |
| 子进程管理 | 后台启动子进程，支持 kill | ❌ 无（同步执行） |

---

## 三、架构层面差异

| 维度 | Python | TypeScript | 影响 |
|---|---|---|---|
| 执行模型 | 子进程 + 后台异步 | Obsidian 进程内同步 | 结班反馈等长任务无法迁移 |
| DB 访问 | 直连 SQLite + MD fallback | 通过 xdf-base 插件 API | 无 MD fallback，依赖 xdf-base |
| LLM 调用 | `openai` SDK，独立配置 | 内置 fetch 调用，插件设置中配置 | 已迁移，但 OCR 多模态未迁移 |
| OCR 能力 | Pillow + 多模态视觉 API | 无 | 完全缺失 |
| 文件操作 | 直接读写文件系统 | Obsidian Vault API | 已迁移，且更优 |
| 配置管理 | `.env` 环境变量 | Obsidian 设置面板 | 已迁移，且更优 |

---

## 四、迁移优先级建议

| 优先级 | 功能 | 理由 |
|---|---|---|
| 🔴 高 | 日常反馈：智能原始记录补充 | 直接影响日常使用质量 |
| 🔴 高 | 日常反馈：出勤感知跳过 | 避免给缺勤学员生成反馈 |
| 🟡 中 | 结班反馈 v2 完整工作流 | 核心业务功能，目前只能用 VPS |
| 🟡 中 | OCR + 评分体系 | 结班反馈的前置依赖 |
| 🟡 中 | 评分配置文件 | 配合 Grader 体系使用 |
| 🟢 低 | 异步任务 + 进度追踪 | 结班反馈迁移后再考虑 |
| 🟢 低 | 结班反馈 v1 | 已有 v2，v1 可跳过 |
| ⚪ 不需 | `query_task_progress` / `cancel_task` 实质实现 | 若保持同步架构则无需 |

---

## 五、统计摘要

- **Python 工具总数**: 31（含 2 个 end-of-class + 2 个 task 管理）
- **TS 已完整迁移**: 26 个工具
- **TS 部分迁移**: 2 个（`generate_daily_feedback`、`query_task_progress`）
- **TS 桩/未实现**: 3 个（`generate_end_of_class_feedback`、`_v2`、`cancel_task`）
- **缺失独立模块**: 4 个 OCR 脚本、4 个评分配置、3 个 Grader 模块、1 个 Grader 路由器
- **缺失架构能力**: OCR/图片处理、异步任务管理、断点续跑
