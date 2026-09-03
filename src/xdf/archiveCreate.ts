import type { App, TFolder } from "obsidian";
import { jsonList, type XdfDb } from "./db";
import { readFile, writeFile } from "./markdown";
import {
  CLASS_TIME_SLOTS,
  INDEX_HEADER,
  LINK_NEXT,
  VIP_TIME_SLOTS,
  appendCourseTypeLine,
  appendLinkBeforeDivider,
  appendLinkListEntry,
  appendTestFeedbackLink,
  buildArchiveBody,
  buildArchiveFrontmatterFields,
  buildClassFeedback,
  buildFrontmatter,
  buildIndexLink,
  buildLessonFolderName,
  buildNav,
  buildPersonFeedback,
  getLessonFileNames,
  insertNewCourseTypeBlock,
  parseDateTime,
  updateArchiveTimestamps,
} from "./templates";

export type ArchiveKind = "class" | "vip";

export interface ArchiveInfo {
  found: boolean;
  kind: ArchiveKind | null;
  subject: string | null;
  schedule_type: string | null;
  course_types: string[];
  students: string[];
  archive_path: string;
  parent_folder: string;
  db_max_lesson: number;
}

function asFolder(app: App, path: string): TFolder | null {
  const f = app.vault.getAbstractFileByPath(path);
  if (f && "children" in f) return f as TFolder;
  return null;
}

export function nextLessonNumber(app: App, parentFolder: string, name: string, dbMax: number): number {
  let maxNum = dbMax || 0;
  const folder = asFolder(app, parentFolder);
  const re = new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+Lesson\\s+(\\d+)$", "i");
  if (folder) {
    for (const child of folder.children) {
      const m = child.name.match(re);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
  }
  return maxNum + 1;
}

function parseStudentsTable(content: string): string[] {
  const lines = content.split("\n");
  const out: string[] = [];
  let inTable = false;
  for (const line of lines) {
    if (line.includes("| 姓名 |")) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (!line.trim().startsWith("|")) break;
      if (/^\|\s*-+/.test(line)) continue;
      const cells = line.split("|").map((c) => c.trim());
      const name = cells[1];
      if (name) out.push(name);
    }
  }
  return out;
}

function kindFromTags(tags: unknown): ArchiveKind | null {
  const list = jsonList(tags).map((t) => t.replace(/^#/, "").toLowerCase());
  if (list.includes("class")) return "class";
  if (list.includes("vip")) return "vip";
  return null;
}

export function loadArchiveInfo(app: App, db: XdfDb, name: string): ArchiveInfo {
  const empty: ArchiveInfo = {
    found: false,
    kind: null,
    subject: null,
    schedule_type: null,
    course_types: [],
    students: [],
    archive_path: `Current Class/${name}/${name}.md`,
    parent_folder: `Current Class/${name}`,
    db_max_lesson: 0,
  };
  if (db.available()) {
    try {
      const rows = db.query("SELECT * FROM archives WHERE name = ?", [name]);
      const row = rows[0];
      if (row) {
        const vaultPath = String(row.vault_path || empty.archive_path).replace(/\\/g, "/");
        const parent = vaultPath.split("/").slice(0, -1).join("/") || `Current Class/${name}`;
        const info: ArchiveInfo = {
          found: true,
          kind: (row.kind as ArchiveKind) || null,
          subject: row.subject ? String(row.subject) : null,
          schedule_type: row.schedule_type ? String(row.schedule_type) : null,
          course_types: jsonList(row.course_types ?? row.course_type),
          students: [],
          archive_path: vaultPath,
          parent_folder: parent,
          db_max_lesson: 0,
        };
        if (info.kind === "class") {
          info.students = db
            .query(
              "SELECT student_name FROM class_roster WHERE archive_id = ? ORDER BY row_order",
              [row.id],
            )
            .map((r) => String(r.student_name));
        }
        const lessons = db.query(
          "SELECT max(lesson_number) as m FROM lessons WHERE archive_id = ?",
          [row.id],
        );
        info.db_max_lesson = Number(lessons[0]?.m ?? 0);
        if (app.vault.getAbstractFileByPath(info.archive_path)) return info;
      }
    } catch {
      /* md fallback */
    }
  }

  const path = `Current Class/${name}/${name}.md`;
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) return empty;
  return empty;
}

export async function loadArchiveInfoAsync(app: App, db: XdfDb, name: string): Promise<ArchiveInfo> {
  const info = loadArchiveInfo(app, db, name);
  if (info.found && app.vault.getAbstractFileByPath(info.archive_path)) {
    if (info.kind === "class" && info.students.length === 0) {
      const md = await readFile(app, info.archive_path);
      if (md) info.students = parseStudentsTable(md);
    }
    return info;
  }
  const path = `Current Class/${name}/${name}.md`;
  const md = await readFile(app, path);
  if (md == null) {
    return {
      found: false,
      kind: null,
      subject: null,
      schedule_type: null,
      course_types: [],
      students: [],
      archive_path: path,
      parent_folder: `Current Class/${name}`,
      db_max_lesson: 0,
    };
  }
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
  const fm: Record<string, string> = {};
  const courseTypes: string[] = [];
  if (fmMatch) {
    let inCourse = false;
    for (const line of fmMatch[1].split("\n")) {
      if (line.trim() === "course_type:") {
        inCourse = true;
        continue;
      }
      if (inCourse) {
        const t = line.trim();
        if (t.startsWith("- ")) {
          courseTypes.push(t.slice(2).replace(/^["']|["']$/g, ""));
          continue;
        }
        inCourse = false;
      }
      const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const kind = (fm.kind as ArchiveKind) || kindFromTags(fm.tags) || null;
  return {
    found: true,
    kind,
    subject: fm.subject || null,
    schedule_type: fm.schedule_type || null,
    course_types: courseTypes.length ? courseTypes : fm.course_type ? [fm.course_type] : [],
    students: kind === "class" ? parseStudentsTable(md) : [],
    archive_path: path,
    parent_folder: `Current Class/${name}`,
    db_max_lesson: 0,
  };
}

async function writeIfNotExists(app: App, path: string, content: string): Promise<"created" | "skipped"> {
  if (app.vault.getAbstractFileByPath(path)) return "skipped";
  await writeFile(app, path, content);
  return "created";
}

async function writeOrUpdate(app: App, path: string, content: string): Promise<"created" | "updated"> {
  const exists = !!app.vault.getAbstractFileByPath(path);
  await writeFile(app, path, content);
  return exists ? "updated" : "created";
}

export async function createClassArchive(
  app: App,
  opts: {
    class_name: string;
    first_class_date: string;
    schedule_type: string;
    course_type: string;
    students: string[];
    subject?: string | null;
  },
) {
  const folder = `Current Class/${opts.class_name}`;
  const path = `${folder}/${opts.class_name}.md`;
  const md =
    buildFrontmatter(
      buildArchiveFrontmatterFields({
        kind: "class",
        starting_date: opts.first_class_date,
        schedule_type: opts.schedule_type,
        course_type: opts.course_type,
        subject: opts.subject,
        student_count: opts.students.length,
      }),
    ) + buildArchiveBody({ kind: "class", students: opts.students });
  const action = await writeIfNotExists(app, path, md);
  return { class_name: opts.class_name, folder_path: folder, archive_path: path, action, students: opts.students };
}

export async function createVipArchive(
  app: App,
  opts: {
    student: string;
    first_class_date: string;
    schedule_type: string;
    course_type: string;
    subject?: string | null;
  },
) {
  const folder = `Current Class/${opts.student}`;
  const path = `${folder}/${opts.student}.md`;
  const md =
    buildFrontmatter(
      buildArchiveFrontmatterFields({
        kind: "vip",
        starting_date: opts.first_class_date,
        schedule_type: opts.schedule_type,
        course_type: opts.course_type,
        subject: opts.subject,
      }),
    ) +
    buildArchiveBody({
      kind: "vip",
      archive_name: opts.student,
      course_type: opts.course_type,
    });
  const action = await writeOrUpdate(app, path, md);
  return { student_name: opts.student, folder_path: folder, archive_path: path, action };
}

async function detectPrevFolder(app: App, parent: string, archiveName: string, n: number): Promise<string | null> {
  if (n <= 1) return null;
  const folderName = buildLessonFolderName(archiveName, n - 1);
  const nav = `${parent}/${folderName}/${getLessonFileNames(archiveName, n - 1).nav}.md`;
  return app.vault.getAbstractFileByPath(nav) ? folderName : null;
}

async function writeLessonPackage(
  app: App,
  opts: {
    kind: ArchiveKind;
    archive_name: string;
    parent_folder: string;
    lesson_number: number;
    iso_date: string;
    month: number;
    day: number;
    course_type: string;
    subject?: string | null;
    need_send_feedback: boolean;
    overwrite: boolean;
    students?: string[];
  },
) {
  const folderName = buildLessonFolderName(opts.archive_name, opts.lesson_number);
  const folderPath = `${opts.parent_folder}/${folderName}`;
  const names = getLessonFileNames(opts.archive_name, opts.lesson_number);
  const prev = await detectPrevFolder(app, opts.parent_folder, opts.archive_name, opts.lesson_number);
  const nav = buildNav({ ...opts, prev_lesson_folder_name: prev });
  const feedback =
    opts.kind === "class"
      ? buildClassFeedback(opts.students ?? [], opts)
      : buildPersonFeedback({
          name: opts.archive_name,
          lesson_number: opts.lesson_number,
          month: opts.month,
          day: opts.day,
          subject: opts.subject,
        });
  const files = [
    { name: names.nav, content: nav },
    { name: names.note, content: "" },
    { name: names.wordlist, content: "" },
    { name: names.grammar, content: "" },
    { name: names.homework, content: "" },
    { name: names.quiz, content: "" },
    { name: names.feedback, content: feedback },
  ];
  const actions: Record<string, string> = {};
  for (const f of files) {
    const path = `${folderPath}/${f.name}.md`;
    if (app.vault.getAbstractFileByPath(path)) {
      if (opts.overwrite) {
        await writeFile(app, path, f.content);
        actions[f.name] = "updated";
      } else {
        actions[f.name] = "skipped";
      }
    } else {
      await writeFile(app, path, f.content);
      actions[f.name] = "created";
    }
  }
  return { folder_name: folderName, folder_path: folderPath, names, actions };
}

async function appendNextLink(app: App, parent: string, archiveName: string, n: number) {
  if (n <= 1) return;
  const prevFolder = buildLessonFolderName(archiveName, n - 1);
  const prevNav = `${parent}/${prevFolder}/${getLessonFileNames(archiveName, n - 1).nav}.md`;
  const content = await readFile(app, prevNav);
  if (content == null) return;
  const nextLink = "[[" + buildLessonFolderName(archiveName, n) + "|" + LINK_NEXT + "]]";
  if (content.includes(nextLink)) return;
  await writeFile(app, prevNav, appendLinkListEntry(content, "links", nextLink));
}

async function updateArchiveAfterLesson(
  app: App,
  opts: {
    archive_path: string;
    parent_folder: string;
    archive_name: string;
    link: string;
    lesson_number: number;
    date_str: string;
    is_new_course_type: boolean;
    course_type: string;
    index_header: string;
  },
) {
  let content = (await readFile(app, opts.archive_path)) ?? "";
  if (!content) return { updated: false };
  if (opts.is_new_course_type) {
    content = appendCourseTypeLine(content, opts.course_type);
    content = insertNewCourseTypeBlock(content, opts.course_type, opts.link);
  } else {
    content = appendLinkBeforeDivider(content, opts.index_header || INDEX_HEADER, opts.link);
  }
  content = updateArchiveTimestamps(content, opts.lesson_number, opts.date_str);
  await writeFile(app, opts.archive_path, content);
  await appendNextLink(app, opts.parent_folder, opts.archive_name, opts.lesson_number);
  return { updated: true };
}

function splitDates(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createLessons(
  app: App,
  db: XdfDb,
  opts: {
    target: string;
    kind: ArchiveKind;
    dates: unknown;
    time_slots?: unknown;
    course_type?: string | null;
    subject?: string | null;
  },
) {
  const info = await loadArchiveInfoAsync(app, db, opts.target);
  if (!info.found) throw new Error((opts.kind === "class" ? "班级" : "学员") + "档案不存在: " + opts.target);
  if (info.kind && info.kind !== opts.kind) {
    throw new Error(opts.target + (opts.kind === "class" ? " 不是班课档案" : " 不是一对一档案"));
  }
  if (opts.kind === "class" && !info.students.length) {
    throw new Error("未找到学员名单（档案表格或 class_roster 均为空）");
  }
  const dates = splitDates(opts.dates);
  const slots = Array.isArray(opts.time_slots) ? opts.time_slots.map(Number) : [];
  const slotMap = opts.kind === "class" ? CLASS_TIME_SLOTS : VIP_TIME_SLOTS;
  let courseType = opts.course_type || "";
  let isNew = false;
  if (opts.kind === "vip") {
    if (courseType) isNew = !info.course_types.includes(courseType);
    else {
      if (!info.course_types.length) throw new Error("未指定课程体系，且档案中无课程体系标签");
      courseType = info.course_types[info.course_types.length - 1];
    }
  } else if (!courseType) {
    courseType = info.course_types[info.course_types.length - 1] || "班课";
  }
  const subject = opts.subject || info.subject;
  const schedule = info.schedule_type || (opts.kind === "class" ? "full-time" : "full-time");
  let lessonNumber = nextLessonNumber(app, info.parent_folder, opts.target, info.db_max_lesson);
  const created: unknown[] = [];
  for (let i = 0; i < dates.length; i++) {
    const parsed = parseDateTime(dates[i], lessonNumber, slotMap, slots[i]);
    const iso = `${parsed.datePart}T${parsed.timePart}:00+08:00`;
    const needSend =
      opts.kind === "vip" ? true : schedule === "weekend" || lessonNumber % 2 === 0;
    const pkg = await writeLessonPackage(app, {
      kind: opts.kind,
      archive_name: opts.target,
      parent_folder: info.parent_folder,
      lesson_number: lessonNumber,
      iso_date: iso,
      month: parsed.month,
      day: parsed.day,
      course_type: courseType,
      subject,
      need_send_feedback: needSend,
      overwrite: opts.kind === "vip",
      students: info.students,
    });
    await updateArchiveAfterLesson(app, {
      archive_path: info.archive_path,
      parent_folder: info.parent_folder,
      archive_name: opts.target,
      link: buildIndexLink(opts.kind, pkg.folder_name, lessonNumber, parsed.datePart),
      lesson_number: lessonNumber,
      date_str: parsed.datePart,
      is_new_course_type: opts.kind === "vip" && isNew,
      course_type: courseType,
      index_header: opts.kind === "vip" ? "### 🏷️ " + courseType : INDEX_HEADER,
    });
    created.push({
      lesson_number: lessonNumber,
      folder: pkg.folder_path,
      date: parsed.datePart,
      need_send_feedback: needSend,
    });
    if (isNew) isNew = false;
    lessonNumber += 1;
  }
  return {
    target: opts.target,
    lessons_created: created,
    course_type: courseType,
    subject,
    students: info.students,
  };
}

export async function createTestFeedbackPage(
  app: App,
  db: XdfDb,
  opts: { target: string; test_name: string; date: string },
) {
  const info = await loadArchiveInfoAsync(app, db, opts.target);
  if (!info.found) throw new Error("未找到 " + opts.target + " 的档案文件");
  const students = info.kind === "vip" ? [opts.target] : info.students;
  if (!students.length) throw new Error("未找到学员名单");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new Error("测试日期格式错误，应为 YYYY-MM-DD");
  const parent = info.parent_folder;
  const path = `${parent}/${opts.test_name}/${opts.test_name}.md`;
  const studentBlocks = students
    .map((s) => `### ${s}\n- [ ] 参加结班测\n- [ ] 反馈已写完`)
    .join("\n\n");
  const testContent = `---
tags: ["#测试反馈"]
test_name: "${opts.test_name}"
test_date: "${opts.date}"
student_count: ${students.length}
---

## 📋 ${opts.test_name}总览

${studentBlocks}
`;
  const fileAction = await writeOrUpdate(app, path, testContent);
  const archive = (await readFile(app, info.archive_path)) ?? "";
  const linkLine = `- [[${opts.test_name}/${opts.test_name}|📝 ${opts.test_name}]]`;
  let archiveAction = "skipped";
  if (!archive.includes(linkLine)) {
    await writeFile(app, info.archive_path, appendTestFeedbackLink(archive, linkLine));
    archiveAction = "updated";
  }
  return {
    target: opts.target,
    test_name: opts.test_name,
    test_file: path,
    test_file_action: fileAction,
    archive_action: archiveAction,
    students,
  };
}
