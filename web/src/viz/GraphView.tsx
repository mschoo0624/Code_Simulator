import type { Value } from "../types";
import type { VizProps } from "./VizProps";
import { VariablesView } from "./VariablesView";
import { fmtValue, intOf, resolveArray } from "./helpers";

/**
 * Graph view (beta): renders an adjacency list (array of arrays) or adjacency
 * matrix (grid of 0/1) as a circle of nodes with edges.
 */
export function GraphView(props: VizProps) {
  const { step, annotation } = props;
  const arr = resolveArray(step, annotation.primary);
  if (!arr) return <VariablesView {...props} />;

  const rows = arr.items.filter((r): r is Extract<Value, { k: "array" }> => r.k === "array");
  if (rows.length === 0) return <VariablesView {...props} />;

  const n = rows.length;
  const isMatrix = rows.every((r) => r.items.length === n && r.items.every((v) => {
    const iv = intOf(v);
    return iv === 0 || iv === 1;
  }));

  const edges: [number, number][] = [];
  rows.forEach((row, i) => {
    row.items.forEach((v, j) => {
      const iv = intOf(v);
      if (iv === undefined) return;
      if (isMatrix) {
        if (iv === 1 && i < j) edges.push([i, j]);
      } else if (iv >= 0 && iv < n) {
        edges.push([i, iv]);
      }
    });
  });

  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 36;
  const pos = (i: number) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  };

  return (
    <div className="p-2">
      <p className="text-xs px-2 pb-1" style={{ color: "var(--accent-2)" }}>graph view (beta)</p>
      <svg width={size} height={size} role="img" aria-label="Graph">
        {edges.map(([a, b], i) => {
          const pa = pos(a);
          const pb = pos(b);
          return (
            <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="var(--fg-soft)" strokeWidth={1.2} />
          );
        })}
        {rows.map((row, i) => {
          const p = pos(i);
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={16} fill="var(--cell)" stroke="var(--border)" strokeWidth={1.5} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={12} fontFamily="monospace" fill="var(--fg)">
                {i}
              </text>
              {!isMatrix && (
                <text x={p.x} y={p.y + 30} textAnchor="middle" fontSize={10} fill="var(--fg-soft)">
                  {fmtValue(row).slice(0, 14)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
