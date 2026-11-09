import type { VizProps } from "./VizProps";
import { VariablesView } from "./VariablesView";
import { findHead, nodeCursors, walkList } from "./nodes";
import { shortHex } from "./helpers";

const BOX_W = 64;
const BOX_H = 40;
const GAP = 36;

/** Boxes with value + next arrows; ref arrows for cycles; cursor labels. */
export function LinkedListView(props: VizProps) {
  const { step, annotation } = props;
  const head = findHead(step, "next", annotation.primary);
  if (!head) return <VariablesView {...props} />;

  const { nodes, cycleTo } = walkList(head.value, "next");
  if (nodes.length === 0) return <VariablesView {...props} />;

  const cursors = nodeCursors(step, nodes.map((n) => n.addr));
  const width = Math.max(240, nodes.length * (BOX_W + GAP) + 40);
  const height = 150;
  const xOf = (i: number) => 20 + i * (BOX_W + GAP);
  const cycleIdx = cycleTo ? nodes.findIndex((n) => n.addr === cycleTo) : -1;

  return (
    <div className="overflow-x-auto p-2">
      <svg width={width} height={height} role="img" aria-label="Linked list">
        <defs>
          <marker id="ll-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--fg-soft)" />
          </marker>
        </defs>
        {nodes.map((n, i) => (
          <g key={n.addr + i}>
            <rect x={xOf(i)} y={50} width={BOX_W} height={BOX_H} fill="var(--cell)" stroke="var(--border)" strokeWidth={1.5} />
            <text x={xOf(i) + BOX_W / 2} y={50 + BOX_H / 2 + 4} textAnchor="middle" fontSize={13} fontFamily="monospace" fill="var(--fg)">
              {n.label}
            </text>
            <text x={xOf(i) + BOX_W / 2} y={50 + BOX_H + 14} textAnchor="middle" fontSize={11} fontFamily="monospace" fill="var(--fg-soft)">
              {shortHex(n.addr)}
            </text>
            {i < nodes.length - 1 && (
              <line
                x1={xOf(i) + BOX_W}
                y1={50 + BOX_H / 2}
                x2={xOf(i + 1) - 4}
                y2={50 + BOX_H / 2}
                stroke="var(--fg-soft)"
                strokeWidth={1.5}
                markerEnd="url(#ll-arrow)"
              />
            )}
          </g>
        ))}
        {cycleIdx >= 0 && (
          <path
            d={`M ${xOf(nodes.length - 1) + BOX_W / 2} ${50 + BOX_H}
                C ${xOf(nodes.length - 1) + BOX_W / 2} ${50 + BOX_H + 40},
                  ${xOf(cycleIdx) + BOX_W / 2} ${50 + BOX_H + 40},
                  ${xOf(cycleIdx) + BOX_W / 2} ${50 + BOX_H + 24}`}
            fill="none"
            stroke="var(--accent-2)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            markerEnd="url(#ll-arrow)"
          />
        )}
        {cycleTo && cycleIdx < 0 && (
          <text x={xOf(nodes.length - 1) + BOX_W + 6} y={50 + BOX_H / 2 + 4} fontSize={12} fill="var(--accent-2)">
            ↩ cycle
          </text>
        )}
        {cursors.map((c, ci) => {
          const i = nodes.findIndex((n) => n.addr === c.addr);
          return (
            <text
              key={c.name}
              x={xOf(i) + BOX_W / 2}
              y={36 - (ci % 2) * 14}
              textAnchor="middle"
              fontSize={12}
              fontWeight="bold"
              fill="var(--accent)"
            >
              {c.name} ▼
            </text>
          );
        })}
      </svg>
    </div>
  );
}
