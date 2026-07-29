import { describe, expect, it } from "vitest";
import { computeStats } from "./stats";
import { freshSettings } from "../constants";
import { reportingTermOf, termKey } from "./calendar";
import type { GradeEntry, Settings, Subject } from "../types";

const settings: Settings = freshSettings();
const flat: Settings = { ...settings, weighted: false };

const sub: Subject = { id: "a", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: 85 };

/* FROZEN, AND ON THE RIGHT GRID.

   These used to be derived from `new Date()` and bucketed by CALENDAR QUARTER
   (`Math.floor(getMonth() / 3)`). `computeStats` buckets by the REPORTING-TERM
   grid — term start plus `settleDays` — and calendar.ts exists precisely to say
   that a school year is not four quarters. The two grids only coincide for
   about five months in twelve, so the suite was green by luck: it failed on
   2026-08-17, 2026-11-09, 2026-12-31, 2027-02-22 and more, always as
   `expected 60 to be 70` in a test about weighting, which says nothing about
   what actually broke.

   `computeStats` already accepts an injected today. Use it. */
const TODAY = "2026-07-22";
/** Inside T2's reporting window, and the day the board is struck. */
const curDate = "2026-07-22";
/** Same window, earlier — an older current-term print. */
const curEarly = "2026-05-20";
/** Inside T1's window: the previous reporting term. */
const prevDate = "2026-04-10";

let n = 0;
const entry = (date: string, score: number, type: GradeEntry["type"] = "Test", classAvg: number | null = null): GradeEntry =>
  ({ id: "e" + n++, subjectId: "a", date, type, score, title: "", classAvg });

/* The fixtures above encode an assumption about the term grid. Assert it here,
   once, so that changing the published calendar fails with a message naming the
   calendar — instead of surfacing as an unrelated averaging test going red. */
describe("the fixture dates sit where the term grid says", () => {
  it("puts prevDate one reporting term behind curEarly and curDate", () => {
    expect(termKey(reportingTermOf(prevDate))).toBe("2026-T1");
    expect(termKey(reportingTermOf(curEarly))).toBe("2026-T2");
    expect(termKey(reportingTermOf(curDate))).toBe("2026-T2");
    expect(termKey(reportingTermOf(TODAY))).toBe("2026-T2");
  });
});

describe("computeStats", () => {
  it("computes tick delta from the last two results", () => {
    const [s] = computeStats([sub], [entry(curEarly, 70), entry(curDate, 76)], flat, TODAY);
    expect(s.latest?.score).toBe(76);
    expect(s.tickDelta).toBe(6);
  });
  it("computes weighted term averages and the period delta", () => {
    const es = [entry(prevDate, 70), entry(curEarly, 60, "Quiz"), entry(curDate, 90, "Exam")];
    const [s] = computeStats([sub], es, settings, TODAY);
    expect(s.prevAvg).toBe(70);
    expect(s.curAvg).toBeCloseTo((60 * 1 + 90 * 3) / 4, 1);
    expect(s.periodDelta).toBeCloseTo(s.curAvg! - 70, 1);
    const [sFlat] = computeStats([sub], es, flat, TODAY);
    expect(sFlat.curAvg).toBe(75);
  });
  it("tracks all-time high/low and distance from ATH", () => {
    const [s] = computeStats([sub], [entry(prevDate, 88), entry(curEarly, 62), entry(curDate, 75)], flat, TODAY);
    expect(s.ath).toBe(88);
    expect(s.athDate).toBe(prevDate);
    expect(s.atl).toBe(62);
    expect(s.fromAth).toBe(-13);
  });
  it("averages alpha only over entries with a class average", () => {
    const [s] = computeStats([sub], [entry(curEarly, 80, "Test", 74), entry(curDate, 70, "Test", 72), entry(curDate, 99)], flat, TODAY);
    expect(s.alphaCount).toBe(2);
    expect(s.alpha).toBeCloseTo(2); // (+6 + -2) / 2
  });
  it("handles an empty subject", () => {
    const [s] = computeStats([sub], [], settings, TODAY);
    expect(s.latest).toBeNull();
    expect(s.curAvg).toBeNull();
    expect(s.ath).toBeNull();
    expect(s.forecast).toBeNull();
  });
});

describe("quant plumbing", () => {
  it("an empty subject carries null quant, exam-only null grade, null staleness", () => {
    const [s] = computeStats([sub], [], settings, TODAY);
    expect(s.quant).toBeNull();
    expect(s.priceDelta).toBeNull();
    expect(s.gradeProj.mode).toBe("exam-only");
    expect(s.gradeProj.grade).toBeNull();
    expect(s.percentile).toBeNull();
    expect(s.staleDays).toBeNull();
  });
  it("prices from the first print; priceDelta needs two", () => {
    const [one] = computeStats([sub], [entry(curEarly, 80)], settings, TODAY);
    expect(one.quant).not.toBeNull();
    expect(one.priceDelta).toBeNull();
    const [two] = computeStats([sub], [entry(curEarly, 60), entry(curDate, 90)], settings, TODAY);
    expect(two.priceDelta).not.toBeNull();
    expect(two.priceDelta!).toBeGreaterThan(0);
  });
  it("reports the LATEST placement, not an average over history", () => {
    const es = [
      { ...entry(curEarly, 80, "Exam"), rank: 1, cohortN: 10 },
      { ...entry(curDate, 70, "Exam"), rank: 10, cohortN: 10 },
      entry(curDate, 75),
    ];
    const [s] = computeStats([sub], es, settings, TODAY);
    expect(s.classPercentile).toBe(5);
    expect(s.percentileCount).toBe(2);
  });

  it("without year-level marks the field percentile IS the class percentile", () => {
    // Nothing in the book says where the class sits, so the engine must not
    // invent a field: the two readings have to coincide exactly.
    const es = [
      { ...entry(curEarly, 80, "Exam"), rank: 3, cohortN: 40 },
      { ...entry(curDate, 70, "Exam"), rank: 12, cohortN: 40 },
    ];
    const [s] = computeStats([sub], es, settings, TODAY);
    expect(s.percentile).toBeCloseTo(s.classPercentile!, 1);
    expect(s.classPercentile).toBe(71.3); // Hazen 71.25, rounded for display
  });
  it("ages a desk in SCHOOL days under an injected today", () => {
    // 1 → 25 June 2026 is 24 calendar days, but only the weekdays school was
    // actually open count against the desk.
    const [s] = computeStats([sub], [entry("2026-06-01", 80)], settings, "2026-06-25");
    expect(s.staleDays).toBe(18);
  });
  it("never ages a desk over a holiday it could not have printed in", () => {
    // 3 Dec → 15 Jan: the school is shut the whole way.
    const [s] = computeStats([sub], [entry("2025-12-03", 80)], settings, "2026-01-15");
    expect(s.staleDays).toBe(0);
  });
  it("the pool couples subjects: one lonely print shrinks toward the book", () => {
    const other: Subject = { ...sub, id: "b", ticker: "ENG" };
    const es = [
      entry(curEarly, 60), entry(curDate, 62), // subject a — a weak book
      { ...entry(curDate, 95), subjectId: "b" }, // subject b — one hot print
    ];
    const stats = computeStats([sub, other], es, settings, TODAY);
    const b = stats.find((s) => s.sub.id === "b")!;
    expect(b.quant!.price).toBeLessThan(95); // dragged toward the grand mean
  });
});

describe("rating plumbing", () => {
  it("an empty desk is uncovered", () => {
    const [s] = computeStats([sub], [], settings, TODAY);
    expect(s.rating.rating).toBe("N/A");
    expect(s.rating.views).toEqual([]);
    expect(s.ratingPrev).toBeNull();
  });
  it("one print initiates coverage but publishes no view", () => {
    const [s] = computeStats([sub], [entry(curEarly, 80)], settings, TODAY);
    expect(s.rating.rating).toBe("N/A");
    expect(s.rating.note).toContain("COVERAGE INITIATED");
    expect(s.rating.target).not.toBeNull(); // the target exists, the call does not
  });
  it("a covered desk carries a rating, a target and the prior call", () => {
    const es = [entry(prevDate, 60), entry(curEarly, 70), entry(curDate, 80)];
    const [s] = computeStats([sub], es, settings, TODAY);
    expect(s.rating.rating).not.toBe("N/A");
    expect(s.rating.views.length).toBeGreaterThan(0);
    expect(s.rating.target).toBeGreaterThan(0);
    expect(s.ratingPrev).not.toBeNull();
  });
});
