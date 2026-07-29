import { describe, expect, it } from "vitest";
import { makeSample } from "./sample";
import { buildRounds, examRounds, pendingRound } from "./rounds";
import { inSession } from "./calendar";
import { pDate } from "./utils";

describe("makeSample", () => {
  const end = new Date(2026, 6, 18);
  const data = makeSample(end);

  it("lists the six default desks in order", () => {
    expect(data.subjects.map((s) => s.ticker)).toEqual(["MATH", "ENG", "PHYS", "ECON", "BUS", "GEO"]);
    expect(data.sample).toBe(true);
  });
  it("demos both grading modes: ENG and BUS carry a coursework split", () => {
    const by = new Map(data.subjects.map((s) => [s.ticker, s]));
    expect(by.get("ENG")!.courseworkPct).toBe(60);
    expect(by.get("BUS")!.courseworkPct).toBe(40);
    expect(by.get("MATH")!.courseworkPct).toBeNull();
  });
  it("produces only valid entries", () => {
    const ids = new Set(data.subjects.map((s) => s.id));
    for (const e of data.entries) {
      expect(ids.has(e.subjectId)).toBe(true);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.score).toBeGreaterThanOrEqual(0);
      expect(e.score).toBeLessThanOrEqual(100);
      expect(pDate(e.date).getTime()).toBeLessThanOrEqual(end.getTime());
    }
  });
  it("keeps every rank inside its cohort, and only on exams", () => {
    for (const e of data.entries) {
      if (e.rank != null) {
        expect(e.type).toBe("Exam");
        expect(e.cohortN).not.toBeNull();
        expect(e.rank).toBeGreaterThanOrEqual(1);
        expect(e.rank).toBeLessThanOrEqual(e.cohortN as number);
      }
      if (e.worthPct != null) {
        expect(e.worthPct).toBeGreaterThan(0);
        expect(e.worthPct).toBeLessThanOrEqual(100);
      }
    }
  });
  it("gives the market-depth fields healthy coverage", () => {
    const exams = data.entries.filter((e) => e.type === "Exam");
    expect(exams.length).toBeGreaterThan(10);
    expect(exams.filter((e) => e.rank != null).length / exams.length).toBeGreaterThan(0.4);
    expect(exams.filter((e) => e.yearAvg != null).length / exams.length).toBeGreaterThan(0.25);
    expect(data.entries.some((e) => e.worthPct != null)).toBe(true);
  });
  it("never prints on a day the school was shut", () => {
    // Stronger than the old "skip December and January": every print lands on
    // a weekday inside a term, holidays and weekends included in the ban.
    for (const e of data.entries) expect(inSession(e.date), e.date).toBe(true);
  });
  it("closes every term with an exam round the whole book sits together", () => {
    const rounds = examRounds(buildRounds(data.entries));
    expect(rounds.length).toBeGreaterThanOrEqual(4);
    for (const r of rounds) expect(r.exams).toBe(data.subjects.length);
    // …and names them the way the school does, so the tape reads in English.
    expect(rounds.map((r) => r.name)).toContain("MID");
    expect(rounds.map((r) => r.name)).toContain("EOY");
  });
  it("forecasts a round the demo has not sat yet", () => {
    const p = pendingRound(buildRounds(data.entries), "2026-07-18")!;
    expect(p.key).toBe("2026-T3");
  });
  it("gives every subject a recent result and enough history to chart", () => {
    for (const s of data.subjects) {
      const es = data.entries.filter((e) => e.subjectId === s.id).sort((a, b) => (a.date < b.date ? -1 : 1));
      expect(es.length).toBeGreaterThanOrEqual(10);
      const last = pDate(es[es.length - 1].date).getTime();
      expect(end.getTime() - last).toBeLessThanOrEqual(16 * 864e5);
    }
  });
  it("carries class averages on a healthy share of entries", () => {
    const withClass = data.entries.filter((e) => e.classAvg != null);
    expect(withClass.length / data.entries.length).toBeGreaterThan(0.4);
    expect(withClass.length / data.entries.length).toBeLessThan(0.8);
  });
  it("is deterministic for a fixed end date", () => {
    const again = makeSample(end);
    expect(again.entries.map((e) => e.score)).toEqual(data.entries.map((e) => e.score));
    expect(again.entries.map((e) => e.date)).toEqual(data.entries.map((e) => e.date));
    expect(again.entries.map((e) => e.rank)).toEqual(data.entries.map((e) => e.rank));
    expect(again.entries.map((e) => e.worthPct)).toEqual(data.entries.map((e) => e.worthPct));
  });
});
