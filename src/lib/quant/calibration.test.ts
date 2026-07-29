import { describe, expect, it } from "vitest";
import { detrend, examOffset, percentileFromRank } from "./calibration";
import type { AssessmentType, GradeEntry } from "../../types";

let id = 0;
const e = (score: number, type: AssessmentType = "Test", extra: Partial<GradeEntry> = {}): GradeEntry => ({
  id: `e${id++}`, subjectId: "s1", date: "2026-05-01", type, score, title: "", ...extra,
});

describe("examOffset", () => {
  it("is 0 when either side is empty", () => {
    expect(examOffset([e(70), e(75)]).delta).toBe(0);
    expect(examOffset([e(70, "Exam")]).delta).toBe(0);
    expect(examOffset([]).raw).toBeNull();
  });
  it("one exam barely moves the offset (κ-shrunk toward 0)", () => {
    const entries = [e(80), e(80), e(80), e(72, "Exam")];
    const off = examOffset(entries);
    expect(off.raw).toBeCloseTo(-8, 6);
    expect(off.delta).toBeCloseTo(-2, 6); // -8 · 1/(1+3)
  });
  it("many exams converge toward the raw gap", () => {
    const entries = [e(80), e(80), ...Array.from({ length: 9 }, () => e(72, "Exam" as const))];
    const off = examOffset(entries);
    expect(off.delta).toBeCloseTo(-8 * (9 / 12), 6);
    expect(Math.abs(off.delta)).toBeGreaterThan(4);
  });
});

describe("detrend", () => {
  it("is the identity when no entry carries a reference", () => {
    const entries = [e(70), e(80)];
    expect(detrend(entries).map((d) => d.adjusted)).toEqual([70, 80]);
  });
  it("lifts a score from an unusually hard assessment", () => {
    // usual classAvg ≈ 70; the third sitting was brutal (classAvg 50)
    const entries = [
      e(75, "Test", { classAvg: 70 }),
      e(76, "Test", { classAvg: 72 }),
      e(60, "Test", { classAvg: 50 }),
    ];
    const out = detrend(entries);
    expect(out[2].adjusted).toBeGreaterThan(60);
    // easy sittings get pulled down, not up
    expect(out[0].adjusted).toBeLessThanOrEqual(75);
  });
  it("falls back to yearAvg when classAvg is missing", () => {
    const entries = [e(75, "Exam", { yearAvg: 70 }), e(60, "Exam", { yearAvg: 50 })];
    const out = detrend(entries);
    expect(out[1].adjusted).toBeGreaterThan(60);
  });
  it("uses a self-reported difficulty only where there is no cohort average (B2)", () => {
    // No average anywhere: the one-tap difficulty is the only signal there is.
    const plain = detrend([e(70)])[0].adjusted;
    const hard = detrend([e(70, "Test", { difficulty: "hard" })])[0].adjusted;
    const easy = detrend([e(70, "Test", { difficulty: "easy" })])[0].adjusted;
    expect(plain).toBe(70); // absent/'normal' ⇒ identity
    expect(hard).toBeGreaterThan(plain); // a brutal paper understates ability
    expect(easy).toBeLessThan(plain);
  });
  it("lets a cohort average override the self-report — no double correction", () => {
    // Both sittings carry the same class average, so the detrend correction is 0
    // and the difficulty tags must not additionally move the scores.
    const out = detrend([
      e(75, "Test", { classAvg: 70, difficulty: "hard" }),
      e(76, "Test", { classAvg: 70, difficulty: "easy" }),
    ]);
    expect(out[0].adjusted).toBe(75);
    expect(out[1].adjusted).toBe(76);
  });
});

describe("percentiles", () => {
  it("uses the Hazen plotting position", () => {
    expect(percentileFromRank(1, 10)).toBeCloseTo(95, 9);
    expect(percentileFromRank(10, 10)).toBeCloseTo(5, 9);
    expect(percentileFromRank(1, 1)).toBeCloseTo(50, 9);
  });
});
