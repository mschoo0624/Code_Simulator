import { z } from "zod";

// ---------------------------------------------------------------------------
// Value — mirrors the serializer in runner/tracer/gdb_tracer.py
// ---------------------------------------------------------------------------

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

export const ValueSchema: z.ZodType<Value> = z.lazy(() =>
  z.union([
    z.object({ k: z.literal("int"), t: z.string(), v: z.union([z.number(), z.string()]) }),
    z.object({ k: z.literal("float"), t: z.string(), v: z.number() }),
    z.object({ k: z.literal("bool"), v: z.boolean() }),
    z.object({ k: z.literal("char"), v: z.string(), code: z.number() }),
    z.object({ k: z.literal("str"), t: z.string(), v: z.string() }),
    z.object({ k: z.literal("null") }),
    z.object({
      k: z.literal("array"),
      t: z.string(),
      len: z.number(),
      items: z.array(ValueSchema),
      truncated: z.boolean().optional(),
      source: z.enum(["stack", "heap", "stl"]),
    }),
    z.object({
      k: z.literal("struct"),
      t: z.string(),
      fields: z.record(ValueSchema),
    }),
    z.object({
      k: z.literal("ptr"),
      t: z.string(),
      addr: z.string(),
      target: ValueSchema.optional(),
      base: z.string().optional(),
      offset: z.number().optional(),
      alloc: z.object({ size: z.number(), live: z.boolean() }).optional(),
      invalid: z.boolean().optional(),
    }),
    z.object({ k: z.literal("ref"), addr: z.string() }),
    z.object({ k: z.literal("unknown"), repr: z.string() }),
  ]),
);

// ---------------------------------------------------------------------------
// Diagnostic / Step / Trace
// ---------------------------------------------------------------------------

export const DiagnosticSchema = z.object({
  file: z.string(),
  line: z.number(),
  col: z.number(),
  severity: z.enum(["error", "warning", "note"]),
  message: z.string(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

export const StepSchema = z.object({
  idx: z.number(),
  event: z.enum(["call", "line", "return", "exception"]),
  line: z.number(),
  func: z.string(),
  stackDepth: z.number(),
  locals: z.record(ValueSchema),
  changed: z.array(z.string()),
  changedIndices: z.record(z.array(z.number())),
  returnValue: ValueSchema.optional(),
  error: z.string().optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const TraceSchema = z.object({
  language: z.enum(["c", "cpp"]),
  solutionFile: z.string(),
  truncated: z.boolean(),
  truncatedReason: z.string().optional(),
  compile: z.object({
    ok: z.boolean(),
    diagnostics: z.array(DiagnosticSchema),
  }),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().optional(),
  leaks: z.array(z.object({ addr: z.string(), size: z.number() })).optional(),
  steps: z.array(StepSchema),
});
export type Trace = z.infer<typeof TraceSchema>;
