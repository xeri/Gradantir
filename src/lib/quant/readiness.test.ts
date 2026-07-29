import { describe, expect, it } from "vitest";
import { freshSettings } from "../../constants";
import { READINESS_PRIOR } from "./params";
import { EMPTY_READINESS, readinessBook, readinessFor, readinessSkill } from "./readiness";
import type { Duel, ForecastLog, GradeEntry } from "../../types";

const CAL = freshSettings().calendar;

const IDS = ["a", "b", "c"];

let seq = 0;
const duel = (aId: string, bId: string, winnerId: string, createdAt = "2025-03-01"): Duel =>
  ({ id: `d${++seq}`, aId, bId, winnerId, createdAt });

const exam = (subjectId: string, date: string, score: number): GradeEntry =>
  ({ id: `e-${subjectId}-${date}`, subjectId, date, type: "Exam", score, title: "" });

const log = (subjectId: string, roundKey: string, point: number): ForecastLog => ({
  id: `${subjectId}|${roundKey}|exam|gx-1`, subjectId, roundKey, target: "exam",
  createdAt: "2025-01-01", modelVersion: "gx-1", point, sd: 5, df: 10, ci90: { lo: point - 8, hi: point + 8 },
});

describe("readinessBook", () => {
  it("is empty when nothing has been duelled", () => {
    expect(readinessBook([], IDS, 0)).toBe(EMPTY_READINESS);
  });

  it("centres the cross-section, so a pile cannot move the book's level", () => {
    const duels = [duel("a", "b", "a"), duel("b", "c", "b"), duel("a", "c", "a")];
    const book = readinessBook(duels, IDS, 1);
    const sum = IDS.reduce((t, id) => t + book.get(id)!.lambda, 0);
    expect(sum).toBeCloseTo(0, 10);
  });

  it("reads as Bradley-Terry log-strength: the winner is the ready one", () => {
    const book = readinessBook([duel("a", "b", "a")], ["a", "b"], 1);
    expect(book.get("a")!.lambda).toBeGreaterThan(0);
    expect(book.get("b")!.lambda).toBeLessThan(0);
    // A single K=24 duel is a ~0.14 log-odds edge each way — not a mandate.
    expect(book.get("a")!.lambda).toBeCloseTo(-book.get("b")!.lambda, 10);
  });

  it("separates the desks further as the pile agrees with itself", () => {
    const one = readinessBook([duel("a", "b", "a")], ["a", "b"], 1);
    const many = readinessBook(
      Array.from({ length: 8 }, (_, i) => duel("a", "b", "a", `2025-03-0${(i % 9) + 1}`)),
      ["a", "b"], 1,
    );
    expect(many.get("a")!.lambda).toBeGreaterThan(one.get("a")!.lambda);
  });

  it("holds a thin pile back through the duel-count credibility", () => {
    const thin = readinessBook([duel("a", "b", "a")], ["a", "b"], 1);
    const thick = readinessBook(
      Array.from({ length: 40 }, (_, i) => duel("a", "b", i % 3 ? "a" : "b", `2025-03-${String((i % 28) + 1).padStart(2, "0")}`)),
      ["a", "b"], 1,
    );
    expect(thin.get("a")!.credibility).toBeLessThan(thick.get("a")!.credibility);
    expect(thin.get("a")!.credibility).toBeGreaterThan(0);
  });

  it("scales every desk's charge by the same skill multiplier", () => {
    const duels = [duel("a", "b", "a")];
    const half = readinessBook(duels, ["a", "b"], 0.5);
    const full = readinessBook(duels, ["a", "b"], 1);
    expect(half.get("a")!.credibility).toBeCloseTo(full.get("a")!.credibility / 2, 10);
  });

  it("ignores duels over desks the book no longer lists", () => {
    const book = readinessBook([duel("a", "gone", "gone")], IDS, 1);
    expect(book).toBe(EMPTY_READINESS);
  });
});

describe("readinessSkill", () => {
  const entries = [
    // 2025-T2: the realized order is a > b > c.
    exam("a", "2025-07-01", 80), exam("b", "2025-07-01", 70), exam("c", "2025-07-01", 60),
  ];

  it("charges at the prior before any round has scored it", () => {
    const skill = readinessSkill([], [], [], CAL);
    expect(skill.n).toBe(0);
    expect(skill.w).toBeCloseTo(READINESS_PRIOR, 10);
  });

  it("rewards a pile that called the ordering the desk got wrong", () => {
    // Duels rank a > b > c, exactly right. The desk had it backwards.
    const duels = [
      duel("a", "b", "a", "2025-06-01"), duel("b", "c", "b", "2025-06-01"), duel("a", "c", "a", "2025-06-01"),
    ];
    const wrongModel = [log("a", "2025-T2", 60), log("b", "2025-T2", 70), log("c", "2025-T2", 80)];
    const skill = readinessSkill(duels, entries, wrongModel, CAL);
    expect(skill.n).toBe(1);
    expect(skill.w).toBeGreaterThan(READINESS_PRIOR);
  });

  it("punishes a pile the desk beat", () => {
    const backwards = [
      duel("a", "b", "b", "2025-06-01"), duel("b", "c", "c", "2025-06-01"), duel("a", "c", "c", "2025-06-01"),
    ];
    const rightModel = [log("a", "2025-T2", 80), log("b", "2025-T2", 70), log("c", "2025-T2", 60)];
    const skill = readinessSkill(backwards, entries, rightModel, CAL);
    expect(skill.n).toBe(1);
    expect(skill.w).toBeLessThan(READINESS_PRIOR);
  });

  it("never lets a duel score a round it was recorded after", () => {
    const late = [duel("a", "b", "a", "2025-09-01"), duel("b", "c", "b", "2025-09-01")];
    expect(readinessSkill(late, entries, [], CAL).n).toBe(0);
  });

  it("needs two desks with prints and a separated pile to score a round", () => {
    const oneDesk = [exam("a", "2025-07-01", 80)];
    const duels = [duel("a", "b", "a", "2025-06-01")];
    expect(readinessSkill(duels, oneDesk, [], CAL).n).toBe(0);
  });
});

describe("readinessFor", () => {
  const duels = [duel("a", "b", "a")];

  it("returns nothing when the switch is off — an exact identity at the desk", () => {
    expect(readinessFor(duels, ["a", "b"], 1, false)).toBe(EMPTY_READINESS);
  });

  it("returns nothing on a book that has never duelled", () => {
    expect(readinessFor([], ["a", "b"], 1, true)).toBe(EMPTY_READINESS);
    expect(readinessFor(undefined, ["a", "b"], 1, true)).toBe(EMPTY_READINESS);
  });

  it("prices the pile when the switch is on", () => {
    expect(readinessFor(duels, ["a", "b"], 1, true).size).toBe(2);
  });
});
