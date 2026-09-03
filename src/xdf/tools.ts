import type { App } from "obsidian";
import type { XdfToolkitsSettings } from "../settings";
import { createXdfDb, dateOnly, jsonList, type XdfDb } from "./db";
import {
  DAILY_FEEDBACK_SYSTEM_PROMPT,
  buildDailyFeedbackUserPrompt,
  buildToneBlock,
} from "./feedbackPrompt";
import {
  createClassArchive,
  createLessons,
  createTestFeedbackPage,
  createVipArchive,
} from "./archiveCreate";
import {
  ensureStudentBlock,
  extractAiBlock,
  findHeadingRange,
  parseLessonRange,
  readFile,
  setCheckbox,
  upsertAiBlock,
  writeFile,
} from "./markdown";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolContext {
  app: App;
  db: XdfDb;
  settings: XdfToolkitsSettings;
}

function ok(data: unknown) {
  return JSON.stringify({ status: "ok", data }, null, 0);
}
function err(error: string) {
  return JSON.stringify({ status: "error", error });
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireTarget(args: Record<string, unknown>): string {
  const t = String(args.target ?? "").trim();
  if (!t) throw new Error("target 必填");
  return t;
}

function archiveByName(db: XdfDb, name: string) {
  const rows = db.query("SELECT * FROM archives WHERE name = ?", [name]);
  return rows[0] ?? null;
}

function lessonFolder(archiveName: string, lessonNum: number, folderPath?: unknown) {
  if (folderPath) return String(folderPath).replace(/\\/g, "/").replace(/\/$/, "");
  return `Current Class/${archiveName}/${archiveName} Lesson ${lessonNum}`;
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "list_classes",
    description: "列出所有进行中的班课档案（kind=class）。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_one_on_one",
    description: "列出所有进行中一对一学员档案（kind=vip）。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_all_students",
    description: "列出所有学员（班课 + 一对一）。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_lessons",
    description: "列出指定班级或一对一的所有课次。",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", description: "班级名或一对一学员名" } },
      required: ["target"],
    },
  },
  {
    name: "list_lessons_by_date",
    description: "按日期查询当天所有课次。",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD" } },
      required: ["date"],
    },
  },
  {
    name: "list_student_lessons",
    description: "列出指定学员参加的所有课次。",
    inputSchema: {
      type: "object",
      properties: { student: { type: "string" } },
      required: ["student"],
    },
  },
  {
    name: "find_lessons",
    description: "定位课次文件夹。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        lesson: { type: "number" },
        date: { type: "string" },
      },
      required: ["target"],
    },
  },
  {
    name: "get_lesson_detail",
    description: "获取课次详情：路径、出勤/反馈相关 section。",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string" }, lesson: { type: "number" } },
      required: ["target", "lesson"],
    },
  },
  {
    name: "extract_raw",
    description: "提取学员原始记录（sections / Feedback）。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        lesson: { type: ["number", "string"] },
        student: { type: "string" },
      },
      required: ["target", "lesson"],
    },
  },
  {
    name: "extract_feedback",
    description: "提取 AI_GENERATED 反馈块。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        lesson: { type: ["number", "string"] },
        student: { type: "string" },
      },
      required: ["target", "lesson"],
    },
  },
  {
    name: "extract_content",
    description: "提取授课内容或作业。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        lesson: { type: ["number", "string"] },
        type: { type: "string", description: "teaching_content | homework" },
      },
      required: ["target", "lesson"],
    },
  },
  {
    name: "check_feedback",
    description: "检查指定档案的反馈提交状态。",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "check_todo",
    description: "检查指定档案待办（未提交反馈等）。",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "list_pending",
    description: "列出所有待发送反馈的课次。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "query_db",
    description: "只读 SQL。仅 SELECT/WITH/EXPLAIN。七表：archives/lessons/sections/checkboxes/class_roster/students/files。",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string" }, limit: { type: "number" } },
      required: ["sql"],
    },
  },
  {
    name: "write_feedback",
    description: "写入 AI 反馈到 AI_GENERATED 块。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        lesson: { type: "number" },
        student: { type: "string" },
        content: { type: "string" },
        feedback_type: { type: "string", description: "student_feedback | class_feedback" },
      },
      required: ["target", "lesson", "content"],
    },
  },
  {
    name: "write_raw",
    description: "写入学员原始记录字段。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        lesson: { type: "number" },
        student: { type: "string" },
        content: { type: "string" },
        field: { type: "string" },
      },
      required: ["target", "lesson", "student", "content"],
    },
  },
  {
    name: "write_teaching_content",
    description: "写入授课内容到课次 Note/Nav。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        lesson: { type: "number" },
        content: { type: "string" },
      },
      required: ["target", "lesson", "content"],
    },
  },
  {
    name: "update_archive_index",
    description: "把缺失课次链接补进档案页课程记录索引。",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "write_checkbox",
    description: "翻转课次文件中的 checkbox（如「提交反馈」）。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        lessons: { type: "string" },
        item: { type: "string" },
        state: { type: "string" },
        section: { type: "string" },
      },
      required: ["target", "lessons", "item"],
    },
  },
  {
    name: "create_class",
    description: "创建班课档案页。",
    inputSchema: {
      type: "object",
      properties: {
        class_name: { type: "string" },
        first_class_date: { type: "string" },
        course_type: { type: "string" },
        schedule_type: { type: "string" },
        students: { type: "string" },
        first_class_time: { type: "string" },
        subject: { type: "string" },
      },
      required: ["class_name", "first_class_date", "course_type", "schedule_type", "students"],
    },
  },
  {
    name: "create_one_on_one",
    description: "创建一对一档案页。",
    inputSchema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        first_class_date: { type: "string" },
        course_type: { type: "string" },
        schedule_type: { type: "string" },
        first_class_time: { type: "string" },
        subject: { type: "string" },
      },
      required: ["student_name", "first_class_date", "course_type", "schedule_type"],
    },
  },
  {
    name: "create_class_lesson",
    description: "为班课批量创建课次文件夹与 nav/Feedback。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        dates: { type: "string" },
        time_slots: { type: "array", items: { type: "number" } },
        course_type: { type: "string" },
        subject: { type: "string" },
      },
      required: ["target", "dates"],
    },
  },
  {
    name: "create_one_on_one_lesson",
    description: "为一对一批量创建课次。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        dates: { type: "string" },
        time_slots: { type: "array", items: { type: "number" } },
        course_type: { type: "string" },
        subject: { type: "string" },
      },
      required: ["target", "dates"],
    },
  },
  {
    name: "create_test_feedback",
    description: "创建测试反馈页（入门测/结班测等）。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        test_name: { type: "string" },
        date: { type: "string" },
      },
      required: ["target", "test_name", "date"],
    },
  },
  {
    name: "generate_student_summary",
    description: "汇总一名学员跨班课的反馈与出勤。",
    inputSchema: {
      type: "object",
      properties: { student: { type: "string" } },
      required: ["student"],
    },
  },
  {
    name: "generate_daily_feedback",
    description: "日常反馈：按设置拼授课内容/此前原始记录 + 锁死去AI味提示，写 AI_GENERATED。",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        lesson: { type: "number" },
        date: { type: "string" },
        student: { type: "string" },
      },
      required: ["target"],
    },
  },
  {
    name: "generate_end_of_class_feedback",
    description: "结班反馈不在本插件。请继续用原 MCP-XDF-Assistant / VPS。",
    inputSchema: {
      type: "object",
      properties: { answer_sheet_folder: { type: "string" } },
      required: ["answer_sheet_folder"],
    },
  },
  {
    name: "generate_end_of_class_feedback_v2",
    description: "结班反馈 v2 不在本插件。请继续用原 Python 工作流。",
    inputSchema: {
      type: "object",
      properties: { answer_sheet_folder: { type: "string" } },
      required: ["answer_sheet_folder"],
    },
  },
  {
    name: "query_task_progress",
    description: "查询后台任务进度（本插件日常反馈为同步执行，通常无需此工具）。",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
  },
  {
    name: "cancel_task",
    description: "取消后台任务（本插件日常反馈同步执行，无后台子进程）。",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
  },
];

async function chatComplete(
  settings: XdfToolkitsSettings,
  prompt: string,
  system = DAILY_FEEDBACK_SYSTEM_PROMPT,
): Promise<string> {
  if (!settings.llmBaseUrl || !settings.llmApiKey) {
    throw new Error("未配置模型 Base URL / API Key");
  }
  const url = settings.llmBaseUrl.replace(/\/$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.llmApiKey}`,
    },
    body: JSON.stringify({
      model: settings.llmModel || "qwen-plus",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("LLM 无输出");
  return text;
}

export async function callTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { app, db } = ctx;
  try {
    switch (name) {
      case "list_classes": {
        const archives = db.query(
          "SELECT * FROM archives WHERE kind = 'class' AND status = 'active' ORDER BY name",
        );
        const classes = archives.map((a) => ({
          name: a.name,
          course_type: jsonList(a.course_types).join(", "),
          schedule_type: a.schedule_type ?? "",
          student_count: db.query(
            "SELECT student_name FROM class_roster WHERE archive_id = ? ORDER BY row_order",
            [a.id],
          ).length,
        }));
        return ok({ classes });
      }
      case "list_one_on_one": {
        const archives = db.query(
          "SELECT * FROM archives WHERE kind = 'vip' AND status = 'active' ORDER BY name",
        );
        return ok({
          students: archives.map((a) => ({
            name: a.name,
            course_type: jsonList(a.course_types).join(", "),
            schedule_type: a.schedule_type ?? "",
          })),
        });
      }
      case "list_all_students": {
        const roster = db.query(
          `SELECT r.student_name as name, a.name as parent, a.kind as kind, a.course_types as course_types
           FROM class_roster r JOIN archives a ON a.id = r.archive_id
           WHERE a.status = 'active'`,
        );
        const vips = db.query(
          "SELECT name, course_types FROM archives WHERE kind = 'vip' AND status = 'active'",
        );
        const data = [
          ...roster.map((r) => ({
            name: r.name,
            type: "班课",
            parent: r.parent,
            course_type: jsonList(r.course_types).join(", "),
          })),
          ...vips.map((r) => ({
            name: r.name,
            type: "一对一",
            parent: r.name,
            course_type: jsonList(r.course_types).join(", "),
          })),
        ];
        return ok(data);
      }
      case "list_lessons": {
        const target = requireTarget(args);
        const archive = archiveByName(db, target);
        if (!archive) return err(`目标 '${target}' 不存在`);
        const lessons = db.query(
          "SELECT * FROM lessons WHERE archive_id = ? ORDER BY lesson_number",
          [archive.id],
        );
        return ok({
          target,
          target_type: archive.kind === "class" ? "class" : "one_on_one",
          count: lessons.length,
          lessons: lessons.map((l) => ({
            lesson_num: l.lesson_number,
            date: dateOnly(l.date),
            path: l.folder_path,
            nav_path: l.nav_path,
            feedback_path: `${String(l.folder_path || "").replace(/\/$/, "")}/Feedback ${l.lesson_number}.md`,
            need_send_feedback: l.need_send_feedback,
            feedback_sent: l.feedback_sent,
          })),
        });
      }
      case "list_lessons_by_date": {
        const date = String(args.date ?? "");
        if (!date) return err("date 必填");
        const lessons = db.query(
          `SELECT l.*, a.name as archive_name, a.kind as archive_kind
           FROM lessons l JOIN archives a ON a.id = l.archive_id
           WHERE substr(l.date, 1, 10) = ?
           ORDER BY a.name, l.lesson_number`,
          [date],
        );
        return ok({
          date,
          lessons: lessons.map((l) => ({
            target: l.archive_name,
            kind: l.archive_kind,
            lesson_num: l.lesson_number,
            date: dateOnly(l.date),
            nav_path: l.nav_path,
            need_send_feedback: l.need_send_feedback,
            feedback_sent: l.feedback_sent,
          })),
        });
      }
      case "list_student_lessons": {
        const student = String(args.student ?? "").trim();
        if (!student) return err("student 必填");
        const lessons = db.query(
          `SELECT l.*, a.name as class_name
           FROM lessons l
           JOIN archives a ON a.id = l.archive_id
           JOIN class_roster r ON r.archive_id = a.id
           WHERE r.student_name = ?
           ORDER BY l.date`,
          [student],
        );
        const vip = db.query(
          `SELECT l.*, a.name as class_name
           FROM lessons l JOIN archives a ON a.id = l.archive_id
           WHERE a.kind = 'vip' AND a.name = ?
           ORDER BY l.date`,
          [student],
        );
        const merged = [...lessons, ...vip];
        return ok(
          merged.map((l) => ({
            class_name: l.class_name,
            lesson_num: l.lesson_number,
            date: dateOnly(l.date),
            nav_path: l.nav_path,
            need_send_feedback: l.need_send_feedback,
          })),
        );
      }
      case "find_lessons": {
        const target = requireTarget(args);
        const archive = archiveByName(db, target);
        if (!archive) return err(`目标 '${target}' 不存在`);
        let sql = "SELECT * FROM lessons WHERE archive_id = ?";
        const params: unknown[] = [archive.id];
        if (args.lesson != null) {
          sql += " AND lesson_number = ?";
          params.push(Number(args.lesson));
        }
        if (args.date) {
          sql += " AND substr(date, 1, 10) = ?";
          params.push(String(args.date));
        }
        sql += " ORDER BY lesson_number";
        return ok({ target, lessons: db.query(sql, params) });
      }
      case "get_lesson_detail": {
        const target = requireTarget(args);
        const lessonNum = Number(args.lesson);
        const archive = archiveByName(db, target);
        if (!archive) return err(`目标 '${target}' 不存在`);
        const lessons = db.query(
          "SELECT * FROM lessons WHERE archive_id = ? AND lesson_number = ?",
          [archive.id, lessonNum],
        );
        const lesson = lessons[0];
        if (!lesson) return err("课次不存在");
        const sections = db.query(
          "SELECT heading_path, title, substr(body, 1, 800) as body FROM sections WHERE lesson_id = ? ORDER BY order_index",
          [lesson.id],
        );
        return ok({ target, lesson, sections });
      }
      case "extract_raw":
      case "extract_feedback":
      case "extract_content": {
        const target = requireTarget(args);
        const lessonKey = String(args.lesson);
        const nums = parseLessonRange(lessonKey);
        const archive = archiveByName(db, target);
        if (!archive) return err(`目标 '${target}' 不存在`);
        const studentFilter = args.student ? String(args.student) : null;
        const out: unknown[] = [];
        for (const n of nums) {
          const lessons = db.query(
            "SELECT * FROM lessons WHERE archive_id = ? AND lesson_number = ?",
            [archive.id, n],
          );
          const lesson = lessons[0];
          if (!lesson) continue;
          if (name === "extract_content") {
            const typ = String(args.type ?? "teaching_content");
            const title = typ === "homework" ? "作业" : "授课";
            const secs = db.query(
              "SELECT heading_path, title, body FROM sections WHERE lesson_id = ? AND (title LIKE ? OR heading_path LIKE ?)",
              [lesson.id, `%${title}%`, `%${title}%`],
            );
            out.push({ lesson: n, sections: secs });
          } else if (name === "extract_feedback") {
            const secs = db.query(
              "SELECT heading_path, title, body FROM sections WHERE lesson_id = ?",
              [lesson.id],
            );
            const items = secs
              .map((s) => ({
                heading_path: s.heading_path,
                title: s.title,
                feedback: extractAiBlock(String(s.body ?? "")),
              }))
              .filter((s) => s.feedback)
              .filter((s) => !studentFilter || String(s.heading_path).includes(studentFilter));
            out.push({ lesson: n, feedback: items });
          } else {
            const secs = db.query(
              "SELECT heading_path, title, body FROM sections WHERE lesson_id = ? AND (heading_path LIKE '%原始%' OR title LIKE '%原始%' OR heading_path LIKE '%出勤%')",
              [lesson.id],
            );
            const items = secs.filter(
              (s) => !studentFilter || String(s.heading_path).includes(studentFilter),
            );
            out.push({ lesson: n, raw: items });
          }
        }
        return ok(out);
      }
      case "check_feedback":
      case "check_todo": {
        const target = requireTarget(args);
        const archive = archiveByName(db, target);
        if (!archive) return err(`目标 '${target}' 不存在`);
        const lessons = db.query(
          "SELECT lesson_number, date, need_send_feedback, feedback_sent, nav_path FROM lessons WHERE archive_id = ? ORDER BY lesson_number",
          [archive.id],
        );
        const items = lessons.map((l) => ({
          lesson: l.lesson_number,
          date: dateOnly(l.date),
          need_send_feedback: !!l.need_send_feedback,
          feedback_sent: !!l.feedback_sent,
          status: l.need_send_feedback
            ? l.feedback_sent
              ? "已发送"
              : "待发送"
            : "未到期",
        }));
        if (name === "check_todo") {
          return ok(items.filter((i) => i.status === "待发送"));
        }
        return ok(items);
      }
      case "list_pending": {
        const lessons = db.query(
          `SELECT l.lesson_number as lesson, l.date as date, a.name as class, l.feedback_sent as feedback_sent
           FROM lessons l JOIN archives a ON a.id = l.archive_id
           WHERE l.need_send_feedback = 1 AND (l.feedback_sent = 0 OR l.feedback_sent IS NULL)
           ORDER BY l.date, a.name`,
        );
        return ok(
          lessons.map((l) => ({
            class: l.class,
            lesson: l.lesson,
            date: dateOnly(l.date),
            status: "待发送",
          })),
        );
      }
      case "query_db": {
        const sql = String(args.sql ?? "").trim();
        const limit = Number(args.limit ?? 200);
        const stripped = sql.replace(/;+\s*$/, "");
        if (!stripped) return err("SQL 为空");
        if (stripped.includes(";")) return err("不允许多语句");
        const first = stripped.split(/\s+/)[0].toLowerCase();
        if (!["select", "with", "explain"].includes(first)) {
          return err("仅允许 SELECT/WITH/EXPLAIN");
        }
        const rows = db.query(stripped);
        const truncated = rows.length > limit;
        const sliced = rows.slice(0, limit);
        const columns = sliced[0] ? Object.keys(sliced[0]) : [];
        return ok({ columns, rows: sliced, row_count: sliced.length, truncated });
      }
      case "write_feedback": {
        const target = requireTarget(args);
        const lessonNum = Number(args.lesson);
        const content = String(args.content ?? "");
        const type = String(args.feedback_type ?? "student_feedback");
        const archive = archiveByName(db, target);
        if (!archive) return err(`目标 '${target}' 不存在`);
        const lessons = db.query(
          "SELECT * FROM lessons WHERE archive_id = ? AND lesson_number = ?",
          [archive.id, lessonNum],
        );
        const lesson = lessons[0];
        const folder = lessonFolder(target, lessonNum, lesson?.folder_path);
        if (type === "class_feedback") {
          const path = String(lesson?.nav_path || `${folder}/${target} Lesson ${lessonNum}.md`);
          const cur = (await readFile(app, path)) ?? "";
          const next = upsertAiBlock(cur, content);
          await writeFile(app, path, next.text);
          return ok({ file: path, action: next.action });
        }
        const student = String(args.student ?? "").trim();
        if (!student) return err("student_feedback 需要 student");
        const path = `${folder}/Feedback ${lessonNum}.md`;
        let cur = (await readFile(app, path)) ?? `# Feedback ${lessonNum}\n`;
        cur = ensureStudentBlock(cur, student, lessonNum, dateOnly(lesson?.date));
        const rangeHint = `## 👤 ${student}`;
        const parts = cur.split(rangeHint);
        if (parts.length === 1) {
          const next = upsertAiBlock(cur, content);
          await writeFile(app, path, next.text);
          return ok({ file: path, action: next.action });
        }
        const head = parts[0] + rangeHint;
        const rest = parts.slice(1).join(rangeHint);
        const splitNext = rest.search(/\n## /);
        const block = splitNext >= 0 ? rest.slice(0, splitNext) : rest;
        const tail = splitNext >= 0 ? rest.slice(splitNext) : "";
        const updated = upsertAiBlock(block, content);
        await writeFile(app, path, head + updated.text + tail);
        return ok({ file: path, action: updated.action, student });
      }
      case "write_raw": {
        const target = requireTarget(args);
        const lessonNum = Number(args.lesson);
        const student = String(args.student ?? "").trim();
        const field = String(args.field ?? "原始记录");
        const content = String(args.content ?? "");
        const archive = archiveByName(db, target);
        if (!archive) return err(`目标 '${target}' 不存在`);
        const lessons = db.query(
          "SELECT * FROM lessons WHERE archive_id = ? AND lesson_number = ?",
          [archive.id, lessonNum],
        );
        const folder = lessonFolder(target, lessonNum, lessons[0]?.folder_path);
        const path = `${folder}/Feedback ${lessonNum}.md`;
        let cur = (await readFile(app, path)) ?? `# Feedback ${lessonNum}\n`;
        cur = ensureStudentBlock(cur, student, lessonNum, dateOnly(lessons[0]?.date));
        const line = `${field}：${content}`;
        if (cur.includes(`${field}：`)) {
          cur = cur.replace(new RegExp(`${escapeReg(field)}：.*`), line);
        } else {
          const marker = `## 👤 ${student}`;
          const idx = cur.indexOf(marker);
          if (idx >= 0) {
            const insertAt = cur.indexOf("### 原始记录", idx);
            if (insertAt >= 0) {
              const nl = cur.indexOf("\n", insertAt);
              cur = cur.slice(0, nl + 1) + line + "\n" + cur.slice(nl + 1);
            } else {
              cur += `\n${line}\n`;
            }
          } else {
            cur += `\n${line}\n`;
          }
        }
        await writeFile(app, path, cur);
        return ok({ file: path, student, field });
      }
      case "write_teaching_content": {
        const target = requireTarget(args);
        const lessonNum = Number(args.lesson);
        const content = String(args.content ?? "");
        const archive = archiveByName(db, target);
        if (!archive) return err(`目标 '${target}' 不存在`);
        const lessons = db.query(
          "SELECT * FROM lessons WHERE archive_id = ? AND lesson_number = ?",
          [archive.id, lessonNum],
        );
        const folder = lessonFolder(target, lessonNum, lessons[0]?.folder_path);
        const notePath = `${folder}/Note ${lessonNum}.md`;
        const navPath = String(lessons[0]?.nav_path || `${folder}/${target} Lesson ${lessonNum}.md`);
        const existingNote = await readFile(app, notePath);
        const path = existingNote != null ? notePath : navPath;
        let cur = (await readFile(app, path)) ?? `# Lesson ${lessonNum}\n`;
        if (/## .*授课/.test(cur)) {
          cur = cur.replace(/(## .*授课[\s\S]*?)(?=\n## |\s*$)/, (m) => {
            const first = m.split("\n")[0];
            return `${first}\n\n${content.trim()}\n`;
          });
        } else {
          cur += `\n\n## 授课内容\n\n${content.trim()}\n`;
        }
        await writeFile(app, path, cur);
        return ok({ file: path });
      }
      case "update_archive_index": {
        const target = requireTarget(args);
        const archive = archiveByName(db, target);
        if (!archive) return err(`目标 '${target}' 不存在`);
        const path = String(archive.vault_path || `Current Class/${target}/${target}.md`);
        let cur = (await readFile(app, path)) ?? "";
        const lessons = db.query(
          "SELECT lesson_number, date, nav_path FROM lessons WHERE archive_id = ? ORDER BY lesson_number",
          [archive.id],
        );
        const lines = lessons.map((l) => {
          const link = String(l.nav_path || "").replace(/\.md$/, "");
          return `- [[${link}|Lesson ${l.lesson_number}]] ${dateOnly(l.date) ?? ""}`.trim();
        });
        if (/课程记录索引/.test(cur)) {
          cur = cur.replace(
            /(## .*课程记录索引[\s\S]*?)(?=\n## |\s*$)/,
            (m) => `${m.split("\n")[0]}\n\n${lines.join("\n")}\n`,
          );
        } else {
          cur += `\n\n## 课程记录索引\n\n${lines.join("\n")}\n`;
        }
        await writeFile(app, path, cur);
        return ok({ file: path, lessons: lessons.length });
      }
      case "write_checkbox": {
        const target = requireTarget(args);
        const item = String(args.item ?? "");
        const checked = String(args.state ?? "checked") !== "unchecked";
        const section = args.section ? String(args.section) : null;
        const archive = archiveByName(db, target);
        if (!archive) return err(`目标 '${target}' 不存在`);
        const nums = parseLessonRange(String(args.lessons ?? ""));
        const updated: string[] = [];
        for (const n of nums) {
          const lessons = db.query(
            "SELECT * FROM lessons WHERE archive_id = ? AND lesson_number = ?",
            [archive.id, n],
          );
          const lesson = lessons[0];
          if (!lesson?.nav_path) continue;
          const path = String(lesson.nav_path);
          const cur = await readFile(app, path);
          if (cur == null) continue;
          const lines = cur.split(/\n/);
          let scope = { start: 0, end: lines.length };
          if (section) {
            const found = findHeadingRange(lines, 2, section) ?? findHeadingRange(lines, 3, section);
            if (found) scope = found;
          }
          let hit = false;
          for (let i = scope.start; i < scope.end; i++) {
            if (lines[i].includes(item) && /(\[ \]|\[x\]|- \[[ xX]\])/i.test(lines[i])) {
              lines[i] = setCheckbox(lines[i], checked);
              hit = true;
            }
          }
          if (hit) {
            await writeFile(app, path, lines.join("\n"));
            updated.push(path);
          }
        }
        return ok({ updated, item, state: checked ? "checked" : "unchecked" });
      }
      case "create_class": {
        const className = String(args.class_name ?? "").trim();
        const students = String(args.students ?? "")
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (!className) return err("class_name 必填");
        if (!students.length) return err("学员名单不能为空");
        const data = await createClassArchive(app, {
          class_name: className,
          first_class_date: String(args.first_class_date ?? ""),
          schedule_type: String(args.schedule_type ?? "weekend"),
          course_type: String(args.course_type ?? ""),
          students,
          subject: args.subject ? String(args.subject) : null,
        });
        return ok(data);
      }
      case "create_one_on_one": {
        const name = String(args.student_name ?? args.student ?? "").trim();
        if (!name) return err("student_name 必填");
        const data = await createVipArchive(app, {
          student: name,
          first_class_date: String(args.first_class_date ?? ""),
          schedule_type: String(args.schedule_type ?? "full-time"),
          course_type: String(args.course_type ?? ""),
          subject: args.subject ? String(args.subject) : null,
        });
        return ok(data);
      }
      case "create_class_lesson": {
        const target = requireTarget(args);
        const data = await createLessons(app, db, {
          target,
          kind: "class",
          dates: args.dates,
          time_slots: args.time_slots,
          course_type: args.course_type ? String(args.course_type) : null,
          subject: args.subject ? String(args.subject) : null,
        });
        return ok(data);
      }
      case "create_one_on_one_lesson": {
        const target = requireTarget(args);
        const data = await createLessons(app, db, {
          target,
          kind: "vip",
          dates: args.dates,
          time_slots: args.time_slots,
          course_type: args.course_type ? String(args.course_type) : null,
          subject: args.subject ? String(args.subject) : null,
        });
        return ok(data);
      }
      case "create_test_feedback": {
        const data = await createTestFeedbackPage(app, db, {
          target: requireTarget(args),
          test_name: String(args.test_name ?? ""),
          date: String(args.date ?? ""),
        });
        return ok(data);
      }
      case "generate_student_summary": {
        const student = String(args.student ?? "").trim();
        const secs = db.query(
          `SELECT a.name as class_name, l.lesson_number as lesson, s.heading_path, s.body
           FROM sections s
           JOIN lessons l ON l.id = s.lesson_id
           JOIN archives a ON a.id = l.archive_id
           WHERE s.heading_path LIKE ?
           ORDER BY l.date`,
          [`%${student}%`],
        );
        return ok({
          student,
          items: secs.map((s) => ({
            class_name: s.class_name,
            lesson: s.lesson,
            heading_path: s.heading_path,
            feedback: extractAiBlock(String(s.body ?? "")),
            excerpt: String(s.body ?? "").slice(0, 400),
          })),
        });
      }
      case "generate_daily_feedback": {
        const target = requireTarget(args);
        const archive = archiveByName(db, target);
        if (!archive) return err(`目标 '${target}' 不存在`);
        let lessonRow;
        if (args.lesson != null) {
          lessonRow = db.query(
            "SELECT * FROM lessons WHERE archive_id = ? AND lesson_number = ?",
            [archive.id, Number(args.lesson)],
          )[0];
        } else if (args.date) {
          lessonRow = db.query(
            "SELECT * FROM lessons WHERE archive_id = ? AND substr(date, 1, 10) = ?",
            [archive.id, String(args.date)],
          )[0];
        } else {
          return err("lesson 或 date 必填");
        }
        if (!lessonRow) return err("课次不存在");
        const student = args.student ? String(args.student) : null;
        const rawSecs = db.query(
          "SELECT heading_path, title, body FROM sections WHERE lesson_id = ?",
          [lessonRow.id],
        );
        const targets = student
          ? rawSecs.filter((s) => String(s.heading_path).includes(student))
          : rawSecs.filter((s) => String(s.heading_path).includes("👤"));
        const names = student
          ? [student]
          : [
              ...new Set(
                rawSecs
                  .map((s) => String(s.heading_path).match(/👤\s*([^\s/]+)/)?.[1])
                  .filter(Boolean) as string[],
              ),
            ];
        const written: unknown[] = [];
        let teaching = "";
        if (ctx.settings.useTeachingContent) {
          const secs = db.query(
            "SELECT body FROM sections WHERE lesson_id = ? AND (title LIKE ? OR heading_path LIKE ?)",
            [lessonRow.id, "%授课%", "%授课%"],
          );
          teaching = secs.map((s) => String(s.body ?? "")).join("\n");
        }
        const prevCount = Math.max(1, Math.min(8, ctx.settings.previousRawLessons || 2));
        const prevLessons = ctx.settings.usePreviousRaw
          ? db.query(
              "SELECT id, lesson_number FROM lessons WHERE archive_id = ? AND lesson_number < ? ORDER BY lesson_number DESC LIMIT ?",
              [archive.id, Number(lessonRow.lesson_number), prevCount],
            )
          : [];
        for (const nameStu of names.length ? names : student ? [student] : []) {
          const raw = targets
            .filter((s) => String(s.heading_path).includes(nameStu))
            .map((s) => String(s.body ?? ""))
            .join("\n");
          const previousRaw: { lesson: number; text: string }[] = [];
          for (const pl of prevLessons) {
            const secs = db.query(
              "SELECT heading_path, title, body FROM sections WHERE lesson_id = ? AND (heading_path LIKE '%原始%' OR title LIKE '%原始%' OR heading_path LIKE '%出勤%')",
              [pl.id],
            );
            const text = secs
              .filter((s) => String(s.heading_path).includes(nameStu))
              .map((s) => String(s.body ?? ""))
              .join("\n");
            previousRaw.push({ lesson: Number(pl.lesson_number), text });
          }
          const prompt = buildDailyFeedbackUserPrompt({
            target,
            lesson: Number(lessonRow.lesson_number),
            student: nameStu,
            raw,
            teaching: ctx.settings.useTeachingContent ? teaching : undefined,
            previousRaw: ctx.settings.usePreviousRaw ? previousRaw : undefined,
            tone: buildToneBlock(ctx.settings),
          });
          const text = await chatComplete(ctx.settings, prompt);
          const inner = await callTool(ctx, "write_feedback", {
            target,
            lesson: Number(lessonRow.lesson_number),
            student: nameStu,
            content: text,
            feedback_type: "student_feedback",
          });
          written.push({ student: nameStu, result: JSON.parse(inner) });
        }
        return ok({ target, lesson: lessonRow.lesson_number, written });
      }
      case "generate_end_of_class_feedback":
      case "generate_end_of_class_feedback_v2":
        return err(
          "结班反馈（含 OCR/估分）不在本插件内。请继续使用 MCP-XDF-Assistant 或 VPS 工作流。",
        );
      case "query_task_progress":
        return ok({
          task_id: args.task_id,
          status: "unknown",
          note: "本插件日常反馈为同步执行，无进度文件。",
        });
      case "cancel_task":
        return ok({ task_id: args.task_id, status: "noop" });
      default:
        return err(`未知工具: ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export { createXdfDb };
