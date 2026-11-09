import type { Value } from "../types";
import type { VizProps } from "./VizProps";
import { VariablesView } from "./VariablesView";
import { fmtValue, resolveArray } from "./helpers";

const CELL = 42;

/** 2D view for arrays of arrays (grids, DP tables, matrices). */
export function GridView(props: VizProps) {
  const { step, annotation } = props;
  const arr = resolveArray(step, annotation.primary);
  const rows = arr?.items.filter((r): r is Extract<Value, { k: "array" }> => r.k === "array");
  if (!arr || !rows || rows.length === 0) return <VariablesView {...props} />;

  const cols = Math.max(...rows.map((r) => r.items.length));
  const changedRows = new Set(step.changedIndices[annotation.primary] ?? []);
  const width = cols * CELL + 50;
  const height = rows.length * CELL + 40;

  return (
    <div className="overflow-auto p-2">
      <svg width={width} height={height} role="img" aria-label={`Grid ${annotation.primary}`}>
        {rows[0].items.map((_, c) => (
          <text key={c} x={46 + c * CELL + CELL / 2} y={16} textAnchor="middle" fontSize={12} fill="var(--fg-soft)">
            {c}
          </text>
        ))}
        {rows.map((row, r) => (
          <g key={r}>
            <text x={20} y={24 + r * CELL + CELL / 2 + 4} textAnchor="middle" fontSize={12} fill="var(--fg-soft)">
              {r}
            </text>
            {row.items.map((v, c) => (
              <g key={c}>
                <rect
                  x={46 + c * CELL}
                  y={24 + r * CELL}
                  width={CELL - 3}
                  height={CELL - 3}
                  fill={changedRows.has(r) ? "var(--cell-changed)" : "var(--cell)"}
                  stroke={changedRows.has(r) ? "var(--accent)" : "var(--border)"}
                  strokeWidth={changedRows.has(r) ? 2 : 1}
                />
                <text
                  x={46 + c * CELL + (CELL - 3) / 2}
                  y={24 + r * CELL + (CELL - 3) / 2 + 4}
                  textAnchor="middle"
                  fontSize={12}
                  fontFamily="monospace"
                  fill="var(--fg)"
                >
                  {fmtValue(v)}
                </text>
              </g>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
