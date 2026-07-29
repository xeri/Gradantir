import { clamp, round1 } from "./utils";
import type { Forecast, GradeEntry, VolatilityLabel } from "../types";

export interface RegressionResult {
  slope: number;
  intercept: number;
  /** Residual standard deviation. */
  sigma: number;
}

export function linreg(pts: { x: number; y: number }[]): RegressionResult {
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const den = n * sxx - sx * sx;
  const slope = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  // n === 0 would make the intercept NaN (0/0) and poison every downstream sum;
  // an empty regression has no line, so both coefficients are simply zero.
  const intercept = n > 0 ? (sy - slope * sx) / n : 0;
  let se = 0;
  for (const p of pts) { const r = p.y - (slope * p.x + intercept); se += r * r; }
  const sigma = Math.sqrt(se / Math.max(1, n - 2));
  return { slope, intercept, sigma };
}

/** Trend line over a subject's last 10 results → estimate for the next one. */
export function subjectForecast(sorted: Pick<GradeEntry, "score">[]): Forecast | null {
  if (sorted.length < 3) return null;
  const recent = sorted.slice(-10);
  const pts = recent.map((e, i) => ({ x: i, y: e.score }));
  const { slope, intercept, sigma } = linreg(pts);
  const pred = clamp(round1(slope * recent.length + intercept), 0, 100);
  return { pred, sigma: round1(sigma), slope: round1(slope * 10) / 10 };
}

export const volatilityLabel = (sd: number): VolatilityLabel =>
  sd < 3.5 ? "Steady" : sd < 7 ? "Variable" : "Volatile";
