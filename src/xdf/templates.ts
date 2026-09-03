/** 档案 / 课次 Markdown 模板，逐行对齐 MCP-XDF-Assistant/scripts/md_utils.py */

export const INDEX_HEADER = "## 📚 课程索引";
export const TEST_FEEDBACK_HEADER = "## 📋 测试反馈";
export const LINK_PREV = "⬅️ 上一课";
export const LINK_ARCHIVE = "📁 档案首页";
export const LINK_NEXT = "➡️ 下一课";

export const CLASS_TIME_SLOTS: Record<number, string> = {
  1: "10:00",
  2: "12:20",
  3: "15:30",
  4: "17:50",
};
export const VIP_TIME_SLOTS: Record<number, string> = {
  ...CLASS_TIME_SLOTS,
  5: "20:10",
};

const TAGS = {
  ARCHIVE: "#档案",
  VIP: "#vip",
  CLASS: "#class",
  LESSON: "#课程记录",
};

const SUBJECT_LABELS: Record<string, string> = {
  Listening: "听力",
  Speaking: "口语",
  Reading: "阅读",
  Writing: "写作",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function yamlScalar(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const s = String(value);
  if (DATE_RE.test(s) || ISO_DT_RE.test(s)) return s;
  return JSON.stringify(s);
}

export function buildFrontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(key + ":");
      for (const item of value) lines.push("  - " + yamlScalar(item));
    } else {
      lines.push(key + ": " + yamlScalar(value));
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function getSubjectLabel(subject?: string | null): string {
  if (!subject) return "";
  return SUBJECT_LABELS[subject] ?? subject;
}

export function buildHomeworkLabel(lessonNumber: number, subject?: string | null): string {
  const label = getSubjectLabel(subject);
  if (label) return "第" + lessonNumber + "次" + label + "作业";
  return "第" + lessonNumber + "次作业";
}

export function buildNavHomeworkTitle(
  month: number,
  day: number,
  n: number,
  subject?: string | null,
): string {
  const label = getSubjectLabel(subject);
  const hw = label ? label + "作业" : "作业";
  return month + "月" + day + "日第" + n + "次" + hw;
}

export function buildLessonFolderName(archiveName: string, lessonNumber: number): string {
  return archiveName + " Lesson " + lessonNumber;
}

export function getLessonFileNames(archiveName: string, lessonNumber: number) {
  return {
    nav: archiveName + " Lesson " + lessonNumber,
    note: "Note " + lessonNumber,
    wordlist: "Wordlist " + lessonNumber,
    grammar: "Grammar Note " + lessonNumber,
    homework: "Homework " + lessonNumber,
    quiz: "Quiz " + (lessonNumber + 1),
    feedback: "Feedback " + lessonNumber,
  };
}

export function buildArchiveFrontmatterFields(opts: {
  kind: "class" | "vip";
  starting_date: string;
  schedule_type: string;
  course_type: string;
  subject?: string | null;
  student_count?: number;
}): Record<string, unknown> {
  const kindTag = opts.kind === "class" ? TAGS.CLASS : TAGS.VIP;
  const fields: Record<string, unknown> = {
    starting_date: opts.starting_date,
    schedule_type: opts.schedule_type,
    course_type: [opts.course_type],
  };
  if (opts.subject) fields.subject = opts.subject;
  fields.status = "active";
  fields.total_lessons = 0;
  fields.last_date = null;
  if (opts.kind === "class") fields.student_count = opts.student_count ?? 0;
  fields.tags = [TAGS.ARCHIVE, kindTag];
  return fields;
}

export function buildLessonNavFrontmatter(opts: {
  kind: "class" | "vip";
  iso_date: string;
  lesson_number: number;
  archive_name: string;
  course_type: string;
  subject?: string | null;
  need_send_feedback: boolean;
  prev_lesson_folder_name?: string | null;
}): Record<string, unknown> {
  const kindTag = opts.kind === "class" ? TAGS.CLASS : TAGS.VIP;
  const links: string[] = [];
  if (opts.prev_lesson_folder_name) {
    links.push("[[" + opts.prev_lesson_folder_name + "|" + LINK_PREV + "]]");
  }
  links.push("[[" + opts.archive_name + "|" + LINK_ARCHIVE + "]]");
  const fields: Record<string, unknown> = {
    Date: opts.iso_date,
    lesson_number: opts.lesson_number,
    archive_name: opts.archive_name,
    course_type: [opts.course_type],
  };
  if (opts.subject) fields.subject = opts.subject;
  fields.need_send_feedback = !!opts.need_send_feedback;
  fields.links = links;
  fields.tags = [TAGS.LESSON, kindTag];
  return fields;
}

export function buildPersonFeedback(opts: {
  name: string;
  lesson_number: number;
  month: number;
  day: number;
  subject?: string | null;
}): string {
  const lines = [
    "## 👤 " + opts.name,
    "",
    "",
    "### 原始记录",
    "#### 出勤",
    opts.month + "月" + opts.day + "日出勤情况：" +
      "[ ] 正常 | [ ] 迟到 | [ ] 早退 | [ ] 线上课 | [ ] 请假",
    "",
    "",
  ];
  if (opts.lesson_number > 1) {
    const homeworkLabel = buildHomeworkLabel(opts.lesson_number - 1, opts.subject);
    lines.push("#### 作业情况", homeworkLabel + "：[ ] 已完成 | [ ] 未完成", "", "");
  }
  lines.push(
    "#### 入门测情况",
    "",
    "",
    "#### 课堂表现",
    "",
    "",
    "#### 掌握情况",
    "",
    "",
    "#### 需要加强",
    "",
    "",
    "### 反馈总结",
    "<!-- AI_GENERATED_START -->",
    "待生成",
    "",
    "<!-- AI_GENERATED_END -->",
    "",
  );
  return lines.join("\n");
}

export function buildClassFeedback(
  students: string[],
  opts: { lesson_number: number; month: number; day: number; subject?: string | null },
): string {
  return students
    .map((name) =>
      buildPersonFeedback({
        name,
        lesson_number: opts.lesson_number,
        month: opts.month,
        day: opts.day,
        subject: opts.subject,
      }),
    )
    .join("\n");
}

export function buildNav(opts: {
  kind: "class" | "vip";
  archive_name: string;
  lesson_number: number;
  month: number;
  day: number;
  iso_date: string;
  course_type: string;
  subject?: string | null;
  need_send_feedback: boolean;
  prev_lesson_folder_name?: string | null;
}): string {
  const n = opts.lesson_number;
  const names = getLessonFileNames(opts.archive_name, n);
  const fm = buildFrontmatter(buildLessonNavFrontmatter(opts));
  const navTitle = buildNavHomeworkTitle(opts.month, opts.day, n, opts.subject);
  const isClass = opts.kind === "class";

  const fileList = [
    "## 📂本节课文件",
    "- [[" + names.note + "|📝 课堂笔记]]",
    "- [[" + names.wordlist + "|📚 词汇表]]",
    "- [[" + names.grammar + "|📖 语法笔记]]",
    "- [[" + names.homework + "|✍️ 课后作业]]",
    "- [[" + names.quiz + "|📋 下节课入门测]]",
    "---",
  ].join("\n");

  const middle = isClass
    ? [
        "## 📝 课堂反馈",
        "- [ ] 提交反馈",
        "- [[" + names.feedback + "|💬 课堂反馈]]",
        "",
        "### 授课内容",
        "",
        "",
        "",
        "### 原始记录",
        "",
        "",
        "",
        "#### 出勤",
        "",
        "",
        "",
        "#### 整体表现",
        "",
        "",
        "",
        "#### 作业情况",
        "",
        "",
        "",
        "#### 入门测情况",
        "",
        "",
        "",
        "#### 授课进度",
        "",
        "",
        "### 反馈总结",
        "<!-- AI_GENERATED_START -->",
        "待生成",
        "<!-- AI_GENERATED_END -->",
        "",
        "---",
      ].join("\n")
    : [
        "## 📝 课堂反馈",
        "- [ ] 提交反馈",
        "- [[" + names.feedback + "|💬 课堂反馈]]",
        "### 授课内容",
        "",
        "---",
      ].join("\n");

  const homeworkBlock = [
    "## ✍️作业记录",
    "",
    "- [ ] 发送作业到家长群",
    navTitle + "：",
    "",
    "",
    "---",
  ].join("\n");

  const nextBlock = ["", "## 📌 下次课提醒", "", "- [ ] 准备打印作业", "- [ ] 准备入门测", "", ""].join(
    "\n",
  );

  return fm + fileList + "\n" + middle + "\n" + homeworkBlock + "\n" + nextBlock;
}

export function buildArchiveBody(opts: {
  kind: "class" | "vip";
  students?: string[];
  archive_name?: string;
  course_type?: string;
}): string {
  const isClass = opts.kind === "class";
  const students = isClass ? opts.students ?? [] : [opts.archive_name ?? ""];
  const rows = students.map((name) => "| " + name + " | | | | | | | | |").join("\n");

  const indexSection = isClass
    ? [INDEX_HEADER, "<!-- 每次课后在这里增加课程链接 -->", "", ""].join("\n")
    : [INDEX_HEADER, "", "### 🏷️ " + (opts.course_type ?? ""), "- *暂无课程记录，等待生成第 1 课...*", ""].join(
        "\n",
      );

  return [
    "## 👥 学员信息",
    "",
    "| 姓名 | 学校 | 年级 | 英语程度 | 目标分数 | 已上课程 | 考试时间 | 考试成绩 | 备注 |",
    "|------|------|------|----------|----------|----------|----------|----------|------|",
    rows,
    "",
    "---",
    "",
    "## 📝 备注",
    "<!-- 在此记录班级注意事项 -->",
    "",
    "---",
    "",
    indexSection,
    "---",
    "",
    TEST_FEEDBACK_HEADER,
    "",
  ].join("\n");
}

export function buildIndexLink(
  kind: "class" | "vip",
  folderName: string,
  lessonNumber: number,
  dateStr: string,
): string {
  const label =
    kind === "class"
      ? "📖 Lesson " + lessonNumber + " - " + dateStr
      : "第 " + lessonNumber + " 课 - " + dateStr;
  return "- [[" + folderName + "|" + label + "]]";
}

export function updateArchiveTimestamps(content: string, total: number, dateStr: string): string {
  content = content.replace(/(total_lessons:\s*)(\d+)/, `$1${total}`);
  content = content.replace(/(last_date:\s*)(null|[^\n]*)/, `$1${dateStr}`);
  return content;
}

export function appendLinkBeforeDivider(content: string, header: string, link: string): string {
  if (content.includes(link)) return content;
  const headerPos = content.indexOf(header);
  if (headerPos === -1) return content;
  const after = content.slice(headerPos);
  const dividerPos = after.indexOf("\n---");
  if (dividerPos === -1) return content;
  const insertPos = headerPos + dividerPos;
  return content.slice(0, insertPos) + "\n" + link + content.slice(insertPos);
}

export function appendCourseTypeLine(content: string, courseType: string): string {
  const line = "  - " + yamlScalar(courseType);
  const lines = content.split("\n");
  let lastIdx = -1;
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "course_type:") {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      const t = lines[i].trim();
      if (t.startsWith("- ")) lastIdx = i;
      else if (t === "---" || (t && !t.startsWith("-"))) break;
    }
  }
  if (lastIdx === -1) return content;
  lines.splice(lastIdx + 1, 0, line);
  return lines.join("\n");
}

export function appendLinkListEntry(content: string, key: string, entry: string): string {
  const lines = content.split("\n");
  let keyIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === key + ":") {
      keyIdx = i;
      break;
    }
  }
  if (keyIdx === -1) return content;
  let lastIdx = -1;
  for (let i = keyIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("- ")) lastIdx = i;
    else if (t === "---" || t === "" || !t.startsWith("-")) break;
  }
  const insertAt = lastIdx === -1 ? keyIdx + 1 : lastIdx + 1;
  lines.splice(insertAt, 0, "  - " + yamlScalar(entry));
  return lines.join("\n");
}

export function insertNewCourseTypeBlock(content: string, courseType: string, link: string): string {
  const indexPos = content.indexOf(INDEX_HEADER);
  if (indexPos === -1) return content;
  const endMarker = content.indexOf(TEST_FEEDBACK_HEADER, indexPos);
  const sectionEnd = endMarker === -1 ? content.length : endMarker;
  const section = content.slice(indexPos, sectionEnd);
  const lastDiv = section.lastIndexOf("---");
  if (lastDiv === -1) return content;
  const insertPos = indexPos + lastDiv + 3;
  const block = "\n\n### 🏷️ " + courseType + "\n" + link + "\n\n---\n";
  return content.slice(0, insertPos) + block + content.slice(insertPos);
}

export function appendTestFeedbackLink(content: string, linkLine: string): string {
  if (!content.includes(TEST_FEEDBACK_HEADER)) {
    return content + `\n${TEST_FEEDBACK_HEADER}\n${linkLine}\n`;
  }
  const parts = content.split(TEST_FEEDBACK_HEADER);
  const before = parts[0];
  const after = parts.slice(1).join(TEST_FEEDBACK_HEADER);
  if (after.trim()) {
    return before + TEST_FEEDBACK_HEADER + after.replace(/\n+$/, "") + "\n" + linkLine + "\n";
  }
  return before + TEST_FEEDBACK_HEADER + "\n" + linkLine + "\n";
}

export function parseDateTime(
  raw: string,
  lessonNumber: number,
  slots: Record<number, string>,
  slotIndex?: number,
): { datePart: string; timePart: string; month: number; day: number } {
  let dateTimeStr = raw.trim();
  let datePart: string;
  let timePart: string | null = null;
  if (dateTimeStr.includes(" ")) {
    const [d, suffixRaw] = dateTimeStr.split(/ (.+)/);
    datePart = d;
    const suffix = (suffixRaw ?? "").trim();
    if (suffix.includes(":")) timePart = suffix;
    else if (/^\d+$/.test(suffix) && slots[Number(suffix)]) timePart = slots[Number(suffix)];
  } else {
    datePart = dateTimeStr;
  }
  if (slotIndex && slots[slotIndex]) timePart = slots[slotIndex];
  if (!timePart) timePart = slots[lessonNumber] ?? "10:00";
  if (!DATE_RE.test(datePart)) throw new Error("日期格式错误（应为 YYYY-MM-DD）: " + datePart);
  const parts = datePart.split("-");
  return { datePart, timePart, month: Number(parts[1]), day: Number(parts[2]) };
}
