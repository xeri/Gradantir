import { HUBER_C, PRIOR_MEAN_FALLBACK, PRIOR_VAR, Q_PER_DAY, RELIABILITY_SD } from "./params";
import type { QuantPoint } from "./types";

/**
 * Local-level Gaussian state-space filter: true ability follows a random walk
 * (variance Q_PER_DAY per elapsed day), each print observes it with per-type
 * noise. Handles irregular spacing natively and produces an honest posterior
 * from a single observation — the small-n workhorse.
 */

export interface KalmanState {
  mean: number;
  var: number;
}

export interface KalmanOptions {
  priorMean?: number;
  priorVar?: number;
  qPerDay?: number;
  obsVar?: (p: QuantPoint) => number;
  /** Huber knee in innovation σ; ∞ recovers the pure Gaussian filter. */
  robustC?: number;
}

export interface KalmanResult {
  /** Filtered ability after the final observation. */
  last: KalmanState;
  /** One state per observation, after its update. */
  states: KalmanState[];
  /** Extrapolate: mean unchanged, variance grows with the horizon. */
  predictAhead(days: number): KalmanState;
}

/** Observation variance: per-type reliability sd, scaled by the per-datum tag. */
const defaultObsVar = (p: QuantPoint) => {
  const sd = RELIABILITY_SD[p.type] * (p.rMult ?? 1);
  return sd * sd;
};

export function kalmanFilter(pts: QuantPoint[], opts: KalmanOptions = {}): KalmanResult | null {
  if (!pts.length) return null;
  const q = opts.qPerDay ?? Q_PER_DAY;
  const obsVar = opts.obsVar ?? defaultObsVar;
  const c = opts.robustC ?? HUBER_C;
  let mean = opts.priorMean ?? PRIOR_MEAN_FALLBACK;
  let variance = opts.priorVar ?? PRIOR_VAR;
  const states: KalmanState[] = [];
  let prevX = pts[0].x; // the prior is timeless — no drift before the first print
  for (const p of pts) {
    variance += q * Math.max(0, p.x - prevX);
    const R = obsVar(p);
    /* Robust observation noise, applied ONLY to prints flagged uncertain by
       their reliability tag (rMult > 1). A shockingly-low OFFICIAL mark is
       almost certainly real and is written straight into the level; a shocking
       REMEMBERED or ESTIMATED one might be a measurement error, so past the
       Huber knee its observation variance is inflated in proportion to the
       standardized surprise — the gain shrinks, the outlier moves the level
       less, and more uncertainty is left behind it. This composes the two
       reliability roles: the tag both scales R and licenses down-weighting. */
    const z = Math.abs(p.y - mean) / Math.sqrt(variance + R);
    const uncertain = (p.rMult ?? 1) > 1;
    const Reff = uncertain && z > c ? R * (z / c) : R;
    const K = variance / (variance + Reff);
    mean += K * (p.y - mean);
    variance *= 1 - K;
    states.push({ mean, var: variance });
    prevX = p.x;
  }
  const last = states[states.length - 1];
  return {
    last,
    states,
    predictAhead: (days: number) => ({ mean: last.mean, var: last.var + q * Math.max(0, days) }),
  };
}
