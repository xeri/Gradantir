import { describe, expect, it } from "vitest";
import { examOracle } from "./oracle";
import { poolStats } from "./shrinkage";
import type { AssessmentType, GradeEntry } from "../../types";

/**
 * The oracle's one structural promise: δ̂ is a BRIDGE, so it is crossed once,
 * from the coursework side. The forecast is therefore a blend of two readings
 * of the same quantity and can never land outside them — which is exactly what
 * the old μ̂ + δ̂ construction did, by w·(E − C) every time.
 */

let id = 0;
const ge = (date: string, score: number, type: AssessmentType = "Test"): GradeEntry => ({
  id: `e${id++}`, subjectId: "s1", date, type, score, title: "",
});
const pool = poolStats([[70, 72, 75], [62, 60, 65], [81, 84, 80]]);
const TODAY = "2026-07-01";

/** Three-week cadence ending a fortnight before today. */
const tape = (rows: [number, AssessmentType][]): GradeEntry[] =>
  rows.map(([score, type], i) => {
    const d = new Date(2026, 5, 17);
    d.setDate(d.getDate() - 21 * (rows.length - 1 - i));
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return ge(iso, score, type);
  });

describe("examOracle", () => {
  it("is null only when there is nothing to forecast from", () => {
    expect(examOracle([], pool, TODAY)).toBeNull();
  });

  it("never lands outside the two sides it blends — δ̂ is crossed once, not twice", () => {
    // Coursework 25 points clear of the exams: the case that broke μ̂ + δ̂.
    const r = examOracle(
      tape([[92, "Assignment"], [90, "Assignment"], [94, "Assignment"],
            [66, "Exam"], [64, "Exam"], [67, "Exam"]]),
      pool, TODAY,
    )!;
    const lo = Math.min(r.examSide!, r.cwSide!);
    const hi = Math.max(r.examSide!, r.cwSide!);
    expect(r.mean).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(r.mean).toBeLessThanOrEqual(hi + 1e-9);
  });

  it("a coursework tape far above the exams cannot forecast above the exam tape", () => {
    const r = examOracle(
      tape([[92, "Assignment"], [90, "Assignment"], [94, "Assignment"],
            [66, "Exam"], [64, "Exam"], [67, "Exam"]]),
      pool, TODAY,
    )!;
    // δ̂ < 0 pulls the coursework side down to exam terms, so both sides — and
    // the blend — sit in exam country, not 20 points above it.
    expect(r.cwSide!).toBeLessThan(80);
    expect(r.mean).toBeLessThan(80);
  });

  it("and symmetrically: coursework far below cannot drag the forecast under the exams", () => {
    const r = examOracle(
      tape([[48, "Assignment"], [50, "Assignment"], [46, "Assignment"],
            [78, "Exam"], [80, "Exam"], [77, "Exam"]]),
      pool, TODAY,
    )!;
    const lo = Math.min(r.examSide!, r.cwSide!);
    expect(r.mean).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(r.mean).toBeGreaterThan(60);
  });

  it("an exam-only tape answers alone, and δ̂ is 0 on a coursework-only one", () => {
    const exams = examOracle(tape([[70, "Exam"], [72, "Exam"], [68, "Exam"], [74, "Exam"]]), pool, TODAY)!;
    expect(exams.cwSide).toBeNull();
    expect(exams.examWeight).toBe(1);
    expect(exams.mean).toBeCloseTo(exams.examSide!, 6);

    const cw = examOracle(tape([[70, "Test"], [72, "Test"], [68, "Assignment"], [74, "Test"]]), pool, TODAY)!;
    expect(cw.examSide).toBeNull();
    expect(cw.examWeight).toBe(0);
    expect(cw.offset.delta).toBe(0); // no exams, no bridge to cross
    expect(cw.mean).toBeCloseTo(cw.cwSide!, 6);
  });

  it("disagreement between the sides widens the band", () => {
    const agree = examOracle(
      tape([[70, "Assignment"], [71, "Assignment"], [70, "Exam"], [71, "Exam"], [70, "Exam"], [71, "Exam"]]),
      pool, TODAY,
    )!;
    const split = examOracle(
      tape([[92, "Assignment"], [90, "Assignment"], [58, "Exam"], [82, "Exam"], [56, "Exam"], [84, "Exam"]]),
      pool, TODAY,
    )!;
    expect(split.sd).toBeGreaterThan(agree.sd);
  });

  it("takes the thinner side's tails — a long coursework tape does not buy confidence", () => {
    const r = examOracle(
      tape([[80, "Test"], [78, "Test"], [82, "Test"], [79, "Test"], [81, "Test"],
            [74, "Exam"], [72, "Exam"]]),
      pool, TODAY,
    )!;
    expect(r.df).toBe(3 + 2); // two exams set the df, not the five coursework prints
  });

  it("stays inside [0,100] on a tape pressed against the ceiling", () => {
    const r = examOracle(
      tape([[100, "Assignment"], [99, "Assignment"], [100, "Assignment"], [98, "Exam"], [100, "Exam"], [99, "Exam"]]),
      pool, TODAY,
    )!;
    expect(r.mean).toBeLessThanOrEqual(100);
    expect(r.mean).toBeGreaterThanOrEqual(0);
  });
});
