import type { Annotation, Step, Trace } from "../types";

/** Props every renderer receives. `solution` is passed for the source-cell
 *  heuristic in BitsArrayView (documented deviation from the base props). */
export interface VizProps {
  step: Step;
  prevStep?: Step;
  annotation: Annotation;
  trace: Trace;
  solution: string;
}
