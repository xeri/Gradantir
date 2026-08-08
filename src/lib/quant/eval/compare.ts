import { makeRng } from "./rng";
import { BOOTSTRAP_B, BOOTSTRAP_SEED, COMPARE_ALPHA, MDE_PAIRING_FACTOR, MDE_Z } from "./params";

/**
 * Can this book tell a better model from a luckier one?
 *
 * The gate used to be `skill > baseline − 0.03` against seven stored scalars.
 * That is one-sided (a 0.03 regression shipped green), it has no notion of
 * sampling error, and it could not have had one: a paired test needs the
 * baseline's PER-FOLD scores and the snapshot stored only aggregates.
 *
 * This module is the replacement. It pairs fold-for-fold on a deterministic
 * key, resamples CLUSTERS (subjects) rather than folds — folds within a subject
 * share a tape, a pool and an ability path, so they are not independent, and
 * resampling them individually would report an interval several times too
 * narrow — and returns a three-way verdict instead of a pass/fail.
 *
 * INDISTINGUISHABLE is not a loophole. At ten clusters it is the honest state
 * of most changes, and a change may still ship on a non-CRPS argument (a fixed
 * defect, a removed hand-set constant, a simplification) as long as the commit
 * message says which. What may not happen is a regression shipping silently.
 */

export interface ScoredFold {
  /** Deterministic identity of the scored event, e.g. "s-math|2026-05-14". */
  key: string;
  /** The dependence group this fold belongs to — the subject id. */
  cluster: string;
  /** Score in points, lower better. */
  crps: number;
}

export type Verdict = "IMPROVED" | "INDISTINGUISHABLE" | "REGRESSED";

export interface Comparison {
  nPaired: number;
  nClusters: number;
  /** mean(next − base) over paired folds. Negative is an improvement. */
  meanDiff: number;
  ciLo: number;
  ciHi: number;
  verdict: Verdict;
  /** Keys the baseline scored and the candidate did not, and vice versa. */
  unmatchedBase: string[];
  unmatchedNext: string[];
}

const EMPTY: Comparison = {
  nPaired: 0, nClusters: 0, meanDiff: 0, ciLo: 0, ciHi: 0,
  verdict: "INDISTINGUISHABLE", unmatchedBase: [], unmatchedNext: [],
};

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Percentile of a sorted array by linear interpolation. */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

export function compareFolds(base: ScoredFold[], next: ScoredFold[]): Comparison {
  const baseByKey = new Map(base.map((f) => [f.key, f]));
  const nextByKey = new Map(next.map((f) => [f.key, f]));

  const unmatchedBase = base.filter((f) => !nextByKey.has(f.key)).map((f) => f.key).sort();
  const unmatchedNext = next.filter((f) => !baseByKey.has(f.key)).map((f) => f.key).sort();

  // Group the paired differences by cluster, in a deterministic order.
  const byCluster = new Map<string, number[]>();
  for (const f of [...base].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const n = nextByKey.get(f.key);
    if (!n) continue;
    const g = byCluster.get(f.cluster) ?? [];
    g.push(n.crps - f.crps);
    byCluster.set(f.cluster, g);
  }

  const clusters = [...byCluster.keys()].sort().map((k) => byCluster.get(k) as number[]);
  const all = clusters.flat();
  if (!all.length) return { ...EMPTY, unmatchedBase, unmatchedNext };

  const meanDiff = mean(all);

  // Cluster bootstrap: resample WHOLE subjects with replacement, then take the
  // fold-weighted mean over the resampled multiset.
  const rng = makeRng(BOOTSTRAP_SEED);
  const reps: number[] = [];
  for (let b = 0; b < BOOTSTRAP_B; b++) {
    let sum = 0;
    let n = 0;
    for (let c = 0; c < clusters.length; c++) {
      const draw = clusters[rng.int(clusters.length)];
      for (const d of draw) { sum += d; n++; }
    }
    reps.push(n ? sum / n : 0);
  }
  reps.sort((a, b) => a - b);

  const ciLo = percentile(reps, COMPARE_ALPHA / 2);
  const ciHi = percentile(reps, 1 - COMPARE_ALPHA / 2);
  const verdict: Verdict = ciHi < 0 ? "IMPROVED" : ciLo > 0 ? "REGRESSED" : "INDISTINGUISHABLE";

  return {
    nPaired: all.length,
    nClusters: clusters.length,
    meanDiff,
    ciLo,
    ciHi,
    verdict,
    unmatchedBase,
    unmatchedNext,
  };
}

/**
 * An UPPER BOUND, in score points, on the smallest CRPS improvement this book
 * could detect at 80% power — "a change smaller than this is invisible here."
 *
 * It is computed without a candidate model, from the cluster-bootstrap spread
 * of the mean score itself, inflated by √2 for the pairing (see
 * MDE_PAIRING_FACTOR). A real paired comparison will do better than this, often
 * much better; the bound is what belongs beside the skill number in README §26,
 * because it is the honest answer to "how much can this engine be improved,
 * measurably, on the evidence available".
 */
export function mdeBound(folds: ScoredFold[]): number {
  const byCluster = new Map<string, number[]>();
  for (const f of [...folds].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const g = byCluster.get(f.cluster) ?? [];
    g.push(f.crps);
    byCluster.set(f.cluster, g);
  }
  const clusters = [...byCluster.keys()].sort().map((k) => byCluster.get(k) as number[]);
  if (clusters.length < 2) return 0;

  const rng = makeRng(BOOTSTRAP_SEED);
  const reps: number[] = [];
  for (let b = 0; b < BOOTSTRAP_B; b++) {
    let sum = 0;
    let n = 0;
    for (let c = 0; c < clusters.length; c++) {
      const draw = clusters[rng.int(clusters.length)];
      for (const v of draw) { sum += v; n++; }
    }
    reps.push(n ? sum / n : 0);
  }
  const m = mean(reps);
  const se = Math.sqrt(reps.reduce((a, v) => a + (v - m) ** 2, 0) / (reps.length - 1));
  return MDE_Z * MDE_PAIRING_FACTOR * se;
}
