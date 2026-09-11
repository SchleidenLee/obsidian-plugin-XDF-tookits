import { App, Notice, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type XdfToolkitsPlugin from "./main";
import { TONE_EXTRACT_SYSTEM } from "./xdf/feedbackPrompt";

export interface TonePreset {
  name: string;
  address: string;
  avoid: string;
  style: string;
}

export interface ToneConfig {
  address: string;
  audience: string;
  style: string;
  avoid: string;
  notes: string;
  presets: TonePreset[];
  activePreset: string;
  custom?: TonePreset;
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
    address: "学员",
    audience: "",
    style: "",
    avoid: "四字成语",
    notes: "",
    presets: [
      {
        name: "TS严格版",
        address: "学员",
        avoid: "四字成语",
        style: "短句、先说问题再说作业、不客套",
      },
      {
        name: "Python客观版",
        address: "学员",
        avoid: "",
        style: "客观中立、100字以上、完整段落、不分条列点、不使用冒号",
      },
    ],
    activePreset: "TS严格版",
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
  const res = await requestUrl({
    url,
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
    throw: false,
  });
  if (res.status >= 400) throw new Error(`LLM HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  const json = res.json as { choices?: { message?: { content?: string } }[] };
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

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("验证 Base URL、API Key、模型名是否可用")
      .addButton((b) =>
        b.setButtonText("测试").onClick(async () => {
          b.setDisabled(true);
          b.setButtonText("测试中...");
          try {
            await chatJson(this.plugin.settings, "回复OK", "ping");
            new Notice("连接成功");
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            new Notice(`连接失败：${msg}`);
          } finally {
            b.setDisabled(false);
            b.setButtonText("测试");
          }
        }),
      );

    containerEl.createEl("h3", { text: "日常反馈生成" });

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
    const isPresetMode = tone.presets.some((p) => p.name === tone.activePreset);
    const currentPreset = tone.presets.find((p) => p.name === tone.activePreset);

    // 预设选择器
    new Setting(containerEl)
      .setName("语气预设")
      .setDesc("选择预设后下方字段为只读，可微调后保存为自定义")
      .addDropdown((d) => {
        tone.presets.forEach((p) => d.addOption(p.name, p.name));
        d.addOption("custom", "自定义");
        d.setValue(tone.activePreset === "custom" ? "custom" : tone.activePreset);
        d.onChange(async (v) => {
          if (v === "custom") {
            this.plugin.settings.tone.activePreset = "custom";
          } else {
            const preset = tone.presets.find((p) => p.name === v);
            if (preset) {
              this.plugin.settings.tone.address = preset.address;
              this.plugin.settings.tone.avoid = preset.avoid;
              this.plugin.settings.tone.style = preset.style;
              this.plugin.settings.tone.activePreset = v;
            }
          }
          await this.plugin.saveSettings();
          this.display();
        });
      });

    // 保存为自定义按钮
    if (isPresetMode) {
      new Setting(containerEl).addButton((b) =>
        b.setButtonText("保存为自定义配置").onClick(async () => {
          this.plugin.settings.tone.custom = {
            name: "自定义",
            address: this.plugin.settings.tone.address,
            avoid: this.plugin.settings.tone.avoid,
            style: this.plugin.settings.tone.style,
          };
          this.plugin.settings.tone.activePreset = "custom";
          await this.plugin.saveSettings();
          new Notice("已保存为自定义配置");
          this.display();
        }),
      );
    }

    const isReadOnly = isPresetMode && !tone.custom;

    // 称呼：下拉 + 条件显示自定义输入框
    const addressType = tone.address === "孩子" || tone.address === "学员" || tone.address === "姓名（后两字）" || tone.address === "姓名"
      ? tone.address
      : "学员";
    const customName = addressType === "姓名（后两字）" || addressType === "姓名" ? tone.address : "";

    const addressSetting = new Setting(containerEl)
      .setName("称呼")
      .addDropdown((d) =>
        d.addOption("孩子", "孩子")
          .addOption("学员", "学员")
          .addOption("姓名（后两字）", "姓名（后两字）")
          .addOption("姓名", "姓名")
          .setValue(addressType)
          .onChange(async (v) => {
            if (v === "姓名（后两字）" || v === "姓名") {
              this.plugin.settings.tone.address = "";
            } else {
              this.plugin.settings.tone.address = v;
            }
            this.plugin.settings.tone.activePreset = "custom";
            await this.plugin.saveSettings();
            this.display();
          }),
      );
    if (isReadOnly) addressSetting.setDisabled(true);

    if ((addressType === "姓名（后两字）" || addressType === "姓名") && !isReadOnly) {
      const isFullName = addressType === "姓名";
      new Setting(containerEl)
        .setName(isFullName ? "全名" : "自定义名字")
        .setDesc(isFullName ? "输入全名，直接使用" : "输入全名，自动取后两字。如：曹子轩 → 子轩")
        .addText((t) =>
          t.setValue(customName).onChange(async (v) => {
            const trimmed = v.trim();
            let displayName = trimmed;
            if (addressType === "姓名（后两字）") {
              displayName = trimmed.length > 2 ? trimmed.slice(-2) : trimmed;
            }
            this.plugin.settings.tone.address = displayName;
            this.plugin.settings.tone.activePreset = "custom";
            await this.plugin.saveSettings();
          }),
        );
    }

    // 违禁词
    const avoidSetting = new Setting(containerEl)
      .setName("违禁词")
      .setDesc("不要出现的说法")
      .addText((t) =>
        t.setValue(tone.avoid).setPlaceholder('四字成语、客套话、"非常棒"').onChange(async (v) => {
          this.plugin.settings.tone.avoid = v;
          this.plugin.settings.tone.activePreset = "custom";
          await this.plugin.saveSettings();
        }),
      );
    if (isReadOnly) avoidSetting.setDisabled(true);

    // 风格偏好（合并原"语气与句式"和"补充"）
    const styleSetting = new Setting(containerEl)
      .setName("风格偏好")
      .setDesc("语气、句式、补充习惯")
      .addTextArea((t) => {
        const merged = [tone.style, tone.notes].filter(Boolean).join("\n");
        t.setValue(merged).setPlaceholder("短句、先说问题再说作业、不客套");
        t.inputEl.rows = 3;
        t.inputEl.style.width = "100%";
        t.onChange(async (v) => {
          this.plugin.settings.tone.style = v;
          this.plugin.settings.tone.notes = "";
          this.plugin.settings.tone.activePreset = "custom";
          await this.plugin.saveSettings();
        });
      });
    if (isReadOnly) styleSetting.setDisabled(true);

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
      b.setButtonText("提取语气").onClick(async () => {
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
            ...this.plugin.settings.tone,
            address: String(parsed.address ?? tone.address),
            audience: "",
            style: String(parsed.style ?? tone.style),
            avoid: String(parsed.avoid ?? tone.avoid),
            notes: "",
            activePreset: "custom",
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
