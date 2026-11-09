import { z } from "zod";
import { BoundedCache, requestKey } from "./cache.js";
import { runInSandbox, SandboxError } from "./sandbox.js";
import { TraceSchema, type Trace } from "./schema/trace.js";

export const MAX_PANE_BYTES = 20 * 1024;

export const TraceRequestSchema = z.object({
  language: z.enum(["c", "cpp"]),
  solution: z.string().max(MAX_PANE_BYTES, "solution pane exceeds 20 KB"),
  driver: z.string().max(MAX_PANE_BYTES, "driver pane exceeds 20 KB"),
});
export type TraceRequest = z.infer<typeof TraceRequestSchema>;

export class TraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceError";
  }
}

export const traceCache = new BoundedCache<Trace>(100);

export async function runTrace(req: TraceRequest): Promise<Trace> {
  const key = requestKey(req.language, req.solution, req.driver);
  const cached = traceCache.get(key);
  if (cached) return cached;

  const result = await runInSandbox(JSON.stringify(req));
  if (result.timedOut) {
    throw new TraceError("The trace exceeded the time budget and was stopped.");
  }
  if (!result.stdout.trim()) {
    throw new SandboxError("The tracer produced no output.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new SandboxError("The tracer produced invalid output.");
  }
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    throw new TraceError(String((parsed as { error: unknown }).error));
  }
  const trace = TraceSchema.parse(parsed);
  traceCache.set(key, trace);
  return trace;
}
