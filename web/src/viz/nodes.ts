import type { Step, Value } from "../types";
import { fmtValue, shortHex } from "./helpers";

export interface WalkedNode {
  addr: string;
  label: string;
  fields: Record<string, Value>;
}

function valueField(fields: Record<string, Value>): string {
  for (const key of ["val", "value", "data", "key"]) {
    if (key in fields) return fmtValue(fields[key]);
  }
  const first = Object.entries(fields).find(([, v]) => v.k !== "ptr" && v.k !== "null");
  return first ? fmtValue(first[1]) : "·";
}

/** Walk a ptr→struct chain along `nextField`; a `ref` ends the walk (cycle). */
export function walkList(
  v: Value | undefined,
  nextField: string,
): { nodes: WalkedNode[]; cycleTo?: string } {
  const nodes: WalkedNode[] = [];
  let cycleTo: string | undefined;
  let cur = v;
  while (cur && nodes.length < 40) {
    if (cur.k === "ref") {
      cycleTo = cur.addr;
      break;
    }
    if (cur.k !== "ptr" || !cur.target || cur.target.k !== "struct") break;
    nodes.push({
      addr: cur.addr,
      label: valueField(cur.target.fields),
      fields: cur.target.fields,
    });
    cur = cur.target.fields[nextField];
  }
  return { nodes, cycleTo };
}

/** Locals that point at one of the node addresses (head/cursor labels). */
export function nodeCursors(
  step: Step,
  addrs: string[],
): { name: string; addr: string }[] {
  const set = new Set(addrs);
  const out: { name: string; addr: string }[] = [];
  for (const [name, v] of Object.entries(step.locals)) {
    if (v.k === "ptr" && set.has(v.addr)) out.push({ name, addr: v.addr });
    if (v.k === "ref" && set.has(v.addr)) out.push({ name, addr: v.addr });
  }
  return out;
}

/** First local that is a ptr→struct containing `field` (candidate head). */
export function findHead(
  step: Step,
  field: string,
  preferred?: string,
): { name: string; value: Value } | undefined {
  const isCandidate = (v: Value | undefined) =>
    v?.k === "ptr" && v.target?.k === "struct" && field in v.target.fields;
  if (preferred && isCandidate(step.locals[preferred])) {
    return { name: preferred, value: step.locals[preferred] };
  }
  for (const [name, v] of Object.entries(step.locals)) {
    if (isCandidate(v)) return { name, value: v };
  }
  return undefined;
}

export { shortHex };
