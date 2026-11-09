/**
 * sandbox.ts — runs one trace in a fresh, locked-down container.
 *
 * Global concurrency cap (default 3) with a small queue; callers beyond the
 * queue get a BusyError. The container is hard-killed if it exceeds the
 * wall-clock budget (the in-container pipeline self-limits earlier; see
 * DECISIONS.md #14 for why the hard budget exceeds the spec's 12 s).
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export const RUNNER_IMAGE = process.env.RUNNER_IMAGE ?? "codelens-runner";
const MAX_CONCURRENT = Number(process.env.MAX_CONTAINERS ?? "3");
const QUEUE_LIMIT = Number(process.env.SANDBOX_QUEUE ?? "6");
const HARD_KILL_MS = Number(process.env.SANDBOX_KILL_MS ?? "25000");

export class BusyError extends Error {
  constructor() {
    super("The tracer is busy, please try again in a moment.");
    this.name = "BusyError";
  }
}

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

let running = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
    return;
  }
  if (waiters.length >= QUEUE_LIMIT) throw new BusyError();
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) next();
  else running -= 1;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  timedOut: boolean;
  exitCode: number | null;
}

export const SANDBOX_FLAGS = [
  "--network", "none",
  "--read-only",
  "--tmpfs", "/work:rw,exec,size=32m,mode=1777",
  "--memory", "256m",
  "--memory-swap", "256m",
  "--cpus", "1",
  "--pids-limit", "128",
  "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges",
];

export async function runInSandbox(input: string): Promise<SandboxResult> {
  await acquire();
  try {
    return await exec(input);
  } finally {
    release();
  }
}

function exec(input: string): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const name = `codelens-${randomUUID()}`;
    const child = spawn(
      "docker",
      ["run", "--rm", "-i", "--name", name, ...SANDBOX_FLAGS, RUNNER_IMAGE],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      // kill the container, not just the docker CLI process
      spawn("docker", ["kill", name], { stdio: "ignore" }).on("error", () => {});
      child.kill();
    }, HARD_KILL_MS);

    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < 32 * 1024 * 1024) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 1024 * 1024) stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new SandboxError(`failed to start container: ${err.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, exitCode: code });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}
