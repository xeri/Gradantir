import { clamp } from "../utils";
import { PRIOR_MEAN_FALLBACK, PRIOR_VAR } from "./params";
import type { PoolStats } from "./shrinkage";
import type { Interval } from "../../types";

/**
 * Normal-Inverse-Gamma conjugate model with unknown mean AND unknown variance.
 * Its predictive distribution is Student-t with df = 2α — which is the whole
 * point at small n: two prints give df 5-ish, so the tails stay honestly fat
 * instead of pretending Gaussian confidence.
 */

export interface NIG {
  mu: number;
  kappa: number;
  alpha: number;
  beta: number;
}

export interface StudentT {
  mean: number;
  scale: number;
  df: number;
}

/** Weak prior centred on the book's grand mean (or 70 for an empty book). */
export function defaultPrior(pool: PoolStats | null): NIG {
  return {
    mu: pool?.grandMean ?? PRIOR_MEAN_FALLBACK,
    kappa: 1,
    alpha: 1.5,
    beta: pool?.sigma2 ?? PRIOR_VAR,
  };
}

/** Conjugate update on (optionally weighted) observations. */
export function nigUpdate(prior: NIG, xs: number[], weights?: number[]): NIG {
  const w = weights ?? xs.map(() => 1);
  let W = 0, wx = 0;
  for (let i = 0; i < xs.length; i++) { W += w[i]; wx += w[i] * xs[i]; }
  if (W <= 0) return { ...prior };
  const xbar = wx / W;
  let S = 0;
  for (let i = 0; i < xs.length; i++) S += w[i] * (xs[i] - xbar) * (xs[i] - xbar);
  const kappa = prior.kappa + W;
  const mu = (prior.kappa * prior.mu + W * xbar) / kappa;
  const alpha = prior.alpha + W / 2;
  const beta = prior.beta + S / 2 + (prior.kappa * W * (xbar - prior.mu) * (xbar - prior.mu)) / (2 * kappa);
  return { mu, kappa, alpha, beta };
}

/** Posterior predictive for the next observation: t_{2α}(μ, β(κ+1)/(ακ)). */
export function nigPredictive(post: NIG): StudentT {
  return {
    mean: post.mu,
    scale: Math.sqrt((post.beta * (post.kappa + 1)) / (post.alpha * post.kappa)),
    df: 2 * post.alpha,
  };
}

/* ── Gaussian tails ───────────────────────────────────────────────── */

/** Φ(x) — Zelen & Severo 26.2.17, |ε| < 7.5e-8. */
export function normCdf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

/**
 * Φ⁻¹(p) — Acklam's rational approximation, |ε| < 1.15e-9. Used to turn a
 * placement ("24th of 36") back into the z-score that produced it.
 */
export function normQuantile(p: number): number {
  const pc = clamp(p, 1e-12, 1 - 1e-12);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const LOW = 0.02425;
  if (pc < LOW) {
    const q = Math.sqrt(-2 * Math.log(pc));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (pc > 1 - LOW) {
    const q = Math.sqrt(-2 * Math.log(1 - pc));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = pc - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** φ(x) — the standard normal density. */
export const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** f_ν(x) — the standard (location 0, scale 1) Student-t density. */
export function tPdf(x: number, df: number): number {
  const logNorm = gammaln((df + 1) / 2) - gammaln(df / 2) - 0.5 * Math.log(df * Math.PI);
  return Math.exp(logNorm) * Math.pow(1 + (x * x) / df, -(df + 1) / 2);
}

/** B(a, b) = Γ(a)Γ(b)/Γ(a+b), via log-gamma for stability. */
export function betaFn(a: number, b: number): number {
  return Math.exp(gammaln(a) + gammaln(b) - gammaln(a + b));
}

/** ln Γ(x) — Lanczos g=7 approximation. */
export function gammaln(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaln(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (Numerical Recipes betacf). */
function betacf(x: number, a: number, b: number): number {
  const FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(x, a, b)) / a : 1 - (bt * betacf(1 - x, b, a)) / b;
}

/** CDF of the standard Student-t. */
export function tCdf(x: number, df: number): number {
  const p = 0.5 * betaInc(df / (df + x * x), df / 2, 0.5);
  return x >= 0 ? 1 - p : p;
}

/**
 * Standard-t quantile by bisection on tCdf. Chosen over series approximations
 * because those degrade exactly where this engine lives: tiny df.
 */
export function tQuantile(p: number, df: number): number {
  const pc = clamp(p, 1e-12, 1 - 1e-12);
  let lo = -1e4, hi = 1e4;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < pc) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The p-quantile of the predictive AFTER truncation to [lo, hi] — boundary-aware
 * (C4b). Scores live on [0,100], so a t centred near a boundary spills mass past
 * it that a plain clamp simply discards, quietly under-covering. Here the mass
 * outside the range is renormalised away: the truncated CDF is
 * (F(x)−F(lo))/(F(hi)−F(lo)), and its p-quantile is F⁻¹(F(lo)+p·(F(hi)−F(lo))).
 * Far from any boundary F(lo)≈0 and F(hi)≈1, so it reduces to the plain quantile.
 */
export function truncatedQuantile(t: StudentT, p: number, lo = 0, hi = 100): number {
  const F = (x: number) => tCdf((x - t.mean) / t.scale, t.df);
  const Flo = F(lo);
  const mass = F(hi) - Flo;
  if (mass <= 1e-9) return clamp(t.mean, lo, hi); // all mass already outside — degenerate
  const pc = Flo + clamp(p, 0, 1) * mass;
  return clamp(t.mean + tQuantile(pc, t.df) * t.scale, lo, hi);
}

/**
 * Central `level` predictive interval as the true quantiles of the [0,100]-
 * truncated predictive (C4b). Near a boundary the interval is asymmetric — it
 * extends into the interior rather than pinning a bound at the ceiling — and it
 * holds the nominal mass; away from boundaries it is the ordinary symmetric
 * t-interval.
 */
export function predictiveInterval(t: StudentT, level: number): Interval {
  return {
    lo: truncatedQuantile(t, (1 - level) / 2),
    hi: truncatedQuantile(t, (1 + level) / 2),
  };
}
