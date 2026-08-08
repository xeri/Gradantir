import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR } from "../../calendar";
import { correlatedSumSd } from "../aggregate";
import { meanSkill } from "./skill";
import type { GradeEntry, Subject } from "../../../types";

const sub = (id: string): Subject => ({ id, name: id, ticker: id.toUpperCase(), color: "#888888", target: null });
let seq = 0;
const exam = (subjectId: string, date: string, score: number): GradeEntry => ({
  id: `e${seq++}`, subjectId, date, type: "Exam", score, title: `Round ${date.slice(0, 7)}`,
});

// Four exam rounds, three subjects — a small book with a stable aggregate mean
// but noisy components (the structure the analysis says is forecastable at the
// mean level and near-noise per subject).
const rounds = ["2024-11-01", "2025-04-01", "2025-08-01", "2025-11-01"];
const subjects = [sub("s1"), sub("s2"), sub("s3")];
const comp: Record<string, number[]> = {
  s1: [80, 60, 78, 62],
  s2: [55, 75, 58, 72],
  s3: [70, 68, 71, 69],
};
const entries: GradeEntry[] = subjects.flatMap((s) => rounds.map((d, i) => exam(s.id, d, comp[s.id][i])));

describe("meanSkill", () => {
  it("scores the all-subject mean walk-forward across exam rounds", () => {
    const ms = meanSkill(subjects, entries, DEFAULT_CALENDAR);
    expect(ms.points.length).toBeGreaterThan(0);
    expect(Number.isFinite(ms.mae)).toBe(true);
    expect(Number.isFinite(ms.naiveMae)).toBe(true);
    for (const p of ms.points) {
      expect(p.realized).toBeGreaterThan(0);
      expect(Number.isFinite(p.forecast)).toBe(true);
    }
  });
  it("is deterministic", () => {
    expect(meanSkill(subjects, entries, DEFAULT_CALENDAR)).toEqual(meanSkill(subjects, entries, DEFAULT_CALENDAR));
  });
});

describe("meanSkill — the aggregate target is scored, not just measured", () => {
  it("reports CRPS, skill and coverage beside MAE", () => {
    const r = meanSkill(subjects, entries, DEFAULT_CALENDAR);
    expect(r.points.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.crps)).toBe(true);
    expect(Number.isFinite(r.crpsNaive)).toBe(true);
    expect(r.crps).toBeGreaterThan(0);
    // skill = 1 − crps/crpsNaive, the same definition backtest.ts uses.
    expect(r.skill).toBeCloseTo(1 - r.crps / r.crpsNaive, 10);
    expect(r.cover90).toBeGreaterThanOrEqual(0);
    expect(r.cover90).toBeLessThanOrEqual(1);
  });

  it("gives every point a positive predictive scale", () => {
    for (const p of meanSkill(subjects, entries, DEFAULT_CALENDAR).points) {
      expect(p.sd).toBeGreaterThan(0);
      expect(p.s.crps).toBeGreaterThan(0);
    }
  });

  it("keeps the naive strictly walk-forward", () => {
    // The naive's spread may only ever use rounds STRICTLY EARLIER than the
    // one being scored. The first scored point therefore sees a one-element
    // history and must fall back to the floor rather than to a zero spread.
    const r = meanSkill(subjects, entries, DEFAULT_CALENDAR);
    expect(r.points[0].naiveScores.crps).toBeGreaterThan(0);
    expect(Number.isFinite(r.points[0].naiveScores.crps)).toBe(true);
  });

  it("widens the aggregate band under a positive correlation", () => {
    expect(correlatedSumSd([3, 4], 0.5)).toBeGreaterThan(correlatedSumSd([3, 4], 0));
  });
});
