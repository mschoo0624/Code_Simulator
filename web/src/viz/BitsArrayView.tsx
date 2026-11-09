import { sourceIndex } from "../sourceIndex";
import type { VizProps } from "./VizProps";
import { ArrayViewBase } from "./ArrayView";

/**
 * ArrayView plus binary strings; highlights the written cell (accent) and the
 * "source" cell the current line reads from the same array (second color).
 * The source is resolved by parsing the current source line for
 * `primary[...]` and evaluating simple index expressions — see sourceIndex.ts
 * for the supported forms; anything fancier falls back to no highlight.
 */
export function BitsArrayView(props: VizProps) {
  const { step, prevStep, annotation, solution } = props;
  const primary = annotation.primary;
  const written = (step.changedIndices[primary] ?? [])[0];
  // GDB stops BEFORE executing a line, so a write observed at this step was
  // produced by the PREVIOUS step's line — parse that line for the source.
  const lineNo = written !== undefined && prevStep ? prevStep.line : step.line;
  const lineText = solution.split("\n")[lineNo - 1] ?? "";
  let srcIdx = sourceIndex(lineText, primary, step, written);
  if (srcIdx === undefined && prevStep) {
    // index vars may have left scope at this stop; try the previous locals
    srcIdx = sourceIndex(lineText, primary, prevStep, written);
  }
  return <ArrayViewBase {...props} showBits sourceIdx={srcIdx} />;
}
