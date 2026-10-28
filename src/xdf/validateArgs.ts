// 轻量参数校验：只覆盖 TOOL_DEFS 实际用到的 JSON-Schema 特性（type / required / enum / items）。

type Schema = Record<string, unknown>;

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function checkValue(name: string, schema: Schema, value: unknown): string | null {
  if (schema.type === undefined) return null; // 没有 type 的属性不校验类型
  const typeList = Array.isArray(schema.type) ? (schema.type as string[]) : [String(schema.type)];
  const actual = typeName(value);
  const typeOk = typeList.some((t) => {
    if (t === actual) return true;
    // number 放行 "3" 这类字符串数字，兼容客户端把课次号传成字符串
    if (t === "number" && actual === "string" && value !== "" && Number.isFinite(Number(value))) {
      return true;
    }
    return false;
  });
  if (!typeOk) return `参数 ${name} 应为 ${typeList.join(" / ")}`;
  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.includes(value)) {
    return `参数 ${name} 只能是 ${enumValues.join(" / ")}`;
  }
  if (actual === "array" && schema.items && typeof schema.items === "object") {
    const items = schema.items as Schema;
    const arr = value as unknown[];
    for (let i = 0; i < arr.length; i++) {
      const itemErr = checkValue(`${name}[${i}]`, items, arr[i]);
      if (itemErr) return itemErr;
    }
  }
  return null;
}

/** 校验工具入参：通过返回 null，否则返回人话错误信息。 */
export function validateToolArgs(schema: Schema, args: Record<string, unknown>): string | null {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      return `参数 ${key} 必填`;
    }
  }
  const properties = (schema.properties ?? {}) as Record<string, Schema>;
  for (const [key, propSchema] of Object.entries(properties)) {
    // null 视为未传，与 callTool 里 args.x ? ... : null 的既有习惯一致
    if (args[key] === undefined || args[key] === null) continue;
    const bad = checkValue(key, propSchema, args[key]);
    if (bad) return bad;
  }
  return null;
}
