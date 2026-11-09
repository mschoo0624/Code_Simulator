/**
 * Source-cell heuristic for BitsArrayView: parse the current source line for
 * `primary[...]` expressions and evaluate simple index expressions against the
 * step locals. Supported: a bare variable, var/const, var>>const, var<<const,
 * var-const, var+const, var&const, var%const, and integer constants.
 * Anything else returns undefined (no source highlight). See README
 * "Known limitations".
 */
import type { Step } from "./types";
import { intOf } from "./viz/helpers";

export function evalIndexExpr(expr: string, step: Step): number | undefined {
  const s = expr.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const mVar = /^[A-Za-z_]\w*$/.exec(s);
  if (mVar) return intOf(step.locals[s]);
  const mBin = /^([A-Za-z_]\w*)\s*(>>|<<|[-+/&%])\s*(\d+)$/.exec(s);
  if (!mBin) return undefined;
  const left = intOf(step.locals[mBin[1]]);
  const right = parseInt(mBin[3], 10);
  if (left === undefined) return undefined;
  switch (mBin[2]) {
    case ">>": return left >> right;
    case "<<": return left << right;
    case "-": return left - right;
    case "+": return left + right;
    case "/": return right === 0 ? undefined : Math.trunc(left / right);
    case "&": return left & right;
    case "%": return right === 0 ? undefined : left % right;
    default: return undefined;
  }
}

/** All indices of `primary[...]` on the line that evaluate successfully. */
export function indicesOnLine(
  lineText: string,
  primary: string,
  step: Step,
): number[] {
  const re = new RegExp(`${escapeRe(primary)}\\s*\\[([^\\][]+)\\]`, "g");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(lineText)) !== null) {
    const idx = evalIndexExpr(m[1], step);
    if (idx !== undefined) out.push(idx);
  }
  return out;
}

/**
 * The "source" cell: an index read on the current line that is not the
 * written index. For `dp[i] = (i & 1) + dp[i / 2];` with i=6 this is 3.
 */
export function sourceIndex(
  lineText: string,
  primary: string,
  step: Step,
  writtenIndex: number | undefined,
): number | undefined {
  const idxs = indicesOnLine(lineText, primary, step);
  return idxs.find((i) => i !== writtenIndex);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
