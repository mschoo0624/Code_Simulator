/**
 * Milestone 1 acceptance tests — run real traces through the runner container.
 * Automatically skipped when Docker is unavailable.
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { TraceSchema, type Trace, type Value } from "../src/schema/trace.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixturesDir = join(repoRoot, "runner", "test", "fixtures");
const IMAGE = "codelens-runner";

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = dockerAvailable();

function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

function runTrace(language: "c" | "cpp", solution: string, driver: string): Trace {
  const res = spawnSync(
    "docker",
    [
      "run", "--rm", "-i",
      "--network", "none",
      "--read-only",
      "--tmpfs", "/work:rw,exec,size=32m,mode=1777",
      "--memory", "256m", "--memory-swap", "256m",
      "--cpus", "1",
      "--pids-limit", "128",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      IMAGE,
    ],
    {
      input: JSON.stringify({ language, solution, driver }),
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (res.error) throw res.error;
  expect(res.stdout, `container stderr: ${res.stderr}`).toBeTruthy();
  return TraceSchema.parse(JSON.parse(res.stdout));
}

/** Depth-first search for any sub-value matching the predicate. */
function findValue(v: unknown, pred: (x: Value) => boolean): Value | undefined {
  if (v == null || typeof v !== "object") return undefined;
  const val = v as Value;
  if ("k" in val && pred(val)) return val;
  for (const child of Object.values(val)) {
    if (typeof child === "object" && child !== null) {
      if (Array.isArray(child)) {
        for (const c of child) {
          const hit = findValue(c, pred);
          if (hit) return hit;
        }
      } else {
        const hit = findValue(child, pred);
        if (hit) return hit;
      }
    }
  }
  return undefined;
}

function arrayItems(v: Value | undefined): (number | string)[] | undefined {
  if (!v) return undefined;
  const arr =
    v.k === "array" ? v : v.k === "ptr" && v.target?.k === "array" ? v.target : undefined;
  if (!arr || arr.k !== "array") return undefined;
  return arr.items.map((it) => (it.k === "int" ? it.v : NaN));
}

const EXPECTED_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2];

describe.skipIf(!hasDocker)("M1 runner/tracer acceptance", () => {
  beforeAll(() => {
    execSync(`docker build -t ${IMAGE} runner`, {
      cwd: repoRoot,
      stdio: "inherit",
      timeout: 600_000,
    });
  });

  it("1. C countBits(10) traces correctly", () => {
    const trace = runTrace(
      "c",
      fixture("countbits.solution.c"),
      fixture("countbits.driver.c"),
    );
    expect(trace.compile.ok).toBe(true);
    expect(trace.steps.length).toBeGreaterThan(10);

    // every recorded step is in the solution function (solution file only)
    for (const s of trace.steps) {
      expect(s.func).toBe("countBits");
      expect(s.line).toBeGreaterThanOrEqual(1);
      expect(s.line).toBeLessThanOrEqual(9);
    }

    // dp appears starting the line after the malloc (line 3 -> first seen on 4)
    const firstDp = trace.steps.find((s) => "dp" in s.locals);
    expect(firstDp).toBeDefined();
    expect(firstDp!.line).toBe(4);

    // final dp is a live heap array of length 11 with the expected values
    const lastDp = [...trace.steps].reverse().find((s) => "dp" in s.locals)!;
    const dp = lastDp.locals.dp;
    expect(dp.k).toBe("ptr");
    if (dp.k !== "ptr") throw new Error("unreachable");
    expect(dp.alloc).toEqual({ size: 44, live: true });
    expect(dp.target?.k).toBe("array");
    if (dp.target?.k !== "array") throw new Error("unreachable");
    expect(dp.target.source).toBe("heap");
    expect(dp.target.len).toBe(11);
    expect(arrayItems(dp)).toEqual(EXPECTED_BITS);

    // changedIndices.dp marks exactly the written index each iteration.
    // (Index 0 may be absent: writing 0 into zeroed fresh heap memory is not
    // an observable change — see DECISIONS.md #8.)
    const written = trace.steps.flatMap((s) => s.changedIndices.dp ?? []);
    const rest = written.filter((i) => i !== 0);
    expect(rest).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    expect(trace.stdout).toBe("0 1 1 2 1 2 2 3 1 2 2 \n");
    expect(trace.exitCode).toBe(0);
    expect(trace.leaks ?? []).toEqual([]);
    expect(trace.truncated).toBe(false);
  });

  it("2. C++ vector countBits traces via STL pretty-printers", () => {
    const trace = runTrace(
      "cpp",
      fixture("countbits.solution.cpp"),
      fixture("countbits.driver.cpp"),
    );
    expect(trace.compile.ok).toBe(true);
    expect(trace.steps.length).toBeGreaterThan(10);

    // no steps recorded inside <vector> headers: all steps are in countBits
    for (const s of trace.steps) {
      expect(s.func).toContain("countBits");
      expect(s.line).toBeLessThanOrEqual(8);
    }

    const lastDp = [...trace.steps].reverse().find((s) => "dp" in s.locals)!;
    const dp = lastDp.locals.dp;
    expect(dp.k).toBe("array");
    if (dp.k !== "array") throw new Error("unreachable");
    expect(dp.source).toBe("stl");
    expect(dp.len).toBe(11);
    expect(arrayItems(dp)).toEqual(EXPECTED_BITS);

    expect(trace.stdout).toBe("0 1 1 2 1 2 2 3 1 2 2 \n");
    expect(trace.exitCode).toBe(0);
  });

  it("3. infinite loop is truncated quickly", () => {
    const t0 = Date.now();
    const trace = runTrace("c", fixture("spin.solution.c"), fixture("spin.driver.c"));
    const elapsed = Date.now() - t0;
    expect(trace.truncated).toBe(true);
    expect(trace.truncatedReason).toBeTruthy();
    // spec target is 10 s; allow slack for Docker Desktop startup variance
    expect(elapsed).toBeLessThan(15_000);

    // no container left running for this image
    const ps = execSync(`docker ps --filter ancestor=${IMAGE} -q`, {
      encoding: "utf8",
    }).trim();
    expect(ps).toBe("");
  });

  it("4. null-pointer dereference yields an exception step", () => {
    const trace = runTrace("c", fixture("segv.solution.c"), fixture("segv.driver.c"));
    expect(trace.compile.ok).toBe(true);
    expect(trace.signal).toBe("SIGSEGV");
    const last = trace.steps[trace.steps.length - 1];
    expect(last.event).toBe("exception");
    expect(last.error).toBe("SIGSEGV");
    expect(last.func).toBe("crash");
  });

  it("5. linked list reverse serializes ptr targets with ref for cycles", () => {
    const trace = runTrace("c", fixture("list.solution.c"), fixture("list.driver.c"));
    expect(trace.compile.ok).toBe(true);
    expect(trace.exitCode).toBe(0);

    // during reverseList, some local is a ptr whose target is a Node struct
    const nodePtr = trace.steps
      .filter((s) => s.func === "reverseList")
      .map((s) =>
        findValue(
          s.locals,
          (v) => v.k === "ptr" && v.target?.k === "struct" && "next" in v.target.fields,
        ),
      )
      .find((v) => v !== undefined);
    expect(nodePtr).toBeDefined();

    // during cycleProbe, the cycle shows up as a ref value
    const refHit = trace.steps
      .filter((s) => s.func === "cycleProbe")
      .map((s) => findValue(s.locals, (v) => v.k === "ref"))
      .find((v) => v !== undefined);
    expect(refHit).toBeDefined();
  });

  it("6. compile errors map to the solution pane", () => {
    const trace = runTrace("c", fixture("bad.solution.c"), fixture("bad.driver.c"));
    expect(trace.compile.ok).toBe(false);
    expect(trace.steps).toEqual([]);
    const err = trace.compile.diagnostics.find((d) => d.severity === "error");
    expect(err).toBeDefined();
    expect(err!.file).toBe("solution.c");
    expect(err!.line).toBeGreaterThanOrEqual(2);
    expect(err!.line).toBeLessThanOrEqual(3);
  });

  it("7. recursion: stackDepth rises and falls", () => {
    const trace = runTrace("c", fixture("fib.solution.c"), fixture("fib.driver.c"));
    expect(trace.compile.ok).toBe(true);
    expect(trace.stdout).toBe("8\n");

    const depths = trace.steps.map((s) => s.stackDepth);
    const min = Math.min(...depths);
    const max = Math.max(...depths);
    expect(max - min).toBeGreaterThanOrEqual(3); // fib(6) nests several levels

    // depth rises somewhere and falls back again
    expect(depths.some((d, i) => i > 0 && d > depths[i - 1])).toBe(true);
    expect(depths.some((d, i) => i > 0 && d < depths[i - 1])).toBe(true);
    expect(depths[depths.length - 1]).toBe(min);

    // call/return events are classified
    expect(trace.steps.some((s) => s.event === "call")).toBe(true);
    expect(trace.steps.some((s) => s.event === "return")).toBe(true);
  });
});

describe.skipIf(hasDocker)("without Docker", () => {
  it("skips Docker-dependent tests cleanly", () => {
    expect(hasDocker).toBe(false);
  });
});
