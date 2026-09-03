import type { App, TFile } from "obsidian";
import { buildPersonFeedback } from "./templates";

const AI_START = "<!-- AI_GENERATED_START -->";
const AI_END = "<!-- AI_GENERATED_END -->";

export async function readFile(app: App, path: string): Promise<string | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!file || !("extension" in file)) return null;
  return app.vault.read(file as TFile);
}

export async function writeFile(app: App, path: string, content: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (file && "extension" in file) {
    await app.vault.modify(file as TFile, content);
    return;
  }
  const dir = path.split("/").slice(0, -1).join("/");
  if (dir && !app.vault.getAbstractFileByPath(dir)) {
    await app.vault.createFolder(dir);
  }
  await app.vault.create(path, content);
}

export function upsertAiBlock(body: string, content: string): { text: string; action: string } {
  const block = `${AI_START}\n${content.trim()}\n\n${AI_END}`;
  const re = /<!--\s*AI_GENERATED_START\s*-->[\s\S]*?<!--\s*AI_GENERATED_END\s*-->/i;
  if (re.test(body)) {
    return { text: body.replace(re, block), action: "replaced" };
  }
  const heading = /(^### 反馈总结\s*$)/m;
  if (heading.test(body)) {
    return {
      text: body.replace(heading, `$1\n${AI_START}\n${content.trim()}\n\n${AI_END}\n`),
      action: "created_under_heading",
    };
  }
  return { text: `${body.trimEnd()}\n\n### 反馈总结\n${AI_START}\n${content.trim()}\n\n${AI_END}\n`, action: "appended" };
}

export function extractAiBlock(body: string): string {
  const m = body.match(
    /<!--\s*AI_GENERATED_START\s*-->\s*([\s\S]*?)\s*<!--\s*AI_GENERATED_END\s*-->/i,
  );
  if (!m) return "";
  const inner = m[1].trim();
  return inner === "待生成" ? "" : inner;
}

export function setCheckbox(line: string, checked: boolean): string {
  return line
    .replace(/- \[[ xX]\]/, `- [${checked ? "x" : " "}]`)
    .replace(/\[ \]/g, checked ? "[x]" : "[ ]")
    .replace(/\[x\]/gi, checked ? "[x]" : "[ ]");
}

export function headingLevel(line: string): number {
  const m = line.match(/^(#{1,6})\s+/);
  return m ? m[1].length : 0;
}

export function findHeadingRange(
  lines: string[],
  level: number,
  titleContains: string,
): { start: number; end: number } | null {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const lv = headingLevel(lines[i]);
    if (lv === level && lines[i].includes(titleContains)) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const lv = headingLevel(lines[i]);
    if (lv && lv <= level) {
      end = i;
      break;
    }
  }
  return { start, end };
}

export function findStudentBlock(text: string, student: string): { start: number; end: number } | null {
  const lines = text.split("\n");
  const markers = [`## 👤 ${student}`, `## ${student}`];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (markers.some((m) => t === m || t === m + " ")) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (headingLevel(lines[i]) === 2) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** 对齐 md_utils.ensure_student_block：缺失时用 buildPersonFeedback 完整模板。 */
export function ensureStudentBlock(
  text: string,
  student: string,
  lessonNum: number,
  dateStr?: string | null,
  subject?: string | null,
): string {
  if (findStudentBlock(text, student)) return text;
  if (!dateStr) return text;
  const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return text;
  const block = buildPersonFeedback({
    name: student,
    lesson_number: lessonNum,
    month: Number(m[2]),
    day: Number(m[3]),
    subject: subject ?? null,
  });
  const trimmed = text.replace(/^\s*# Feedback \d+\s*\n*/, "").replace(/\s+$/, "");
  if (!trimmed.trim()) return block;
  return trimmed + "\n\n" + block;
}

export function setFieldBody(
  text: string,
  field: string,
  content: string,
  student?: string | null,
): string {
  const lines = text.split("\n");
  let scopeStart = 0;
  let scopeEnd = lines.length;
  if (student) {
    const range = findStudentBlock(text, student);
    if (!range) return text;
    scopeStart = range.start;
    scopeEnd = range.end;
  }
  let fieldStart = -1;
  for (let i = scopeStart; i < scopeEnd; i++) {
    if (headingLevel(lines[i]) === 4 && lines[i].includes(field)) {
      fieldStart = i;
      break;
    }
  }
  if (fieldStart < 0) return text;
  let fieldEnd = scopeEnd;
  for (let i = fieldStart + 1; i < scopeEnd; i++) {
    const lv = headingLevel(lines[i]);
    if (lv && lv <= 4) {
      fieldEnd = i;
      break;
    }
  }
  const keep: string[] = [];
  for (let i = fieldStart + 1; i < fieldEnd; i++) {
    if (/<input\s+type=["']checkbox["']/i.test(lines[i])) keep.push(lines[i]);
    if (/出勤情况：/.test(lines[i]) || /已完成 \|/.test(lines[i])) keep.push(lines[i]);
  }
  const body = content.split("\n");
  const next = [
    ...lines.slice(0, fieldStart + 1),
    ...keep,
    ...body,
    "",
    ...lines.slice(fieldEnd),
  ];
  return next.join("\n");
}

export function parseLessonRange(input: string): number[] {
  const out = new Set<number>();
  for (const part of input.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)-(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
    } else {
      const n = Number(p);
      if (Number.isFinite(n)) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}
