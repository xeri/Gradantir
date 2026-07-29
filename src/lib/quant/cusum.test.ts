import { describe, expect, it } from "vitest";
import { cusumDrift } from "./cusum";
import { CUSUM_H } from "./params";
import type { AssessmentType, GradeEntry } from "../../types";

/** Monthly tape builder: scores land 30 days apart, oldest first. */
const tape = (scores: number[], type: AssessmentType = "Test"): GradeEntry[] =>
  scores.map((score, i) => {
    const d = new Date(2025, 0, 15 + 30 * i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { id: `e${i}`, subjectId: "s", date, type, score, title: `P${i}` };
  });

describe("cusumDrift", () => {
  it("returns null below four prints — nothing to accumulate on", () => {
    expect(cusumDrift(tape([70, 72, 71]))).toBeNull();
  });

  it("stays at zero on a steady tape", () => {
    const r = cusumDrift(tape([75, 75, 75, 75, 75, 75]))!;
    expect(r.stat).toBe(0);
    expect(r.alarm).toBe(false);
  });

  it("alarms on a sustained slide", () => {
    const r = cusumDrift(tape([78, 78, 78, 72, 66, 60, 54]))!;
    expect(r.alarm).toBe(true);
    expect(r.stat).toBeGreaterThanOrEqual(CUSUM_H);
  });

  it("does not alarm on a whipsaw that oscillates around a level", () => {
    const r = cusumDrift(tape([70, 80, 70, 80, 70, 80, 70, 80]))!;
    expect(r.alarm).toBe(false);
    expect(r.stat).toBeLessThan(CUSUM_H);
  });

  it("one crash print is a shock, not drift — no alarm; a second one alarms", () => {
    const one = cusumDrift(tape([75, 75, 75, 75, 49], "Exam"))!;
    expect(one.alarm).toBe(false);
    const two = cusumDrift(tape([75, 75, 75, 75, 49, 49], "Exam"))!;
    expect(two.alarm).toBe(true);
  });

  it("recovery bleeds the statistic back down — peak remembers, stat forgives", () => {
    const slide = cusumDrift(tape([78, 78, 78, 68, 62, 58]))!;
    const recovered = cusumDrift(tape([78, 78, 78, 68, 62, 58, 80, 82, 84]))!;
    expect(recovered.stat).toBeLessThan(slide.stat);
    expect(recovered.peak).toBeGreaterThanOrEqual(slide.stat);
  });

  it("is order-independent: a shuffled tape prices identically", () => {
    const scores = [78, 78, 78, 72, 66, 60, 54];
    const sorted = cusumDrift(tape(scores))!;
    const shuffled = cusumDrift([...tape(scores)].reverse())!;
    expect(shuffled).toEqual(sorted);
  });
});
