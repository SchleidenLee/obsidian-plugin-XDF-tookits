import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type XdfToolkitsPlugin from "./main";

export interface XdfToolkitsSettings {
  enabled: boolean;
  port: number;
  token: string;
  bindLan: boolean;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
}

export const DEFAULT_SETTINGS: XdfToolkitsSettings = {
  enabled: true,
  port: 27183,
  token: "",
  bindLan: false,
  llmBaseUrl: "https://api.schleiden.space/v1",
  llmApiKey: "",
  llmModel: "qwen-plus",
};

export class XdfToolkitsSettingTab extends PluginSettingTab {
  plugin: XdfToolkitsPlugin;

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
      .setDesc("默认 27183。Agent 插件会自动探测这个口。")
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
      .setDesc("空则自动生成。Agent 请求头带 Authorization: Bearer <token>")
      .addText((t) =>
        t.setValue(this.plugin.settings.token).onChange(async (v) => {
          this.plugin.settings.token = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("允许局域网")
      .setDesc("默认只绑 127.0.0.1。打开后绑 0.0.0.0，给同网段 Agent 用。")
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
        t
          .setPlaceholder("https://host/v1")
          .setValue(this.plugin.settings.llmBaseUrl)
          .onChange(async (v) => {
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
      .setName("复制 MCP 配置")
      .setDesc("给支持 HTTP MCP 的客户端粘贴")
      .addButton((b) =>
        b.setButtonText("复制").onClick(async () => {
          const cfg = this.plugin.getClientConfigSnippet();
          await navigator.clipboard.writeText(cfg);
          new Notice("已复制 MCP 配置");
        }),
      );
  }
}
