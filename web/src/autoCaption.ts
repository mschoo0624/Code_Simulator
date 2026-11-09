import type { Step } from "./types";
import { fmtValue } from "./viz/helpers";

/** Client-side auto captions, shown before/without LLM captions. */
export function autoCaption(step: Step): string {
  if (step.event === "exception") {
    return `Program crashed with ${step.error ?? "a signal"} at line ${step.line}.`;
  }
  if (step.event === "call") {
    return `Line ${step.line}: entering ${step.func}.`;
  }
  if (step.event === "return") {
    const rv = step.returnValue ? ` with ${fmtValue(step.returnValue)}` : "";
    return `Line ${step.line}: returning from ${step.func}${rv}.`;
  }
  if (step.changed.length > 0) {
    const parts = step.changed
      .slice(0, 3)
      .map((name) => `${name} = ${fmtValue(step.locals[name])}`)
      .join(", ");
    return `Line ${step.line}: ${parts}`.slice(0, 140);
  }
  return `Line ${step.line} in ${step.func}.`;
}
