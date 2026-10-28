import { Notice, Plugin } from "obsidian";
import { McpHttpServer } from "./mcp/httpServer";
import {
  DEFAULT_SETTINGS,
  SECRET_IDS,
  XdfToolkitsSettingTab,
  type XdfToolkitsSettings,
} from "./settings";

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default class XdfToolkitsPlugin extends Plugin {
  settings: XdfToolkitsSettings = { ...DEFAULT_SETTINGS };
  private mcp: McpHttpServer | null = null;
  private statusEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();
    if (!this.settings.token) {
      this.settings.token = randomToken();
      await this.saveSettings();
    }

    this.mcp = new McpHttpServer(this.app, () => this.settings, this.manifest.version);
    this.addSettingTab(new XdfToolkitsSettingTab(this.app, this));
    this.statusEl = this.addStatusBarItem();
    this.statusEl.setText("XDF MCP 未启动");

    this.addCommand({
      id: "xdf-mcp-restart",
      name: "重启 MCP 服务",
      callback: () => void this.restartServer(),
    });
    this.addCommand({
      id: "xdf-mcp-copy-url",
      name: "复制 MCP URL",
      callback: async () => {
        await navigator.clipboard.writeText(this.getServerStatus().url);
        new Notice("已复制 MCP URL");
      },
    });

    (this as unknown as { api: unknown }).api = {
      getStatus: () => this.getServerStatus(),
      getConfig: () => this.getClientConfigSnippet(),
    };

    if (this.settings.enabled) {
      await this.restartServer();
    }
  }

  onunload() {
    void this.mcp?.stop();
  }

  async loadSettings() {
    const loaded = (await this.loadData()) as Partial<XdfToolkitsSettings> | null;
    // 迁移:data.json 里的明文密钥写入 SecretStorage,并从持久化数据中删除
    let migrated = false;
    for (const field of ["llmApiKey", "visionApiKey"] as const) {
      const legacy = loaded?.[field];
      if (legacy) {
        this.app.secretStorage.setSecret(SECRET_IDS[field], legacy);
        delete loaded[field];
        migrated = true;
      }
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded, {
      tone: {
        ...DEFAULT_SETTINGS.tone,
        ...(loaded?.tone ?? {}),
        presets: loaded?.tone?.presets ?? DEFAULT_SETTINGS.tone.presets,
        activePreset: loaded?.tone?.activePreset ?? DEFAULT_SETTINGS.tone.activePreset,
      },
    });
    // 运行时从 SecretStorage 回填密钥(落盘时由 saveSettings 剥离)
    this.settings.llmApiKey = this.app.secretStorage.getSecret(SECRET_IDS.llmApiKey) ?? "";
    this.settings.visionApiKey = this.app.secretStorage.getSecret(SECRET_IDS.visionApiKey) ?? "";
    if (migrated) await this.saveSettings();
  }

  async saveSettings() {
    // 密钥走 SecretStorage,不落 data.json
    const dataToSave: Record<string, unknown> = { ...this.settings };
    delete dataToSave.llmApiKey;
    delete dataToSave.visionApiKey;
    await this.saveData(dataToSave);
  }

  // 写入密钥到 SecretStorage 并同步内存(settings.llmApiKey 等运行时字段仍保留真实值)
  async setSecretValue(field: "llmApiKey" | "visionApiKey", value: string) {
    this.app.secretStorage.setSecret(SECRET_IDS[field], value);
    this.settings[field] = value;
    await this.saveSettings();
  }

  async regenerateToken() {
    this.settings.token = randomToken();
    await this.saveSettings();
  }

  getServerStatus() {
    const running = !!this.mcp?.running;
    const url = this.mcp?.url ?? `http://127.0.0.1:${this.settings.port}/mcp`;
    return {
      running,
      url,
      port: this.settings.port,
      token: this.settings.token,
      pluginId: "xdf-toolkits",
    };
  }

  getClientConfigSnippet(): string {
    const st = this.getServerStatus();
    return JSON.stringify(
      {
        mcpServers: {
          "xdf-toolkits": {
            url: st.url,
            headers: { Authorization: `Bearer ${st.token}` },
          },
        },
      },
      null,
      2,
    );
  }

  async restartServer() {
    if (this.settings.bindLan && !this.settings.token) {
      new Notice("开启局域网访问前必须设置访问令牌(token),请先在设置中填写");
      return;
    }
    if (!this.mcp) return;
    try {
      await this.mcp.stop();
      if (!this.settings.enabled) {
        this.statusEl?.setText("XDF MCP 已关闭");
        return;
      }
      await this.mcp.start();
      const actualPort = this.mcp.port;
      this.statusEl?.setText(`XDF MCP :${actualPort}`);
      if (actualPort !== this.settings.port) {
        new Notice(`XDF MCP 已启动 ${this.mcp.url}（端口已自动调整）`);
      } else {
        new Notice(`XDF MCP 已启动 ${this.mcp.url}`);
      }
    } catch (e) {
      this.statusEl?.setText("XDF MCP 失败");
      new Notice(`XDF MCP 启动失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
