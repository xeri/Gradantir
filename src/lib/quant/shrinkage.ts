import { avg } from "../utils";
import type { GradeEntry } from "../../types";

/**
 * Empirical-Bayes partial pooling across subjects (James–Stein flavoured).
 * With one or two prints in a subject, its mean is a terrible estimator —
 * borrow strength from the rest of the book. B is the trust in local data:
 * B = τ² / (τ² + σ²/n), so B→0 as n→0 and B→1 as n grows.
 */

export interface PoolStats {
  /** Mean of subject means — equal subject weight, not print weight. */
  grandMean: number;
  /** Between-subject variance of means (floored — subjects always differ a bit). */
  tau2: number;
  /** Within-subject variance of one print (pooled; floored — one print is never exact). */
  sigma2: number;
  /** Subjects contributing (n ≥ 1). */
  k: number;
}

const TAU2_FLOOR = 9; // subjects genuinely differ by at least ±3 pts
const SIGMA2_FLOOR = 25; // a single result carries at least ±5 pts of noise
const SIGMA2_FALLBACK = 50; // when no subject has a second print to measure noise from

export function poolStats(subjectScores: number[][]): PoolStats | null {
  const nonEmpty = subjectScores.filter((s) => s.length > 0);
  if (!nonEmpty.length) return null;
  const means = nonEmpty.map((s) => avg(s));
  const grandMean = avg(means);
  let tau2 = TAU2_FLOOR;
  if (means.length >= 2) {
    const v = means.reduce((a, m) => a + (m - grandMean) * (m - grandMean), 0) / (means.length - 1);
    tau2 = Math.max(TAU2_FLOOR, v);
  }
  let se = 0;
  let dof = 0;
  for (const s of nonEmpty) {
    if (s.length < 2) continue;
    const m = avg(s);
    se += s.reduce((a, x) => a + (x - m) * (x - m), 0);
    dof += s.length - 1;
  }
  const sigma2 = dof > 0 ? Math.max(SIGMA2_FLOOR, se / dof) : SIGMA2_FALLBACK;
  return { grandMean, tau2, sigma2, k: nonEmpty.length };
}

export function shrinkMean(
  scores: number[],
  pool: PoolStats | null,
): { mean: number; B: number } | null {
  if (!scores.length) return pool ? { mean: pool.grandMean, B: 0 } : null;
  const local = avg(scores);
  if (!pool) return { mean: local, B: 1 };
  const B = pool.tau2 / (pool.tau2 + pool.sigma2 / scores.length);
  return { mean: B * local + (1 - B) * pool.grandMean, B };
}

/** Generic κ-shrinkage toward a target: (n·v + κ·target) / (n + κ). */
export function shrinkToward(v: number, n: number, target: number, kappa: number): number {
  return (n * v + kappa * target) / (n + kappa);
}

/**
 * Scores to pool on, corrected for how hard each subject marks.
 *
 * Borrowing strength across subjects assumes they measure the same thing on the
 * same scale, and marks do not: a desk whose year-level mean is 70 drags one
 * whose year-level mean is 55 toward it for no reason but the marking. Where
 * prints carry a reference average, subtract it and re-centre on the BOOK's
 * mean reference — one shared centre, so the correction is genuinely
 * cross-subject and the result stays on the 0–100 scale everything else speaks.
 *
 * Takes the whole book at once for exactly that reason. Prints without a
 * reference pass through untouched, and a book with none at all pools raw.
 */
export function poolableScores(bySubject: GradeEntry[][]): number[][] {
  const refOf = (e: GradeEntry) => e.classAvg ?? e.yearAvg;
  const refs = bySubject.flat().map(refOf).filter((r): r is number => r != null);
  if (!refs.length) return bySubject.map((es) => es.map((e) => e.score));
  const meanRef = avg(refs);
  return bySubject.map((es) =>
    es.map((e) => {
      const ref = refOf(e);
      return ref == null ? e.score : e.score - ref + meanRef;
    }),
  );
}
