import * as crypto from "crypto";
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

// 恒定时间比较两个 token,避免逐字符比较被计时探测;
// 长度不等时也用等长的假数据比一遍,保证耗时恒定
function timingSafeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length === bufB.length) {
    return crypto.timingSafeEqual(bufA, bufB);
  }
  const padded = Buffer.alloc(64);
  bufA.copy(padded, 0, 0, Math.min(bufA.length, 64));
  crypto.timingSafeEqual(padded, Buffer.alloc(64));
  return false;
}

export class McpHttpServer {
  private server: http.Server | null = null;
  private actualPort: number | null = null;
  // 长挂的 SSE 探活响应:close 前必须逐个销毁,否则 srv.close 永不回调
  private sseResponses = new Set<http.ServerResponse>();
  running = false;

  constructor(
    private app: App,
    private getSettings: () => XdfToolkitsSettings,
    private version: string,
  ) {}

  get listenHost(): string {
    return this.getSettings().bindLan ? "0.0.0.0" : "127.0.0.1";
  }

  get port(): number {
    return this.actualPort ?? this.getSettings().port;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  private tryListen(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        void this.handle(req, res);
      });
      srv.once("error", (err) => {
        srv.close();
        reject(err);
      });
      srv.listen(port, this.listenHost, () => {
        this.server = srv;
        this.actualPort = port;
        resolve();
      });
    });
  }

  async start(): Promise<void> {
    await this.stop();
    const settings = this.getSettings();
    const basePort = settings.port;
    const maxOffset = 50;

    // Try base port first, then alternate +1, -1, +2, -2, ...
    for (let offset = 0; offset <= maxOffset; offset++) {
      const ports = offset === 0 ? [basePort] : [basePort + offset, basePort - offset];
      for (const port of ports) {
        if (port < 1 || port > 65535) continue;
        try {
          await this.tryListen(port);
          this.running = true;
          return;
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          if (err.code !== "EADDRINUSE") throw e;
          // Port in use, try next
        }
      }
    }

    throw new Error(`端口 ${basePort} 及 ±${maxOffset} 范围内均被占用，请手动设置端口`);
  }

  async stop(): Promise<void> {
    const srv = this.server;
    this.server = null;
    this.running = false;
    if (!srv) return;
    // 先销毁挂着的 SSE 连接,否则 srv.close 永不完成
    for (const res of this.sseResponses) res.destroy();
    this.sseResponses.clear();
    // Node 18.2+ 提供,存在才调
    srv.closeAllConnections?.();
    // 兜底:close 回调 2 秒内不来就放行,避免永久挂死
    await Promise.race([
      new Promise<void>((resolve) => srv.close(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  }

  private unauthorized(res: http.ServerResponse) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const settings = this.getSettings();
    const url = new URL(req.url || "/", "http://127.0.0.1");

    // CORS:Obsidian 内页面(app://obsidian.md)用 fetch 连接,必须应答预检;
    // 预检请求不带 Authorization,所以必须在 token 校验之前处理
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
      if (!timingSafeTokenEqual(token, settings.token)) {
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
      // 记录活跃 SSE,stop() 时统一销毁;连接断开或响应结束时移除
      this.sseResponses.add(res);
      res.on("close", () => this.sseResponses.delete(res));
      res.on("end", () => this.sseResponses.delete(res));
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
            serverInfo: { name: "xdf-toolkits", version: this.version },
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
