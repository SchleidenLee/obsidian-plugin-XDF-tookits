import { Notice, Plugin } from "obsidian";
import { McpHttpServer } from "./mcp/httpServer";
import {
  DEFAULT_SETTINGS,
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

    this.mcp = new McpHttpServer(this.app, () => this.settings);
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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
    if (!this.mcp) return;
    try {
      await this.mcp.stop();
      if (!this.settings.enabled) {
        this.statusEl?.setText("XDF MCP 已关闭");
        return;
      }
      await this.mcp.start();
      this.statusEl?.setText(`XDF MCP :${this.settings.port}`);
      new Notice(`XDF MCP 已启动 ${this.mcp.url}`);
    } catch (e) {
      this.statusEl?.setText("XDF MCP 失败");
      new Notice(`XDF MCP 启动失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
