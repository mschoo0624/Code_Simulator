import type { Trace } from "../types";

export function OutputPanel({ trace }: { trace: Trace }) {
  const status =
    trace.signal
      ? `crashed with ${trace.signal}`
      : trace.exitCode === null
        ? "did not exit"
        : `exited with code ${trace.exitCode}`;
  return (
    <section
      className="border rounded p-3 text-sm"
      style={{ borderColor: "var(--border)", background: "var(--bg-soft)" }}
    >
      <h3 className="font-semibold mb-1">Output</h3>
      <p className="mb-1" style={{ color: trace.signal ? "var(--error)" : "var(--fg-soft)" }}>
        Program {status}.
      </p>
      {trace.stdout && (
        <pre
          className="font-mono text-xs p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        >
          {trace.stdout}
        </pre>
      )}
      {trace.stderr && (
        <pre
          className="font-mono text-xs p-2 rounded overflow-auto max-h-24 mt-1 whitespace-pre-wrap"
          style={{ background: "var(--bg)", border: "1px solid var(--error)", color: "var(--error)" }}
        >
          {trace.stderr}
        </pre>
      )}
      {(trace.leaks?.length ?? 0) > 0 && (
        <p className="mt-1" style={{ color: "var(--error)" }}>
          ⚠ {trace.leaks!.length} leaked block{trace.leaks!.length === 1 ? "" : "s"}:{" "}
          {trace.leaks!.map((l) => `${l.size} B`).join(", ")}
        </p>
      )}
    </section>
  );
}
