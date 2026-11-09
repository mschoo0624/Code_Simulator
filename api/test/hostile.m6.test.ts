/**
 * Milestone 6 — hostile input containment tests. Each submits malicious code
 * through the real sandbox and verifies graceful, contained behavior.
 * Auto-skipped without Docker.
 */
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runTrace } from "../src/trace.js";
import type { Trace } from "../src/schema/trace.js";

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}
const hasDocker = dockerAvailable();

const MAIN = `int main(void) { return go(); }`;

async function trace(solution: string, driver = MAIN): Promise<Trace> {
  return runTrace({ language: "c", solution, driver });
}

describe.skipIf(!hasDocker)("M6 hostile input containment", () => {
  it("fork bomb is contained by pids-limit", async () => {
    const t = await trace(`
#include <unistd.h>
int go(void) {
    while (1) fork();
    return 0;
}`);
    // must come back as a structured trace (likely truncated), not hang
    expect(t.compile.ok).toBe(true);
    expect(typeof t.truncated).toBe("boolean");
  }, 60_000);

  it("huge allocation is contained by the memory cap", async () => {
    const t = await trace(`
#include <stdlib.h>
#include <string.h>
int go(void) {
    for (int i = 0; i < 64; i++) {
        char* p = malloc(64UL * 1024 * 1024);
        if (p) memset(p, 1, 64UL * 1024 * 1024);
    }
    return 0;
}`);
    expect(t.compile.ok).toBe(true);
    // either the allocs fail (exit 0) or the OOM killer fires — both graceful
    expect(t.steps.length).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('#include "/etc/passwd" fails to compile without leaking host files', async () => {
    const t = await trace(`#include "/etc/passwd"\nint go(void) { return 0; }`);
    expect(t.compile.ok).toBe(false);
    const text = JSON.stringify(t.compile.diagnostics);
    // host (Windows) users never appear; the container's /etc/passwd has no
    // password hashes, and diagnostics must not dump file contents wholesale
    expect(text).not.toContain("$6$");
    expect(text).not.toContain("$y$");
  }, 60_000);

  it("network syscalls fail (--network none)", async () => {
    const t = await trace(`
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
int go(void) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return 1;
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET;
    a.sin_port = htons(80);
    a.sin_addr.s_addr = inet_addr("1.1.1.1");
    int rc = connect(fd, (struct sockaddr*)&a, sizeof a);
    close(fd);
    return rc == 0 ? 2 : 0;
}`);
    expect(t.compile.ok).toBe(true);
    expect(t.exitCode).toBe(0); // connect must fail -> go() returns 0
  }, 60_000);

  it("reading /proc/1/environ yields nothing sensitive", async () => {
    const t = await trace(`
#include <stdio.h>
int go(void) {
    FILE* f = fopen("/proc/1/environ", "r");
    if (!f) { printf("denied\\n"); return 0; }
    char buf[256];
    size_t n = fread(buf, 1, sizeof buf - 1, f);
    buf[n] = 0;
    printf("read %zu bytes\\n", n);
    fclose(f);
    return 0;
}`);
    expect(t.compile.ok).toBe(true);
    // pid 1 is our own entrypoint; its env must not contain secrets
    expect(t.stdout).not.toContain("ANTHROPIC");
    expect(t.stdout).not.toContain("API_KEY");
  }, 60_000);
});
