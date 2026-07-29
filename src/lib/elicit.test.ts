import { describe, expect, it } from "vitest";
import {
  STAKE_BANDS, STAKE_CHIPS, bandOf, elicitationScoreboard, modelBandPmf, scoreChips, scoreSelfPred,
} from "./elicit";
import type { GradeEntry, Upcoming } from "../types";

const entry = (subjectId: string, date: string, score: number): GradeEntry =>
  ({ id: "e-" + date, subjectId, date, type: "Exam", score, title: "" });

describe("bands", () => {
  it("ten chips over six grade bands", () => {
    expect(STAKE_CHIPS).toBe(10);
    expect(STAKE_BANDS).toHaveLength(6);
  });
  it("maps a score to its band, the top band closed at 100", () => {
    expect(bandOf(49.9)).toBe(0);
    expect(bandOf(50)).toBe(1);
    expect(bandOf(74)).toBe(3);
    expect(bandOf(100)).toBe(5);
  });
});

describe("scoreSelfPred", () => {
  it("scores a bare point by signed and absolute error", () => {
    const s = scoreSelfPred({ point: 80 }, 74);
    expect(s.error).toBe(6);
    expect(s.absError).toBe(6);
    expect(s.covered).toBeNull();
    expect(s.crps).toBeNull();
  });
  it("scores a ranged prediction with coverage and a proper CRPS", () => {
    const inside = scoreSelfPred({ point: 75, lo: 70, hi: 85 }, 74);
    expect(inside.covered).toBe(1);
    expect(inside.crps).toBeGreaterThan(0);
    const outside = scoreSelfPred({ point: 75, lo: 70, hi: 85 }, 55);
    expect(outside.covered).toBe(0);
    // A miss well outside the stated range scores worse than a hit.
    expect(outside.crps!).toBeGreaterThan(inside.crps!);
  });
});

describe("scoreChips", () => {
  it("Brier-scores a staked distribution against the realized band", () => {
    // realized 74 → band index 3
    expect(scoreChips([0, 0, 0, 10, 0, 0], 74)!.brier).toBeCloseTo(0, 6);
    expect(scoreChips([10, 0, 0, 0, 0, 0], 74)!.brier).toBeCloseTo(2, 6);
    // Hedged evenly across two bands, one of them right.
    expect(scoreChips([0, 0, 0, 5, 5, 0], 74)!.brier).toBeCloseTo(0.5, 6);
  });
  it("returns null for an empty or mis-sized stake", () => {
    expect(scoreChips([0, 0, 0, 0, 0, 0], 74)).toBeNull();
    expect(scoreChips([5, 5], 74)).toBeNull();
  });
});

describe("modelBandPmf", () => {
  it("is a normalized distribution over the bands, peaked at the mean's band", () => {
    const p = modelBandPmf({ mean: 74, scale: 6, df: 8 });
    expect(p).toHaveLength(STAKE_BANDS.length);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(Math.max(...p)).toBe(p[3]);
  });
});

describe("elicitationScoreboard", () => {
  const u = (over: Partial<Upcoming>): Upcoming =>
    ({ id: "u", subjectId: "s1", date: "2026-09-15", type: "Exam", title: "", ...over });
  it("compares your calls to the model on the same realized outcomes", () => {
    const resolved = [
      { upcoming: u({ selfPred: { point: 80 }, teacherPred: 78, chips: [0, 0, 0, 10, 0, 0] }), realized: entry("s1", "2026-09-16", 74) },
    ];
    const sb = elicitationScoreboard(resolved, () => ({ mean: 72, scale: 6, df: 8 }));
    expect(sb.self.n).toBe(1);
    expect(sb.self.youMae).toBeCloseTo(6, 6);
    expect(sb.self.modelMae).toBeCloseTo(2, 6);
    expect(sb.teacher.n).toBe(1);
    expect(sb.teacher.youMae).toBeCloseTo(4, 6);
    expect(sb.chips.n).toBe(1);
    expect(sb.chips.youBrier).toBeCloseTo(0, 6);
    expect(sb.chips.modelBrier).toBeGreaterThan(0);
  });
  it("counts only the calls that were actually made", () => {
    const resolved = [
      { upcoming: u({ teacherPred: 70 }), realized: entry("s1", "2026-09-16", 74) },
    ];
    const sb = elicitationScoreboard(resolved, () => null);
    expect(sb.self.n).toBe(0);
    expect(sb.self.youMae).toBeNull();
    expect(sb.teacher.n).toBe(1);
    expect(sb.ai.n).toBe(0);
    expect(sb.ai.youMae).toBeNull();
    expect(sb.chips.n).toBe(0);
  });
  it("scores the wire's call like the teacher's — point error, both sides", () => {
    const resolved = [
      { upcoming: u({ aiPred: { point: 79, lo: 70, hi: 88, basis: "trend" } }), realized: entry("s1", "2026-09-16", 74) },
    ];
    const sb = elicitationScoreboard(resolved, () => ({ mean: 72, scale: 6, df: 8 }));
    expect(sb.ai.n).toBe(1);
    expect(sb.ai.youMae).toBeCloseTo(5, 6);
    expect(sb.ai.modelMae).toBeCloseTo(2, 6);
    expect(sb.ai.youCrps).toBeNull();
    // A wire call with no desk call still scores the wire's side.
    const alone = elicitationScoreboard(resolved, () => null);
    expect(alone.ai.n).toBe(1);
    expect(alone.ai.modelMae).toBeNull();
  });
});
