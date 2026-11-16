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

  return (
    <div className="player-controls">
      <div className="player-buttons">
      <button className="control-button" onClick={() => props.onDelta(-1)} aria-label="Previous step">
        ◀ Prev
      </button>
      <button
        className="primary-button play-button"
        onClick={props.onPlayPause}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "⏸ Pause" : "▶ Play"}
      </button>
      <button className="control-button" onClick={() => props.onDelta(1)} aria-label="Next step">
        Next ▶
      </button>
      <button className="control-button" onClick={props.onReset} aria-label="Reset to first step">
        ↺ Reset
      </button>

      <select
        className="select-control speed-select"
        value={speed}
        onChange={(e) => props.onSpeed(Number(e.target.value) as 0.5 | 1 | 2)}
        aria-label="Playback speed"
      >
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
      </select>
      </div>
      <div className="player-progress">
      <input
        type="range"
        className="step-slider"
        min={0}
        max={Math.max(0, stepCount - 1)}
        value={stepIdx}
        onChange={(e) => props.onStepTo(Number(e.target.value))}
        aria-label="Step slider"
      />
      <span className="step-count tabular-nums">
        {stepCount === 0 ? "0 / 0" : `${stepIdx + 1} / ${stepCount}`}
      </span>
      </div>
    </div>
  );
}
