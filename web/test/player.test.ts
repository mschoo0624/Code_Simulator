import { describe, expect, it } from "vitest";
import {
  initialPlayerState,
  playerReducer,
  type PlayerState,
} from "../src/player/reducer";
import type { Trace } from "../src/types";

const trace: Trace = {
  language: "c",
  solutionFile: "solution.c",
  truncated: false,
  compile: { ok: true, diagnostics: [] },
  stdout: "",
  stderr: "",
  exitCode: 0,
  steps: Array.from({ length: 5 }, (_, i) => ({
    idx: i,
    event: "line" as const,
    line: i + 1,
    func: "f",
    stackDepth: 2,
    locals: {},
    changed: [],
    changedIndices: {},
  })),
};

function ready(): PlayerState {
  return playerReducer(initialPlayerState, { type: "trace_ok", trace });
}

describe("player reducer", () => {
  it("clamps stepping at both ends", () => {
    let s = ready();
    s = playerReducer(s, { type: "step_delta", delta: -1 });
    expect(s.stepIdx).toBe(0);
    s = playerReducer(s, { type: "step_to", idx: 99 });
    expect(s.stepIdx).toBe(4);
    s = playerReducer(s, { type: "step_delta", delta: 1 });
    expect(s.stepIdx).toBe(4);
  });

  it("stops playing at the last step", () => {
    let s = ready();
    s = playerReducer(s, { type: "step_to", idx: 3 });
    s = playerReducer(s, { type: "play_pause" });
    expect(s.playing).toBe(true);
    s = playerReducer(s, { type: "step_delta", delta: 1 });
    expect(s.stepIdx).toBe(4);
    expect(s.playing).toBe(false);
  });

  it("play at the end restarts from step 0", () => {
    let s = ready();
    s = playerReducer(s, { type: "step_to", idx: 4 });
    s = playerReducer(s, { type: "play_pause" });
    expect(s.stepIdx).toBe(0);
    expect(s.playing).toBe(true);
  });

  it("reset returns to step 0 and pauses", () => {
    let s = ready();
    s = playerReducer(s, { type: "step_to", idx: 3 });
    s = playerReducer(s, { type: "play_pause" });
    s = playerReducer(s, { type: "reset" });
    expect(s).toMatchObject({ stepIdx: 0, playing: false });
  });

  it("annotation upgrade keeps the current step (progressive enhancement)", () => {
    let s = ready();
    s = playerReducer(s, { type: "step_to", idx: 2 });
    s = playerReducer(s, {
      type: "annotation_ok",
      source: "llm",
      annotation: {
        viz: "array",
        primary: "a",
        pointers: [],
        captions: [],
        insight: "x",
        complexity: { time: "O(n)", space: "O(1)" },
      },
    });
    expect(s.stepIdx).toBe(2);
    expect(s.annotation?.viz).toBe("array");
  });

  it("edit returns to idle", () => {
    const s = playerReducer(ready(), { type: "edit" });
    expect(s.status).toBe("idle");
    expect(s.trace).toBeUndefined();
  });
});
