import { clamp } from "../utils";
import { shrinkToward } from "./shrinkage";

/**
 * How much an UNAUDITED input is allowed to weigh — the one credibility rule
 * shared by every elicitation the engine prices.
 *
 * Everything upstream of the elicitation cards estimates ability from prints,
 * because prints are the only thing the book can audit. The student knows
 * things the tape cannot, and §27 argues at length that refusing to price that
 * is a choice rather than neutrality. But an opinion cannot be allowed to
 * simply assert itself against a fitted model, so every channel that carries
 * one through this function, and every one of them obeys the same three rules:
 *
 * · The weight is a SCORE RATIO, never a preference. Both forecasters are
 *   judged by the same proper rule on the same resolved outcomes, and only the
 *   ratio is read — so a mixed record is still fair, and the weight rises
 *   exactly insofar as the model has been persistently off and the student has
 *   not. That is the whole of "the models are always wrong, so listen to me":
 *   it is a measured claim here, not a mood.
 *
 * · It SHRINKS TOWARD ZERO — the desk's own call — with κ pseudo-outcomes. The
 *   share a record implies is barely identified from the handful of sittings a
 *   student ever calls, so it is approached slowly and never quite reached.
 *
 * · It is CAPPED, strictly, by the caller. A forecast the student can move
 *   further than the tape can is a wish with an interval around it.
 *
 * Exactly the identity on an empty record, which is what keeps every channel
 * built on it invisible to the committed fixture, §21 and the walk-forward gate.
 */

export interface EarnedWeight {
  /** Weight on the student's input, 0 … cap. */
  w: number;
  /** Resolved outcomes both forecasters called. */
  n: number;
  /** Mean proper score of the student's calls (lower is better). */
  youScore: number | null;
  /** The model's mean score on the very same outcomes, under the same rule. */
  modelScore: number | null;
  /** The share the record alone implies, before shrinkage — what was earned. */
  rawShare: number;
}

export const NO_WEIGHT: EarnedWeight = { w: 0, n: 0, youScore: null, modelScore: null, rawShare: 0 };

export interface EarnedOpts {
  /** Pseudo-outcomes pulling the weight toward `toward`. */
  kappa: number;
  /** The most this input may ever weigh. */
  cap: number;
  /**
   * What an unscored record shrinks TO. Zero — the desk's own call — for any
   * channel making a forecast, because a forecaster with no record has earned
   * nothing. A channel reporting a self-assessed STATE rather than a forecast
   * (readiness, §15c) passes a small prior instead: the engine already charges
   * self-reported states the moment they exist, and what the record then buys is
   * the right to be charged more or less than that. Defaults to 0.
   */
  toward?: number;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Fit the weight a record has earned. `youScores[i]` and `modelScores[i]` must
 * be the two forecasters' scores on the SAME outcome under the SAME rule —
 * pairing them is the caller's job, and getting it wrong would compare a
 * student's easy sittings against a model's hard ones, so it throws rather than
 * quietly averaging two different things.
 */
export function earnedWeight(youScores: number[], modelScores: number[], opts: EarnedOpts): EarnedWeight {
  if (youScores.length !== modelScores.length) {
    throw new Error("earnedWeight: scores must be paired outcome-for-outcome");
  }
  const toward = opts.toward ?? 0;
  const n = youScores.length;
  if (!n) return { ...NO_WEIGHT, w: clamp(toward, 0, opts.cap) };

  const youScore = mean(youScores);
  const modelScore = mean(modelScores);
  // A dead heat at zero — both forecasters perfect — is not evidence for either.
  const denom = youScore + modelScore;
  const rawShare = denom > 0 ? modelScore / denom : 0;
  const w = clamp(shrinkToward(rawShare, n, toward, opts.kappa), 0, opts.cap);

  return { w, n, youScore, modelScore, rawShare };
}
