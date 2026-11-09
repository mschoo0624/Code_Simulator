import { describe, expect, it } from "vitest";
import { checkCaptions } from "../src/hallucination";
import type { Annotation, Step, Trace } from "../src/types";

function mkStep(idx: number, locals: Record<string, number>, line = 6): Step {
  return {
    idx,
    event: "line",
    line,
    func: "countBits",
    stackDepth: 2,
    locals: Object.fromEntries(
      Object.entries(locals).map(([k, v]) => [k, { k: "int" as const, t: "int", v }]),
    ),
    changed: Object.keys(locals),
    changedIndices: {},
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

function mkAnnotation(captions: { idx: number; text: string }[]): Annotation {
  return {
    viz: "bits_array",
    primary: "dp",
    pointers: ["i"],
    captions,
    insight: "",
    complexity: { time: "O(n)", space: "O(n)" },
  };
}

describe("hallucination check", () => {
  it("passes captions whose numbers appear in the step or neighbors", () => {
    const trace = mkTrace([mkStep(0, { i: 5 }), mkStep(1, { i: 6, dp3: 2 }), mkStep(2, { i: 7 })]);
    const ann = mkAnnotation([{ idx: 1, text: "i=6 (110): last bit 0, dp[3]=2, so dp[6]=2" }]);
    // 6 in step, 110 is binary of 6, 3... not in values! 3 only as dp3 name.
    const flags = checkCaptions(trace, ann);
    expect(flags.map((f) => f.number)).toEqual([3]);
  });

  it("accepts line numbers and neighbor values", () => {
    const trace = mkTrace([mkStep(0, { i: 5 }, 6), mkStep(1, { i: 6 }, 6)]);
    const ann = mkAnnotation([{ idx: 1, text: "Line 6: i is now 6, was 5" }]);
    expect(checkCaptions(trace, ann)).toEqual([]);
  });

  it("flags invented numbers", () => {
    const trace = mkTrace([mkStep(0, { i: 2 })]);
    const ann = mkAnnotation([{ idx: 0, text: "i jumps to 999 here" }]);
    const flags = checkCaptions(trace, ann);
    expect(flags).toHaveLength(1);
    expect(flags[0].number).toBe(999);
  });

  it("ignores 0 and 1 (binary digits, ubiquitous)", () => {
    const trace = mkTrace([mkStep(0, { i: 2 })]);
    const ann = mkAnnotation([{ idx: 0, text: "last bit is 0, add 1" }]);
    expect(checkCaptions(trace, ann)).toEqual([]);
  });
});
