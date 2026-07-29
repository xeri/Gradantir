import { describe, expect, it } from "vitest";
import {
  computeFactors, courseworkSignal, decayFactor, downsideSemiDev, missStreak, rmssd,
} from "./factors";
import { computeStats } from "../stats";
import { freshSettings } from "../../constants";
import type { GradeEntry, Settings, Subject } from "../../types";

const flat: Settings = { ...freshSettings(), weighted: false };
const subject = (id: string, ticker: string): Subject =>
  ({ id, name: ticker, ticker, color: "#4D7CFE", target: null });

let n = 0;
const entry = (
  subjectId: string, date: string, score: number, type: GradeEntry["type"] = "Test",
): GradeEntry => ({ id: "e" + n++, subjectId, date, type, score, title: "" });

describe("downsideSemiDev", () => {
  it("measures only the downside of a known series", () => {
    expect(downsideSemiDev([-2, 3, -4, 1], 0)).toBeCloseTo(Math.sqrt(5), 3);
  });
  it("is zero when every value sits above the mean", () => {
    expect(downsideSemiDev([5, 6, 7], 4)).toBe(0);
  });
  it("is zero below n=3", () => {
    expect(downsideSemiDev([-9, -9], 0)).toBe(0);
  });
});

describe("rmssd", () => {
  it("catches a whipsaw that deviation-from-median statistics miss", () => {
    expect(rmssd([82, 52, 76, 82])!).toBeCloseTo(Math.sqrt(504), 2);
  });
  it("stays small on a genuinely steady tape", () => {
    expect(rmssd([69, 70, 71, 70, 72])!).toBeLessThan(2);
  });
  it("is null below four prints", () => {
    expect(rmssd([80, 50, 80])).toBeNull();
  });
});

describe("missStreak", () => {
  it("counts consecutive prints under the estimate that stood before them", () => {
    const r = missStreak([80, 80, 80, 70, 62, 55].map((score) => ({ score })));
    expect(r.streak).toBe(3);
    expect(r.avgDeficit).toBeGreaterThan(0);
  });
  it("resets on a beat", () => {
    expect(missStreak([80, 80, 80, 70, 62, 90].map((score) => ({ score }))).streak).toBe(0);
  });
  it("is zero without three priors to forecast from", () => {
    expect(missStreak([80, 80, 60].map((score) => ({ score }))).streak).toBe(0);
  });
});

describe("courseworkSignal", () => {
  const TODAY = "2026-05-10";
  it("implies a negative exam surprise when coursework slides under the exam anchor", () => {
    const es = [
      entry("a", "2026-01-10", 80, "Exam"),
      entry("a", "2026-03-01", 70), entry("a", "2026-03-20", 65),
      entry("a", "2026-04-10", 58), entry("a", "2026-05-01", 55),
    ];
    const cw = courseworkSignal(es, TODAY);
    expect(cw.nExams).toBe(1);
    expect(cw.nCoursework).toBe(4);
    expect(cw.surprise).not.toBeNull();
    expect(cw.surprise!).toBeLessThan(0);
    expect(cw.surpriseZ!).toBeLessThan(0);
    expect(cw.cwSlope30).not.toBeNull();
    expect(cw.cwSlope30!).toBeLessThan(0);
    expect(cw.cwStaleDays).toBe(9);
    expect(cw.cwGapMedian).toBe(21);
  });
  it("implies a positive surprise when coursework runs above the exam anchor", () => {
    const es = [
      entry("a", "2026-01-10", 60, "Exam"),
      entry("a", "2026-03-01", 70), entry("a", "2026-03-20", 75),
      entry("a", "2026-04-10", 82), entry("a", "2026-05-01", 88),
    ];
    const cw = courseworkSignal(es, TODAY);
    expect(cw.surprise!).toBeGreaterThan(0);
    expect(cw.surpriseZ!).toBeGreaterThan(0);
  });
  it("keeps the coursework slope without any exam on file", () => {
    const es = [
      entry("a", "2026-03-01", 80), entry("a", "2026-03-20", 74),
      entry("a", "2026-04-10", 68), entry("a", "2026-05-01", 62),
    ];
    const cw = courseworkSignal(es, TODAY);
    expect(cw.nExams).toBe(0);
    expect(cw.examAnchor).toBeNull();
    expect(cw.surprise).toBeNull();
    expect(cw.cwSlope30!).toBeLessThan(0);
  });
  it("goes quiet without any coursework on file", () => {
    const es = [
      entry("a", "2026-01-10", 70, "Exam"),
      entry("a", "2026-03-01", 72, "Exam"), entry("a", "2026-04-10", 74, "Exam"),
    ];
    const cw = courseworkSignal(es, TODAY);
    expect(cw.nCoursework).toBe(0);
    expect(cw.cwMean).toBeNull();
    expect(cw.cwStaleDays).toBeNull();
    expect(cw.cwGapMedian).toBeNull();
  });
});

describe("decayFactor", () => {
  it("keeps the latest print at full strength", () => {
    expect(decayFactor(0, 0)).toBe(1);
  });
  it("halves after two superseding prints", () => {
    expect(decayFactor(2, 0)).toBeCloseTo(0.5, 6);
  });
  it("only decays on the calendar beyond the stale horizon", () => {
    expect(decayFactor(0, 120)).toBe(1);
    expect(decayFactor(0, 180)).toBeCloseTo(0.5, 6);
  });
  it("is monotone in prints since", () => {
    expect(decayFactor(1, 0)).toBeLessThan(decayFactor(0, 0));
    expect(decayFactor(3, 0)).toBeLessThan(decayFactor(1, 0));
  });
});

describe("computeFactors", () => {
  const TODAY = "2026-06-01";
  const weekly = (subjectId: string, scores: number[], type: GradeEntry["type"] = "Test") =>
    scores.map((s, i) => entry(subjectId, `2026-0${4 + Math.floor(i / 4)}-${String(2 + (i % 4) * 7).padStart(2, "0")}`, s, type));

  it("flags the wild desk against the book's own volatility norm", () => {
    const subs = [subject("a", "AAA"), subject("b", "BBB"), subject("c", "CCC")];
    const es = [
      ...weekly("a", [69, 70, 71, 70, 72]),
      ...weekly("b", [67, 68, 69, 68, 70]),
      ...weekly("c", [55, 85, 50, 90, 60]),
    ];
    const { book, desks } = computeFactors(computeStats(subs, es, flat, TODAY), TODAY);
    expect(book.medianVol).not.toBeNull();
    const wild = desks.find((d) => d.ticker === "CCC")!;
    const steady = desks.find((d) => d.ticker === "AAA")!;
    expect(wild.volRatio!).toBeGreaterThan(1.5);
    expect(steady.volRatio!).toBeLessThanOrEqual(1);
  });
  it("leaves volRatio null on a single-desk book", () => {
    const subs = [subject("c", "CCC")];
    const es = weekly("c", [55, 85, 50, 90, 60]);
    const { desks } = computeFactors(computeStats(subs, es, flat, TODAY), TODAY);
    expect(desks[0].volRatio).toBeNull();
  });
  it("measures volatility on the exam tape once four exams exist", () => {
    const subs = [subject("a", "AAA")];
    const es = [
      ...weekly("a", [80, 50, 80, 50], "Exam"),
      ...weekly("a", [70, 70, 70]).map((e) => ({ ...e, date: "2026-03-" + (10 + Number(e.id.slice(1)) % 3) })),
    ];
    const { desks } = computeFactors(computeStats(subs, es, flat, TODAY), TODAY);
    expect(desks[0].volBasis).toBe("exam");
    expect(desks[0].vol).toBeGreaterThan(10);
  });
  it("reads a significant decline as a negative 30-day slope", () => {
    const subs = [subject("a", "AAA")];
    const es = [80, 76, 72, 68, 64].map((s, i) => entry("a", `2026-0${1 + i}-05`, s));
    const { desks } = computeFactors(computeStats(subs, es, flat, TODAY), TODAY);
    expect(desks[0].slope30).toBeLessThan(-1);
  });
  it("gates the slope to zero below four prints", () => {
    const subs = [subject("a", "AAA")];
    const es = [80, 72, 64].map((s, i) => entry("a", `2026-0${2 + i}-05`, s));
    const { desks } = computeFactors(computeStats(subs, es, flat, TODAY), TODAY);
    expect(desks[0].slope30).toBe(0);
  });
  it("returns an empty, null-normed report for an empty book", () => {
    const { book, desks } = computeFactors([], TODAY);
    expect(desks).toEqual([]);
    expect(book.medianVol).toBeNull();
    expect(book.medianSlope30).toBeNull();
  });
  it("reads a crash as a deep shock against the trailing exam mean", () => {
    const subs = [subject("a", "AAA")];
    const es = [80, 80, 80, 80, 50].map((s, i) => entry("a", `2026-0${1 + i}-05`, s, "Exam"));
    const { desks } = computeFactors(computeStats(subs, es, flat, TODAY), TODAY);
    const d = desks[0];
    expect(d.shock!).toBeCloseTo(-30, 0);
    expect(d.shockZ!).toBeLessThanOrEqual(-5);
    expect(d.downStreak).toBe(1);
  });
  it("compares the latest exam with the same session a year earlier", () => {
    const subs = [subject("a", "AAA")];
    const es = [
      entry("a", "2025-04-10", 75, "Exam"), entry("a", "2025-08-01", 74, "Exam"),
      entry("a", "2025-12-03", 73, "Exam"), entry("a", "2026-04-08", 60, "Exam"),
    ];
    const { desks } = computeFactors(computeStats(subs, es, flat, TODAY), TODAY);
    expect(desks[0].yoyDelta!).toBe(-15);
  });
  it("pairs a same-session exam with its coursework print", () => {
    const subs = [subject("a", "AAA")];
    const es = [
      entry("a", "2025-12-03", 69, "Exam"), entry("a", "2025-12-03", 93, "Assignment"),
      entry("a", "2026-04-08", 65, "Exam"),
    ];
    const { desks } = computeFactors(computeStats(subs, es, flat, TODAY), TODAY);
    expect(desks[0].sessionPairs).toHaveLength(1);
    expect(desks[0].worstPair!.gap).toBe(24);
  });
  it("detects an alpha collapse against the desk's own trailing edge", () => {
    const subs = [subject("a", "AAA")];
    const mk = (date: string, score: number, yearAvg: number) =>
      ({ ...entry("a", date, score, "Exam"), yearAvg });
    const es = [
      mk("2025-04-10", 75, 60), mk("2025-08-01", 76, 61),
      mk("2025-12-03", 74, 59), mk("2026-04-08", 55, 60),
    ];
    const { desks } = computeFactors(computeStats(subs, es, flat, TODAY), TODAY);
    expect(desks[0].alphaLatest!).toBe(-5);
    expect(desks[0].alphaCollapse!).toBeLessThan(-15);
  });
});
