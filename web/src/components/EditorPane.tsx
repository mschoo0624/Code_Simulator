import Editor, { type Monaco } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import type { Diagnostic } from "../types";

interface Props {
  language: "c" | "cpp";
  solution: string;
  driver: string;
  onSolution: (s: string) => void;
  onDriver: (s: string) => void;
  readOnly: boolean;
  currentLine?: number; // 1-based, solution pane only
  diagnostics: Diagnostic[];
}

/** Two Monaco editors: Solution (default) and a collapsible Driver tab. */
export function EditorPane({
  language,
  solution,
  driver,
  onSolution,
  onDriver,
  readOnly,
  currentLine,
  diagnostics,
}: Props) {
  const [tab, setTab] = useState<"solution" | "driver">("solution");
  const solEditor = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorations = useRef<string[]>([]);
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const monacoLang = language === "c" ? "c" : "cpp";

  // current-line decoration + reveal
  useEffect(() => {
    const ed = solEditor.current;
    if (!ed) return;
    if (currentLine && tab === "solution") {
      decorations.current = ed.deltaDecorations(decorations.current, [
        {
          range: {
            startLineNumber: currentLine,
            startColumn: 1,
            endLineNumber: currentLine,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: "current-line-highlight",
            glyphMarginClassName: "current-line-glyph",
          },
        },
      ]);
      ed.revealLineInCenterIfOutsideViewport(currentLine);
    } else {
      decorations.current = ed.deltaDecorations(decorations.current, []);
    }
  }, [currentLine, tab]);

  // compile diagnostics as editor markers
  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = solEditor.current;
    if (!monaco || !ed) return;
    const model = ed.getModel();
    if (!model) return;
    const paneFile = tab === "solution" ? `solution.${language === "c" ? "c" : "cpp"}` : `driver.${language === "c" ? "c" : "cpp"}`;
    const markers = diagnostics
      .filter((d) => d.file === paneFile)
      .map((d) => ({
        startLineNumber: Math.max(1, d.line),
        startColumn: Math.max(1, d.col),
        endLineNumber: Math.max(1, d.line),
        endColumn: Math.max(1, d.col) + 1,
        message: d.message,
        severity:
          d.severity === "error"
            ? monaco.MarkerSeverity.Error
            : d.severity === "warning"
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info,
      }));
    monaco.editor.setModelMarkers(model, "codelens", markers);
  }, [diagnostics, tab, language]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="editor-tabs" role="tablist" aria-label="Code panes">
        {(["solution", "driver"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="editor-tab"
          >
            {t === "solution" ? "Solution" : "Driver (main)"}
          </button>
        ))}
      </div>
      <div className="editor-content flex-1 min-h-0">
        {tab === "solution" ? (
          <Editor
            theme={dark ? "vs-dark" : "light"}
            language={monacoLang}
            value={solution}
            onChange={(v) => onSolution(v ?? "")}
            onMount={(ed, monaco) => {
              solEditor.current = ed;
              monacoRef.current = monaco;
            }}
            options={{
              readOnly,
              minimap: { enabled: false },
              fontSize: 13,
              glyphMargin: true,
              scrollBeyondLastLine: false,
              padding: { top: 16 },
            }}
          />
        ) : (
          <Editor
            theme={dark ? "vs-dark" : "light"}
            language={monacoLang}
            value={driver}
            onChange={(v) => onDriver(v ?? "")}
            options={{
              readOnly,
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              padding: { top: 16 },
            }}
          />
        )}
      </div>
    </div>
  );
}
