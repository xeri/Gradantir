import { describe, expect, it } from "vitest";
import {
  aggregateForecast, aggregateHistory, compositeIndex, correlatedSumSd, examAggregate,
  examAggregateHistory, pricesAsOf,
} from "./aggregate";
import { DEFAULT_SETTINGS } from "../../constants";
import type { AssessmentType, GradeEntry, PriceResult, Subject } from "../../types";

const sub = (id: string, ticker: string, extra: Partial<Subject> = {}): Subject => ({
  id, name: ticker, ticker, color: "#4D7CFE", target: null, ...extra,
});
let eid = 0;
const ge = (subjectId: string, date: string, score: number, type: AssessmentType = "Test"): GradeEntry => ({
  id: `e${eid++}`, subjectId, date, type, score, title: "",
});
const mkQuant = (price: number, sd: number, next = price): PriceResult => ({
  price, fv: price, discount: 0, premia: [], regime: "PRIME", sd, df: 8,
  ci50: { lo: price - sd, hi: price + sd },
  ci90: { lo: price - 2 * sd, hi: price + 2 * sd },
  p10: price - sd,
  lastExamPct: null, lastExamDate: null, prevPrice: null,
  nextExam: { mean: next, sd, ci50: { lo: 0, hi: 100 }, ci90: { lo: 0, hi: 100 } },
  weights: {},
  horizonDays: 30, carry: 0, prevCarry: null, forward: [], prevForward: null,
});
const S = DEFAULT_SETTINGS;
const CAL = S.calendar;

describe("cross-subject covariance — the affinity prior (C6)", () => {
  it("correlatedSumSd is quadrature at ρ=0 and linear at ρ=1", () => {
    const sds = [3, 4]; // Σσ² = 25 ⇒ 5 (independent) ; Σσ = 7 (perfectly correlated)
    expect(correlatedSumSd(sds, 0)).toBeCloseTo(5, 9);
    expect(correlatedSumSd(sds, 1)).toBeCloseTo(7, 9);
    const half = correlatedSumSd(sds, 0.5);
    expect(half).toBeGreaterThan(5);
    expect(half).toBeLessThan(7);
  });

  it("PREDICTION and COMPOSITE bands widen with ρ, and ρ=0 is the current quadrature", () => {
    const stats = [
      { sub: sub("a", "A"), quant: mkQuant(70, 6) },
      { sub: sub("b", "B"), quant: mkQuant(60, 8) },
    ];
    const fc0 = aggregateForecast(stats, null)!;
    const fcR = aggregateForecast(stats, null, 0.4)!;
    expect(fcR.sd).toBeGreaterThan(fc0.sd);
    expect(aggregateForecast(stats, null, 0)).toEqual(fc0); // default ≡ explicit zero

    const ci0 = compositeIndex(stats, null)!;
    const ciR = compositeIndex(stats, null, 0.4)!;
    expect(ciR.sd).toBeGreaterThan(ci0.sd);
    expect(compositeIndex(stats, null, 0)).toEqual(ci0);
  });
});

describe("examAggregate", () => {
  it("is null until an exam prints", () => {
    expect(examAggregate([])).toBeNull();
    expect(examAggregate([{ sub: sub("a", "A"), entries: [ge("a", "2026-03-01", 90)] }])).toBeNull();
  });
  it("sums the last exam per desk and reports the percentage", () => {
    const agg = examAggregate([
      { sub: sub("a", "A"), entries: [ge("a", "2026-02-01", 60, "Exam"), ge("a", "2026-05-01", 80, "Exam")] },
      { sub: sub("b", "B"), entries: [ge("b", "2026-04-01", 70, "Exam")] },
    ])!;
    expect(agg.sum).toBe(150); // 80 + 70 — the older 60 is history
    expect(agg.outOf).toBe(200);
    expect(agg.pct).toBe(75);
    expect(agg.asOf).toBe("2026-05-01");
  });
  it("ignores coursework entirely — no model, no other prints", () => {
    const agg = examAggregate([
      { sub: sub("a", "A"), entries: [ge("a", "2026-05-01", 80, "Exam"), ge("a", "2026-06-01", 20, "Quiz")] },
    ])!;
    expect(agg.sum).toBe(80);
  });
  it("excludes exam-less desks from the sum AND the denominator, but counts them as listed", () => {
    const agg = examAggregate([
      { sub: sub("a", "A"), entries: [ge("a", "2026-05-01", 80, "Exam")] },
      { sub: sub("b", "B"), entries: [ge("b", "2026-05-02", 90)] },
      { sub: sub("c", "C"), entries: [] },
    ])!;
    expect(agg.sum).toBe(80);
    expect(agg.outOf).toBe(100);
    expect(agg.reported).toBe(1);
    expect(agg.listed).toBe(3);
  });
  it("compares only desks holding two exams — a first exam cannot fake a rally", () => {
    const agg = examAggregate([
      { sub: sub("a", "A"), entries: [ge("a", "2026-02-01", 60, "Exam"), ge("a", "2026-05-01", 70, "Exam")] },
      { sub: sub("new", "NEW"), entries: [ge("new", "2026-05-02", 95, "Exam")] },
    ])!;
    expect(agg.delta).toBe(10); // 70 − 60; NEW's first exam contributes nothing
    expect(agg.pctDelta).toBe(10); // one comparable desk
  });
  it("reports null delta when no desk has a prior exam", () => {
    const agg = examAggregate([{ sub: sub("a", "A"), entries: [ge("a", "2026-05-01", 80, "Exam")] }])!;
    expect(agg.delta).toBeNull();
    expect(agg.pctDelta).toBeNull();
  });
  it("per-subject shares sum to ~100", () => {
    const agg = examAggregate([
      { sub: sub("a", "A"), entries: [ge("a", "2026-05-01", 60, "Exam")] },
      { sub: sub("b", "B"), entries: [ge("b", "2026-05-01", 90, "Exam")] },
    ])!;
    const total = agg.perSubject.reduce((a: number, p: { share: number }) => a + p.share, 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });
});

describe("aggregateForecast", () => {
  it("sums the oracle and adds the errors in quadrature", () => {
    const fc = aggregateForecast(
      [
        { sub: sub("a", "A"), quant: mkQuant(70, 3, 74) },
        { sub: sub("b", "B"), quant: mkQuant(80, 4, 82) },
      ],
      null,
    )!;
    expect(fc.sum).toBe(156);
    expect(fc.pct).toBe(78);
    expect(fc.sd).toBeCloseTo(5, 6); // √(9+16), in quadrature
    expect(fc.ci90.lo).toBeLessThan(fc.sum);
    expect(fc.ci90.hi).toBeGreaterThan(fc.sum);
    expect(fc.vsLast).toBeNull();
  });
  it("measures the expected move only over desks with a last exam", () => {
    const realized = examAggregate([
      { sub: sub("a", "A"), entries: [ge("a", "2026-05-01", 70, "Exam")] },
      { sub: sub("b", "B"), entries: [] },
    ])!;
    const fc = aggregateForecast(
      [
        { sub: sub("a", "A"), quant: mkQuant(70, 3, 76) },
        { sub: sub("b", "B"), quant: mkQuant(50, 3, 50) }, // no exam on file — out of the comparison
      ],
      realized,
    )!;
    expect(fc.count).toBe(2); // both desks are still forecast
    expect(fc.vsLast).toBe(6); // but only A is compared: 76 − 70
  });
  it("is null when nothing is priced", () => {
    expect(aggregateForecast([{ sub: sub("a", "A"), quant: null }], null)).toBeNull();
  });
});

describe("compositeIndex", () => {
  it("is null when nothing is priced", () => {
    expect(compositeIndex([], null)).toBeNull();
    expect(compositeIndex([{ sub: sub("a", "A"), quant: null }], null)).toBeNull();
  });
  it("value is the mean price; sum is out of 100 per desk", () => {
    const idx = compositeIndex(
      [
        { sub: sub("a", "A"), quant: mkQuant(70, 3) },
        { sub: sub("b", "B"), quant: mkQuant(80, 4) },
      ],
      null,
    )!;
    expect(idx.value).toBe(75);
    expect(idx.sum).toBe(150);
    expect(idx.outOf).toBe(200);
    expect(idx.count).toBe(2);
  });
  it("unpriced desks are excluded from sum AND outOf", () => {
    const idx = compositeIndex(
      [
        { sub: sub("a", "A"), quant: mkQuant(70, 3) },
        { sub: sub("b", "B"), quant: null },
        { sub: sub("c", "C"), quant: mkQuant(80, 4) },
      ],
      null,
    )!;
    expect(idx.sum).toBe(150);
    expect(idx.outOf).toBe(200);
  });
  it("combines uncertainty in quadrature and truncates ci90 to the range", () => {
    const idx = compositeIndex(
      [
        { sub: sub("a", "A"), quant: mkQuant(70, 3) },
        { sub: sub("b", "B"), quant: mkQuant(80, 4) },
      ],
      null,
    )!;
    expect(idx.sd).toBeCloseTo(5, 6); // √(9+16), in quadrature
    expect(idx.ci90.lo).toBeGreaterThanOrEqual(0);
    expect(idx.ci90.hi).toBeLessThanOrEqual(idx.outOf);
  });
  it("delta is per desk and compares only desks priced both now and then", () => {
    const stats = [
      { sub: sub("a", "A"), quant: mkQuant(75, 3) },
      { sub: sub("new", "NEW"), quant: mkQuant(90, 3) }, // listed since the prev snapshot
    ];
    const idx = compositeIndex(stats, new Map([["a", 70]]))!;
    expect(idx.delta).toBe(5); // 75 − 70; NEW's 90 doesn't fake a +90
    expect(compositeIndex(stats, new Map([["ghost", 50]]))!.delta).toBeNull();
    expect(compositeIndex(stats, null)!.delta).toBeNull();
  });
  it("per-subject shares sum to ~100", () => {
    const idx = compositeIndex(
      [
        { sub: sub("a", "A"), quant: mkQuant(60, 3) },
        { sub: sub("b", "B"), quant: mkQuant(90, 3) },
      ],
      null,
    )!;
    const total = idx.perSubject.reduce((a: number, p: { share: number }) => a + p.share, 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });
});

describe("pricesAsOf", () => {
  const subjects = [sub("a", "A"), sub("b", "B")];
  const entries = [
    ge("a", "2026-02-10", 70), ge("a", "2026-03-05", 74), ge("a", "2026-06-10", 90),
    ge("b", "2026-06-01", 65),
  ];
  it("only sees prints on or before the cutoff", () => {
    const early = pricesAsOf(subjects, entries, S, "2026-03-31");
    expect(early.has("a")).toBe(true);
    expect(early.has("b")).toBe(false); // b's first print is in June
    const late = pricesAsOf(subjects, entries, S, "2026-06-30");
    expect(late.has("b")).toBe(true);
    expect(late.get("a")!).toBeGreaterThan(early.get("a")!); // the June 90 lifted it
  });
});

describe("aggregateHistory", () => {
  const subjects = [sub("a", "A"), sub("b", "B")];
  const entries = [
    ge("a", "2025-11-10", 70), ge("a", "2026-02-10", 74), ge("a", "2026-05-05", 78),
    ge("b", "2026-05-20", 66), // b lists mid-history
  ];
  it("walks terms in ascending order and prices only listed desks", () => {
    const hist = aggregateHistory(subjects, entries, S, "2026-07-21", 4);
    expect(hist.length).toBeGreaterThan(1);
    expect(hist.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < hist.length; i++) expect(hist[i].key > hist[i - 1].key).toBe(true);
    const first = hist[0];
    const last = hist[hist.length - 1];
    expect(first.outOf).toBe(100); // only A existed in 2025-T4
    expect(last.outOf).toBe(200); // both priced by now
    expect(last.pct).toBeCloseTo((100 * last.sum) / last.outOf, 1);
  });
  it("is deterministic", () => {
    expect(aggregateHistory(subjects, entries, S, "2026-07-21", 4))
      .toEqual(aggregateHistory(subjects, entries, S, "2026-07-21", 4));
  });
  it("closes with a live mark when the open term has not printed yet", () => {
    // The composite is a price, not a result: it keeps moving between rounds,
    // so the tape must end at today rather than at the last paper.
    const hist = aggregateHistory(subjects, entries, S, "2026-07-21", 8);
    const last = hist[hist.length - 1];
    expect(last.live).toBe(true);
    expect(last.label).toBe("NOW");
    expect(last.date).toBe("2026-07-21");
    expect(hist.filter((p) => p.live).length).toBe(1);
  });
  it("draws no live point on the day a round printed", () => {
    const hist = aggregateHistory(subjects, entries, S, "2026-05-20", 8);
    expect(hist[hist.length - 1].live).toBeUndefined();
  });
});

describe("examAggregateHistory", () => {
  const subjects = [sub("a", "A"), sub("b", "B")];
  const entries = [
    ge("a", "2025-11-10", 60, "Exam"), // T4 2025
    ge("a", "2026-03-10", 70, "Exam"), // T1 2026
    ge("a", "2026-04-01", 99), // coursework — must not enter the index
    ge("b", "2026-06-20", 80, "Exam"), // T2 2026
  ];
  const hist = examAggregateHistory(subjects, entries, "2026-07-21", CAL);

  it("strikes one point per round the book actually printed", () => {
    expect(hist.map((p) => p.key)).toEqual(["2025-T4", "2026-T1", "2026-T2"]);
    for (let i = 1; i < hist.length; i++) expect(hist[i].key > hist[i - 1].key).toBe(true);
  });
  it("carries each desk's standing exam forward across rounds it sat out", () => {
    const last = hist[hist.length - 1];
    expect(last.sum).toBe(150); // A's March 70 still stands, plus B's 80
    expect(last.outOf).toBe(200);
    expect(last.pct).toBe(75);
  });
  it("counts only the desks that had printed by then", () => {
    expect(hist[0]).toMatchObject({ sum: 60, outOf: 100 });
    expect(hist[1]).toMatchObject({ sum: 70, outOf: 100 }); // B has not sat one yet
  });
  it("stamps each point with the day the round closed", () => {
    expect(hist[1].date).toBe("2026-04-01");
    expect(hist[2].date).toBe("2026-06-20");
  });
  it("never invents a point for a term nobody examined in", () => {
    // 2026-T3 is open on 2026-07-21 and empty; drawing it would repeat T2's
    // exams under a later name, which is the bug this tape exists to avoid.
    expect(hist.some((p) => p.key === "2026-T3")).toBe(false);
  });
  it("is empty before the first exam", () => {
    expect(examAggregateHistory(subjects, [ge("a", "2026-05-01", 90)], "2026-07-21", CAL)).toEqual([]);
  });
});
