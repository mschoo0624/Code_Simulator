import type { Annotation, Trace, VizKind } from "../types";

export type Status = "idle" | "compiling" | "tracing" | "ready" | "error";

export interface PlayerState {
  status: Status;
  trace?: Trace;
  annotation?: Annotation;
  annotationSource?: "llm" | "fallback";
  stepIdx: number;
  playing: boolean;
  speed: 0.5 | 1 | 2;
  vizOverride?: VizKind;
  primaryOverride?: string;
  error?: string;
}

export type PlayerAction =
  | { type: "start_trace" }
  | { type: "trace_ok"; trace: Trace }
  | { type: "trace_error"; error: string }
  | { type: "annotation_ok"; annotation: Annotation; source: "llm" | "fallback" }
  | { type: "step_to"; idx: number }
  | { type: "step_delta"; delta: number }
  | { type: "play_pause" }
  | { type: "set_speed"; speed: 0.5 | 1 | 2 }
  | { type: "set_viz"; viz?: VizKind; primary?: string }
  | { type: "reset" }
  | { type: "edit" };

export const initialPlayerState: PlayerState = {
  status: "idle",
  stepIdx: 0,
  playing: false,
  speed: 1,
};

function clampStep(trace: Trace | undefined, idx: number): number {
  const max = trace ? Math.max(0, trace.steps.length - 1) : 0;
  return Math.min(Math.max(0, idx), max);
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "start_trace":
      return {
        ...initialPlayerState,
        status: "tracing",
      };
    case "trace_ok":
      return {
        ...state,
        status: "ready",
        trace: action.trace,
        annotation: undefined,
        annotationSource: undefined,
        stepIdx: 0,
        playing: false,
        vizOverride: undefined,
        primaryOverride: undefined,
        error: undefined,
      };
    case "trace_error":
      return { ...initialPlayerState, status: "error", error: action.error };
    case "annotation_ok":
      // progressive enhancement: upgrade captions when the LLM responds
      return { ...state, annotation: action.annotation, annotationSource: action.source };
    case "step_to":
      return { ...state, stepIdx: clampStep(state.trace, action.idx), playing: false };
    case "step_delta": {
      const next = clampStep(state.trace, state.stepIdx + action.delta);
      const atEnd = state.trace ? next === state.trace.steps.length - 1 : true;
      return { ...state, stepIdx: next, playing: state.playing && !atEnd };
    }
    case "play_pause":
      if (
        !state.playing &&
        state.trace &&
        state.stepIdx >= state.trace.steps.length - 1
      ) {
        return { ...state, stepIdx: 0, playing: true }; // replay from start
      }
      return { ...state, playing: !state.playing };
    case "set_speed":
      return { ...state, speed: action.speed };
    case "set_viz":
      return { ...state, vizOverride: action.viz, primaryOverride: action.primary };
    case "reset":
      return { ...state, stepIdx: 0, playing: false };
    case "edit":
      return { ...initialPlayerState };
    default:
      return state;
  }
}
