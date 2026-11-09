/**
 * Milestone 2 — API endpoint tests. Unit-level tests always run; tests that
 * need the runner container auto-skip without Docker.
 */
import { execSync } from "node:child_process";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import { traceCache } from "../src/trace.js";
import { RateLimiter } from "../src/rateLimit.js";
import { BoundedCache, requestKey } from "../src/cache.js";

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}
const hasDocker = dockerAvailable();

const SOLUTION = `#include <stdlib.h>
int* countBits(int n, int* returnSize) {
    int* dp = malloc(sizeof(int) * (n + 1));
    *returnSize = n + 1;
    dp[0] = 0;
    for (int i = 1; i <= n; i++)
        dp[i] = (i & 1) + dp[i / 2];
    return dp;
}
`;
const DRIVER = `#include <stdio.h>
int main(void) {
    int size;
    int* r = countBits(10, &size);
    for (int i = 0; i < size; i++) printf("%d ", r[i]);
    printf("\\n");
    free(r);
    return 0;
}
`;

describe("API validation (no Docker needed)", () => {
  const app = createApp();

  it("GET /api/health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects an unknown language", async () => {
    const res = await request(app)
      .post("/api/trace")
      .send({ language: "rust", solution: "x", driver: "y" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("language");
  });

  it("rejects oversized panes (> 20 KB)", async () => {
    const res = await request(app)
      .post("/api/trace")
      .send({ language: "c", solution: "x".repeat(21 * 1024), driver: "y" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("20 KB");
  });

  it("rejects oversized request bodies (> 200 KB)", async () => {
    const res = await request(app)
      .post("/api/annotate")
      .send({
        language: "c",
        solution: "x",
        driver: "y",
        trace: { padding: "p".repeat(250 * 1024) },
      });
    expect(res.status).toBe(413);
    expect(res.body.error).toContain("200 KB");
  });

  it("rejects invalid JSON without a stack trace", async () => {
    const res = await request(app)
      .post("/api/trace")
      .set("content-type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("at ");
  });

  it("annotate without a prior trace asks for one", async () => {
    const res = await request(app)
      .post("/api/annotate")
      .send({ language: "c", solution: "nope", driver: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("trace");
  });
});

describe("rate limiter", () => {
  it("allows 6 per minute then blocks, sliding window", () => {
    const rl = new RateLimiter(6, 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 6; i++) expect(rl.allow("a", t0 + i)).toBe(true);
    expect(rl.allow("a", t0 + 10)).toBe(false);
    expect(rl.allow("b", t0 + 10)).toBe(true); // other IPs unaffected
    expect(rl.allow("a", t0 + 61_000)).toBe(true); // window slid
  });
});

describe("cache", () => {
  it("keys by sha-256 of language+solution+driver", () => {
    expect(requestKey("c", "a", "b")).toBe(requestKey("c", "a", "b"));
    expect(requestKey("c", "a", "b")).not.toBe(requestKey("cpp", "a", "b"));
    expect(requestKey("c", "ab", "")).not.toBe(requestKey("c", "a", "b"));
  });

  it("evicts oldest entries beyond the cap", () => {
    const c = new BoundedCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });
});

describe.skipIf(!hasDocker)("API end-to-end (Docker)", () => {
  const app = createApp();

  beforeAll(() => {
    traceCache.clear();
  });

  it("POST /api/trace runs countBits and caches", async () => {
    const res = await request(app)
      .post("/api/trace")
      .send({ language: "c", solution: SOLUTION, driver: DRIVER });
    expect(res.status).toBe(200);
    expect(res.body.compile.ok).toBe(true);
    expect(res.body.stdout).toBe("0 1 1 2 1 2 2 3 1 2 2 \n");

    // second call hits the cache (must be much faster than a container run)
    const t0 = Date.now();
    const res2 = await request(app)
      .post("/api/trace")
      .send({ language: "c", solution: SOLUTION, driver: DRIVER });
    expect(res2.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(300);
  }, 60_000);

  it("POST /api/annotate works without an API key (heuristic fallback)", async () => {
    const res = await request(app)
      .post("/api/annotate")
      .send({ language: "c", solution: SOLUTION, driver: DRIVER });
    expect(res.status).toBe(200);
    expect(res.body.annotation).toBeDefined();
    expect(res.body.annotation.captions.length).toBeGreaterThan(0);
    if (!process.env.ANTHROPIC_API_KEY) {
      expect(res.body.source).toBe("fallback");
      // the heuristic chooser recognizes countBits without any LLM:
      expect(res.body.annotation.viz).toBe("bits_array");
      expect(res.body.annotation.primary).toBe("dp");
      expect(res.body.annotation.pointers).toContain("i");
    }
  }, 60_000);

  it("compile errors surface as a structured trace, not an API error", async () => {
    const res = await request(app)
      .post("/api/trace")
      .send({ language: "c", solution: "int broken(int x) { return x + }", driver: "int main(void){return 0;}" });
    expect(res.status).toBe(200);
    expect(res.body.compile.ok).toBe(false);
    expect(res.body.compile.diagnostics.length).toBeGreaterThan(0);
    expect(res.body.compile.diagnostics[0].file).toBe("solution.c");
  }, 60_000);
});
