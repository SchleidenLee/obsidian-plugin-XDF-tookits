import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type XdfToolkitsPlugin from "./main";
import { TONE_EXTRACT_SYSTEM } from "./xdf/feedbackPrompt";

export interface ToneConfig {
  address: string;
  audience: string;
  style: string;
  avoid: string;
  notes: string;
}

export interface XdfToolkitsSettings {
  enabled: boolean;
  port: number;
  token: string;
  bindLan: boolean;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  useTeachingContent: boolean;
  usePreviousRaw: boolean;
  previousRawLessons: number;
  tone: ToneConfig;
}

export const DEFAULT_SETTINGS: XdfToolkitsSettings = {
  enabled: true,
  port: 27183,
  token: "",
  bindLan: false,
  llmBaseUrl: "https://api.schleiden.space/v1",
  llmApiKey: "",
  llmModel: "qwen-plus",
  useTeachingContent: true,
  usePreviousRaw: true,
  previousRawLessons: 2,
  tone: {
    address: "",
    audience: "家长",
    style: "",
    avoid: "",
    notes: "",
  },
};

async function chatJson(
  settings: XdfToolkitsSettings,
  system: string,
  user: string,
): Promise<string> {
  if (!settings.llmBaseUrl || !settings.llmApiKey) {
    throw new Error("未配置模型");
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
        { role: "user", content: user },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("LLM 无输出");
  return text;
}

export class XdfToolkitsSettingTab extends PluginSettingTab {
  plugin: XdfToolkitsPlugin;
  private extractSample = "";

  constructor(app: App, plugin: XdfToolkitsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "XDF Toolkits · MCP" });

    const status = this.plugin.getServerStatus();
    containerEl.createEl("p", {
      text: status.running
        ? `服务运行中：${status.url}`
        : "服务未运行（请启用开关并确保在桌面端）",
    });

    new Setting(containerEl)
      .setName("启用 MCP 服务")
      .setDesc("Obsidian 打开时在本机监听 HTTP MCP")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enabled).onChange(async (v) => {
          this.plugin.settings.enabled = v;
          await this.plugin.saveSettings();
          await this.plugin.restartServer();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("端口")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.port)).onChange(async (v) => {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 1 || n > 65535) return;
          this.plugin.settings.port = n;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("访问令牌")
      .addText((t) =>
        t.setValue(this.plugin.settings.token).onChange(async (v) => {
          this.plugin.settings.token = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("允许局域网")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.bindLan).onChange(async (v) => {
          this.plugin.settings.bindLan = v;
          await this.plugin.saveSettings();
          await this.plugin.restartServer();
        }),
      );

    containerEl.createEl("h3", { text: "模型（NewAPI / 兼容口）" });

    new Setting(containerEl)
      .setName("Base URL")
      .addText((t) =>
        t.setValue(this.plugin.settings.llmBaseUrl).onChange(async (v) => {
          this.plugin.settings.llmBaseUrl = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("API Key")
      .addText((t) =>
        t.setValue(this.plugin.settings.llmApiKey).onChange(async (v) => {
          this.plugin.settings.llmApiKey = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("模型名")
      .addText((t) =>
        t.setValue(this.plugin.settings.llmModel).onChange(async (v) => {
          this.plugin.settings.llmModel = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "日常反馈生成" });
    containerEl.createEl("p", {
      text: "去 AI 味的系统提示已锁死，不在此修改。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("参考本课授课内容")
      .setDesc("生成时带上本课授课内容，只对照「练了什么」，不复述讲义")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.useTeachingContent).onChange(async (v) => {
          this.plugin.settings.useTeachingContent = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("参考此前原始记录")
      .setDesc("带上该学员前几节课的原始记录，只对照习惯，不当成本课事实")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.usePreviousRaw).onChange(async (v) => {
          this.plugin.settings.usePreviousRaw = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("此前原始记录节数")
      .setDesc("不含本课。默认 2")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.previousRawLessons)).onChange(async (v) => {
          const n = Math.max(1, Math.min(8, Number(v) || 2));
          this.plugin.settings.previousRawLessons = n;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl("h3", { text: "语气" });

    const tone = this.plugin.settings.tone;
    const bind = (key: keyof ToneConfig, name: string, desc: string) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) =>
          t.setValue(tone[key]).onChange(async (v) => {
            this.plugin.settings.tone[key] = v;
            await this.plugin.saveSettings();
          }),
        );
    };
    bind("address", "称呼", "如：孩子 / 小名 / 同学");
    bind("audience", "写给谁", "家长 / 学生 / 两者");
    bind("style", "语气与句式", "如：短句、先问题后作业、不客套");
    bind("avoid", "避免", "不要出现的说法");
    bind("notes", "补充", "其它稳定习惯");

    containerEl.createEl("h4", { text: "从自己的反馈提取语气" });
    new Setting(containerEl)
      .setName("粘贴历史反馈")
      .setDesc("3～5 段自己写的即可，点提取后覆盖上方字段，可再改")
      .addTextArea((t) => {
        t.setValue(this.extractSample);
        t.inputEl.rows = 8;
        t.inputEl.style.width = "100%";
        t.onChange((v) => {
          this.extractSample = v;
        });
      });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText("提取语气配置").onClick(async () => {
        const sample = this.extractSample.trim();
        if (!sample) {
          new Notice("先粘贴反馈");
          return;
        }
        b.setDisabled(true);
        try {
          const raw = await chatJson(this.plugin.settings, TONE_EXTRACT_SYSTEM, sample);
          const match = raw.match(/\{[\s\S]*\}/);
          if (!match) throw new Error("未解析到 JSON");
          const parsed = JSON.parse(match[0]) as Partial<ToneConfig>;
          this.plugin.settings.tone = {
            address: String(parsed.address ?? tone.address),
            audience: String(parsed.audience ?? tone.audience),
            style: String(parsed.style ?? tone.style),
            avoid: String(parsed.avoid ?? tone.avoid),
            notes: String(parsed.notes ?? tone.notes),
          };
          await this.plugin.saveSettings();
          new Notice("已写入语气配置，可再改");
          this.display();
        } catch (e) {
          new Notice(`提取失败：${e instanceof Error ? e.message : String(e)}`);
        } finally {
          b.setDisabled(false);
        }
      }),
    );

    new Setting(containerEl)
      .setName("复制 MCP 配置")
      .addButton((b) =>
        b.setButtonText("复制").onClick(async () => {
          await navigator.clipboard.writeText(this.plugin.getClientConfigSnippet());
          new Notice("已复制 MCP 配置");
        }),
      );
  }
}
