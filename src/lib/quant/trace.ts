/**
 * Engine traces — the intermediates, kept instead of discarded.
 *
 * The pricing modules compute a great deal on the way to a number and then
 * return only the number: `ensemble` scores four members by walk-forward MSE
 * and reports rounded percentages, `markDesk` builds a full factor panel and
 * reports eleven rounded line items. That is the right API for the interface,
 * and the wrong one for explaining itself.
 *
 * So every result now carries the working. Nothing here is recomputed — these
 * are references to values the engine already produced — and every field is
 * optional, so a caller that does not care never notices. The derivation layer
 * (src/lib/derive) is the only consumer.
 */

import type { PremiumLine } from "../../types";
import type { CusumResult } from "./cusum";
import type { EffortPressure } from "./effort";
import type { ReadinessPressure } from "./readiness";
import type { BookContext, DeskFactors } from "./factors";
import type { ExamOffset } from "./calibration";
import type { OracleResult } from "./oracle";
import type { PoolStats } from "./shrinkage";

/** How one ensemble member scored in walk-forward validation. */
export interface MemberValidation {
  /** Mean squared one-step-ahead error over the folds, pts². */
  mse: number;
  /** Prints it was scored against. */
  folds: number;
}

export interface MemberTrace {
  name: string;
  /** The member's own estimate today, before the blend. */
  mean: number;
  sd: number;
  /** Null when the tape was too short to validate on. */
  validation: MemberValidation | null;
  /** Normalized blend weight, 0–1. */
  weight: number;
}

/** Difficulty detrending's own parameters, for §2 of the paper. */
export interface DetrendTrace {
  /** λ = m/(m+2). */
  lambda: number;
  /** Prints carrying a class or year-level reference. */
  refCount: number;
  /** ρ̄ — the desk's usual reference level. */
  meanRef: number | null;
}

/** Everything behind FAIR VALUE. */
export interface PriceTrace {
  n: number;
  members: MemberTrace[];
  /** True when n < 3 and the fixed prior weights applied instead. */
  fixedWeights: boolean;
  /** Unrounded blend, before clipping to [0,100]. */
  mean: number;
  sd: number;
  df: number;
  pool: PoolStats | null;
  offset: ExamOffset;
  /** The two sides the next-exam forecast was blended from. */
  oracle: OracleResult | null;
  detrend: DetrendTrace;
  horizonDays: number;
}

/** Everything behind the MARK. */
export interface MarkTrace {
  factors: DeskFactors;
  book: BookContext;
  cusum: CusumResult | null;
  staleDays: number | null;
  examAgeDays: number | null;
  printsSinceExam: number;
  /** The desk's fair-share effort read, or null when no budget is priced in. */
  effort: EffortPressure | null;
  /** The desk's readiness log-strength, or null when no duel pile is priced in. */
  readiness: ReadinessPressure | null;
  /** The premium lines before credibility, saturation and attribution. */
  raw: PremiumLine[];
  /** Σ πⱼ, signed — credits can pull it under the floor. */
  rawSum: number;
  /** max(0, Σ πⱼ). */
  floored: number;
  /** Bühlmann credibility n/(n+κ). */
  cred: number;
  /** The per-line attribution scale, 𝒟 / Σ πⱼ. */
  shrink: number;
  /** Horizon in units of 30 days — what the flow premia are charged over. */
  H: number;
}

/** Attached to PriceResult; both halves are filled by their own pass. */
export interface QuantTrace {
  price: PriceTrace;
  mark?: MarkTrace;
}
