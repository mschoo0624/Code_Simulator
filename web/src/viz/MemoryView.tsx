import type { Value } from "../types";
import type { VizProps } from "./VizProps";
import { fmtValue, shortHex } from "./helpers";

interface HeapBlock {
  addr: string;
  size: number;
  live: boolean;
  preview?: string;
}

function collectBlocks(locals: Record<string, Value>): Map<string, HeapBlock> {
  const blocks = new Map<string, HeapBlock>();
  const visit = (v: Value): void => {
    if (v.k === "ptr") {
      if (v.alloc) {
        const addr = v.base ?? v.addr;
        if (!blocks.has(addr)) {
          blocks.set(addr, {
            addr,
            size: v.alloc.size,
            live: v.alloc.live,
            preview: v.target ? fmtValue(v.target) : undefined,
          });
        }
      }
      if (v.target) visit(v.target);
    } else if (v.k === "array") {
      v.items.forEach(visit);
    } else if (v.k === "struct") {
      Object.values(v.fields).forEach(visit);
    }
  };
  Object.values(locals).forEach(visit);
  return blocks;
}

const ROW = 26;

/** Stack frame (left) + heap blocks (right) with pointer arrows. */
export function MemoryView(props: VizProps) {
  const { step, trace } = props;
  const entries = Object.entries(step.locals);
  const blocks = [...collectBlocks(step.locals).values()];
  const isLast = step.idx === trace.steps.length - 1;
  const leaks = isLast ? (trace.leaks ?? []) : [];

  const stackH = Math.max(1, entries.length) * ROW + 40;
  const heapH = Math.max(1, blocks.length) * (ROW * 2 + 14) + 40;
  const height = Math.max(stackH, heapH, 140) + leaks.length * 20 + 20;
  const width = 560;
  const heapX = 300;

  const blockY = (i: number) => 40 + i * (ROW * 2 + 14);
  const varY = (i: number) => 40 + i * ROW;

  return (
    <div className="overflow-auto p-2">
      <svg width={width} height={height} role="img" aria-label="Stack and heap memory">
        {/* stack column */}
        <text x={20} y={22} fontSize={12} fontWeight="bold" fill="var(--fg-soft)">
          STACK — {step.func}()
        </text>
        <rect x={16} y={28} width={220} height={entries.length * ROW + 12} fill="none" stroke="var(--border)" />
        {entries.map(([name, v], i) => (
          <g key={name}>
            <text x={24} y={varY(i) + 16} fontSize={12} fontFamily="monospace" fill="var(--fg)">
              {name} = {v.k === "ptr" ? shortHex(v.addr) : fmtValue(v).slice(0, 18)}
            </text>
          </g>
        ))}

        {/* heap column */}
        <text x={heapX} y={22} fontSize={12} fontWeight="bold" fill="var(--fg-soft)">
          HEAP
        </text>
        {blocks.length === 0 && (
          <text x={heapX} y={50} fontSize={12} fill="var(--fg-soft)">
            (no reachable heap blocks)
          </text>
        )}
        {blocks.map((b, i) => (
          <g key={b.addr} opacity={b.live ? 1 : 0.45}>
            <rect
              x={heapX}
              y={blockY(i)}
              width={230}
              height={ROW * 2}
              fill={b.live ? "var(--cell)" : "var(--freed)"}
              stroke={b.live ? "var(--border)" : "var(--fg-soft)"}
              strokeDasharray={b.live ? undefined : "5 3"}
            />
            <text x={heapX + 8} y={blockY(i) + 17} fontSize={11} fontFamily="monospace" fill="var(--fg)">
              {shortHex(b.addr)} · {b.size} bytes{b.live ? "" : " · freed"}
            </text>
            {b.preview && (
              <text x={heapX + 8} y={blockY(i) + 37} fontSize={11} fontFamily="monospace" fill="var(--fg-soft)">
                {b.preview.slice(0, 30)}
              </text>
            )}
          </g>
        ))}

        {/* pointer arrows: stack var -> heap block */}
        <defs>
          <marker id="mem-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--accent)" />
          </marker>
        </defs>
        {entries.map(([name, v], i) => {
          if (v.k !== "ptr" || !v.alloc) return null;
          const bi = blocks.findIndex((b) => b.addr === (v.base ?? v.addr));
          if (bi < 0) return null;
          return (
            <path
              key={`arrow-${name}`}
              d={`M 236 ${varY(i) + 12} C 268 ${varY(i) + 12}, 268 ${blockY(bi) + ROW}, ${heapX - 4} ${blockY(bi) + ROW}`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.5}
              markerEnd="url(#mem-arrow)"
            />
          );
        })}

        {/* leaked blocks at the final step */}
        {leaks.length > 0 && (
          <g>
            <text
              x={20}
              y={Math.max(stackH, heapH) + 14}
              fontSize={12}
              fontWeight="bold"
              fill="var(--error)"
            >
              LEAKED at exit:
            </text>
            {leaks.map((l, i) => (
              <text
                key={l.addr}
                x={130}
                y={Math.max(stackH, heapH) + 14 + i * 18}
                fontSize={12}
                fontFamily="monospace"
                fill="var(--error)"
              >
                {shortHex(l.addr)} ({l.size} bytes)
              </text>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
