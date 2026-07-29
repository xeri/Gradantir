import { describe, expect, it } from "vitest";
import { classZ, depthLadder, fitDepth, subjectDepth, withinBandVariance, yearSpread } from "./depth";
import { normCdf } from "./bayes";
import { percentileFromRank } from "./calibration";
import { freshSettings } from "../../constants";
import type { GradeEntry, Settings, Subject } from "../../types";

const sub = (id: string): Subject => ({ id, name: id, ticker: id.toUpperCase(), color: "#4D7CFE", target: null });

let seq = 0;
const e = (
  subjectId: string,
  date: string,
  score: number,
  extra: Partial<GradeEntry> = {},
): GradeEntry => ({
  id: `e${seq++}`, subjectId, date, type: "Exam", score, title: "",
  classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null, ...extra,
});

const withDepth = (patch: Partial<Settings["depth"]> = {}): Settings => {
  const s = freshSettings();
  return { ...s, depth: { ...s.depth, ...patch } };
};

/** Build a book from a truth: a class sitting `premium` above the year mean. */
function synth(opts: { premium: number[]; sigmaClass: number; yearMean: number; subjects: string[] }): GradeEntry[] {
  const { premium, sigmaClass, yearMean, subjects } = opts;
  const out: GradeEntry[] = [];
  const N = 36;
  premium.forEach((prem, p) => {
    const date = `202${4 + Math.floor(p / 4)}-${String((p % 4) * 3 + 2).padStart(2, "0")}-15`;
    subjects.forEach((id, i) => {
      // Spread the placements around so the design matrix is well conditioned.
      const rank = 4 + ((i * 7 + p * 5) % (N - 8));
      const score = yearMean + prem + sigmaClass * classZ(rank, N);
      out.push(e(id, date, Math.round(score * 10) / 10, { rank, cohortN: N, yearAvg: yearMean }));
    });
  });
  return out;
}

describe("cohort geometry", () => {
  it("one stream removes no variance; more streams remove more", () => {
    expect(withinBandVariance(1)).toBe(1);
    expect(withinBandVariance(2)).toBeCloseTo(1 - 2 / Math.PI, 3);
    expect(withinBandVariance(15)).toBeLessThan(withinBandVariance(4));
    expect(withinBandVariance(15)).toBeGreaterThan(0);
  });

  it("the year is only wider than the class when the school actually streams", () => {
    expect(yearSpread(7.7, { streamsPerLevel: 1, yearSize: null, streamTightness: 0 })).toBeCloseTo(7.7, 6);
    expect(yearSpread(7.7, { streamsPerLevel: 15, yearSize: null, streamTightness: 0 })).toBeCloseTo(7.7, 6);
    expect(yearSpread(7.7, { streamsPerLevel: 1, yearSize: null, streamTightness: 0.9 })).toBeCloseTo(7.7, 6);
    // Tight streaming across many bands: the class is a narrow slice of a wide year.
    expect(yearSpread(7.7, { streamsPerLevel: 15, yearSize: null, streamTightness: 0.7 })).toBeGreaterThan(9.5);
  });
});

describe("fitDepth — cohortSD anchors σ_class directly (B3)", () => {
  it("a reported cohort SD drags the inferred within-class spread toward it", () => {
    // A book whose placements imply σ_class ≈ 12, but every print reports the
    // class actually spread only 4 points — the direct measurement wins.
    const book = synth({ premium: [0, 0, 0], sigmaClass: 12, yearMean: 60, subjects: ["a", "b", "c"] });
    const inferred = fitDepth(book, freshSettings());
    const anchored = fitDepth(book.map((x) => ({ ...x, cohortSD: 4 })), freshSettings());
    expect(inferred.sigmaClass).toBeGreaterThan(9);
    expect(anchored.sigmaClass).toBeLessThan(inferred.sigmaClass); // pulled down toward 4
    expect(anchored.sigmaClass).toBeGreaterThan(4); // shrunk by credibility, not replaced
  });

  it("is unchanged when no print carries a cohort SD", () => {
    const book = synth({ premium: [1, -2, 3], sigmaClass: 9, yearMean: 65, subjects: ["a", "b", "c"] });
    const before = fitDepth(book, freshSettings());
    const after = fitDepth(book.map((x) => ({ ...x, cohortSD: null })), freshSettings());
    expect(after.sigmaClass).toBe(before.sigmaClass);
  });
});

describe("fitDepth", () => {
  it("recovers a known within-class spread and per-period premium", () => {
    const truth = [12, 14, 3];
    const entries = synth({ premium: truth, sigmaClass: 8, yearMean: 60, subjects: ["a", "b", "c", "d", "e", "f"] });
    const m = fitDepth(entries, withDepth());
    expect(m.fitted).toBe(true);
    expect(m.sigmaClass).toBeCloseTo(8, 1);
    expect(m.rmse).toBeLessThan(0.2);
    expect(m.groups).toHaveLength(3);
    m.groups.forEach((g, i) => expect(g.premium).toBeCloseTo(truth[i], 0));
  });

  it("flags a book whose classes sit clear of the year level as streamed", () => {
    const streamed = fitDepth(
      synth({ premium: [13, 14, 12], sigmaClass: 8, yearMean: 60, subjects: ["a", "b", "c", "d"] }),
      withDepth(),
    );
    expect(streamed.streamed).toBe(true);
    expect(streamed.premiumMean).toBeGreaterThan(10);

    const flat = fitDepth(
      synth({ premium: [0, 0, 0], sigmaClass: 8, yearMean: 60, subjects: ["a", "b", "c", "d"] }),
      withDepth(),
    );
    expect(flat.streamed).toBe(false);
  });

  it("attributes a single desk's offset to that desk, not to the period", () => {
    const truth = [12, 13, 14, 12];
    const subjects = ["a", "b", "c", "d", "e", "f"];
    const entries = synth({ premium: truth, sigmaClass: 6, yearMean: 60, subjects });
    // Lift every "d" print: that is a property of d's own class, not of the
    // form class — the periods must not absorb it.
    const lifted = entries.map((x) => (x.subjectId === "d" ? { ...x, score: x.score + 12 } : x));
    const m = fitDepth(lifted, withDepth());

    expect(m.basis.d).toBeGreaterThan(5);
    for (const s of subjects.filter((x) => x !== "d")) expect(m.basis[s]).toBeLessThan(0);
    // The premiums survive the lift: each stays within a point or two of truth.
    m.groups.forEach((g, i) => expect(Math.abs(g.premium - truth[i])).toBeLessThan(2.5));
  });

  it("holds the within-class spread down when the design cannot support it", () => {
    // Four desks over two periods is 8 readings for 7 parameters. There is
    // nothing left to estimate a spread from, so it must floor rather than
    // contort itself to fit the noise.
    const entries = synth({ premium: [10, 10], sigmaClass: 6, yearMean: 60, subjects: ["a", "b", "c", "d"] });
    expect(fitDepth(entries, withDepth()).sigmaClass).toBeLessThanOrEqual(6);
  });

  it("declines to fit a book too thin to separate student from class", () => {
    const thin = synth({ premium: [10], sigmaClass: 8, yearMean: 60, subjects: ["a", "b", "c", "d", "e", "f"] });
    const m = fitDepth(thin, withDepth()); // one period only
    expect(m.fitted).toBe(false);
    expect(m.groups).toHaveLength(0);
    expect(m.streamed).toBe(false);
    expect(m.sigmaYear).toBe(m.sigmaClass);
  });

  it("ignores placements that cannot be true", () => {
    const bad = [
      e("a", "2024-02-15", 70, { rank: 40, cohortN: 36, yearAvg: 60 }),
      e("a", "2024-05-15", 70, { rank: 5, cohortN: 1, yearAvg: 60 }),
      e("a", "2024-08-15", 70, { rank: 5, cohortN: null, yearAvg: 60 }),
    ];
    expect(fitDepth(bad, withDepth()).n).toBe(0);
  });

  it("derives the year size from the geometry, and takes an explicit one as given", () => {
    const entries = synth({ premium: [10, 12], sigmaClass: 8, yearMean: 60, subjects: ["a", "b", "c"] });
    expect(fitDepth(entries, withDepth({ streamsPerLevel: 15 })).yearSize).toBe(15 * 36);
    expect(fitDepth(entries, withDepth({ streamsPerLevel: 15, yearSize: 500 })).yearSize).toBe(500);
    expect(fitDepth(entries, withDepth()).yearSize).toBe(36);
  });
});

describe("field position", () => {
  const entries = synth({ premium: [12, 14, 3], sigmaClass: 8, yearMean: 60, subjects: ["a", "b", "c", "d", "e", "f"] });

  it("under the defaults a placement percentile IS the field percentile", () => {
    // No year-level marks anywhere: the engine must not invent a field.
    const bare = entries.map((x) => ({ ...x, yearAvg: null }));
    const model = fitDepth(bare, withDepth());
    const d = subjectDepth(sub("a"), bare.filter((x) => x.subjectId === "a"), model, withDepth())!;
    expect(d.history.length).toBeGreaterThan(0); // else the equality is untested
    for (const r of d.history) expect(r.fieldPct).toBeCloseTo(r.classPct, 1);
  });

  it("separates a placement that held from a field position that did not", () => {
    // Same student, same placement, but the class around them collapses.
    const N = 36;
    const rank = 24;
    const book = [
      e("a", "2025-11-15", 68, { rank, cohortN: N, yearAvg: 59 }),
      e("b", "2025-11-15", 69, { rank: 30, cohortN: N, yearAvg: 58 }),
      e("c", "2025-11-15", 75, { rank: 8, cohortN: N, yearAvg: 62 }),
      e("a", "2026-03-15", 57, { rank: 23, cohortN: 33, yearAvg: 60 }),
      e("b", "2026-03-15", 65, { rank: 20, cohortN: 34, yearAvg: 64 }),
      e("c", "2026-03-15", 56, { rank: 29, cohortN: 29, yearAvg: 58 }),
    ];
    const st = withDepth({ streamsPerLevel: 15, streamTightness: 0.7 });
    const model = fitDepth(book, st);
    const d = subjectDepth(sub("a"), book.filter((x) => x.subjectId === "a"), model, st)!;
    const [before, after] = d.history;

    // The placement barely moved…
    expect(Math.abs(after.classPct - before.classPct)).toBeLessThan(15);
    // …but the field position fell, and the class strength fell with it.
    expect(after.fieldPct).toBeLessThan(before.fieldPct - 20);
    expect(after.premium).toBeLessThan(before.premium - 5);
    expect(after.fieldRank).toBeGreaterThan(before.fieldRank);
  });

  it("a field rank sits inside the year level and improves with the mark", () => {
    const st = withDepth({ streamsPerLevel: 15, streamTightness: 0.7 });
    const model = fitDepth(entries, st);
    const d = subjectDepth(sub("a"), entries.filter((x) => x.subjectId === "a"), model, st)!;
    expect(d.history.length).toBeGreaterThan(0);
    for (const r of d.history) {
      expect(r.fieldRank).toBeGreaterThanOrEqual(1);
      expect(r.fieldRank).toBeLessThanOrEqual(model.yearSize);
      expect(r.fieldRank).toBeCloseTo((1 - normCdf(r.fieldZ)) * model.yearSize, -1);
    }
    expect(d.streamIndex).not.toBeNull();
    expect(d.streamIndex!).toBeGreaterThanOrEqual(1);
    expect(d.streamIndex!).toBeLessThanOrEqual(15);
  });

  it("reports no stream index when there is only one class", () => {
    const model = fitDepth(entries, withDepth());
    expect(subjectDepth(sub("a"), entries.filter((x) => x.subjectId === "a"), model, withDepth())!.streamIndex).toBeNull();
  });
});

describe("depthLadder", () => {
  const entries = synth({ premium: [12, 14, 3], sigmaClass: 8, yearMean: 60, subjects: ["a", "b", "c", "d", "e", "f"] });
  const st = withDepth({ streamsPerLevel: 15, streamTightness: 0.7 });
  const model = fitDepth(entries, st);
  const read = subjectDepth(sub("a"), entries.filter((x) => x.subjectId === "a"), model, st)!.latest;
  const ladder = depthLadder(read, model);

  it("accounts for every student in the year level exactly once", () => {
    const heads = ladder.reduce((a, l) => a + l.count, 0);
    expect(heads).toBeCloseTo(model.yearSize, 6);
  });

  it("accounts for every student in the class exactly once", () => {
    const heads = ladder.reduce((a, l) => a + l.classCount, 0);
    expect(heads).toBeCloseTo(read.cohortN, 6);
  });

  it("reads top-down with exactly one touch, asks above it and bids below", () => {
    for (let i = 1; i < ladder.length; i++) expect(ladder[i].lo).toBeLessThan(ladder[i - 1].lo);
    expect(ladder.filter((l) => l.side === "touch")).toHaveLength(1);
    const touch = ladder.findIndex((l) => l.side === "touch");
    expect(ladder.slice(0, touch).every((l) => l.side === "ask")).toBe(true);
    expect(ladder.slice(touch + 1).every((l) => l.side === "bid")).toBe(true);
  });

  it("puts the touch on the rung holding the mark", () => {
    const touch = ladder.find((l) => l.side === "touch")!;
    expect(read.score).toBeGreaterThanOrEqual(touch.lo);
    expect(read.score).toBeLessThanOrEqual(touch.hi);
  });

  it("never quotes a level outside the 0–100 range", () => {
    expect(Math.min(...ladder.map((l) => l.lo))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ladder.map((l) => l.hi))).toBeLessThanOrEqual(100);
  });
});

describe("classZ", () => {
  it("lands on the textbook normal quantile the placement names", () => {
    // Independently-known standard-normal quantiles, NOT a re-run of the
    // formula under test: rank r of n sits at Hazen percentile 1 − (r−0.5)/n,
    // and classZ must return the z with that cumulative probability.
    expect(classZ(1, 10)).toBeCloseTo(1.6449, 3); //  p = 1 − 0.5/10 = 0.95
    expect(classZ(10, 10)).toBeCloseTo(-1.6449, 3); // p = 0.05  (symmetry)
    expect(classZ(6, 10)).toBeCloseTo(-0.1257, 3); //  p = 0.45
    expect(classZ(1, 4)).toBeCloseTo(1.1503, 3); //    p = 0.875
    expect(classZ(2, 4)).toBeCloseTo(0.3186, 3); //    p = 0.625
  });
  it("inverts the Hazen percentile it is built from", () => {
    for (const [r, n] of [[1, 36], [18, 36], [36, 36], [24, 33]] as const) {
      expect(normCdf(classZ(r, n)) * 100).toBeCloseTo(percentileFromRank(r, n), 4);
    }
  });
});
