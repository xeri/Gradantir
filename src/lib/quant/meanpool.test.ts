import { describe, expect, it } from "vitest";
import { freshSettings } from "../../constants";
import { IDENTITY_MEAN_POOL, latestCallFor, meanCallSkill, poolAggregate } from "./meanpool";
import type { AggregateForecast, ForecastLog, GradeEntry, MeanCall } from "../../types";

const CAL = freshSettings().calendar;

const call = (roundKey: string, predAvg: number, ranking: string[], createdAt: string): MeanCall =>
  ({ id: `${roundKey}-${createdAt}-${predAvg}`, roundKey, predAvg, ranking, createdAt });

const exam = (subjectId: string, date: string, score: number): GradeEntry =>
  ({ id: `e-${subjectId}-${date}`, subjectId, date, type: "Exam", score, title: "" });

const log = (subjectId: string, roundKey: string, point: number): ForecastLog => ({
  id: `${subjectId}|${roundKey}|exam|gx-1`, subjectId, roundKey, target: "exam",
  createdAt: "2025-01-01", modelVersion: "gx-1", point, sd: 5, df: 10, ci90: { lo: point - 8, hi: point + 8 },
});

/** Two desks, so the book aggregate is out of 200 and the pct is the mean. */
const forecast = (pct: number, sdPct: number): AggregateForecast => ({
  sum: pct * 2, outOf: 200, count: 2, pct, sd: sdPct * 2,
  ci90: { lo: 0, hi: 200 }, vsLast: null,
});

describe("latestCallFor", () => {
  it("takes the newest call for the round — a revision supersedes", () => {
    const calls = [
      call("2026-T2", 70, ["a", "b"], "2026-06-01"),
      call("2026-T2", 74, ["a", "b"], "2026-06-10"),
      call("2026-T1", 60, ["a", "b"], "2026-03-01"),
    ];
    expect(latestCallFor(calls, "2026-T2")!.predAvg).toBe(74);
  });

  it("is null for a round nobody has called", () => {
    expect(latestCallFor([], "2026-T2")).toBeNull();
  });
});

describe("meanCallSkill", () => {
  const entries = [exam("a", "2025-07-01", 80), exam("b", "2025-07-01", 60)]; // realized avg 70

  it("is the identity before any call has scored", () => {
    expect(meanCallSkill([], [], [], CAL)).toEqual(IDENTITY_MEAN_POOL);
  });

  it("hands weight over when you called the round and the desk missed it", () => {
    const yours = [call("2025-T2", 70, ["a", "b"], "2025-06-01")];   // dead on
    const desk = [log("a", "2025-T2", 90), log("b", "2025-T2", 90)]; // 20 out
    const fit = meanCallSkill(yours, entries, desk, CAL);
    expect(fit.n).toBe(1);
    expect(fit.w).toBeGreaterThan(0);
    expect(fit.youScore).toBeCloseTo(0, 10);
    expect(fit.modelScore).toBeCloseTo(20, 10);
    expect(fit.selfSd).toBeNull(); // a perfect record has no spread to quote
  });

  it("gives nothing to a call the desk beat", () => {
    const yours = [call("2025-T2", 50, ["a", "b"], "2025-06-01")];
    const desk = [log("a", "2025-T2", 80), log("b", "2025-T2", 60)];
    const fit = meanCallSkill(yours, entries, desk, CAL);
    expect(fit.w).toBe(0);
    expect(fit.selfSd).toBeCloseTo(20, 10);
  });

  it("refuses to score a call logged after the round printed", () => {
    const late = [call("2025-T2", 70, ["a", "b"], "2025-07-02")];
    expect(meanCallSkill(late, entries, [], CAL).n).toBe(0);
  });

  it("scores your revision, not your first guess", () => {
    const revised = [
      call("2025-T2", 50, ["a", "b"], "2025-05-01"),
      call("2025-T2", 70, ["a", "b"], "2025-06-01"),
    ];
    expect(meanCallSkill(revised, entries, [], CAL).youScore).toBeCloseTo(0, 10);
  });
});

describe("poolAggregate", () => {
  const fc = forecast(70, 3);
  const yours = call("2026-T2", 80, ["a", "b"], "2026-06-01");

  it("returns the desk's own forecast at zero weight", () => {
    expect(poolAggregate(fc, yours, IDENTITY_MEAN_POOL)).toBe(fc);
  });

  it("returns the desk's own forecast with nothing called", () => {
    expect(poolAggregate(fc, null, { ...IDENTITY_MEAN_POOL, w: 0.4, n: 3 })).toBe(fc);
  });

  it("moves the level toward your call, in proportion to the weight", () => {
    const pooled = poolAggregate(fc, yours, { ...IDENTITY_MEAN_POOL, w: 0.25, n: 4, selfSd: 3 })!;
    // 0.75 * 70 + 0.25 * 80 = 72.5
    expect(pooled.pct).toBeCloseTo(72.5, 5);
    expect(pooled.sum).toBeCloseTo(145, 5);
    expect(pooled.outOf).toBe(200);
  });

  it("widens the band when you disagree with the desk", () => {
    const near = poolAggregate(fc, call("2026-T2", 71, ["a", "b"], "x"), { ...IDENTITY_MEAN_POOL, w: 0.3, n: 4, selfSd: 3 })!;
    const far = poolAggregate(fc, call("2026-T2", 90, ["a", "b"], "x"), { ...IDENTITY_MEAN_POOL, w: 0.3, n: 4, selfSd: 3 })!;
    expect(far.sd).toBeGreaterThan(near.sd);
    expect(far.ci90.hi - far.ci90.lo).toBeGreaterThan(near.ci90.hi - near.ci90.lo);
  });

  it("keeps the band honest — a contested call never sharpens the forecast", () => {
    // Even a confident agreeing call cannot cut the band below the mixture's.
    const pooled = poolAggregate(fc, call("2026-T2", 70, ["a", "b"], "x"), { ...IDENTITY_MEAN_POOL, w: 0.45, n: 9, selfSd: 0.5 })!;
    expect(pooled.sd).toBeGreaterThan(0);
    expect(pooled.pct).toBeCloseTo(70, 5);
  });

  it("carries the expected move over from the desk's own read", () => {
    const withMove: AggregateForecast = { ...fc, vsLast: 4.2 };
    const pooled = poolAggregate(withMove, yours, { ...IDENTITY_MEAN_POOL, w: 0.25, n: 4, selfSd: 3 })!;
    // The move is repriced off the pooled level: +10 pts of call at w=0.25.
    expect(pooled.vsLast).toBeCloseTo(6.7, 5);
  });

  it("stays inside the board", () => {
    const pooled = poolAggregate(fc, call("2026-T2", 100, ["a", "b"], "x"), { ...IDENTITY_MEAN_POOL, w: 0.45, n: 9, selfSd: 20 })!;
    expect(pooled.pct).toBeLessThanOrEqual(100);
    expect(pooled.ci90.hi).toBeLessThanOrEqual(200);
    expect(pooled.ci90.lo).toBeGreaterThanOrEqual(0);
  });
});
