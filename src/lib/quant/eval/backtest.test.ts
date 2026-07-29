import { describe, expect, it } from "vitest";
import { backtestBook, backtestSubject } from "./backtest";
import type { GradeEntry, Subject } from "../../../types";

const sub = (id: string): Subject => ({ id, name: id, ticker: id.toUpperCase(), color: "#888888", target: null });
let seq = 0;
const ge = (subjectId: string, date: string, score: number): GradeEntry => ({
  id: `e${seq++}`, subjectId, date, type: "Exam", score, title: "",
});

const dates = ["2025-02-01", "2025-03-01", "2025-04-01", "2025-05-01", "2025-06-01", "2025-07-01", "2025-08-01", "2025-09-01"];

describe("backtestSubject", () => {
  it("returns one scored step per print past the warmup", () => {
    const subjects = [sub("s1")];
    const entries = dates.map((d, i) => ge("s1", d, 70 + i));
    const bt = backtestSubject("s1", subjects, entries)!;
    expect(bt.points.length).toBeGreaterThan(0);
    expect(bt.points.every((p) => p.s.crps >= 0)).toBe(true);
    expect(bt.cover90).toBeGreaterThanOrEqual(0);
    expect(bt.cover90).toBeLessThanOrEqual(1);
  });

  it("beats the naive last-value benchmark on a noisy mean-reverting tape", () => {
    // The engine's real edge is averaging out noise the random-walk naive chases:
    // last-value predicts 78 the step before an actual 62. (On a clean *trend* the
    // engine instead LAGS and loses to naive — the trend-lag Phase C's damped drift
    // targets — so mean-reversion is the honest place to assert positive skill.)
    const subjects = [sub("s1")];
    const swing = [78, 62, 76, 64, 74, 66, 72, 68];
    const entries = dates.map((d, i) => ge("s1", d, swing[i]));
    const bt = backtestSubject("s1", subjects, entries)!;
    expect(bt.skill).toBeGreaterThan(0); // skill = 1 − crps/crpsNaive
  });

  it("is deterministic", () => {
    const subjects = [sub("s1")];
    const entries = dates.map((d, i) => ge("s1", d, 60 + (i % 3) * 5));
    expect(backtestSubject("s1", subjects, entries)).toEqual(backtestSubject("s1", subjects, entries));
  });

  it("reports the mean-forecast bias (mean of pred − actual)", () => {
    const subjects = [sub("s1")];
    const entries = dates.map((d, i) => ge("s1", d, 70 + i));
    const bt = backtestSubject("s1", subjects, entries)!;
    const manual = bt.points.reduce((a, p) => a + (p.pred.mean - p.y), 0) / bt.points.length;
    expect(bt.bias).toBeCloseTo(manual, 9);
  });
});

describe("backtestBook", () => {
  it("aggregates every subject's folds", () => {
    const subjects = [sub("s1"), sub("s2")];
    const entries = [
      ...dates.map((d, i) => ge("s1", d, 70 + i)),
      ...dates.map((d, i) => ge("s2", d, 60 - i)),
    ];
    const bt = backtestBook(subjects, entries);
    expect(bt.subjects.length).toBe(2);
    expect(bt.n).toBe(bt.subjects.reduce((a, s) => a + s.points.length, 0));
    expect(Number.isFinite(bt.skill)).toBe(true);
  });

  it("member ablation changes the score", () => {
    const subjects = [sub("s1")];
    const entries = dates.map((d, i) => ge("s1", d, 50 + 4 * i));
    const full = backtestBook(subjects, entries);
    const noTrend = backtestBook(subjects, entries, { members: new Set(["kalman", "ewma", "shrunk"]) });
    expect(noTrend.crps).not.toBeCloseTo(full.crps, 6);
  });
});
