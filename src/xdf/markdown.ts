import type { App, TFile } from "obsidian";

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
  const block = `${AI_START}\n${content.trim()}\n${AI_END}`;
  const re = /<!--\s*AI_GENERATED_START\s*-->[\s\S]*?<!--\s*AI_GENERATED_END\s*-->/i;
  if (re.test(body)) {
    return { text: body.replace(re, block), action: "replaced" };
  }
  const heading = /(^### 反馈总结\s*$)/m;
  if (heading.test(body)) {
    return {
      text: body.replace(heading, `$1\n\n${block}\n`),
      action: "created_under_heading",
    };
  }
  return { text: `${body.trimEnd()}\n\n### 反馈总结\n\n${block}\n`, action: "appended" };
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

export function ensureStudentBlock(
  text: string,
  student: string,
  lessonNum: number,
  dateStr?: string | null,
): string {
  if (text.includes(`## 👤 ${student}`) || text.includes(`## ${student}`)) return text;
  const dateLabel = dateStr ? dateStr.replace(/(\d{4})-(\d{2})-(\d{2})/, "$2月$3日") : "";
  const block = `
## 👤 ${student}

### 原始记录
${dateLabel}出勤情况：[ ] 正常 | [ ] 迟到 | [ ] 早退 | [ ] 线上课 | [ ] 请假

### 反馈总结
${AI_START}
待生成
${AI_END}
`;
  return `${text.trimEnd()}\n${block}\n`;
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
