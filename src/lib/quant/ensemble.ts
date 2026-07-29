import { clamp, pDate } from "../utils";
import { detrend } from "./calibration";
import { kalmanFilter } from "./kalman";
import {
  CENSORED_MULT, DRIFT_SATURATION_DAYS, ENSEMBLE_DISPERSION, EWMA_HALF_LIFE_DAYS,
  HORIZON_FALLBACK_DAYS, HORIZON_MAX_DAYS, HORIZON_MIN_DAYS, LOO_WINDOW, PRIOR_VAR,
  reliabilityMult, SIGNAL_WEIGHT,
} from "./params";
import { dampedDrift, mad, median, shrunkSlope, theilSen } from "./robust";
import { shrinkMean, type PoolStats } from "./shrinkage";
import { defaultPrior, nigPredictive, nigUpdate } from "./bayes";
import type { GradeEntry } from "../../types";
import type { QuantPoint } from "./types";
import type { MemberValidation } from "./trace";

/**
 * Four forecasters with orthogonal failure modes, stacked by walk-forward
 * validation: each member is scored on how well it predicted the prints it
 * hadn't seen yet, and the blend weight follows inverse validation error.
 * Below n=3 there is nothing to validate on, so fixed prior weights apply.
 */

export type MemberName = "kalman" | "ewma" | "shrunk" | "trend";

export interface MemberPred {
  name: MemberName;
  mean: number;
  sd: number;
}

export interface EnsembleResult {
  mean: number;
  sd: number;
  /** Student-t df carried into the intervals: 3 + n. */
  df: number;
  /** Blend fractions, all four keys, summing to 1. */
  weights: Record<MemberName, number>;
  members: MemberPred[];
  /** Rating horizon: the desk's median print gap, clamped. */
  horizonDays: number;
  /** The same members re-evaluated at today + horizonDays — the analyst views. */
  forward: MemberPred[];
  /**
   * Walk-forward score behind each weight — null for a member that never got
   * a fold. Kept for the derivation layer; nothing in the engine reads it.
   */
  validation: Partial<Record<MemberName, MemberValidation>>;
  /** True when the tape was too short to validate and the priors applied. */
  fixedWeights: boolean;
}

const MEMBER_NAMES: MemberName[] = ["kalman", "ewma", "shrunk", "trend"];
const FIXED_WEIGHTS: Record<MemberName, number> = { kalman: 0.35, ewma: 0.25, shrunk: 0.3, trend: 0.1 };
const SD_FLOOR = 3;
const MSE_REGULARIZER = 4; // pts² — keeps any member from taking infinite weight

/** Recency- and type-weighted mean, decaying from `nowX` (defaults to the last x). */
export function ewma(
  pts: QuantPoint[],
  halfLifeDays: number = EWMA_HALF_LIFE_DAYS,
  nowX?: number,
): { mean: number; sd: number } | null {
  if (!pts.length) return null;
  const ref = nowX ?? Math.max(...pts.map((p) => p.x));
  let sw = 0, swy = 0;
  const ws = pts.map((p) => Math.pow(2, -(ref - p.x) / halfLifeDays) * SIGNAL_WEIGHT[p.type]);
  for (let i = 0; i < pts.length; i++) { sw += ws[i]; swy += ws[i] * pts[i].y; }
  /* A print dated far enough back drives 2^-(Δ/halfLife) to exactly 0 in double
     precision — a mistyped year like 0202 is enough. Every weight underflowing
     makes this 0/0, and the NaN propagates through the mark, the factors and
     the drift detector until the whole desk reads NaN. An unweighted mean is a
     defensible answer for a tape that old; a NaN never is. */
  if (!(sw > 0)) {
    const mean = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const sv = pts.reduce((a, p) => a + (p.y - mean) * (p.y - mean), 0) / pts.length;
    return { mean, sd: Math.max(SD_FLOOR, Math.sqrt(sv)) };
  }
  const mean = swy / sw;
  let sv = 0;
  for (let i = 0; i < pts.length; i++) sv += ws[i] * (pts[i].y - mean) * (pts[i].y - mean);
  return { mean, sd: Math.max(SD_FLOOR, Math.sqrt(sv / sw)) };
}

const dayX = (first: string, date: string): number =>
  Math.round((pDate(date).getTime() - pDate(first).getTime()) / 86400000);

/** One member's forecast at targetX given only the points before it. */
function memberForecast(
  name: MemberName,
  past: QuantPoint[],
  targetX: number,
  pool: PoolStats | null,
): MemberPred | null {
  if (!past.length) return null;
  switch (name) {
    case "kalman": {
      const r = kalmanFilter(past, { priorMean: pool?.grandMean, priorVar: PRIOR_VAR });
      if (!r) return null;
      const ahead = r.predictAhead(Math.max(0, targetX - past[past.length - 1].x));
      return { name, mean: ahead.mean, sd: Math.max(SD_FLOOR, Math.sqrt(ahead.var)) };
    }
    case "ewma": {
      const r = ewma(past, EWMA_HALF_LIFE_DAYS, targetX);
      return r ? { name, mean: r.mean, sd: r.sd } : null;
    }
    case "shrunk": {
      const ys = past.map((p) => p.y);
      const r = shrinkMean(ys, pool);
      if (!r) return null;
      const scale = nigPredictive(nigUpdate(defaultPrior(pool), ys)).scale;
      return { name, mean: r.mean, sd: Math.max(SD_FLOOR, scale) };
    }
    case "trend": {
      const ts = theilSen(past);
      if (!ts) return null;
      // Re-anchor the intercept on the gated slope: with slope 0 this member
      // degrades to the running median — the safe no-correlation behaviour.
      const s = shrunkSlope(ts);
      const intercept = median(past.map((p) => p.y - s * p.x))!;
      const resid = past.map((p) => p.y - (intercept + s * p.x));
      // Ride the fitted line to the last print, then let the drift SATURATE
      // instead of extrapolating the slope straight out — a slope that fit a
      // hot streak must not pay out forever. One-step-ahead is barely touched;
      // a full horizon out the drift is capped (see robust.dampedDrift).
      const lastX = past[past.length - 1].x;
      const mean = intercept + s * lastX + dampedDrift(s, targetX - lastX, DRIFT_SATURATION_DAYS);
      return { name, mean, sd: Math.max(SD_FLOOR, 1.25 * mad(resid)) };
    }
  }
}

export function ensemble(
  entries: GradeEntry[],
  pool: PoolStats | null,
  todayIso: string,
  opts?: { members?: ReadonlySet<MemberName> },
): EnsembleResult | null {
  if (!entries.length) return null;
  /* Ablation seam. `active` restricts which members forecast and are scored;
     the default is all four in their canonical order, so the default path is
     byte-identical to before this argument existed (the 512-test lock holds). */
  const active: readonly MemberName[] = opts?.members
    ? MEMBER_NAMES.filter((m) => opts.members!.has(m))
    : MEMBER_NAMES;
  if (!active.length) return null;
  const sortedAll = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  /* Regime break: a print flagged as a structural change (new teacher, set,
     syllabus or cohort) is the first of a new regime — the process behind the
     older prints is gone. Fit only from the most recent break onward, so the
     level re-anchors and the shorter tape widens the band (df = 3 + n). No flag
     anywhere ⇒ breakAt stays 0 ⇒ the whole tape, byte-identical to before. */
  let breakAt = 0;
  for (let i = 0; i < sortedAll.length; i++) if (sortedAll[i].regimeBreak) breakAt = i;
  const sorted = breakAt > 0 ? sortedAll.slice(breakAt) : sortedAll;
  const adjusted = detrend(sorted);
  const first = sorted[0].date;
  const pts: QuantPoint[] = adjusted.map(({ entry, adjusted: y }) => ({
    x: dayX(first, entry.date),
    y,
    type: entry.type,
    // A censored (boundary) reading widens its own measurement noise on top of
    // the reliability tag — it bounds ability rather than measuring it.
    rMult: reliabilityMult(entry.reliability) * (entry.censored ? CENSORED_MULT : 1),
  }));
  const n = pts.length;
  const xToday = Math.max(dayX(first, todayIso), pts[n - 1].x);

  // Score each member on walk-forward one-step-ahead errors.
  const weights: Record<MemberName, number> = { kalman: 0, ewma: 0, shrunk: 0, trend: 0 };
  const validation: Partial<Record<MemberName, MemberValidation>> = {};
  if (n >= 3) {
    const start = Math.max(1, n - LOO_WINDOW);
    const sse: Record<MemberName, number> = { kalman: 0, ewma: 0, shrunk: 0, trend: 0 };
    const cnt: Record<MemberName, number> = { kalman: 0, ewma: 0, shrunk: 0, trend: 0 };
    // Gather every member's one-step-ahead forecast per fold first, then score
    // only the folds where ALL members answered. Scoring each member on the
    // folds it happened to manage compared MSEs over DIFFERENT fold sets — the
    // trend member, which needs three points to fit, skipped the hard early
    // folds and so posted an unfairly low MSE and stole the weights. One common
    // fold set makes the comparison honest.
    const folds: { y: number; preds: Record<MemberName, number | null> }[] = [];
    for (let i = start; i < n; i++) {
      const past = pts.slice(0, i);
      const preds: Record<MemberName, number | null> = { kalman: null, ewma: null, shrunk: null, trend: null };
      for (const name of active) {
        const f = memberForecast(name, past, pts[i].x, pool);
        if (f) preds[name] = f.mean;
      }
      folds.push({ y: pts[i].y, preds });
    }
    const common = folds.filter((fold) => active.every((name) => fold.preds[name] != null));
    // Fall back to per-member folds only if no fold has the whole panel (a
    // member that never fits over the window), so weights still form.
    const scored = common.length ? common : folds;
    for (const fold of scored) {
      for (const name of active) {
        const p = fold.preds[name];
        if (p == null) continue;
        const err = p - fold.y;
        sse[name] += err * err;
        cnt[name]++;
      }
    }
    for (const name of active) {
      if (cnt[name] > 0) {
        validation[name] = { mse: sse[name] / cnt[name], folds: cnt[name] };
        weights[name] = 1 / (sse[name] / cnt[name] + MSE_REGULARIZER);
      }
    }
  }

  // Full-data member forecasts at today.
  const members = active
    .map((name) => memberForecast(name, pts, xToday, pool))
    .filter((m): m is MemberPred => m != null);
  if (!members.length) return null;

  // …and again one horizon out, where only the τ-gated trend may extrapolate
  // and the Kalman widens itself: the members disagree on their own terms.
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) gaps.push(pts[i].x - pts[i - 1].x);
  const horizonDays = Math.round(
    clamp(gaps.length ? median(gaps)! : HORIZON_FALLBACK_DAYS, HORIZON_MIN_DAYS, HORIZON_MAX_DAYS),
  );
  const forward = active
    .map((name) => memberForecast(name, pts, xToday + horizonDays, pool))
    .filter((m): m is MemberPred => m != null);
  const available = new Set(members.map((m) => m.name));

  let total = 0;
  for (const name of MEMBER_NAMES) {
    if (!available.has(name)) weights[name] = 0;
    total += weights[name];
  }
  const fixedWeights = total <= 0;
  if (fixedWeights) {
    for (const name of MEMBER_NAMES) weights[name] = available.has(name) ? FIXED_WEIGHTS[name] : 0;
    total = MEMBER_NAMES.reduce((a, nm) => a + weights[nm], 0);
  }
  for (const name of MEMBER_NAMES) weights[name] /= total;

  let mean = 0;
  for (const m of members) mean += weights[m.name] * m.mean;
  // Mixture moment-matching: blended variance carries member disagreement.
  let variance = 0;
  for (const m of members) variance += weights[m.name] * (m.sd * m.sd + (m.mean - mean) * (m.mean - mean));
  // …then the dispersion markup: the mixture omits the members' own estimation
  // uncertainty and runs too tight out-of-sample, so honest bands widen it by a
  // CRPS-tuned factor (params.ENSEMBLE_DISPERSION). df is left alone — the tail
  // shape is the NIG posterior's job; this only rescales the width.
  const sd = Math.sqrt(variance) * ENSEMBLE_DISPERSION;

  return {
    mean, sd, df: 3 + n, weights, members, horizonDays, forward,
    validation, fixedWeights,
  };
}
