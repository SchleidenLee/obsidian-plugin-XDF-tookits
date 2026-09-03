import * as http from "http";
import type { App } from "obsidian";
import type { XdfToolkitsSettings } from "../settings";
import { TOOL_DEFS, callTool, createXdfDb } from "../xdf/tools";

interface JsonRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpHttpServer {
  private server: http.Server | null = null;
  running = false;

  constructor(
    private app: App,
    private getSettings: () => XdfToolkitsSettings,
  ) {}

  get listenHost(): string {
    return this.getSettings().bindLan ? "0.0.0.0" : "127.0.0.1";
  }

  get url(): string {
    return `http://127.0.0.1:${this.getSettings().port}/mcp`;
  }

  async start(): Promise<void> {
    await this.stop();
    const settings = this.getSettings();
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(settings.port, this.listenHost, () => resolve());
    });
    this.running = true;
  }

  async stop(): Promise<void> {
    const srv = this.server;
    this.server = null;
    this.running = false;
    if (!srv) return;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  private unauthorized(res: http.ServerResponse) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const settings = this.getSettings();
    const url = new URL(req.url || "/", "http://127.0.0.1");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, MCP-Session-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          name: "xdf-toolkits",
          tools: TOOL_DEFS.length,
        }),
      );
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    if (settings.token) {
      const auth = String(req.headers.authorization || "");
      const token = auth.toLowerCase().startsWith("bearer ")
        ? auth.slice(7).trim()
        : auth.trim();
      if (token !== settings.token) {
        this.unauthorized(res);
        return;
      }
    }

    if (req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("event: ping\ndata: {}\n\n");
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let msg: JsonRpc;
    try {
      msg = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "parse error" } }));
      return;
    }

    const reply = await this.dispatch(msg);
    if (reply === null) {
      res.writeHead(202);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply));
  }

  private async dispatch(msg: JsonRpc): Promise<JsonRpc | null> {
    const id = msg.id ?? null;
    const method = msg.method || "";
    const params = (msg.params || {}) as Record<string, unknown>;

    if (method.startsWith("notifications/")) return null;

    try {
      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "xdf-toolkits", version: "0.1.0" },
          },
        };
      }
      if (method === "ping" || method === "tools/list") {
        if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: TOOL_DEFS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        };
      }
      if (method === "tools/call") {
        const name = String(params.name || "");
        const args = (params.arguments || {}) as Record<string, unknown>;
        const ctx = {
          app: this.app,
          db: createXdfDb(this.app),
          settings: this.getSettings(),
        };
        const text = await callTool(ctx, name, args);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text }],
            isError: text.includes('"status":"error"'),
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown method: ${method}` },
      };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: e instanceof Error ? e.message : String(e) },
      };
    }
  }
}
