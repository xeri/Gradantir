import { describe, expect, it } from "vitest";
import { priceSubject, projectGrade } from "./price";
import { poolStats } from "./shrinkage";
import { DEFAULT_SETTINGS } from "../../constants";
import type { AssessmentType, GradeEntry, Subject } from "../../types";

let id = 0;
const ge = (date: string, score: number, type: AssessmentType = "Test", extra: Partial<GradeEntry> = {}): GradeEntry => ({
  id: `e${id++}`, subjectId: "s1", date, type, score, title: "", ...extra,
});
const sub = (extra: Partial<Subject> = {}): Subject => ({
  id: "s1", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: null, ...extra,
});
const pool = poolStats([[70, 72, 75], [62, 60, 65], [81, 84, 80]]);
const S = DEFAULT_SETTINGS;

describe("priceSubject", () => {
  it("is null with no prints", () => {
    expect(priceSubject([], pool, S, "2026-07-01")).toBeNull();
  });
  it("prices pure coursework — no exams needed", () => {
    const entries = ["2026-04-01", "2026-04-20", "2026-05-10", "2026-05-30", "2026-06-15"]
      .map((d) => ge(d, 78, "Assignment"));
    const r = priceSubject(entries, pool, S, "2026-07-01")!;
    expect(r.price).toBeGreaterThan(0);
    expect(r.price).toBeLessThanOrEqual(100);
    expect(r.lastExamPct).toBeNull();
    expect(r.lastExamDate).toBeNull();
  });
  it("nests ci50 inside ci90", () => {
    const r = priceSubject([ge("2026-05-01", 70), ge("2026-06-01", 80)], pool, S, "2026-07-01")!;
    expect(r.ci90.lo).toBeLessThanOrEqual(r.ci50.lo);
    expect(r.ci90.hi).toBeGreaterThanOrEqual(r.ci50.hi);
    expect(r.p10).toBeLessThanOrEqual(r.price);
  });
  it("prevPrice reprices without the latest print (null at n=1)", () => {
    expect(priceSubject([ge("2026-06-01", 80)], pool, S, "2026-07-01")!.prevPrice).toBeNull();
    const r = priceSubject([ge("2026-05-01", 70), ge("2026-06-01", 90)], pool, S, "2026-07-01")!;
    expect(r.prevPrice).not.toBeNull();
    expect(r.price).toBeGreaterThan(r.prevPrice!); // the 90 print moved the price up
  });
  it("last exam is picked by date, not array order", () => {
    const entries = [
      ge("2026-06-20", 88, "Exam"),
      ge("2026-03-10", 60, "Exam"),
      ge("2026-06-25", 70, "Test"),
    ];
    const r = priceSubject(entries, pool, S, "2026-07-01")!;
    expect(r.lastExamPct).toBe(88);
    expect(r.lastExamDate).toBe("2026-06-20");
  });
  it("nextExam applies the shrunk exam offset below coursework form", () => {
    const entries = [
      ge("2026-04-01", 82), ge("2026-04-20", 84), ge("2026-05-10", 83),
      ge("2026-05-25", 70, "Exam"), ge("2026-06-10", 72, "Exam"),
    ];
    const r = priceSubject(entries, pool, S, "2026-07-01")!;
    expect(r.nextExam.mean).toBeLessThan(r.price); // exams have paid under coursework
    expect(r.nextExam.ci90.hi).toBeLessThanOrEqual(100);
  });
  it("reports ensemble weights as percentages summing to ~100", () => {
    const r = priceSubject([ge("2026-05-01", 70), ge("2026-05-20", 75), ge("2026-06-10", 72)], pool, S, "2026-07-01")!;
    const total = Object.values(r.weights).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(97);
    expect(total).toBeLessThan(103);
  });
});

describe("projectGrade", () => {
  it("default: coursework is signal, not grade — no exams means no grade", () => {
    const entries = [ge("2026-05-01", 80, "Assignment"), ge("2026-06-01", 85, "Assignment")];
    const p = projectGrade(entries, sub(), S);
    expect(p.mode).toBe("exam-only");
    expect(p.grade).toBeNull();
    expect(p.courseworkAvg).toBe(82.5);
  });
  it("default: exams alone decide the grade", () => {
    const entries = [ge("2026-05-01", 95, "Assignment"), ge("2026-06-01", 70, "Exam"), ge("2026-06-20", 80, "Exam")];
    const p = projectGrade(entries, sub(), S);
    expect(p.mode).toBe("exam-only");
    expect(p.grade).toBe(75);
  });
  it("blend mode mixes by courseworkPct", () => {
    const entries = [ge("2026-05-01", 80, "Test"), ge("2026-06-01", 70, "Exam")];
    const p = projectGrade(entries, sub({ courseworkPct: 40 }), S);
    expect(p.mode).toBe("blend");
    expect(p.grade).toBe(74); // 0.4·80 + 0.6·70
  });
  it("blend falls back to the present side alone", () => {
    const p = projectGrade([ge("2026-05-01", 80, "Test")], sub({ courseworkPct: 40 }), S);
    expect(p.grade).toBe(80);
  });
  it("worth mode overrides everything and reports coverage", () => {
    const entries = [
      ge("2026-05-01", 60, "Test", { worthPct: 20 }),
      ge("2026-06-01", 90, "Exam", { worthPct: 30 }),
      ge("2026-06-10", 100, "Quiz"), // no worth → excluded from the worth grade
    ];
    const p = projectGrade(entries, sub({ courseworkPct: 40 }), S);
    expect(p.mode).toBe("worth");
    expect(p.grade).toBe(78); // (60·20 + 90·30) / 50
    expect(p.worthCoverage).toBe(50);
  });
});
