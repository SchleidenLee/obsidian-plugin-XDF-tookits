/**
 * 模型传输层：文本 / 视觉两套独立 provider 的统一调用入口。
 *
 * 本模块只做传输：拼 URL、鉴权、发 requestUrl、取 choices[0].message.content、抛错。
 * 不含业务逻辑（压缩、批量、缓存、评分、进度等由调用方负责）。
 * 不含超时（requestUrl 无超时参数，超时由业务层负责）。
 */
import { requestUrl } from "obsidian";
import type { XdfToolkitsSettings } from "./settings";

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 图片载荷：base64 不含 "data:" 前缀 */
export interface VisionImage {
  mime: string;
  base64: string;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatMessage {
  role: "system" | "user";
  content: string | ContentPart[];
}

function resolveTextProvider(settings: XdfToolkitsSettings): ProviderConfig {
  if (!settings.llmBaseUrl || !settings.llmApiKey || !settings.llmModel) {
    throw new Error("未配置文本模型（Base URL / API Key / Model）");
  }
  return {
    baseUrl: settings.llmBaseUrl,
    apiKey: settings.llmApiKey,
    model: settings.llmModel,
  };
}

function resolveVisionProvider(settings: XdfToolkitsSettings): ProviderConfig {
  if (!settings.visionBaseUrl || !settings.visionApiKey || !settings.visionModel) {
    throw new Error("未配置视觉模型（Base URL / API Key / Model）");
  }
  return {
    baseUrl: settings.visionBaseUrl,
    apiKey: settings.visionApiKey,
    model: settings.visionModel,
  };
}

async function chatRequest(
  cfg: ProviderConfig,
  opts: { messages: ChatMessage[]; temperature?: number; maxTokens?: number },
): Promise<string> {
  const url = cfg.baseUrl.replace(/\/$/, "") + "/chat/completions";
  const res = await requestUrl({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      // 未指定时兜底 8000，保证长课次反馈能一次写完；显式传入则以调用方为准
      max_tokens: opts.maxTokens ?? 8000,
    }),
    throw: false,
  });
  if (res.status >= 400) {
    throw new Error(`模型 HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  }
  const json = res.json as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("模型无输出");
  return text;
}

export async function chatText(
  settings: XdfToolkitsSettings,
  opts: { user: string; system?: string; temperature?: number },
): Promise<string> {
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });
  return chatRequest(resolveTextProvider(settings), {
    messages,
    temperature: opts.temperature,
  });
}

export async function chatVision(
  settings: XdfToolkitsSettings,
  opts: { prompt: string; images: VisionImage[]; system?: string; temperature?: number },
): Promise<string> {
  const parts: ContentPart[] = opts.images.map((img) => ({
    type: "image_url",
    image_url: { url: `data:${img.mime};base64,${img.base64}` },
  }));
  parts.push({ type: "text", text: opts.prompt });
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: parts });
  return chatRequest(resolveVisionProvider(settings), {
    messages,
    temperature: opts.temperature,
  });
}
