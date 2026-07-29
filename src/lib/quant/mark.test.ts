import { describe, expect, it } from "vitest";
import { markDesk, rawPremia, type MarkContext } from "./mark";
import { EFFORT_ACTUAL_W, EFFORT_PLAN_W, MARK_MAX_DISCOUNT, UPSIDE_DAMP } from "./params";
import type { EffortPressure } from "./effort";
import type { BookContext, CourseworkSignal, DeskFactors } from "./factors";

/** A desk with nothing wrong: every premium should stay silent. */
const cleanCw = (): CourseworkSignal => ({
  nExams: 5, nCoursework: 0, cwMean: null, cwSd: null, cwSlope30: null,
  examAnchor: null, delta: 0, impliedExam: null, surprise: null, surpriseZ: null,
  cwStaleDays: null, cwGapMedian: null,
});

const cleanFactors = (over: Partial<DeskFactors> = {}): DeskFactors => ({
  id: "s1", ticker: "TST", n: 8,
  slope30: 0, relSlope30: 0, drawdown: 0,
  vol: 1, volBasis: "exam", volN: 8, volRatio: 0.9, volExpansion: null,
  semiDev: 0, missStreak: 0, avgMissDeficit: 0, downStreak: 0,
  examTrail: null, shock: null, shockZ: null, yoyDelta: null,
  alphaLatest: null, alphaTrail: null, alphaCollapse: null,
  coursework: cleanCw(), sessionPairs: [], worstPair: null,
  targetGap: null, consistent: false,
  ...over,
});

const book: BookContext = {
  desks: 6, medianVol: 5, medianSlope30: 0, medianPrice: 70,
  medianStaleDays: 30, medianCwStaleDays: 60,
};

const fv = { price: 70, sd: 3, horizonDays: 30 };
const ctx = (over: Partial<MarkContext> = {}): MarkContext => ({
  staleDays: 10, examAgeDays: 10, printsSinceExam: 0, cusum: null, effort: null, readiness: null,
  ...over,
});

const ptsOf = (lines: { key: string; pts: number }[], key: string): number =>
  lines.find((l) => l.key === key)?.pts ?? 0;

const effort = (over: Partial<EffortPressure> = {}): EffortPressure => ({
  planRatio: 1, actualRatio: null, planHours: 3.5, actualHours: null, ...over,
});

describe("rawPremia", () => {
  it("a clean steady desk owes nothing", () => {
    expect(rawPremia(fv, cleanFactors(), book, ctx())).toEqual([]);
  });

  it("momentum charges the points bled over one horizon and scales with it", () => {
    const short = rawPremia(fv, cleanFactors({ slope30: -4 }), book, ctx());
    const long = rawPremia({ ...fv, horizonDays: 60 }, cleanFactors({ slope30: -4 }), book, ctx());
    expect(ptsOf(short, "mom")).toBeCloseTo(4, 5);
    expect(ptsOf(long, "mom")).toBeCloseTo(7, 5); // 8 hits the cap
    const rising = rawPremia(fv, cleanFactors({ slope30: 3 }), book, ctx());
    expect(ptsOf(rising, "mom")).toBe(0);
  });

  it("charges nothing for effort until a budget is actually being priced", () => {
    const lines = rawPremia(fv, cleanFactors(), book, ctx());
    expect(ptsOf(lines, "effort")).toBe(0);
    expect(ptsOf(lines, "plan")).toBe(0);
    expect(lines.some((l) => l.key === "plan")).toBe(false);
  });

  it("charges a starved desk on both rings, the actual one far harder", () => {
    const starved = ctx({ effort: effort({ planRatio: 0, actualRatio: 0, actualHours: 0 }) });
    const lines = rawPremia(fv, cleanFactors(), book, starved);
    expect(ptsOf(lines, "effort")).toBeCloseTo(EFFORT_ACTUAL_W, 5);
    expect(ptsOf(lines, "plan")).toBeCloseTo(EFFORT_PLAN_W, 5);
    // "Less" is the whole point of the plan line: it must not rival the actual.
    expect(ptsOf(lines, "plan")).toBeLessThan(ptsOf(lines, "effort") / 2);
  });

  it("charges the plan alone when no actual was ever recorded", () => {
    const lines = rawPremia(fv, cleanFactors(), book, ctx({ effort: effort({ planRatio: 0.2 }) }));
    expect(ptsOf(lines, "effort")).toBe(0);
    expect(ptsOf(lines, "plan")).toBeCloseTo(EFFORT_PLAN_W * 0.8, 5);
  });

  it("scales the charge linearly with the shortfall, and stays silent at a fair share", () => {
    const half = rawPremia(fv, cleanFactors(), book, ctx({ effort: effort({ planRatio: 1, actualRatio: 0.5 }) }));
    expect(ptsOf(half, "effort")).toBeCloseTo(EFFORT_ACTUAL_W * 0.5, 5);
    const fair = rawPremia(fv, cleanFactors(), book, ctx({ effort: effort({ planRatio: 1, actualRatio: 1 }) }));
    expect(ptsOf(fair, "effort")).toBe(0);
    expect(ptsOf(fair, "plan")).toBe(0);
  });

  it("credits an over-resourced desk only a damped fraction, and caps the surplus", () => {
    const lines = rawPremia(fv, cleanFactors(), book, ctx({ effort: effort({ planRatio: 2, actualRatio: 2 }) }));
    expect(ptsOf(lines, "effort")).toBeCloseTo(-EFFORT_ACTUAL_W * UPSIDE_DAMP, 5);
    expect(ptsOf(lines, "plan")).toBeCloseTo(-EFFORT_PLAN_W * UPSIDE_DAMP, 5);
    // Pouring the entire week into one desk earns no more than doubling it.
    const lavish = rawPremia(fv, cleanFactors(), book, ctx({ effort: effort({ planRatio: 6, actualRatio: 6 }) }));
    expect(ptsOf(lavish, "effort")).toBeCloseTo(ptsOf(lines, "effort"), 5);
  });

  it("clearing the actual ring lifts the mark of a desk you were starving", () => {
    const f = cleanFactors();
    const measured = markDesk(fv, f, book, ctx({ effort: effort({ planRatio: 0.4, actualRatio: 0 }) }));
    const cleared = markDesk(fv, f, book, ctx({ effort: effort({ planRatio: 0.4 }) }));
    const off = markDesk(fv, f, book, ctx());
    expect(cleared.mark).toBeGreaterThan(measured.mark);
    expect(off.mark).toBeGreaterThan(cleared.mark);
    // The switch is the only thing that puts the desk back at fair value.
    expect(off.mark).toBe(fv.price);
  });

  it("relative lag charges a desk trailing the book even while flat", () => {
    const lines = rawPremia(fv, cleanFactors({ slope30: 0, relSlope30: -2 }), book, ctx());
    expect(ptsOf(lines, "lag")).toBeCloseTo(1.6, 5);
  });

  it("instability charges swing, scaled up when the book is calmer", () => {
    const own = rawPremia(fv, cleanFactors({ vol: 8, volRatio: 1.0 }), book, ctx());
    const rel = rawPremia(fv, cleanFactors({ vol: 8, volRatio: 1.6 }), book, ctx());
    expect(ptsOf(own, "vol")).toBeGreaterThan(2);
    expect(ptsOf(rel, "vol")).toBeGreaterThan(ptsOf(own, "vol"));
    expect(ptsOf(rawPremia(fv, cleanFactors({ vol: 40, volRatio: 1.6 }), book, ctx()), "vol")).toBe(7);
  });

  it("uncertainty charges error bars only beyond one clean exam's noise", () => {
    expect(ptsOf(rawPremia({ ...fv, sd: 5 }, cleanFactors(), book, ctx()), "unc")).toBe(0);
    expect(ptsOf(rawPremia({ ...fv, sd: 8 }, cleanFactors(), book, ctx()), "unc")).toBeCloseTo(1.8, 5);
  });

  it("a fresh exam shock charges hard and decays as prints supersede it", () => {
    const fresh = rawPremia(fv, cleanFactors({ shockZ: -3 }), book, ctx());
    const superseded = rawPremia(fv, cleanFactors({ shockZ: -3 }), book, ctx({ printsSinceExam: 2, examAgeDays: 60 }));
    expect(ptsOf(fresh, "shock")).toBeCloseTo(4.8, 5);
    expect(ptsOf(superseded, "shock")).toBeCloseTo(ptsOf(fresh, "shock") / 2, 5);
    expect(ptsOf(rawPremia(fv, cleanFactors({ shockZ: 2 }), book, ctx()), "shock")).toBe(0);
  });

  it("downside charges semideviation, miss streaks and down streaks", () => {
    const lines = rawPremia(fv, cleanFactors({ semiDev: 5, missStreak: 2, downStreak: 2 }), book, ctx());
    expect(ptsOf(lines, "down")).toBeCloseTo(0.4 * 5 + 0.7 * 2 + 0.5 * 2, 5);
  });

  it("coursework divergence is loss-averse: full charge down, damped credit up", () => {
    const bad = cleanFactors({ coursework: { ...cleanCw(), surpriseZ: -2, impliedExam: 60 } });
    const good = cleanFactors({ coursework: { ...cleanCw(), surpriseZ: 2, impliedExam: 80 } });
    const penalty = ptsOf(rawPremia(fv, bad, book, ctx()), "cw");
    const credit = ptsOf(rawPremia(fv, good, book, ctx()), "cw");
    expect(penalty).toBeCloseTo(2.8, 5);
    expect(credit).toBeLessThan(0);
    expect(Math.abs(credit) / penalty).toBeCloseTo(UPSIDE_DAMP, 5);
  });

  it("a sinking coursework tape deepens the divergence charge", () => {
    const flat = cleanFactors({ coursework: { ...cleanCw(), surpriseZ: -1, cwSlope30: 0 } });
    const sinking = cleanFactors({ coursework: { ...cleanCw(), surpriseZ: -1, cwSlope30: -4 } });
    expect(ptsOf(rawPremia(fv, sinking, book, ctx()), "cw")).toBeGreaterThan(
      ptsOf(rawPremia(fv, flat, book, ctx()), "cw"),
    );
  });

  it("alpha erosion charges a closing moat and trading under your own reference", () => {
    const lines = rawPremia(fv, cleanFactors({ alphaCollapse: -6, alphaLatest: -3 }), book, ctx());
    expect(ptsOf(lines, "alpha")).toBeCloseTo(0.5 * 6 + 0.35 * 3, 5);
  });

  it("a drift alarm charges only once the CUSUM actually fired", () => {
    const quiet = rawPremia(fv, cleanFactors(), book, ctx({ cusum: { stat: 2, alarm: false, peak: 2 } }));
    const fired = rawPremia(fv, cleanFactors(), book, ctx({ cusum: { stat: 4, alarm: true, peak: 4 } }));
    expect(ptsOf(quiet, "cusum")).toBe(0);
    expect(ptsOf(fired, "cusum")).toBeCloseTo(1.2 * (4 - 2.5 + 1), 5);
  });

  it("a stale tape charges only past the session clock — a term gap is free", () => {
    // Staleness is SCHOOL days: a whole term of silence (~55 in session) costs
    // nothing, two terms of it costs real points. Holidays never accrue at all.
    expect(ptsOf(rawPremia(fv, cleanFactors(), book, ctx({ staleDays: 55 })), "stale")).toBe(0);
    expect(ptsOf(rawPremia(fv, cleanFactors(), book, ctx({ staleDays: 125 })), "stale")).toBeCloseTo(2, 5);
  });

  it("the consistency gate earns a bounded credit", () => {
    const lines = rawPremia(fv, cleanFactors({ consistent: true, vol: 1, slope30: -2 }), book, ctx());
    const credit = ptsOf(lines, "steady");
    expect(credit).toBeLessThan(0);
    expect(credit).toBeGreaterThanOrEqual(-2);
  });
});

describe("markDesk", () => {
  it("a clean desk marks at par: no discount, PRIME, empty waterfall", () => {
    const m = markDesk(fv, cleanFactors(), book, ctx());
    expect(m.mark).toBe(fv.price);
    expect(m.discount).toBe(0);
    expect(m.premia).toEqual([]);
    expect(m.regime).toBe("PRIME");
  });

  it("credits can never push the mark above fair value", () => {
    const angel = cleanFactors({
      consistent: true, slope30: 2,
      coursework: { ...cleanCw(), surpriseZ: 3, impliedExam: 85 },
    });
    const m = markDesk(fv, angel, book, ctx());
    expect(m.mark).toBe(fv.price);
    expect(m.discount).toBe(0);
  });

  it("thin desks are marked gently: credibility shrinks the same exposures", () => {
    const bad = { slope30: -5, vol: 10, volRatio: 1.4, shockZ: -2 };
    const thick = markDesk(fv, cleanFactors({ ...bad, n: 10 }), book, ctx());
    const thin = markDesk(fv, cleanFactors({ ...bad, n: 2 }), book, ctx());
    expect(thin.discount).toBeLessThan(thick.discount);
    expect(thin.discount).toBeGreaterThan(0);
  });

  it("the total discount soft-caps below MARK_MAX_DISCOUNT no matter how ugly the tape", () => {
    const disaster = cleanFactors({
      slope30: -10, relSlope30: -8, vol: 30, volRatio: 1.6, volExpansion: 3,
      semiDev: 12, missStreak: 4, downStreak: 4, shockZ: -6,
      alphaCollapse: -12, alphaLatest: -10,
      coursework: { ...cleanCw(), surpriseZ: -4, cwSlope30: -6 },
    });
    const m = markDesk({ ...fv, sd: 12 }, disaster, book, ctx({ staleDays: 200, cusum: { stat: 8, alarm: true, peak: 8 } }));
    expect(m.discount).toBeLessThan(MARK_MAX_DISCOUNT);
    expect(m.discount).toBeGreaterThan(14);
    expect(m.regime).toBe("DISTRESSED");
  });

  it("the waterfall is exact: displayed lines sum to the discount, harshest first", () => {
    const f = cleanFactors({ slope30: -4, vol: 9, volRatio: 1.3, shockZ: -2, alphaLatest: -4 });
    const m = markDesk(fv, f, book, ctx());
    const sum = m.premia.reduce((a, l) => a + l.pts, 0);
    expect(sum).toBeCloseTo(m.discount, 1);
    const penalties = m.premia.filter((l) => l.pts > 0).map((l) => l.pts);
    expect([...penalties].sort((a, b) => b - a)).toEqual(penalties);
    expect(m.mark).toBeCloseTo(fv.price - m.discount, 5);
  });

  it("a consistency credit visibly nets against real penalties", () => {
    const loose = markDesk(fv, cleanFactors({ slope30: -3, vol: 3 }), book, ctx());
    const tight = markDesk(fv, cleanFactors({ slope30: -3, vol: 3, consistent: true }), book, ctx());
    expect(tight.discount).toBeLessThan(loose.discount);
    expect(tight.premia.some((l) => l.key === "steady" && l.pts < 0)).toBe(true);
  });

  it("regimes step with the discount and an alarm forces at least STRESSED", () => {
    expect(markDesk(fv, cleanFactors({ slope30: -1.2 }), book, ctx()).regime).toBe("PRIME");
    expect(markDesk(fv, cleanFactors({ slope30: -5 }), book, ctx()).regime).toBe("STABLE");
    expect(markDesk(fv, cleanFactors({ slope30: -5, vol: 10, volRatio: 1.5, shockZ: -3 }), book, ctx()).regime).toBe("STRESSED");
    const bumped = markDesk(fv, cleanFactors(), book, ctx({ cusum: { stat: 3, alarm: true, peak: 3 } }));
    expect(bumped.regime).toBe("STRESSED");
  });
});

describe("markDesk — premium ablation seam", () => {
  it("dropping a premium removes its line and lowers the discount", () => {
    const f = cleanFactors({ slope30: -4, vol: 9, volRatio: 1.3 });
    const full = markDesk(fv, f, book, ctx());
    const noMom = markDesk(fv, f, book, ctx(), { drop: new Set(["mom"]) });
    expect(full.premia.some((l) => l.key === "mom")).toBe(true);
    expect(noMom.premia.some((l) => l.key === "mom")).toBe(false);
    expect(noMom.discount).toBeLessThan(full.discount);
  });
  it("an empty drop set is identical to the default", () => {
    const f = cleanFactors({ slope30: -4, vol: 9, volRatio: 1.3, shockZ: -2 });
    expect(markDesk(fv, f, book, ctx(), { drop: new Set() })).toEqual(markDesk(fv, f, book, ctx()));
  });
});
