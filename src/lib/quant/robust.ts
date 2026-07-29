import { avg } from "../utils";

/**
 * Order-statistic tools. Everything here must stay sane at n=1–3 and shrug
 * off single wild results — the small-sample backbone of the engine.
 */

/**
 * The k-th smallest value (0-indexed), by Hoare partition, rearranging `a` in
 * place. Linear expected, and — the property the median below rests on — it
 * leaves the array partitioned about k: everything at an index below k is ≤ the
 * returned value, everything above is ≥ it.
 *
 * The pivot is the midpoint element rather than an end, which is what keeps
 * already-sorted input (a slope array off a steadily improving tape) on the
 * balanced path instead of the quadratic one. Runs of equal values — a flat
 * tape's slopes are ALL the same number — still split evenly, because the scans
 * stop on equality and swap through it.
 */
function selectKth(a: number[], k: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k];
  }
  return a[lo];
}

/**
 * The middle value — SELECTED, not sorted.
 *
 * This is the engine's hottest primitive: Theil–Sen medians every pairwise
 * slope, so it is handed n(n−1)/2 numbers, and the ensemble runs Theil–Sen once
 * per walk-forward fold on every desk. Sorting that array cost a log factor the
 * answer never needed — measured at 93% of Theil–Sen's total runtime, and the
 * thing that made pricing one long tape superlinear in its own length.
 *
 * Selection is exact, not approximate: it returns the same order statistics a
 * full sort would, so every number this engine publishes is unchanged.
 * `robust.test.ts` locks that against a sorting reference.
 */
export function median(xs: number[]): number | null {
  const n = xs.length;
  if (!n) return null;
  if (n === 1) return xs[0];
  const a = [...xs];
  const mid = n >> 1;
  const upper = selectKth(a, mid);
  if (n % 2) return upper;
  // Even n needs the value below the midpoint too. After selection everything
  // left of `mid` is ≤ `upper`, so the largest of those IS the (mid−1)-th
  // smallest — one linear scan, no second selection.
  let lower = a[0];
  for (let i = 1; i < mid; i++) if (a[i] > lower) lower = a[i];
  return (lower + upper) / 2;
}

/** Median absolute deviation, scaled to estimate sd (×1.4826). 0 below n=2. */
export function mad(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = median(xs)!;
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)))!;
}

/** Clamp the top/bottom ⌊p·n⌋ (≥1) values to their neighbours. No-op below n=5. */
export function winsorize(xs: number[], p = 0.1): number[] {
  const n = xs.length;
  if (n < 5) return [...xs];
  const k = Math.max(1, Math.floor(p * n));
  const s = [...xs].sort((a, b) => a - b);
  const lo = s[k], hi = s[n - 1 - k];
  return xs.map((x) => Math.min(hi, Math.max(lo, x)));
}

export function winsorizedMean(xs: number[], p = 0.1): number | null {
  return xs.length ? avg(winsorize(xs, p)) : null;
}

/** Φ(z) via the Abramowitz–Stegun 7.1.26 erf polynomial (|ε| < 1.5e-7). */
export function normCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export interface TheilSenResult {
  /** Median pairwise slope, y-units per x-unit. */
  slope: number;
  /** median(y − slope·x). */
  intercept: number;
  /** Kendall τ (a-variant; tied pairs contribute 0). */
  tau: number;
  /** Two-sided significance via the normal approximation; 1 below n=4. */
  p: number;
  n: number;
}

export function theilSen(pts: { x: number; y: number }[]): TheilSenResult | null {
  const n = pts.length;
  if (n < 2) return null;
  const slopes: number[] = [];
  let S = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = pts[j].x - pts[i].x;
      const dy = pts[j].y - pts[i].y;
      pairs++;
      if (dx !== 0) slopes.push(dy / dx);
      if (dx !== 0 && dy !== 0) S += Math.sign(dx) * Math.sign(dy);
    }
  }
  if (!slopes.length) return null;
  const slope = median(slopes)!;
  const intercept = median(pts.map((p) => p.y - slope * p.x))!;
  const tau = pairs ? S / pairs : 0;
  let p = 1;
  if (n >= 4) {
    const varS = (n * (n - 1) * (2 * n + 5)) / 18;
    const z = S / Math.sqrt(varS);
    p = Math.min(1, 2 * (1 - normCdf(Math.abs(z))));
  }
  return { slope, intercept, tau, p, n };
}

/**
 * τ-gated slope: an insignificant trend forecasts flat. Hard 0 below n=4 or
 * when p > 0.5; otherwise the slope is damped by (1−p)².
 */
export function shrunkSlope(ts: TheilSenResult | null): number {
  if (!ts || ts.n < 4 || ts.p > 0.5) return 0;
  const g = Math.max(0, 1 - ts.p);
  return ts.slope * g * g;
}

/**
 * Damped-trend extrapolation. A linear trend ridden straight out is the signature
 * of a forecaster's optimism: a slope that fit the last few prints keeps paying
 * out forever. Damping bleeds it off with horizon so the drift saturates.
 *
 * Over a horizon of `h` days beyond the anchor, the displacement is
 * `slope · τ · (1 − e^(−h/τ))`:
 *   • for h ≪ τ it is ≈ `slope · h` — locally the same straight line, so a
 *     one-step-ahead forecast is barely touched;
 *   • as h → ∞ it saturates at `slope · τ` — the trend can never contribute more
 *     than τ days' worth of drift, however far out it is asked.
 * `τ` is the saturation length in days. A non-positive horizon adds nothing.
 */
export function dampedDrift(slope: number, horizonDays: number, tau: number): number {
  if (horizonDays <= 0 || tau <= 0) return 0;
  return slope * tau * (1 - Math.exp(-horizonDays / tau));
}
