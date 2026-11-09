/**
 * heuristicViz.ts — mirror of api/src/heuristicViz.ts for the client: picks a
 * fitting visualization for ANY traced program the moment the trace arrives,
 * before (or without) the LLM annotation.
 */
import type { Step, Trace, Value, VizKind } from "./types";

interface Pick_ {
  viz: VizKind;
  primary: string;
  len: number;
  score: number;
}

function arrayOf(v: Value): Extract<Value, { k: "array" }> | undefined {
  if (v.k === "array") return v;
  if (v.k === "ptr" && v.target?.k === "array") return v.target;
  return undefined;
}

function structTargetOf(v: Value): Extract<Value, { k: "struct" }> | undefined {
  if (v.k === "ptr" && v.target?.k === "struct") return v.target;
  return undefined;
}

function classify(name: string, v: Value, step: Step): Pick_ | undefined {
  const arr = arrayOf(v);
  if (arr) {
    const isGrid = arr.items.some((it) => it.k === "array");
    const changedBonus = (step.changedIndices[name]?.length ?? 0) > 0 ? 2 : 0;
    return {
      viz: isGrid ? "grid" : "array",
      primary: name,
      len: arr.len,
      score: 4 + changedBonus + Math.min(arr.len, 8) / 8,
    };
  }
  const st = structTargetOf(v);
  if (st) {
    const fields = Object.keys(st.fields);
    if (fields.includes("left") && fields.includes("right")) {
      return { viz: "tree", primary: name, len: 0, score: 3 };
    }
    const linkField = fields.find(
      (f) =>
        ["next", "prev", "link"].includes(f) &&
        (st.fields[f].k === "ptr" || st.fields[f].k === "null" || st.fields[f].k === "ref"),
    );
    if (linkField) return { viz: "linked_list", primary: name, len: 0, score: 3 };
  }
  return undefined;
}

const BIT_OP_RE = /(&\s*1\b|>>|<<|\^|\bpopcount|__builtin_ctz|__builtin_clz)/;

function allSmallNonNegativeInts(trace: Trace, primary: string): boolean {
  for (const step of trace.steps) {
    const v = step.locals[primary];
    if (!v) continue;
    const arr = arrayOf(v);
    if (!arr) continue;
    for (const it of arr.items) {
      if (it.k !== "int") return false;
      if (typeof it.v !== "number" || it.v < 0 || it.v > 0xffff) return false;
    }
  }
  return true;
}

function findPointers(trace: Trace, primary: string, len: number): string[] {
  const seen = new Map<string, { changes: number; inRange: boolean }>();
  let prevInts = new Map<string, number>();
  for (const step of trace.steps) {
    for (const [name, v] of Object.entries(step.locals)) {
      if (name === primary) continue;
      if (v.k === "ptr" && v.offset !== undefined) {
        const e = seen.get(name) ?? { changes: 1, inRange: true };
        seen.set(name, e);
        continue;
      }
      if (v.k === "int" && typeof v.v === "number") {
        const e = seen.get(name) ?? { changes: 0, inRange: true };
        if (prevInts.has(name) && prevInts.get(name) !== v.v) e.changes += 1;
        if (len > 0 && (v.v < -1 || v.v > len)) e.inRange = false;
        seen.set(name, e);
      }
    }
    prevInts = new Map(
      Object.entries(step.locals).flatMap(([n, v]) =>
        v.k === "int" && typeof v.v === "number" ? [[n, v.v] as [string, number]] : [],
      ),
    );
  }
  return [...seen.entries()]
    .filter(([, e]) => e.changes > 0 && e.inRange)
    .sort((a, b) => b[1].changes - a[1].changes)
    .slice(0, 3)
    .map(([name]) => name);
}

export interface HeuristicChoice {
  viz: VizKind;
  primary: string;
  pointers: string[];
}

export function chooseViz(trace: Trace, solution: string): HeuristicChoice {
  let best: Pick_ | undefined;
  for (let i = trace.steps.length - 1; i >= 0; i--) {
    const step = trace.steps[i];
    for (const [name, v] of Object.entries(step.locals)) {
      const p = classify(name, v, step);
      if (p && (!best || p.score > best.score)) best = p;
    }
    if (best && trace.steps.length - i > 8) break;
  }

  if (best) {
    if (
      best.viz === "array" &&
      BIT_OP_RE.test(solution) &&
      allSmallNonNegativeInts(trace, best.primary)
    ) {
      best = { ...best, viz: "bits_array" };
    }
    return {
      viz: best.viz,
      primary: best.primary,
      pointers: findPointers(trace, best.primary, best.len),
    };
  }

  for (const step of trace.steps) {
    for (const [name, v] of Object.entries(step.locals)) {
      if (v.k === "ptr" && v.alloc) {
        return { viz: "memory", primary: name, pointers: [] };
      }
    }
  }
  const firstLocals = trace.steps[0] ? Object.keys(trace.steps[0].locals) : [];
  return { viz: "variables", primary: firstLocals[0] ?? "", pointers: [] };
}
