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
  manifest?: { version?: string };
}

/**
 * xdf-base 最低版本要求：1.4.14 起 api.db 门面纯只读 + query_only 引擎硬闸。
 * 低于此版本的 base 仍暴露 exec() 写入口，"只读"承诺不成立，直接拒用。
 */
const MIN_BASE_VERSION = "1.4.14";

function versionLess(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

function getXdfBasePlugin(app: App): LoosePlugin | null {
  const plugins = (app as unknown as { plugins: { plugins: Record<string, LoosePlugin> } })
    .plugins?.plugins;
  return plugins?.["xdf-base"] ?? null;
}

/** xdf-base 把查询口挂在 _xdfBase.getDBApi()，文档里的 api.db 目前没接上。 */
function resolveQuery(app: App): { query: QueryFn; source: string; version: string } | null {
  const plugin = getXdfBasePlugin(app);
  if (!plugin) return null;
  const version = plugin.manifest?.version ?? "0.0.0";
  const viaExt = plugin._xdfBase?.getDBApi?.();
  if (viaExt && typeof viaExt.query === "function") {
    return { query: viaExt.query.bind(viaExt), source: "xdf-base:_xdfBase", version };
  }
  if (typeof plugin.api?.db?.query === "function") {
    return { query: plugin.api.db.query.bind(plugin.api.db), source: "xdf-base:api.db", version };
  }
  return null;
}

/** 低于最低版本的 base 仍暴露写入口，只读承诺不成立 → 拒用并给出可读报错。 */
function baseVersionError(version: string): string {
  return `xdf-base 版本过低（当前 ${version}，需 ≥${MIN_BASE_VERSION}）。旧版 api.db 仍开放写入口，查询只读无保障，请升级 XDF-Base。`;
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
      const resolved = resolveQuery(app);
      return !!resolved && !versionLess(resolved.version, MIN_BASE_VERSION);
    },
    source() {
      return resolveQuery(app)?.source ?? "none";
    },
    query(sql: string, params: unknown[] = []) {
      const resolved = resolveQuery(app);
      if (!resolved) {
        throw new Error("未找到 xdf-base 数据库。请启用 XDF-Base 并等待初始化完成。");
      }
      if (versionLess(resolved.version, MIN_BASE_VERSION)) {
        throw new Error(baseVersionError(resolved.version));
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
