import type { AssessmentType } from "../../types";

/** One observation on the engine's time axis: x = days since first print. */
export interface QuantPoint {
  x: number;
  y: number;
  type: AssessmentType;
  /** Reliability multiplier on the observation-noise sd (default 1 = official). */
  rMult?: number;
}
