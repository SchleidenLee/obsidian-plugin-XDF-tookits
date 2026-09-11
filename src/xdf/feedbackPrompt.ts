import type { XdfToolkitsSettings } from "../settings";

/** Locked. Not editable in settings. */
export const DAILY_FEEDBACK_SYSTEM_PROMPT = `你是新东方一线雅思{subject}老师，在写给学生或家长看的课后反馈。

写人话，不要写模型腔。禁止：
- 「首先/其次/最后」「值得一提的是」「总的来说」「展现出」「赋能」「夯实」
- 排比、空夸奖、正确的废话
- 编造分数、排名、未在记录里出现的题目或错误
- markdown 标题、emoji、编号大作文

要求：
- 只根据提供的原始记录（以及可选的本课授课内容、此前几节原始记录）写
- 授课内容只用来对照「这节课练了什么」，不要把讲义复述进反馈
- 此前原始记录只用来看习惯和对比，不要把旧课当成本课事实
- 2～6 句或几个短句，具体到表现/作业/问题
- 不写开场白和结尾祝福

语气配置若有，服从配置里的称呼和语气，仍须遵守以上禁令。`;

export function buildToneBlock(settings: XdfToolkitsSettings): string {
  const t = settings.tone;
  const lines = [
    `称呼：${t.address || "（未填）"}`,
  ];
  if (t.avoid) lines.push(`违禁词：${t.avoid}`);
  const styleParts = [t.style, t.notes].filter(Boolean);
  lines.push(`风格偏好：${styleParts.join("；") || "（未填）"}`);
  return lines.join("\n");
}

export function buildDailyFeedbackUserPrompt(input: {
  target: string;
  lesson: number;
  student: string;
  raw: string;
  teaching?: string;
  previousRaw?: { lesson: number; text: string }[];
  tone: string;
}): string {
  const parts = [
    `档案：${input.target}`,
    `课次：${input.lesson}`,
    `学员：${input.student}`,
    `语气配置：\n${input.tone}`,
    `本课原始记录：\n${input.raw.trim() || "（无）"}`,
  ];
  if (input.teaching != null) {
    parts.push(`本课授课内容（仅对照，勿复述）：\n${input.teaching.trim() || "（无）"}`);
  }
  if (input.previousRaw && input.previousRaw.length) {
    const block = input.previousRaw
      .map((p) => `第${p.lesson}课原始记录：\n${p.text.trim() || "（无）"}`)
      .join("\n\n");
    parts.push(`此前原始记录（只对照习惯，不当成本课事实）：\n${block}`);
  }
  parts.push("请直接写出本课反馈正文。");
  return parts.join("\n\n");
}

export const TONE_EXTRACT_SYSTEM = `根据老师粘贴的历史反馈，提炼可执行的语气配置。只输出 JSON，不要 markdown。
字段：
{"address":"怎么称呼学生","avoid":"违禁词","style":"风格偏好（语气、句式、补充习惯合并）"}
短句，不要评价老师。`;
