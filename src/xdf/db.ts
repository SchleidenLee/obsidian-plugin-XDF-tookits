import type { App } from "obsidian";

export type SqlRow = Record<string, unknown>;

export interface XdfDb {
  query(sql: string, params?: unknown[]): SqlRow[];
  available(): boolean;
  source(): string;
}

interface XdfBaseApi {
  db?: {
    query: (sql: string, params?: unknown[]) => unknown;
  };
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

function getBaseApi(app: App): XdfBaseApi | null {
  const plugins = (app as unknown as { plugins: { plugins: Record<string, { api?: XdfBaseApi }> } })
    .plugins?.plugins;
  return plugins?.["xdf-base"]?.api ?? null;
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
      return !!getBaseApi(app)?.db?.query;
    },
    source() {
      return this.available() ? "xdf-base" : "none";
    },
    query(sql: string, params: unknown[] = []) {
      const api = getBaseApi(app);
      if (!api?.db?.query) {
        throw new Error("未找到 xdf-base 数据库。请启用 XDF-Base 插件并等待 .xdf/xdf.db 同步。");
      }
      const bound = bindParams(sql, params);
      try {
        return normalizeRows(api.db.query(bound));
      } catch {
        return normalizeRows(api.db.query(sql, params));
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
