/**
 * Heuristic visualization chooser — picks a fitting visual for ANY traced
 * program without an LLM. No Docker needed.
 */
import { describe, expect, it } from "vitest";
import { chooseViz } from "../src/heuristicViz.js";
import type { Step, Trace, Value } from "../src/schema/trace.js";

function mkStep(partial: Partial<Step> & { idx: number }): Step {
  return {
    event: "line",
    line: 5,
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

const ints = (vals: number[]): Value[] => vals.map((v) => ({ k: "int", t: "int", v }));

function heapArr(vals: number[]): Value {
  return {
    k: "ptr",
    t: "int *",
    addr: "0x1000",
    alloc: { size: vals.length * 4, live: true },
    target: { k: "array", t: "int", len: vals.length, items: ints(vals), source: "heap" },
  };
}

describe("chooseViz", () => {
  it("picks bits_array for countBits-like traces, with i as pointer", () => {
    const steps = [0, 1, 2, 3].map((i) =>
      mkStep({
        idx: i,
        locals: {
          n: { k: "int", t: "int", v: 10 },
          i: { k: "int", t: "int", v: i + 1 },
          dp: heapArr([0, 1, 1, 2]),
        },
        changed: ["i"],
        changedIndices: i > 0 ? { dp: [i] } : {},
      }),
    );
    const c = chooseViz(mkTrace(steps), "dp[i] = (i & 1) + dp[i / 2];");
    expect(c.viz).toBe("bits_array");
    expect(c.primary).toBe("dp");
    expect(c.pointers).toContain("i");
    expect(c.pointers).not.toContain("n"); // n never changes
  });

  it("picks plain array when the solution has no bit tricks", () => {
    const steps = [0, 1].map((i) =>
      mkStep({ idx: i, locals: { a: heapArr([5, 1, 4]), j: { k: "int", t: "int", v: i } }, changed: ["j"] }),
    );
    const c = chooseViz(mkTrace(steps), "if (a[j] > a[j+1]) swap();");
    expect(c.viz).toBe("array");
    expect(c.primary).toBe("a");
  });

  it("picks linked_list for ptr->struct with next", () => {
    const node: Value = {
      k: "ptr",
      t: "struct Node *",
      addr: "0x2000",
      target: {
        k: "struct",
        t: "struct Node",
        fields: { val: { k: "int", t: "int", v: 1 }, next: { k: "null" } },
      },
    };
    const c = chooseViz(mkTrace([mkStep({ idx: 0, locals: { head: node } })]), "");
    expect(c.viz).toBe("linked_list");
    expect(c.primary).toBe("head");
  });

  it("picks tree for ptr->struct with left/right", () => {
    const node: Value = {
      k: "ptr",
      t: "struct T *",
      addr: "0x3000",
      target: {
        k: "struct",
        t: "struct T",
        fields: {
          val: { k: "int", t: "int", v: 1 },
          left: { k: "null" },
          right: { k: "null" },
        },
      },
    };
    const c = chooseViz(mkTrace([mkStep({ idx: 0, locals: { root: node } })]), "");
    expect(c.viz).toBe("tree");
  });

  it("picks grid for arrays of arrays", () => {
    const grid: Value = {
      k: "array",
      t: "int [2][2]",
      len: 2,
      source: "stack",
      items: [
        { k: "array", t: "int [2]", len: 2, items: ints([1, 2]), source: "stack" },
        { k: "array", t: "int [2]", len: 2, items: ints([3, 4]), source: "stack" },
      ],
    };
    const c = chooseViz(mkTrace([mkStep({ idx: 0, locals: { g: grid } })]), "");
    expect(c.viz).toBe("grid");
  });

  it("falls back to memory when only a bare heap pointer exists", () => {
    const p: Value = {
      k: "ptr",
      t: "struct Opaque *",
      addr: "0x4000",
      alloc: { size: 64, live: true },
    };
    const c = chooseViz(mkTrace([mkStep({ idx: 0, locals: { p } })]), "");
    expect(c.viz).toBe("memory");
  });

  it("falls back to variables for scalar-only traces", () => {
    const c = chooseViz(
      mkTrace([mkStep({ idx: 0, locals: { n: { k: "int", t: "int", v: 3 } } })]),
      "",
    );
    expect(c.viz).toBe("variables");
    expect(c.primary).toBe("n");
  });
});
