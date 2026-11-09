import type { VizProps } from "./VizProps";
import { VariablesView } from "./VariablesView";
import { fmtValue, pointerIndices, resolveArray, toBinary } from "./helpers";

const CELL_W = 46;
const CELL_H = 34;
const TOP = 26;

export interface ArrayViewExtraProps {
  showBits?: boolean;
  sourceIdx?: number;
}

export function ArrayViewBase(props: VizProps & ArrayViewExtraProps) {
  const { step, annotation, showBits, sourceIdx } = props;
  const primary = annotation.primary;
  const arr = resolveArray(step, primary);
  if (!arr) return <VariablesView {...props} />;

  const changed = new Set(step.changedIndices[primary] ?? []);
  const pointers = pointerIndices(step, annotation.pointers, arr.items.length);
  const bitsWidth = showBits
    ? Math.max(1, ...arr.items.map((v) => toBinary(v)?.length ?? 1))
    : 0;
  const rowH = CELL_H + (showBits ? 18 : 0);
  const ptrRows = pointers.length > 0 ? 22 : 0;
  const width = Math.max(200, arr.items.length * CELL_W + 20);
  const height = TOP + rowH + ptrRows + 24;

  return (
    <div className="overflow-x-auto p-2">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Array ${primary} with ${arr.len} elements`}
      >
        {arr.items.map((v, i) => {
          const x = 10 + i * CELL_W;
          const isChanged = changed.has(i);
          const isSource = sourceIdx === i && !isChanged;
          return (
            <g key={i}>
              <text x={x + CELL_W / 2} y={TOP - 8} textAnchor="middle" fontSize={12} fill="var(--fg-soft)">
                {i}
              </text>
              <rect
                x={x}
                y={TOP}
                width={CELL_W - 4}
                height={CELL_H}
                fill={isChanged ? "var(--cell-changed)" : isSource ? "var(--cell-source)" : "var(--cell)"}
                stroke={isChanged ? "var(--accent)" : isSource ? "var(--accent-2)" : "var(--border)"}
                strokeWidth={isChanged || isSource ? 2.5 : 1}
                strokeDasharray={isSource ? "4 2" : undefined}
              />
              <text
                x={x + (CELL_W - 4) / 2}
                y={TOP + CELL_H / 2 + 4}
                textAnchor="middle"
                fontSize={13}
                fontFamily="monospace"
                fill="var(--fg)"
              >
                {fmtValue(v)}
              </text>
              {showBits && (
                <text
                  x={x + (CELL_W - 4) / 2}
                  y={TOP + CELL_H + 13}
                  textAnchor="middle"
                  fontSize={12}
                  fontFamily="monospace"
                  fill={isChanged ? "var(--accent)" : isSource ? "var(--accent-2)" : "var(--fg-soft)"}
                >
                  {toBinary(v, bitsWidth) ?? ""}
                </text>
              )}
            </g>
          );
        })}
        {pointers.map((p, pi) => {
          const x = 10 + p.index * CELL_W + (CELL_W - 4) / 2;
          const y = TOP + rowH + 4 + (pi % 2) * 10;
          return (
            <g key={p.name}>
              <text x={x} y={y + 12} textAnchor="middle" fontSize={12} fontWeight="bold" fill="var(--accent)">
                ▲ {p.name}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-xs px-2" style={{ color: "var(--fg-soft)" }}>
        {primary}: {arr.source} array, {arr.len} element{arr.len === 1 ? "" : "s"}
        {arr.truncated ? ` (showing first ${arr.items.length})` : ""}
      </p>
    </div>
  );
}

export function ArrayView(props: VizProps) {
  return <ArrayViewBase {...props} />;
}
