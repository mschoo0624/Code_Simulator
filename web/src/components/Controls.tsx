import { useEffect } from "react";

interface Props {
  stepIdx: number;
  stepCount: number;
  playing: boolean;
  speed: 0.5 | 1 | 2;
  onStepTo: (idx: number) => void;
  onDelta: (d: number) => void;
  onPlayPause: () => void;
  onSpeed: (s: 0.5 | 1 | 2) => void;
  onReset: () => void;
}

/** Prev/Next/Play/Reset + slider; keyboard: ←/→ step, Space play. */
export function Controls(props: Props) {
  const { stepIdx, stepCount, playing, speed } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.closest(".monaco-editor")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        props.onDelta(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        props.onDelta(1);
      } else if (e.key === " ") {
        e.preventDefault();
        props.onPlayPause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const btn = "px-3 py-1 rounded border text-sm";
  const btnStyle = { borderColor: "var(--border)", background: "var(--bg)", color: "var(--fg)" };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t" style={{ borderColor: "var(--border)" }}>
      <button className={btn} style={btnStyle} onClick={() => props.onDelta(-1)} aria-label="Previous step">
        ◀ Prev
      </button>
      <button
        className={btn}
        style={{ ...btnStyle, background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}
        onClick={props.onPlayPause}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "⏸ Pause" : "▶ Play"}
      </button>
      <button className={btn} style={btnStyle} onClick={() => props.onDelta(1)} aria-label="Next step">
        Next ▶
      </button>
      <button className={btn} style={btnStyle} onClick={props.onReset} aria-label="Reset to first step">
        ↺ Reset
      </button>

      <select
        className="border rounded px-1 py-1 text-sm"
        style={btnStyle}
        value={speed}
        onChange={(e) => props.onSpeed(Number(e.target.value) as 0.5 | 1 | 2)}
        aria-label="Playback speed"
      >
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
      </select>

      <input
        type="range"
        className="flex-1"
        min={0}
        max={Math.max(0, stepCount - 1)}
        value={stepIdx}
        onChange={(e) => props.onStepTo(Number(e.target.value))}
        aria-label="Step slider"
      />
      <span className="text-sm tabular-nums" style={{ color: "var(--fg-soft)" }}>
        {stepCount === 0 ? "0 / 0" : `${stepIdx + 1} / ${stepCount}`}
      </span>
    </div>
  );
}
