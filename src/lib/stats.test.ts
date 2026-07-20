import { describe, expect, it } from "vitest";
import { computeStats } from "./stats";
import { compositeNow } from "./composite";
import { iso } from "./utils";
import type { GradeEntry, Settings, Subject } from "../types";

const settings: Settings = { weights: { Exam: 3, Test: 2, Assignment: 1.5, Quiz: 1 }, weighted: true };
const flat: Settings = { ...settings, weighted: false };

const sub: Subject = { id: "a", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: 85 };

/** A date safely inside the current term (today). */
const curDate = iso(new Date());
/** A date safely inside the previous term. */
const prevDate = (() => {
  const now = new Date();
  const t = Math.floor(now.getMonth() / 3);
  return iso(t === 0 ? new Date(now.getFullYear() - 1, 10, 15) : new Date(now.getFullYear(), (t - 1) * 3 + 1, 15));
})();
/** An older current-term date that still sorts before today. */
const curEarly = (() => {
  const now = new Date();
  return iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1));
})();

let n = 0;
const entry = (date: string, score: number, type: GradeEntry["type"] = "Test", classAvg: number | null = null): GradeEntry =>
  ({ id: "e" + n++, subjectId: "a", date, type, score, title: "", classAvg });

describe("computeStats", () => {
  it("computes tick delta from the last two results", () => {
    const [s] = computeStats([sub], [entry(curEarly, 70), entry(curDate, 76)], flat);
    expect(s.latest?.score).toBe(76);
    expect(s.tickDelta).toBe(6);
  });
  it("computes weighted term averages and the period delta", () => {
    const es = [entry(prevDate, 70), entry(curEarly, 60, "Quiz"), entry(curDate, 90, "Exam")];
    const [s] = computeStats([sub], es, settings);
    expect(s.prevAvg).toBe(70);
    expect(s.curAvg).toBeCloseTo((60 * 1 + 90 * 3) / 4, 1);
    expect(s.periodDelta).toBeCloseTo(s.curAvg! - 70, 1);
    const [sFlat] = computeStats([sub], es, flat);
    expect(sFlat.curAvg).toBe(75);
  });
  it("tracks all-time high/low and distance from ATH", () => {
    const [s] = computeStats([sub], [entry(prevDate, 88), entry(curEarly, 62), entry(curDate, 75)], flat);
    expect(s.ath).toBe(88);
    expect(s.athDate).toBe(prevDate);
    expect(s.atl).toBe(62);
    expect(s.fromAth).toBe(-13);
  });
  it("averages alpha only over entries with a class average", () => {
    const [s] = computeStats([sub], [entry(curEarly, 80, "Test", 74), entry(curDate, 70, "Test", 72), entry(curDate, 99)], flat);
    expect(s.alphaCount).toBe(2);
    expect(s.alpha).toBeCloseTo(2); // (+6 + -2) / 2
  });
  it("handles an empty subject", () => {
    const [s] = computeStats([sub], [], settings);
    expect(s.latest).toBeNull();
    expect(s.curAvg).toBeNull();
    expect(s.ath).toBeNull();
    expect(s.forecast).toBeNull();
  });
});

describe("compositeNow", () => {
  it("averages current-term values with fallback to overall", () => {
    const subs: Subject[] = [sub, { ...sub, id: "b", ticker: "ENG" }];
    const es = [
      entry(curDate, 80),
      { ...entry(prevDate, 60), subjectId: "b" }, // b has no current-term data → falls back to overall
    ];
    const stats = computeStats(subs, es, flat);
    const comp = compositeNow(stats);
    expect(comp.value).toBe(70); // (80 + 60) / 2
  });
  it("reports null delta without previous-term data", () => {
    const stats = computeStats([sub], [entry(curDate, 80)], flat);
    expect(compositeNow(stats)).toEqual({ value: 80, delta: null });
  });
});
