/**
 * Milestone 3 — annotation unit tests (compression, auto captions, fallback).
 * No Docker or API key required.
 */
import { describe, expect, it } from "vitest";
import {
  autoCaption,
  compressTrace,
  fallbackAnnotation,
} from "../src/annotate.js";
import type { Step, Trace } from "../src/schema/trace.js";

function mkStep(partial: Partial<Step> & { idx: number }): Step {
  return {
    event: "line",
    line: 1,
    func: "f",
    stackDepth: 2,
    locals: {},
    changed: [],
    changedIndices: {},
    ...partial,
  };
}

function mkTrace(steps: Step[]): Trace {
  return {
    language: "c",
    solutionFile: "solution.c",
    truncated: false,
    compile: { ok: true, diagnostics: [] },
    stdout: "",
    stderr: "",
    exitCode: 0,
    steps,
  };
}

describe("compressTrace", () => {
  it("keeps changed/call/return/exception steps and first+last", () => {
    const steps = [
      mkStep({ idx: 0, event: "call" }),
      mkStep({ idx: 1 }), // boring
      mkStep({ idx: 2, changed: ["i"], locals: { i: { k: "int", t: "int", v: 1 } } }),
      mkStep({ idx: 3 }), // boring
      mkStep({ idx: 4 }), // boring, but last -> kept
    ];
    const c = compressTrace(mkTrace(steps));
    expect(c.steps.map((s) => (s as { idx: number }).idx)).toEqual([0, 2, 4]);
  });

  it("caps at 120 steps while keeping first and last", () => {
    const steps = Array.from({ length: 400 }, (_, i) =>
      mkStep({ idx: i, changed: ["x"], locals: { x: { k: "int", t: "int", v: i } } }),
    );
    const c = compressTrace(mkTrace(steps));
    expect(c.steps.length).toBeLessThanOrEqual(121);
    const idxs = c.steps.map((s) => (s as { idx: number }).idx);
    expect(idxs[0]).toBe(0);
    expect(idxs[idxs.length - 1]).toBe(399);
  });

  it("shrinks large arrays to changed + edge samples", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ k: "int" as const, t: "int", v: i }));
    const step = mkStep({
      idx: 0,
      changed: ["a"],
      changedIndices: { a: [25] },
      locals: { a: { k: "array", t: "int [50]", len: 50, items, source: "stack" } },
    });
    const c = compressTrace(mkTrace([step]));
    const a = (c.steps[0] as { locals: { a: { sample: Record<number, unknown> } } }).locals.a;
    const keys = Object.keys(a.sample).map(Number);
    expect(keys).toContain(25);
    expect(keys).toContain(0);
    expect(keys).toContain(49);
    expect(keys.length).toBeLessThan(10);
  });
});

describe("autoCaption", () => {
  it("describes changed variables with values", () => {
    const step = mkStep({
      idx: 5,
      line: 6,
      changed: ["i"],
      locals: { i: { k: "int", t: "int", v: 6 } },
    });
    expect(autoCaption(step)).toBe("Line 6: i = 6");
  });

  it("describes exceptions", () => {
    const step = mkStep({ idx: 0, line: 2, event: "exception", error: "SIGSEGV" });
    expect(autoCaption(step)).toContain("SIGSEGV");
    expect(autoCaption(step)).toContain("line 2");
  });

  it("describes returns with the return value", () => {
    const step = mkStep({
      idx: 9,
      line: 3,
      event: "return",
      func: "fib",
      returnValue: { k: "int", t: "int", v: 8 },
    });
    expect(autoCaption(step)).toContain("fib");
    expect(autoCaption(step)).toContain("8");
  });
});

describe("fallbackAnnotation", () => {
  it("produces a valid variables annotation with captions per kept step", () => {
    const steps = [
      mkStep({ idx: 0, event: "call", locals: { n: { k: "int", t: "int", v: 10 } } }),
      mkStep({ idx: 1, changed: ["i"], locals: { i: { k: "int", t: "int", v: 1 } } }),
      mkStep({ idx: 2 }),
    ];
    const ann = fallbackAnnotation(mkTrace(steps));
    expect(ann.viz).toBe("variables");
    expect(ann.primary).toBe("n");
    expect(ann.captions.map((c) => c.idx)).toEqual([0, 1, 2]);
    expect(ann.captions.every((c) => c.text.length > 0)).toBe(true);
  });
});
