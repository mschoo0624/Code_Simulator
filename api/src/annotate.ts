/**
 * annotate.ts — compresses a trace, asks Claude for an Annotation, validates
 * with Zod (one retry with the validation error appended), and falls back to
 * viz:"variables" with auto captions when the LLM is unavailable or invalid.
 */
import { BoundedCache, requestKey } from "./cache.js";
import { chooseViz } from "./heuristicViz.js";
import { AnnotationSchema, type Annotation } from "./schema/annotation.js";
import type { Step, Trace, Value } from "./schema/trace.js";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 20_000;
const MAX_COMPRESSED_STEPS = 120;

export const SYSTEM_PROMPT = `You annotate real execution traces of C/C++ programs for a teaching visualizer.
Rules:
1. Use ONLY values present in the trace. Never invent, recompute, or guess values.
2. Respond with a single JSON object, no prose, no markdown fences.
3. Choose "viz" from: "array", "bits_array", "grid", "linked_list", "tree", "graph", "memory", "variables".
   - "bits_array": array of non-negative ints where binary form matters (bit tricks, DP over bits).
   - "array": generic 1D array, std::vector, DP table, sorting, two pointers.
   - "grid": array of arrays.
   - "linked_list" / "tree" / "graph": pointer-linked structs with matching shapes.
   - "memory": when stack frames, pointers, and malloc/free lifetime ARE the lesson.
   - "variables": fallback.
4. "primary" is the variable to draw. It may be an int* pointing to a heap block, a stack array, or a std::vector.
5. "pointers" lists variables that act as indices or cursors into the primary array: integer index variables (i, j) and pointer variables whose trace value has a base/offset into it (p, left, right).
6. "captions" has one entry per provided step idx, max 140 characters, plain English, present tense, citing concrete values.
7. "insight": 1-2 sentences on the core idea. "complexity": time and space in Big-O, one short reason each.`;

// ---------------------------------------------------------------------------
// trace compression
// ---------------------------------------------------------------------------

function shrinkValue(v: Value, keepIdx: number[]): unknown {
  if (v.k === "array" && v.items.length > 8) {
    const keep = new Set<number>([0, 1, 2, v.items.length - 2, v.items.length - 1, ...keepIdx]);
    const sample: Record<number, unknown> = {};
    for (const i of [...keep].sort((a, b) => a - b)) {
      if (i >= 0 && i < v.items.length) sample[i] = shrinkValue(v.items[i], []);
    }
    return { k: "array", t: v.t, len: v.len, source: v.source, sample };
  }
  if (v.k === "array") {
    return { ...v, items: v.items.map((it) => shrinkValue(it, [])) };
  }
  if (v.k === "ptr") {
    const out: Record<string, unknown> = { ...v };
    if (v.target) out.target = shrinkValue(v.target, keepIdx);
    return out;
  }
  if (v.k === "struct") {
    const fields: Record<string, unknown> = {};
    for (const [name, f] of Object.entries(v.fields)) fields[name] = shrinkValue(f, []);
    return { ...v, fields };
  }
  return v;
}

export function compressTrace(trace: Trace): {
  steps: unknown[];
  stdout: string;
  truncated: boolean;
  signal?: string;
} {
  const interesting = trace.steps.filter(
    (s) => s.changed.length > 0 || s.event !== "line",
  );
  const first = trace.steps[0];
  const last = trace.steps[trace.steps.length - 1];
  const set = new Set(interesting);
  if (first) set.add(first);
  if (last) set.add(last);

  let kept = [...set].sort((a, b) => a.idx - b.idx);
  if (kept.length > MAX_COMPRESSED_STEPS) {
    const stride = Math.ceil(kept.length / MAX_COMPRESSED_STEPS);
    kept = kept.filter(
      (s, i) => i % stride === 0 || s === first || s === last,
    );
  }

  const steps = kept.map((s) => ({
    idx: s.idx,
    event: s.event,
    line: s.line,
    func: s.func,
    changed: s.changed,
    changedIndices: s.changedIndices,
    locals: Object.fromEntries(
      Object.entries(s.locals).map(([name, v]) => [
        name,
        shrinkValue(v, s.changedIndices[name] ?? []),
      ]),
    ),
    ...(s.returnValue ? { returnValue: s.returnValue } : {}),
    ...(s.error ? { error: s.error } : {}),
  }));

  return {
    steps,
    stdout: trace.stdout,
    truncated: trace.truncated,
    ...(trace.signal ? { signal: trace.signal } : {}),
  };
}

// ---------------------------------------------------------------------------
// auto captions (also used by the fallback path)
// ---------------------------------------------------------------------------

function shortValue(v: Value): string {
  switch (v.k) {
    case "int":
    case "float":
      return String(v.v);
    case "bool":
      return String(v.v);
    case "char":
      return `'${v.v}'`;
    case "str":
      return JSON.stringify(v.v.length > 20 ? v.v.slice(0, 20) + "…" : v.v);
    case "null":
      return "NULL";
    case "array":
      return `[${v.items.slice(0, 8).map(shortValue).join(", ")}${v.len > 8 ? ", …" : ""}]`;
    case "ptr":
      if (v.target) return shortValue(v.target);
      return v.addr.slice(0, 8);
    case "struct":
      return `{${Object.keys(v.fields).slice(0, 3).join(", ")}}`;
    case "ref":
      return `→${v.addr.slice(0, 8)}`;
    default:
      return "?";
  }
}

export function autoCaption(step: Step): string {
  if (step.event === "exception") {
    return `Program crashed with ${step.error ?? "a signal"} at line ${step.line}.`;
  }
  if (step.event === "call") {
    return `Line ${step.line}: entering ${step.func}.`;
  }
  if (step.event === "return") {
    const rv = step.returnValue ? ` with ${shortValue(step.returnValue)}` : "";
    return `Line ${step.line}: returning from ${step.func}${rv}.`;
  }
  if (step.changed.length > 0) {
    const parts = step.changed
      .slice(0, 3)
      .map((name) => {
        const v = step.locals[name];
        return v ? `${name} = ${shortValue(v)}` : name;
      })
      .join(", ");
    return `Line ${step.line}: ${parts}`.slice(0, 140);
  }
  return `Line ${step.line} in ${step.func}.`;
}

export function fallbackAnnotation(trace: Trace, solution = ""): Annotation {
  const compressed = compressTrace(trace);
  const captions = compressed.steps.map((s) => {
    const idx = (s as { idx: number }).idx;
    const step = trace.steps.find((t) => t.idx === idx)!;
    return { idx, text: autoCaption(step) };
  });
  // No LLM needed: pick the visualization from the trace itself, so ANY
  // program gets a fitting visual (arrays, lists, trees, memory, …).
  const choice = chooseViz(trace, solution);
  return {
    ...choice,
    captions,
    insight: "Step through the trace to see how each variable evolves.",
    complexity: { time: "?", space: "?" },
  };
}

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------

async function callClaude(userContent: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API returned ${res.status}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("Anthropic API returned no text");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(trimmed);
}

export interface AnnotateRequest {
  language: "c" | "cpp";
  solution: string;
  driver: string;
  trace: Trace;
}

export const annotationCache = new BoundedCache<Annotation>(100);

export async function annotate(req: AnnotateRequest): Promise<{
  annotation: Annotation;
  source: "llm" | "fallback";
}> {
  const key = requestKey(req.language, req.solution, req.driver);
  const cached = annotationCache.get(key);
  if (cached) return { annotation: cached, source: "llm" };

  const compressed = compressTrace(req.trace);
  const basePrompt = JSON.stringify({
    language: req.language,
    solution: req.solution,
    driver: req.driver,
    trace: compressed,
  });

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous response failed validation: ${lastError}\nRespond again with ONLY the corrected JSON object.`;
    try {
      const text = await callClaude(prompt);
      const parsed = AnnotationSchema.safeParse(extractJson(text));
      if (parsed.success) {
        annotationCache.set(key, parsed.data);
        return { annotation: parsed.data, source: "llm" };
      }
      lastError = parsed.error.message.slice(0, 1000);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (lastError.includes("ANTHROPIC_API_KEY")) break; // no key: skip retry
    }
  }
  return { annotation: fallbackAnnotation(req.trace, req.solution), source: "fallback" };
}
