import { pDate, round1 } from "../utils";
import { detrend } from "./calibration";
import { ewma } from "./ensemble";
import { CUSUM_H, CUSUM_K, CUSUM_Z_CAP, EWMA_HALF_LIFE_DAYS, RELIABILITY_SD } from "./params";
import { mad } from "./robust";
import type { GradeEntry } from "../../types";
import type { QuantPoint } from "./types";

/**
 * The drift detector: a one-sided downward Page CUSUM over standardized
 * walk-forward residuals. A slope answers "how fast is the tape falling?";
 * this answers "has it been printing under its own forecast for long enough
 * that the misses stopped being noise?" — which fires earlier on a slow bleed
 * and never on a whipsaw, because upside residuals drain the statistic.
 *
 * Each print is scored against the EWMA level fitted to everything before it,
 * standardized by the forecaster's own trailing miss spread (floored by the
 * print type's reliability), and winsorized per step: one crash print is an
 * earnings shock, not drift — it takes a second bad print to alarm.
 */

export interface CusumResult {
  /** Current statistic, in allowance-adjusted z units. ≥ 0. */
  stat: number;
  /** stat ≥ CUSUM_H: the desk has been bleeding beyond noise. */
  alarm: boolean;
  /** Highest the statistic ever got on this tape. */
  peak: number;
}

/** Null below n=4 — three prints seed the first forecast, one more scores it. */
export function cusumDrift(entries: GradeEntry[]): CusumResult | null {
  if (entries.length < 4) return null;
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const first = sorted[0].date;
  const pts: QuantPoint[] = detrend(sorted).map(({ entry, adjusted }) => ({
    x: Math.round((pDate(entry.date).getTime() - pDate(first).getTime()) / 86400000),
    y: adjusted,
    type: entry.type,
  }));

  const resids: number[] = [];
  let S = 0;
  let peak = 0;
  for (let i = 3; i < pts.length; i++) {
    const f = ewma(pts.slice(0, i), EWMA_HALF_LIFE_DAYS, pts[i].x);
    if (!f) continue;
    const resid = pts[i].y - f.mean;
    const scale = Math.max(mad(resids), RELIABILITY_SD[pts[i].type]);
    resids.push(resid);
    const z = Math.max(-CUSUM_Z_CAP, Math.min(CUSUM_Z_CAP, resid / scale));
    S = Math.max(0, S - z - CUSUM_K);
    if (S > peak) peak = S;
  }
  return { stat: round1(S), alarm: S >= CUSUM_H, peak: round1(peak) };
}
