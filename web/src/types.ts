// Shared types — mirror api/src/schema/{trace,annotation}.ts

export type Value =
  | { k: "int"; t: string; v: number | string }
  | { k: "float"; t: string; v: number }
  | { k: "bool"; v: boolean }
  | { k: "char"; v: string; code: number }
  | { k: "str"; t: string; v: string }
  | { k: "null" }
  | {
      k: "array";
      t: string;
      len: number;
      items: Value[];
      truncated?: boolean;
      source: "stack" | "heap" | "stl";
    }
  | { k: "struct"; t: string; fields: Record<string, Value> }
  | {
      k: "ptr";
      t: string;
      addr: string;
      target?: Value;
      base?: string;
      offset?: number;
      alloc?: { size: number; live: boolean };
      invalid?: boolean;
    }
  | { k: "ref"; addr: string }
  | { k: "unknown"; repr: string };

export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  severity: "error" | "warning" | "note";
  message: string;
}

export interface Step {
  idx: number;
  event: "call" | "line" | "return" | "exception";
  line: number;
  func: string;
  stackDepth: number;
  locals: Record<string, Value>;
  changed: string[];
  changedIndices: Record<string, number[]>;
  returnValue?: Value;
  error?: string;
}

export interface Trace {
  language: "c" | "cpp";
  solutionFile: string;
  truncated: boolean;
  truncatedReason?: string;
  compile: { ok: boolean; diagnostics: Diagnostic[] };
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string;
  leaks?: { addr: string; size: number }[];
  steps: Step[];
}

export const VIZ_KINDS = [
  "array",
  "bits_array",
  "grid",
  "linked_list",
  "tree",
  "graph",
  "memory",
  "variables",
] as const;
export type VizKind = (typeof VIZ_KINDS)[number];

export interface Annotation {
  viz: VizKind;
  primary: string;
  pointers: string[];
  captions: { idx: number; text: string }[];
  insight: string;
  complexity: { time: string; space: string };
}
