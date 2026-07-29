import { describe, expect, it } from "vitest";
import { poolStats, poolableScores, shrinkMean, shrinkToward } from "./shrinkage";

describe("poolStats", () => {
  it("returns null with no scores anywhere", () => {
    expect(poolStats([])).toBeNull();
    expect(poolStats([[], []])).toBeNull();
  });
  it("computes an equal-subject-weight grand mean", () => {
    const p = poolStats([[70, 70], [90]])!;
    expect(p.grandMean).toBe(80); // subject means 70 and 90, NOT print-weighted
    expect(p.k).toBe(2);
  });
  it("floors both variance components", () => {
    const p = poolStats([[75], [75], [75]])!; // identical single-print subjects
    expect(p.tau2).toBeGreaterThan(0);
    expect(p.sigma2).toBeGreaterThan(0);
  });
});

describe("shrinkMean", () => {
  const pool = poolStats([
    [62, 65, 60, 64],
    [78, 74, 76, 80],
    [88, 85, 90, 87],
  ])!;
  it("n=0 falls back to the grand mean with zero trust", () => {
    const r = shrinkMean([], pool)!;
    expect(r.mean).toBe(pool.grandMean);
    expect(r.B).toBe(0);
    expect(shrinkMean([], null)).toBeNull();
  });
  it("no pool → trust the local mean entirely", () => {
    const r = shrinkMean([80, 90], null)!;
    expect(r.mean).toBe(85);
    expect(r.B).toBe(1);
  });
  it("lands strictly between local and grand means", () => {
    const r = shrinkMean([95], pool)!;
    expect(r.mean).toBeGreaterThan(pool.grandMean);
    expect(r.mean).toBeLessThan(95);
    expect(r.B).toBeGreaterThan(0);
    expect(r.B).toBeLessThan(1);
  });
  it("trusts the local mean more as n grows", () => {
    const b1 = shrinkMean([95], pool)!.B;
    const b4 = shrinkMean([95, 95, 95, 95], pool)!.B;
    const b8 = shrinkMean(Array(8).fill(95), pool)!.B;
    expect(b4).toBeGreaterThan(b1);
    expect(b8).toBeGreaterThan(b4);
  });
});

describe("shrinkToward", () => {
  it("is the κ-weighted compromise", () => {
    expect(shrinkToward(10, 1, 0, 3)).toBe(2.5); // (1·10 + 3·0)/4
    expect(shrinkToward(10, 9, 0, 3)).toBe(7.5);
    expect(shrinkToward(10, 0, 0, 3)).toBe(0); // no data → target
  });
});

describe("poolableScores", () => {
  const mk = (score: number, yearAvg: number | null) =>
    ({ id: "x", subjectId: "s", date: "2026-01-01", type: "Exam" as const, score, title: "",
       classAvg: null, yearAvg, rank: null, cohortN: null, worthPct: null });

  it("passes a book with no reference averages straight through", () => {
    const out = poolableScores([[mk(70, null)], [mk(50, null)]]);
    expect(out).toEqual([[70], [50]]);
  });

  it("removes subject difficulty so a hard desk stops dragging an easy one", () => {
    // Both students are exactly 10 pts above their own year level; raw pooling
    // says they are 20 apart, which is an artefact of the marking.
    const raw = [[mk(80, 70)], [mk(60, 50)]];
    const [[a], [b]] = poolableScores(raw);
    expect(a).toBeCloseTo(b, 9);
    // …and the corrected scale still reads as a percentage.
    expect(a).toBeGreaterThan(60);
    expect(a).toBeLessThan(80);
  });

  it("centres on the BOOK, not on each subject in isolation", () => {
    // Centring per subject would map every desk to the same number and erase
    // the genuine difference between them.
    const [[a], [b]] = poolableScores([[mk(80, 70)], [mk(55, 50)]]);
    expect(a).toBeGreaterThan(b);
  });

  it("leaves prints without a reference untouched", () => {
    // Book mean reference is 60, so the referenced print shifts by 70 − 60 and
    // the unreferenced one cannot move at all.
    const [[withRef, without], [other]] = poolableScores([[mk(80, 70), mk(64, null)], [mk(55, 50)]]);
    expect(without).toBe(64);
    expect(withRef).toBeCloseTo(70, 9);
    expect(other).toBeCloseTo(65, 9);
  });
});
