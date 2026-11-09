import type { VizProps } from "./VizProps";
import { fmtValue, shortHex } from "./helpers";

/** Table of locals; changed values highlighted; pointers as short hex + type. */
export function VariablesView({ step }: VizProps) {
  const entries = Object.entries(step.locals);
  if (entries.length === 0) {
    return <p className="p-4" style={{ color: "var(--fg-soft)" }}>No visible variables yet.</p>;
  }
  return (
    <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ color: "var(--fg-soft)" }}>
          <th className="px-3 py-1 border-b" style={{ borderColor: "var(--border)" }}>name</th>
          <th className="px-3 py-1 border-b" style={{ borderColor: "var(--border)" }}>value</th>
          <th className="px-3 py-1 border-b" style={{ borderColor: "var(--border)" }}>type</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([name, v]) => {
          const changed = step.changed.includes(name);
          const type =
            "t" in v && typeof v.t === "string" ? v.t : v.k;
          return (
            <tr
              key={name}
              style={{
                background: changed ? "var(--cell-changed)" : undefined,
                borderLeft: changed ? "3px solid var(--accent)" : "3px solid transparent",
              }}
            >
              <td className="px-3 py-1 font-mono">{name}{changed ? " *" : ""}</td>
              <td className="px-3 py-1 font-mono">
                {v.k === "ptr" ? `${shortHex(v.addr)}${v.target ? ` → ${fmtValue(v.target)}` : ""}` : fmtValue(v)}
              </td>
              <td className="px-3 py-1 font-mono" style={{ color: "var(--fg-soft)" }}>{type}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
