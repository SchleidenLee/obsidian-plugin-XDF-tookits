import type { App } from "obsidian";

export type SqlRow = Record<string, unknown>;

export interface XdfDb {
  query(sql: string, params?: unknown[]): SqlRow[];
  available(): boolean;
  source(): string;
}

type QueryFn = (sql: string, params?: unknown[]) => unknown;

interface LoosePlugin {
  api?: { db?: { query?: QueryFn } };
  _xdfBase?: { getDBApi?: () => { query?: QueryFn } };
}

function getXdfBasePlugin(app: App): LoosePlugin | null {
  const plugins = (app as unknown as { plugins: { plugins: Record<string, LoosePlugin> } })
    .plugins?.plugins;
  return plugins?.["xdf-base"] ?? null;
}

/** xdf-base 把查询口挂在 _xdfBase.getDBApi()，文档里的 api.db 目前没接上。 */
function resolveQuery(app: App): { query: QueryFn; source: string } | null {
  const plugin = getXdfBasePlugin(app);
  if (!plugin) return null;
  const viaExt = plugin._xdfBase?.getDBApi?.();
  if (viaExt && typeof viaExt.query === "function") {
    return { query: viaExt.query.bind(viaExt), source: "xdf-base:_xdfBase" };
  }
  if (typeof plugin.api?.db?.query === "function") {
    return { query: plugin.api.db.query.bind(plugin.api.db), source: "xdf-base:api.db" };
  }
  return null;
}

function bindParams(sql: string, params: unknown[]): string {
  if (!params.length) return sql;
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v == null) return "NULL";
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "1" : "0";
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

function normalizeRows(raw: unknown): SqlRow[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((r) => (r && typeof r === "object" ? (r as SqlRow) : { value: r }));
  }
  if (typeof raw === "object" && raw !== null && "rows" in raw) {
    const rows = (raw as { rows: unknown }).rows;
    return Array.isArray(rows) ? normalizeRows(rows) : [];
  }
  return [];
}

export function createXdfDb(app: App): XdfDb {
  return {
    available() {
      return !!resolveQuery(app);
    },
    source() {
      return resolveQuery(app)?.source ?? "none";
    },
    query(sql: string, params: unknown[] = []) {
      const resolved = resolveQuery(app);
      if (!resolved) {
        throw new Error("未找到 xdf-base 数据库。请启用 XDF-Base 并等待初始化完成。");
      }
      try {
        return normalizeRows(resolved.query(sql, params));
      } catch {
        return normalizeRows(resolved.query(bindParams(sql, params)));
      }
    },
  };
}

export function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  const m = String(value).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[0] : null;
}

export function jsonList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  try {
    const v = JSON.parse(String(value));
    return Array.isArray(v) ? v.map(String) : [String(v)];
  } catch {
    return [String(value)];
  }
}
