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
    <div className="flex flex-col h-full">
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

      <main className="flex flex-1 min-h-0">
        {/* left: editors */}
        <div className="w-1/2 border-r flex flex-col min-h-0" style={{ borderColor: "var(--border)" }}>
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
            readOnly={ready}
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
        </div>

        {/* right: visual + captions */}
        <div className="w-1/2 flex flex-col min-h-0 overflow-auto">
          {!ready && (
            <div className="flex-1 flex items-center justify-center p-8 text-center" style={{ color: "var(--fg-soft)" }}>
              {state.status === "tracing" ? (
                <p>Compiling and tracing in the sandbox…</p>
              ) : (
                <p>
                  Write <strong>any C or C++ code</strong> — arrays, pointers,
                  linked lists, trees, recursion, malloc/free — plus a small{" "}
                  <code>main()</code> driver, then press <strong>Illustrate</strong>.
                  <br />
                  Pick <em>✏️ Custom code</em> in the Examples menu for a blank
                  template, or try one of the examples.
                </p>
              )}
            </div>
          )}

          {ready && trace && step && effAnnotation && Viz && (
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 border-b text-xs" style={{ borderColor: "var(--border)" }}>
                <label style={{ color: "var(--fg-soft)" }}>
                  Visual{" "}
                  <select
                    value={effAnnotation.viz}
                    onChange={(e) => dispatch({ type: "set_viz", viz: e.target.value as VizKind, primary: state.primaryOverride })}
                    style={{ background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 4 }}
                  >
                    {VIZ_KINDS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ color: "var(--fg-soft)" }}>
                  Primary{" "}
                  <select
                    value={effAnnotation.primary}
                    onChange={(e) => dispatch({ type: "set_viz", viz: state.vizOverride, primary: e.target.value })}
                    style={{ background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 4 }}
                  >
                    {[effAnnotation.primary, ...primaryCandidates.filter((n) => n !== effAnnotation.primary)].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="flex-1" />
                <span style={{ color: "var(--fg-soft)" }}>
                  {step.func}() · line {step.line} · {step.event}
                </span>
              </div>

              <div className="flex-1 overflow-auto">
                <Viz step={step} prevStep={prevStep} annotation={effAnnotation} trace={trace} solution={solution} />
              </div>

              <p
                aria-live="polite"
                className="px-4 py-2 border-t text-sm min-h-[2.5rem]"
                style={{ borderColor: "var(--border)", background: "var(--bg-soft)" }}
              >
                {caption}
              </p>

              {annotation && annotation.insight && (
                <div className="px-4 py-2 grid grid-cols-2 gap-2 text-xs border-t" style={{ borderColor: "var(--border)" }}>
                  <div className="border rounded p-2" style={{ borderColor: "var(--border)" }}>
                    <strong>Insight</strong>
                    <p style={{ color: "var(--fg-soft)" }}>{annotation.insight}</p>
                  </div>
                  <div className="border rounded p-2" style={{ borderColor: "var(--border)" }}>
                    <strong>Complexity</strong>
                    <p style={{ color: "var(--fg-soft)" }}>
                      time {annotation.complexity.time} · space {annotation.complexity.space}
                    </p>
                  </div>
                </div>
              )}

              <div className="px-3 py-2">
                <OutputPanel trace={trace} />
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
        </div>
      </main>
    </div>
  );
}
