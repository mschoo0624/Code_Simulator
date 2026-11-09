import { describe, expect, it } from "vitest";
import { evalIndexExpr, indicesOnLine, sourceIndex } from "../src/sourceIndex";
import type { Step } from "../src/types";

function mkStep(locals: Record<string, number>): Step {
  return {
    idx: 0,
    event: "line",
    line: 1,
    func: "f",
    stackDepth: 2,
    locals: Object.fromEntries(
      Object.entries(locals).map(([k, v]) => [k, { k: "int" as const, t: "int", v }]),
    ),
    changed: [],
    changedIndices: {},
  };
}

describe("evalIndexExpr", () => {
  const step = mkStep({ i: 6, j: 3 });
  it.each([
    ["i", 6],
    ["i / 2", 3],
    ["i >> 1", 3],
    ["i - 1", 5],
    ["i - 2", 4],
    ["i + 1", 7],
    ["i & 1", 0],
    ["4", 4],
    ["j", 3],
  ])("evaluates %s", (expr, expected) => {
    expect(evalIndexExpr(expr, step)).toBe(expected);
  });

  it("returns undefined for unsupported expressions", () => {
    expect(evalIndexExpr("i * j", step)).toBeUndefined();
    expect(evalIndexExpr("f(i)", step)).toBeUndefined();
    expect(evalIndexExpr("unknown", step)).toBeUndefined();
  });
});

describe("sourceIndex (countBits line)", () => {
  it("highlights dp[i/2] as the source when writing dp[i]", () => {
    const step = mkStep({ i: 6, n: 10 });
    const line = "        dp[i] = (i & 1) + dp[i / 2];";
    expect(indicesOnLine(line, "dp", step)).toEqual([6, 3]);
    expect(sourceIndex(line, "dp", step, 6)).toBe(3);
  });

  it("C++ variant with >>", () => {
    const step = mkStep({ i: 7 });
    const line = "        dp[i] = dp[i >> 1] + (i & 1);";
    expect(sourceIndex(line, "dp", step, 7)).toBe(3);
  });

  it("falls back to no source highlight for complex indices", () => {
    const step = mkStep({ i: 6 });
    const line = "        dp[i] = dp[f(i)] + 1;";
    expect(sourceIndex(line, "dp", step, 6)).toBeUndefined();
  });
});
