/**
 * Hallucination check: scan each caption's integers and flag any that do not
 * appear in that step's values, line number, or immediate neighbor steps.
 * Flags go to the dev console; they never fail the UI.
 */
import type { Annotation, Step, Trace, Value } from "./types";

function collectInts(v: Value, into: Set<number>): void {
  switch (v.k) {
    case "int":
      if (typeof v.v === "number") into.add(v.v);
      break;
    case "float":
      if (Number.isInteger(v.v)) into.add(v.v);
      break;
    case "char":
      into.add(v.code);
      break;
    case "bool":
      into.add(v.v ? 1 : 0);
      break;
    case "array":
      into.add(v.len);
      for (const it of v.items) collectInts(it, into);
      break;
    case "struct":
      for (const f of Object.values(v.fields)) collectInts(f, into);
      break;
    case "ptr":
      if (v.offset !== undefined) into.add(v.offset);
      if (v.alloc) into.add(v.alloc.size);
      if (v.target) collectInts(v.target, into);
      break;
    default:
      break;
  }
}

function stepInts(step: Step): Set<number> {
  const s = new Set<number>();
  s.add(step.line);
  for (const v of Object.values(step.locals)) collectInts(v, s);
  for (const idxs of Object.values(step.changedIndices)) idxs.forEach((i) => s.add(i));
  if (step.returnValue) collectInts(step.returnValue, s);
  return s;
}

export interface HallucinationFlag {
  idx: number;
  number: number;
  caption: string;
}

export function checkCaptions(trace: Trace, annotation: Annotation): HallucinationFlag[] {
  const flags: HallucinationFlag[] = [];
  const byIdx = new Map(trace.steps.map((s) => [s.idx, s]));
  for (const cap of annotation.captions) {
    const step = byIdx.get(cap.idx);
    if (!step) continue;
    const known = stepInts(step);
    // neighbors too (captions often mention the value about to be written)
    const prev = byIdx.get(cap.idx - 1);
    const next = byIdx.get(cap.idx + 1);
    if (prev) for (const n of stepInts(prev)) known.add(n);
    if (next) for (const n of stepInts(next)) known.add(n);
    // binary forms of known numbers are fine ("i=6 (110)")
    const binaries = new Set<string>();
    for (const n of known) if (n >= 0) binaries.add(n.toString(2));

    for (const m of cap.text.matchAll(/\d+/g)) {
      const num = parseInt(m[0], 10);
      if (num <= 1) continue; // 0/1 are ubiquitous and also binary digits
      if (known.has(num)) continue;
      if (binaries.has(m[0])) continue;
      flags.push({ idx: cap.idx, number: num, caption: cap.text });
    }
  }
  return flags;
}
