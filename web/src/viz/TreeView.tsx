import type { Value } from "../types";
import type { VizProps } from "./VizProps";
import { VariablesView } from "./VariablesView";
import { findHead, nodeCursors } from "./nodes";

interface TreeNode {
  addr: string;
  label: string;
  left?: TreeNode;
  right?: TreeNode;
  isRef?: boolean;
}

function labelOf(fields: Record<string, Value>): string {
  for (const key of ["val", "data", "key", "value"]) {
    const v = fields[key];
    if (v && (v.k === "int" || v.k === "float")) return String(v.v);
    if (v && v.k === "char") return `'${v.v}'`;
    if (v && v.k === "str") return v.v;
  }
  return "·";
}

function buildTree(v: Value | undefined, depth = 0): TreeNode | undefined {
  if (!v || depth > 12) return undefined;
  if (v.k === "ref") return { addr: v.addr, label: "↩", isRef: true };
  if (v.k !== "ptr" || !v.target || v.target.k !== "struct") return undefined;
  const f = v.target.fields;
  return {
    addr: v.addr,
    label: labelOf(f),
    left: buildTree(f.left, depth + 1),
    right: buildTree(f.right, depth + 1),
  };
}

interface Placed extends TreeNode {
  x: number;
  y: number;
  leftP?: Placed;
  rightP?: Placed;
}

/** Simple in-order layout: x = in-order position, y = depth. */
function layout(node: TreeNode, depth: number, counter: { n: number }): Placed {
  const leftP = node.left ? layout(node.left, depth + 1, counter) : undefined;
  const x = counter.n++;
  const rightP = node.right ? layout(node.right, depth + 1, counter) : undefined;
  return { ...node, x, y: depth, leftP, rightP };
}

function flatten(p: Placed, into: Placed[]): void {
  into.push(p);
  if (p.leftP) flatten(p.leftP, into);
  if (p.rightP) flatten(p.rightP, into);
}

const R = 17;
const DX = 46;
const DY = 60;

/** Binary tree view (left/right pointers) — beta. */
export function TreeView(props: VizProps) {
  const { step, annotation } = props;
  const head = findHead(step, "left", annotation.primary) ?? findHead(step, "right", annotation.primary);
  const root = head ? buildTree(head.value) : undefined;
  if (!root) return <VariablesView {...props} />;

  const placed = layout(root, 0, { n: 0 });
  const all: Placed[] = [];
  flatten(placed, all);
  const cursors = nodeCursors(step, all.map((n) => n.addr));
  const maxX = Math.max(...all.map((n) => n.x));
  const maxY = Math.max(...all.map((n) => n.y));
  const width = Math.max(240, (maxX + 1) * DX + 40);
  const height = (maxY + 1) * DY + 50;
  const px = (n: Placed) => 20 + n.x * DX + DX / 2;
  const py = (n: Placed) => 30 + n.y * DY;

  return (
    <div className="overflow-auto p-2">
      <p className="text-xs px-2 pb-1" style={{ color: "var(--accent-2)" }}>tree view (beta)</p>
      <svg width={width} height={height} role="img" aria-label="Binary tree">
        {all.map((n) =>
          [n.leftP, n.rightP].map(
            (c, ci) =>
              c && (
                <line
                  key={`${n.addr}-${ci}`}
                  x1={px(n)}
                  y1={py(n)}
                  x2={px(c)}
                  y2={py(c)}
                  stroke="var(--fg-soft)"
                  strokeWidth={1.3}
                />
              ),
          ),
        )}
        {all.map((n) => (
          <g key={n.addr + n.x}>
            <circle
              cx={px(n)}
              cy={py(n)}
              r={R}
              fill={n.isRef ? "var(--cell-source)" : "var(--cell)"}
              stroke={n.isRef ? "var(--accent-2)" : "var(--border)"}
              strokeWidth={1.5}
              strokeDasharray={n.isRef ? "4 2" : undefined}
            />
            <text x={px(n)} y={py(n) + 4} textAnchor="middle" fontSize={12} fontFamily="monospace" fill="var(--fg)">
              {n.label}
            </text>
          </g>
        ))}
        {cursors.map((c) => {
          const n = all.find((a) => a.addr === c.addr);
          if (!n) return null;
          return (
            <text key={c.name} x={px(n)} y={py(n) - R - 5} textAnchor="middle" fontSize={12} fontWeight="bold" fill="var(--accent)">
              {c.name}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
