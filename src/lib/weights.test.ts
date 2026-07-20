import { describe, expect, it } from "vitest";
import { entriesAvg, neededScore, weightFor, weightedAvg } from "./weights";
import { DEFAULT_SETTINGS } from "../constants";
import type { GradeEntry, Settings } from "../types";

const settings: Settings = { weights: { Exam: 3, Test: 2, Assignment: 1.5, Quiz: 1 }, weighted: true };
const flat: Settings = { ...settings, weighted: false };

const entry = (score: number, type: GradeEntry["type"]): GradeEntry =>
  ({ id: "e" + score + type, subjectId: "s", date: "2026-05-01", type, score, title: "" });

describe("weightFor", () => {
  it("returns the configured weight when weighting is on", () => {
    expect(weightFor("Exam", settings)).toBe(3);
    expect(weightFor("Quiz", settings)).toBe(1);
  });
  it("collapses to 1 when weighting is off", () => {
    expect(weightFor("Exam", flat)).toBe(1);
  });
});

describe("weightedAvg / entriesAvg", () => {
  it("returns null on empty input", () => {
    expect(weightedAvg([])).toBeNull();
    expect(entriesAvg([], settings)).toBeNull();
  });
  it("weights exams more than quizzes", () => {
    const es = [entry(100, "Exam"), entry(60, "Quiz")];
    expect(entriesAvg(es, settings)).toBeCloseTo((100 * 3 + 60 * 1) / 4);
    expect(entriesAvg(es, flat)).toBeCloseTo(80);
  });
});

describe("neededScore", () => {
  it("matches the simple formula under unit weights", () => {
    const es = [entry(70, "Test"), entry(80, "Test")];
    // wish * (n+1) - sum
    expect(neededScore(es, flat, 80, "Test")).toBeCloseTo(80 * 3 - 150);
  });
  it("solves the weighted equation exactly", () => {
    const es = [entry(70, "Quiz"), entry(80, "Test")];
    const x = neededScore(es, settings, 82, "Exam");
    const check = (70 * 1 + 80 * 2 + x * 3) / (1 + 2 + 3);
    expect(check).toBeCloseTo(82);
  });
  it("needs a lower score when the next assessment weighs more", () => {
    const es = [entry(60, "Quiz")];
    const viaExam = neededScore(es, settings, 80, "Exam");
    const viaQuiz = neededScore(es, settings, 80, "Quiz");
    expect(viaExam).toBeLessThan(viaQuiz);
  });
  it("works with default settings on an empty term", () => {
    expect(neededScore([], DEFAULT_SETTINGS, 85, "Test")).toBeCloseTo(85);
  });
});
