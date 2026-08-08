import { describe, expect, it } from "vitest";
import { compareFolds, mdeBound, type ScoredFold } from "./compare";

/**
 * The gate's statistics. Every assertion here is about the INSTRUMENT, not
 * about the engine: given fold scores with a known relationship, does the
 * comparison report the relationship honestly, and does it refuse to claim a
 * difference that is not there?
 */

/** k folds per cluster, every fold scoring `base`, ids deterministic. */
const folds = (clusters: number, per: number, score: (c: number, i: number) => number): ScoredFold[] => {
  const out: ScoredFold[] = [];
  for (let c = 0; c < clusters; c++) {
    for (let i = 0; i < per; i++) {
      out.push({ key: `s-${c}|2026-0${i + 1}-01`, cluster: `s-${c}`, crps: score(c, i) });
    }
  }
  return out;
};

describe("compareFolds", () => {
  it("is deterministic across runs", () => {
    const a = folds(6, 5, (c, i) => 5 + c * 0.3 + i * 0.1);
    const b = folds(6, 5, (c, i) => 5 + c * 0.3 + i * 0.1 - 0.4);
    expect(compareFolds(a, b)).toEqual(compareFolds(a, b));
  });

  it("calls two identical models INDISTINGUISHABLE with a zero mean difference", () => {
    const a = folds(6, 5, (c, i) => 5 + c * 0.3 + i * 0.1);
    const r = compareFolds(a, a);
    expect(r.meanDiff).toBe(0);
    expect(r.verdict).toBe("INDISTINGUISHABLE");
    expect(r.nPaired).toBe(30);
    expect(r.nClusters).toBe(6);
  });

  it("calls a uniform penalty on every fold REGRESSED", () => {
    const a = folds(6, 5, (c, i) => 5 + c * 0.3 + i * 0.1);
    const b = folds(6, 5, (c, i) => 5 + c * 0.3 + i * 0.1 + 1);
    const r = compareFolds(a, b);
    expect(r.meanDiff).toBeCloseTo(1, 6);
    expect(r.verdict).toBe("REGRESSED");
    expect(r.ciLo).toBeGreaterThan(0);
  });

  it("calls a uniform gain on every fold IMPROVED", () => {
    const a = folds(6, 5, (c, i) => 5 + c * 0.3 + i * 0.1);
    const b = folds(6, 5, (c, i) => 5 + c * 0.3 + i * 0.1 - 1);
    const r = compareFolds(a, b);
    expect(r.meanDiff).toBeCloseTo(-1, 6);
    expect(r.verdict).toBe("IMPROVED");
    expect(r.ciHi).toBeLessThan(0);
  });

  it("refuses to call a difference that lives in one cluster only", () => {
    // Cluster 0 improves by 6 points; every other cluster is unchanged. The
    // fold-level mean difference is large, but it rests on a single subject —
    // exactly the case fold-level resampling would call a win and clustering
    // must not.
    const a = folds(6, 5, () => 10);
    const b = folds(6, 5, (c) => (c === 0 ? 4 : 10));
    const r = compareFolds(a, b);
    expect(r.meanDiff).toBeCloseTo(-1, 6);
    expect(r.verdict).toBe("INDISTINGUISHABLE");
  });

  it("reports folds present on one side only and excludes them from the statistic", () => {
    const a = folds(3, 2, () => 5);
    const b = [...folds(3, 2, () => 4), { key: "s-9|2026-01-01", cluster: "s-9", crps: 99 }];
    const r = compareFolds(a, b);
    expect(r.nPaired).toBe(6);
    expect(r.unmatchedNext).toEqual(["s-9|2026-01-01"]);
    expect(r.unmatchedBase).toEqual([]);
    expect(r.meanDiff).toBeCloseTo(-1, 6);
  });

  it("returns a zero-width interval and INDISTINGUISHABLE when nothing pairs", () => {
    const r = compareFolds(folds(2, 2, () => 5), []);
    expect(r.nPaired).toBe(0);
    expect(r.verdict).toBe("INDISTINGUISHABLE");
    expect(r.meanDiff).toBe(0);
  });
});

describe("mdeBound", () => {
  it("is zero when every fold scores identically", () => {
    expect(mdeBound(folds(6, 5, () => 7))).toBeCloseTo(0, 6);
  });

  it("grows with between-cluster spread", () => {
    const tight = mdeBound(folds(6, 5, (c) => 7 + c * 0.1));
    const loose = mdeBound(folds(6, 5, (c) => 7 + c * 2.0));
    expect(loose).toBeGreaterThan(tight);
  });

  it("is reported in score points, not points squared", () => {
    // Doubling every score doubles the bound. A points² statistic would quadruple it.
    const one = mdeBound(folds(6, 5, (c, i) => 4 + c + i));
    const two = mdeBound(folds(6, 5, (c, i) => 2 * (4 + c + i)));
    expect(two / one).toBeCloseTo(2, 4);
  });
});
