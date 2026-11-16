import { useEffect, useMemo, useReducer, useState } from "react";
import { autoCaption } from "./autoCaption";
import { Controls } from "./components/Controls";
import { EditorPane } from "./components/EditorPane";
import { OutputPanel } from "./components/OutputPanel";
import { TopBar } from "./components/TopBar";
import { presets, type Preset } from "./examples/presets";
import { checkCaptions } from "./hallucination";
import { chooseViz } from "./heuristicViz";
import { initialPlayerState, playerReducer } from "./player/reducer";
import type { Annotation, Trace, VizKind } from "./types";
import { VIZ_KINDS } from "./types";
import { registry } from "./viz/registry";

const DEFAULT = presets[0];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export default function App() {
  const [language, setLanguage] = useState<"c" | "cpp">(DEFAULT.language);
  const [solution, setSolution] = useState(DEFAULT.solution);
  const [driver, setDriver] = useState(DEFAULT.driver);
  const [state, dispatch] = useReducer(playerReducer, initialPlayerState);

  const { trace, annotation, stepIdx } = state;
  const step = trace?.steps[stepIdx];
  const prevStep = stepIdx > 0 ? trace?.steps[stepIdx - 1] : undefined;
  const ready = state.status === "ready" && !!trace;

  // autoplay timer
  useEffect(() => {
    if (!state.playing || !trace) return;
    const interval = 800 / state.speed;
    const t = setInterval(() => dispatch({ type: "step_delta", delta: 1 }), interval);
    return () => clearInterval(t);
  }, [state.playing, state.speed, trace]);

  // hallucination check on LLM captions (dev console only)
  useEffect(() => {
    if (trace && annotation && state.annotationSource === "llm") {
      const flags = checkCaptions(trace, annotation);
      if (flags.length > 0) {
        console.warn("[codelens] caption numbers not found in trace:", flags);
      }
    }
  }, [trace, annotation, state.annotationSource]);

  async function illustrate() {
    dispatch({ type: "start_trace" });
    let tr: Trace;
    try {
      tr = await postJson<Trace>("/api/trace", { language, solution, driver });
    } catch (err) {
      dispatch({ type: "trace_error", error: err instanceof Error ? err.message : "Trace failed." });
      return;
    }
    dispatch({ type: "trace_ok", trace: tr });
    if (!tr.compile.ok || tr.steps.length === 0) return;
    // progressive enhancement: annotation arrives later
    try {
      const res = await postJson<{ annotation: Annotation; source: "llm" | "fallback" }>(
        "/api/annotate",
        { language, solution, driver },
      );
      dispatch({ type: "annotation_ok", annotation: res.annotation, source: res.source });
    } catch {
      // keep auto captions; annotation is optional
    }
  }

  function applyPreset(p: Preset) {
    setLanguage(p.language);
    setSolution(p.solution);
    setDriver(p.driver);
    dispatch({ type: "edit" });
  }

  // effective annotation: LLM one, overridden viz/primary, or an instant
  // heuristic pick from the trace itself (works for ANY code, no LLM needed)
  const effAnnotation: Annotation | undefined = useMemo(() => {
    if (!trace) return undefined;
    const base: Annotation =
      annotation ?? {
        ...chooseViz(trace, solution),
        captions: [],
        insight: "",
        complexity: { time: "", space: "" },
      };
    return {
      ...base,
      viz: state.vizOverride ?? base.viz,
      primary: state.primaryOverride ?? base.primary,
    };
  }, [trace, annotation, solution, state.vizOverride, state.primaryOverride]);

  const caption = useMemo(() => {
    if (!step) return "";
    const llm = annotation?.captions.find((c) => c.idx === step.idx)?.text;
    return llm ?? autoCaption(step);
  }, [step, annotation]);

  const Viz = effAnnotation ? registry[effAnnotation.viz] : undefined;
  const primaryCandidates = useMemo(
    () => (step ? Object.keys(step.locals) : []),
    [step],
  );

  const crashStep = trace?.steps.find((s) => s.event === "exception");

  return (
    <div className="app-shell">
      <TopBar
        language={language}
        onLanguage={(lang) => {
          setLanguage(lang);
          dispatch({ type: "edit" });
        }}
        onPreset={applyPreset}
        onIllustrate={illustrate}
        busy={state.status === "tracing" || state.status === "compiling"}
      />

      {/* banners */}
      {state.status === "error" && (
        <div role="alert" className="px-4 py-2 text-sm" style={{ background: "var(--cell-source)", color: "var(--fg)" }}>
          {state.error}
        </div>
      )}
      {trace?.truncated && (
        <div role="status" className="px-4 py-2 text-sm" style={{ background: "var(--cell-source)" }}>
          Trace limited to {trace.steps.length} steps ({trace.truncatedReason ?? "limit reached"}).
        </div>
      )}
      {trace?.sampled && !trace.truncated && (
        <div role="status" className="px-4 py-2 text-sm" style={{ background: "var(--cell-source)" }}>
          Long run: early steps are recorded in full, later steps are sampled
          (every Nth) to cover the whole execution.
        </div>
      )}
      {trace?.signal && (
        <div role="alert" className="px-4 py-2 text-sm font-semibold" style={{ background: "var(--cell-source)", color: "var(--error)" }}>
          Program crashed: {trace.signal}
          {crashStep ? ` at line ${crashStep.line}` : ""}
        </div>
      )}
      {trace && !trace.compile.ok && (
        <div role="alert" className="px-4 py-2 text-sm" style={{ background: "var(--cell-source)", color: "var(--error)" }}>
          Compilation failed — see the markers in the editor and the list below.
        </div>
      )}

      <main className="workspace">
        {/* left: editors */}
        <section className="workspace-panel editor-panel" aria-label="Code editor">
          <div className="panel-heading">
            <div>
              <span className="eyebrow"><span className="status-dot" /> YOUR WORKSPACE</span>
              <h2>Code editor</h2>
              <p>Write your function and set up its inputs.</p>
            </div>
            {ready && trace?.compile.ok && (
              <button className="control-button" onClick={() => dispatch({ type: "edit" })}>
                Edit code
              </button>
            )}
          </div>
          <EditorPane
            language={language}
            solution={solution}
            driver={driver}
            onSolution={(s) => {
              setSolution(s);
              if (ready) dispatch({ type: "edit" });
            }}
            onDriver={(s) => {
              setDriver(s);
              if (ready) dispatch({ type: "edit" });
            }}
            readOnly={ready && !!trace?.compile.ok}
            currentLine={ready ? step?.line : undefined}
            diagnostics={trace?.compile.diagnostics ?? []}
          />
          {trace && trace.compile.diagnostics.length > 0 && (
            <div className="max-h-36 overflow-auto border-t text-xs p-2" style={{ borderColor: "var(--border)" }}>
              {trace.compile.diagnostics.map((d, i) => (
                <p key={i} style={{ color: d.severity === "error" ? "var(--error)" : "var(--fg-soft)" }}>
                  [{d.severity}] {d.file}:{d.line}:{d.col} — {d.message}
                </p>
              ))}
            </div>
          )}
        </section>

        {/* right: visual + captions */}
        <section className="workspace-panel visual-panel" aria-label="Execution visualization">
          <div className="panel-heading visual-heading">
            <div>
              <span className="eyebrow"><span className="status-dot secondary" /> EXECUTION TRACE</span>
              <h2>Visual walkthrough</h2>
              <p>Follow your program, one step at a time.</p>
            </div>
            <span className="status-badge">{step ? "Trace ready" : trace && !trace.compile.ok ? "Compilation failed" : "Ready to explore"}</span>
          </div>
          {(!ready || !trace?.compile.ok) && (
            <div className="empty-state">
              {state.status === "tracing" ? (
                <div className="empty-content">
                  <div className="empty-icon" aria-hidden="true">⌁</div>
                  <h3>Bringing your code to life</h3>
                  <p>Compiling and tracing in the sandbox…</p>
                </div>
              ) : trace && !trace.compile.ok ? (
                <div className="empty-content">
                  <div className="empty-icon" aria-hidden="true">!</div>
                  <h3>Let's fix the code first.</h3>
                  <p>Review the compiler messages under the editor, make your changes, then press Illustrate again.</p>
                </div>
              ) : (
                <div className="empty-content">
                  <div className="empty-icon" aria-hidden="true">✦</div>
                  <span className="eyebrow">YOUR CODE, VISUALIZED</span>
                  <h3>See what happens<br />between the lines.</h3>
                  <p>Write a C or C++ function, add a <code>main()</code> driver, and watch your program unfold.</p>
                  <div className="empty-steps">
                    <span><b>01</b> Write your code</span>
                    <span><b>02</b> Choose an input</span>
                    <span><b>03</b> Press Illustrate</span>
                  </div>
                  <p className="empty-hint">Not sure where to start? Pick an example above.</p>
                </div>
              )}
            </div>
          )}

          {ready && trace && step && effAnnotation && Viz && (
            <>
              <div className="visual-toolbar">
                <label>
                  Visual{" "}
                  <select
                    value={effAnnotation.viz}
                    onChange={(e) => dispatch({ type: "set_viz", viz: e.target.value as VizKind, primary: state.primaryOverride })}
                    className="select-control"
                  >
                    {VIZ_KINDS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Primary{" "}
                  <select
                    value={effAnnotation.primary}
                    onChange={(e) => dispatch({ type: "set_viz", viz: state.vizOverride, primary: e.target.value })}
                    className="select-control"
                  >
                    {[effAnnotation.primary, ...primaryCandidates.filter((n) => n !== effAnnotation.primary)].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="trace-location">
                  {step.func}() · line {step.line} · {step.event}
                </span>
              </div>

              <div className="visual-details">
              <div className="visual-canvas">
                <Viz step={step} prevStep={prevStep} annotation={effAnnotation} trace={trace} solution={solution} />
              </div>

              <div className="caption-strip">
                <span className="caption-icon" aria-hidden="true">✦</span>
                <div><span className="eyebrow">CURRENT STEP</span><p aria-live="polite">{caption}</p></div>
              </div>

              {annotation && annotation.insight && (
                <div className="insight-grid">
                  <div className="info-card">
                    <strong>Insight</strong>
                    <p style={{ color: "var(--fg-soft)" }}>{annotation.insight}</p>
                  </div>
                  <div className="info-card">
                    <strong>Complexity</strong>
                    <p style={{ color: "var(--fg-soft)" }}>
                      time {annotation.complexity.time} · space {annotation.complexity.space}
                    </p>
                  </div>
                </div>
              )}

              <div className="output-wrap">
                <OutputPanel trace={trace} />
              </div>
              </div>

              <Controls
                stepIdx={stepIdx}
                stepCount={trace.steps.length}
                playing={state.playing}
                speed={state.speed}
                onStepTo={(idx) => dispatch({ type: "step_to", idx })}
                onDelta={(delta) => dispatch({ type: "step_delta", delta })}
                onPlayPause={() => dispatch({ type: "play_pause" })}
                onSpeed={(speed) => dispatch({ type: "set_speed", speed })}
                onReset={() => dispatch({ type: "reset" })}
              />
            </>
          )}

          {ready && trace && trace.compile.ok && trace.steps.length === 0 && (
            <div className="p-6" style={{ color: "var(--fg-soft)" }}>
              <p>The program ran but no solution-file steps were recorded. Make sure the driver calls a function defined in the Solution pane.</p>
              <div className="mt-3">
                <OutputPanel trace={trace} />
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
