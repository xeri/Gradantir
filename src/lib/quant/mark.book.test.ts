import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseImport } from "../io";
import { computeStats } from "../stats";
import { pricesAsOf } from "./aggregate";
import { MARK_MAX_DISCOUNT } from "./params";
import type { SubjectStat } from "../../types";

/**
 * Calibration against the committed fixture — a three-year tape anonymised from
 * the real 2024–2026 export: same structure and trajectory shapes, synthetic
 * marks. The harsh mark must tell the truthful, unflattering story of this
 * specific tape. Most of these are behavioral bounds, not snapshot values —
 * retuning a weight should not break them unless it breaks the story.
 */

const TODAY = "2026-07-21"; // the fixture's stamped export date
const raw = readFileSync(fileURLToPath(new URL("../__fixtures__/book.json", import.meta.url)), "utf8");
const parsed = parseImport(raw);
if (!parsed.ok) throw new Error("real book failed to parse");
const { subjects, entries, settings } = parsed.payload;
// The engine is fed the WHOLE book and the results are filtered, exactly as the
// app does it. Filtering first would drop BEA — which ECON and BUS descend from
// — and silently price both on a single print instead of six.
const stats = computeStats(subjects, entries, settings!, TODAY).filter((s) => !s.sub.archived);
const byTicker = new Map(stats.map((s) => [s.sub.ticker, s]));
const desk = (t: string): SubjectStat => {
  const s = byTicker.get(t);
  if (!s) throw new Error(`desk ${t} missing`);
  return s;
};

/**
 * §21 of the README prints these six rows as the engine's output on this book.
 * They are asserted here so that sentence is true: a retune that rewrites the
 * paper's empirical section fails the build instead of quietly disagreeing
 * with it. Population sd, not sample — §21 quotes the spread of six desks, not
 * an estimate of some wider population's.
 */
const psd = (xs: number[]): number => {
  const m = xs.reduce((a, x) => a + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / xs.length);
};
const round2 = (v: number) => Math.round(v * 100) / 100;

describe("§21 · the published table", () => {
  it("reproduces every figure the paper prints", () => {
    const row = (t: string) => {
      const q = desk(t).quant!;
      const f = q.trace!.mark!.factors;
      return {
        ticker: t, n: f.n, fv: q.fv, mark: q.price, discount: q.discount, regime: q.regime,
        rmssd: f.vol, volRatio: f.volRatio, shockZ: f.shockZ, alpha: f.alphaCollapse,
        semiDev: f.semiDev, largest: q.premia[0].label, largestPts: q.premia[0].pts,
      };
    };
    expect(["BUS", "ECON", "MATH", "PHYS", "GEO", "ENG"].map(row)).toEqual([
      { ticker: "BUS",  n: 6,  fv: 81.7, mark: 69.8, discount: 11.9, regime: "STRESSED",
        rmssd: 19.8, volRatio: 1.8, shockZ: 1.7,  alpha: 23.0,  semiDev: 14.2, largest: "INSTABILITY",   largestPts: 4.8 },
      { ticker: "ECON", n: 6,  fv: 71.7, mark: 57.8, discount: 13.9, regime: "DISTRESSED",
        rmssd: 20.4, volRatio: 1.8, shockZ: -0.9, alpha: -7.0,  semiDev: 7.0,  largest: "INSTABILITY",   largestPts: 4.5 },
      { ticker: "MATH", n: 11, fv: 70.8, mark: 60.1, discount: 10.7, regime: "STRESSED",
        rmssd: 7.1,  volRatio: 0.6, shockZ: -1.0, alpha: -13.5, semiDev: 2.8,  largest: "ALPHA EROSION", largestPts: 3.9 },
      { ticker: "PHYS", n: 11, fv: 70.8, mark: 52.8, discount: 18.0, regime: "DISTRESSED",
        rmssd: 12.6, volRatio: 1.1, shockZ: -5.9, alpha: -25.2, semiDev: 3.1,  largest: "INSTABILITY",   largestPts: 4.2 },
      { ticker: "GEO",  n: 11, fv: 64.8, mark: 50.0, discount: 14.8, regime: "DISTRESSED",
        rmssd: 9.0,  volRatio: 0.8, shockZ: -3.5, alpha: -15.0, semiDev: 3.3,  largest: "EXAM SHOCK",    largestPts: 4.1 },
      { ticker: "ENG",  n: 11, fv: 60.3, mark: 48.8, discount: 11.5, regime: "STRESSED",
        rmssd: 5.2,  volRatio: 0.5, shockZ: -1.8, alpha: -11.0, semiDev: 4.8,  largest: "ALPHA EROSION", largestPts: 3.8 },
    ]);
  });

  it("restructures the book: fair value ranks it, the mark re-ranks the whipsaw", () => {
    const order = ["BUS", "ECON", "MATH", "PHYS", "GEO", "ENG"];
    const fv = order.map((t) => desk(t).quant!.fv);
    const mark = order.map((t) => desk(t).quant!.price);
    // Fair value ranks the desks in the published order…
    expect([...fv].sort((a, b) => b - a)).toEqual(fv);
    // …but the mark is harsher on variance than capability alone: ECON prices
    // ABOVE MATH on fair value and is demoted BELOW it once the whipsaw desk's
    // instability discount is charged. That reordering is the whole point.
    expect(desk("ECON").quant!.fv).toBeGreaterThan(desk("MATH").quant!.fv);
    expect(desk("MATH").quant!.price).toBeGreaterThan(desk("ECON").quant!.price);
    // The discount disperses the book rather than compressing it, and the best
    // desk stays top and the weakest bottom right through it.
    expect(psd(mark)).toBeGreaterThan(psd(fv));
    expect([round2(psd(fv)), round2(psd(mark)), round2(psd(mark) / psd(fv) - 1)]).toEqual([6.61, 7.15, 0.08]);
    const byMark = [...stats].sort((a, b) => b.quant!.price - a.quant!.price);
    expect(byMark[0].sub.ticker).toBe("BUS");
    expect(byMark[byMark.length - 1].sub.ticker).toBe("ENG");
    // MATH and PHYS share a fair value but separate hard under the mark — the
    // crash is a discount, not a capability write-down.
    expect(desk("MATH").quant!.fv).toBeCloseTo(desk("PHYS").quant!.fv, 1);
    expect(round2(desk("MATH").quant!.price - desk("PHYS").quant!.price)).toBe(7.3);
  });

  it("MATH's coursework earns a damped credit that never reaches the grade", () => {
    const q = desk("MATH").quant!;
    const cw = q.trace!.mark!.factors.coursework;
    const line = q.premia.find((l) => l.key === "cw")!;
    expect([cw.impliedExam, cw.examAnchor, cw.surpriseZ, line.pts]).toEqual([76.4, 61.9, 2.7, -0.8]);
  });

  it("the oracle forecasts exams from exam-level anchors, never past them", () => {
    // ENG is the case that exposed μ̂ + δ̂: coursework well under the exams, so
    // adding the whole gap to a mean that already held the exams forecast the
    // next paper ABOVE every exam the desk had sat in two years.
    for (const s of stats) {
      const q = s.quant!;
      const o = q.trace!.price.oracle!;
      const lo = Math.min(o.examSide ?? o.cwSide!, o.cwSide ?? o.examSide!);
      const hi = Math.max(o.examSide ?? o.cwSide!, o.cwSide ?? o.examSide!);
      expect(q.nextExam.mean, s.sub.ticker).toBeGreaterThanOrEqual(Math.floor(lo * 10) / 10);
      expect(q.nextExam.mean, s.sub.ticker).toBeLessThanOrEqual(Math.ceil(hi * 10) / 10);
    }
    const eng = desk("ENG").quant!;
    const exams = desk("ENG").entries.filter((e) => e.type === "Exam").map((e) => e.score);
    expect(eng.nextExam.mean).toBeLessThanOrEqual(Math.max(...exams));
    // 62.5, held under ENG's top exam — not the figure above every exam it has
    // sat that μ̂ + δ̂ produced by adding the whole coursework gap to a mean that
    // already held the papers.
    expect([eng.nextExam.mean, eng.carry]).toEqual([62.5, 2.2]);
  });

  it("the book is in a genuinely weak period", () => {
    const b = stats[0].quant!.trace!.mark!.book;
    // Staleness is SESSION days — every desk last printed 2026-04-08, which is
    // 104 calendar days back but only 57 days of teaching. And the median desk
    // is not rising into that silence: momentum sits at or below flat.
    expect(b.medianStaleDays).toBe(57);
    expect(b.medianSlope30).toBeLessThanOrEqual(0);
  });
});

describe("the harsh mark on the real book", () => {
  it("prices every active desk and never above fair value", () => {
    for (const s of stats) {
      expect(s.quant, s.sub.ticker).not.toBeNull();
      const q = s.quant!;
      expect(q.price).toBeLessThanOrEqual(q.fv);
      expect(q.discount).toBeGreaterThanOrEqual(0);
      expect(q.discount).toBeLessThanOrEqual(MARK_MAX_DISCOUNT);
      expect(q.fv - q.price).toBeCloseTo(q.discount, 1);
    }
  });

  it("nothing on this tape is clean — every desk pays some premium", () => {
    for (const s of stats) {
      expect(s.quant!.discount, s.sub.ticker).toBeGreaterThan(0);
      expect(s.quant!.premia.length, s.sub.ticker).toBeGreaterThan(0);
    }
  });

  it("every waterfall sums to its own discount", () => {
    for (const s of stats) {
      const q = s.quant!;
      const sum = q.premia.reduce((a, l) => a + l.pts, 0);
      expect(sum, s.sub.ticker).toBeCloseTo(q.discount, 1);
    }
  });

  it("the weak areas trade at visibly deeper discounts than the mid-book", () => {
    const math = desk("MATH").quant!;
    expect(desk("ENG").quant!.discount).toBeGreaterThan(math.discount);
    expect(desk("PHYS").quant!.discount).toBeGreaterThan(math.discount);
  });

  it("PHYS pays for the 49 crash: an exam-shock line and a stressed regime", () => {
    const q = desk("PHYS").quant!;
    expect(q.premia.some((l) => l.key === "shock" && l.pts > 0)).toBe(true);
    expect(["STRESSED", "DISTRESSED"]).toContain(q.regime);
  });

  it("ENG pays for the slow bleed: momentum/lag/coursework charges, stressed or worse", () => {
    const q = desk("ENG").quant!;
    expect(q.premia.some((l) => ["mom", "lag", "cw", "cusum"].includes(l.key) && l.pts > 0)).toBe(true);
    expect(["STRESSED", "DISTRESSED"]).toContain(q.regime);
  });

  it("the whipsawing desks pay an instability premium even when the latest print is strong", () => {
    for (const t of ["ECON", "BUS"]) {
      expect(desk(t).quant!.premia.some((l) => l.key === "vol" && l.pts > 0), t).toBe(true);
    }
  });

  it("priceDelta measures mark against previous mark, not fair value", () => {
    for (const s of stats) {
      const q = s.quant!;
      if (q.prevPrice == null || s.priceDelta == null) continue;
      expect(s.priceDelta, s.sub.ticker).toBeCloseTo(q.price - q.prevPrice, 1);
    }
  });

  it("today's history reprice agrees with today's board", () => {
    const asOf = pricesAsOf(subjects, entries, settings!, TODAY);
    for (const s of stats) {
      expect(asOf.get(s.sub.id), s.sub.ticker).toBeCloseTo(s.quant!.price, 1);
    }
  });

  it("is deterministic end to end", () => {
    expect(computeStats(subjects, entries, settings!, TODAY).filter((s) => !s.sub.archived)).toEqual(stats);
  });
});
