import type { Step, Value } from "../types";

/** Short printable form of a Value. */
export function fmtValue(v: Value | undefined): string {
  if (!v) return "?";
  switch (v.k) {
    case "int":
    case "float":
      return String(v.v);
    case "bool":
      return String(v.v);
    case "char":
      return `'${v.v}' (${v.code})`;
    case "str":
      return JSON.stringify(v.v.length > 24 ? v.v.slice(0, 24) + "…" : v.v);
    case "null":
      return "NULL";
    case "array":
      return `[${v.items.slice(0, 6).map(fmtValue).join(", ")}${v.len > 6 ? ", …" : ""}]`;
    case "ptr":
      return v.invalid ? `${shortHex(v.addr)} (invalid)` : shortHex(v.addr);
    case "struct":
      return `{${Object.entries(v.fields)
        .slice(0, 3)
        .map(([k2, f]) => `${k2}: ${fmtValue(f)}`)
        .join(", ")}}`;
    case "ref":
      return `→ ${shortHex(v.addr)}`;
    default:
      return v.repr;
  }
}

export function shortHex(addr: string): string {
  return addr.length > 10 ? `…${addr.slice(-6)}` : addr;
}

/** Resolve a named local to the array it represents (stack, heap, STL). */
export function resolveArray(
  step: Step,
  name: string,
): { items: Value[]; len: number; source: string; truncated: boolean } | undefined {
  const v = step.locals[name];
  if (!v) return undefined;
  if (v.k === "array") {
    return { items: v.items, len: v.len, source: v.source, truncated: !!v.truncated };
  }
  if (v.k === "ptr" && v.target?.k === "array") {
    return {
      items: v.target.items,
      len: v.target.len,
      source: v.target.source,
      truncated: !!v.target.truncated,
    };
  }
  return undefined;
}

export function intOf(v: Value | undefined): number | undefined {
  if (v?.k === "int" && typeof v.v === "number") return v.v;
  if (v?.k === "char") return v.code;
  if (v?.k === "bool") return v.v ? 1 : 0;
  return undefined;
}

/**
 * Index markers into the primary array for `annotation.pointers` variables:
 * plain ints are used directly; ptr values with base/offset use the offset.
 */
export function pointerIndices(
  step: Step,
  pointers: string[],
  arrayLen: number,
): { name: string; index: number }[] {
  const out: { name: string; index: number }[] = [];
  for (const name of pointers) {
    const v = step.locals[name];
    if (!v) continue;
    const iv = intOf(v);
    if (iv !== undefined && iv >= 0 && iv < arrayLen) {
      out.push({ name, index: iv });
      continue;
    }
    if (v.k === "ptr" && v.offset !== undefined && v.offset >= 0 && v.offset < arrayLen) {
      out.push({ name, index: v.offset });
    }
  }
  return out;
}

export function toBinary(v: Value | undefined, minBits = 1): string | undefined {
  const n = intOf(v);
  if (n === undefined || n < 0) return undefined;
  return n.toString(2).padStart(minBits, "0");
}
