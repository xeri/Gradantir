import { clamp } from "../../utils";
import { betaFn, tCdf, tPdf, tQuantile, type StudentT } from "../bayes";

/**
 * Proper scoring rules for a location-scale Student-t predictive, scored
 * against a realized value. CRPS and pinball are the objective the engine is
 * tuned against (MAE rewards overconfidence; these do not). All closed-form and
 * deterministic — no sampling — so the eval harness stays reproducible.
 */

export type Quantile = "0.1" | "0.25" | "0.5" | "0.75" | "0.9";
export const QUANTILES: readonly Quantile[] = ["0.1", "0.25", "0.5", "0.75", "0.9"];

export interface Scores {
  /** Continuous ranked probability score (lower is better), in score points. */
  crps: number;
  /** Pinball / quantile loss at each τ. */
  pinball: Record<Quantile, number>;
  /** Absolute and squared error of the mean forecast. */
  ae: number;
  se: number;
  /** Probability integral transform F(y) ∈ [0,1] — uniform iff calibrated. */
  pit: number;
  /** 1 if y fell inside the central 50% / 90% predictive interval. */
  cover50: 0 | 1;
  cover90: 0 | 1;
  /** Gneiting–Raftery interval score of the central 90% interval (lower better). */
  is90: number;
}

/**
 * CRPS of a standard Student-t (location 0, scale 1) at ω, df ν>1
 * (Jordan, Krüger & Lerch 2019). ν = 3+n ≥ 4 here, so ν>1 always holds.
 */
function crpsStdT(w: number, df: number): number {
  const F = tCdf(w, df);
  const f = tPdf(w, df);
  const tail = (2 * Math.sqrt(df)) / (df - 1) * (betaFn(0.5, df - 0.5) / (betaFn(0.5, df / 2) ** 2));
  return w * (2 * F - 1) + (2 * f * (df + w * w)) / (df - 1) - tail;
}

/** Pinball (quantile) loss: (y−q)(τ − 1{y<q}). */
function pinball(y: number, q: number, tau: number): number {
  return (y - q) * (tau - (y < q ? 1 : 0));
}

export function scoreT(t: StudentT, y: number): Scores {
  const w = (y - t.mean) / t.scale;
  const crps = t.scale * crpsStdT(w, t.df);

  const pb = {} as Record<Quantile, number>;
  for (const q of QUANTILES) {
    const tau = Number(q);
    const qv = t.mean + tQuantile(tau, t.df) * t.scale;
    pb[q] = pinball(y, qv, tau);
  }

  const pit = clamp(tCdf(w, t.df), 0, 1);

  const q05 = t.mean + tQuantile(0.05, t.df) * t.scale;
  const q95 = t.mean + tQuantile(0.95, t.df) * t.scale;
  const q25 = t.mean + tQuantile(0.25, t.df) * t.scale;
  const q75 = t.mean + tQuantile(0.75, t.df) * t.scale;

  const alpha = 0.1; // 90% interval
  const is90 =
    (q95 - q05) +
    (2 / alpha) * (q05 - y) * (y < q05 ? 1 : 0) +
    (2 / alpha) * (y - q95) * (y > q95 ? 1 : 0);

  return {
    crps,
    pinball: pb,
    ae: Math.abs(y - t.mean),
    se: (y - t.mean) ** 2,
    pit,
    cover50: y >= q25 && y <= q75 ? 1 : 0,
    cover90: y >= q05 && y <= q95 ? 1 : 0,
    is90,
  };
}
