import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import { annotate } from "./annotate.js";
import { requestKey } from "./cache.js";
import { RateLimiter } from "./rateLimit.js";
import { BusyError } from "./sandbox.js";
import {
  runTrace,
  TraceError,
  TraceRequestSchema,
  traceCache,
} from "./trace.js";
import { TraceSchema } from "./schema/trace.js";

const limiter = new RateLimiter(6, 60_000);

export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "200kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/trace", async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (!limiter.allow(ip)) {
      res.status(429).json({ error: "Rate limit exceeded: 6 traces per minute." });
      return;
    }
    const parsed = TraceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstIssue(parsed.error) });
      return;
    }
    try {
      const trace = await runTrace(parsed.data);
      res.json(trace);
    } catch (err) {
      sendError(res, err);
    }
  });

  const AnnotateBodySchema = TraceRequestSchema.extend({
    trace: TraceSchema.optional(),
  });

  app.post("/api/annotate", async (req, res) => {
    const parsed = AnnotateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstIssue(parsed.error) });
      return;
    }
    const { language, solution, driver } = parsed.data;
    // Prefer the server-side cached trace (keeps request bodies small);
    // accept an inline trace as a fallback. See DECISIONS.md #15.
    const trace =
      traceCache.get(requestKey(language, solution, driver)) ?? parsed.data.trace;
    if (!trace) {
      res.status(400).json({
        error: "No trace found for this input; run /api/trace first or include `trace`.",
      });
      return;
    }
    try {
      const result = await annotate({ language, solution, driver, trace });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // body-parser / JSON errors and anything uncaught: never leak internals
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err && typeof err === "object" && "type" in err &&
        (err as { type: string }).type === "entity.too.large") {
      res.status(413).json({ error: "Request body exceeds 200 KB." });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "Invalid JSON body." });
      return;
    }
    sendError(res, err);
  });

  return app;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid request.";
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof BusyError) {
    res.status(503).json({ error: err.message });
    return;
  }
  if (err instanceof TraceError) {
    res.status(422).json({ error: err.message });
    return;
  }
  // Generic: log server-side, return a sanitized message (no stack, no key).
  console.error("[api]", err instanceof Error ? err.message : err);
  res.status(500).json({ error: "Internal error while running the trace." });
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("src/server.ts") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("dist/server.js");
if (isMain) {
  const port = Number(process.env.PORT ?? "3001");
  createApp().listen(port, () => {
    console.log(`[api] listening on :${port}`);
  });
}
