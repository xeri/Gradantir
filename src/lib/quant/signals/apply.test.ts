import { describe, expect, it } from "vitest";
import type { NextExamForecast, SubjectStat } from "../../../types";
import { applySignals } from "./apply";
import type { SignalRead } from "./signalread";

/**
 * `applySignals` — the post-process that shifts the house nextExam forecast
 * by the earned-weighted signal adjustment and widens its bands by sdMult.
 * Mirrors `applyBias`/`correctNextExam` in `../../stats.ts`: a post-process
 * over an already-priced board, identity (same references) wherever nothing
 * actually moves.
 */

const nextExam = (mean: number, sd: number, ci50: NextExamForecast["ci50"], ci90: NextExamForecast["ci90"]): NextExamForecast => ({
  mean, sd, ci50, ci90,
});

const stat = (id: string, quant: { nextExam: NextExamForecast } | null): SubjectStat =>
  ({
    sub: { id, name: id, ticker: id.toUpperCase(), color: "#333333", target: null },
    entries: [],
    quant,
  }) as unknown as SubjectStat;

const read = (over: Partial<SignalRead>): SignalRead => ({
  subjectId: "s1",
  adj: 0,
  rawSum: 0,
  sdMult: 1,
  terms: [],
  rawTerms: [],
  reasons: [],
  ...over,
});

describe("applySignals — interval math", () => {
  it("shifts the mean and rescales the bands exactly per correctNextExam's formula", () => {
    const nx = nextExam(70, 8, { lo: 63, hi: 77 }, { lo: 57, hi: 83 });
    const stats = [stat("s1", { nextExam: nx })];
    // w = 1 so the shift equals read.adj exactly, keeping the hand values exact.
    const reads = new Map([["s1", read({ adj: 1.2, sdMult: 1.2 })]]);
    const out = applySignals(stats, reads, 1, true);
    const got = out[0].quant!.nextExam;
    expect(got.mean).toBeCloseTo(71.2, 6);
    expect(got.sd).toBeCloseTo(9.6, 6);
    expect(got.ci90.lo).toBeCloseTo(55.6, 6);
    expect(got.ci90.hi).toBeCloseTo(86.8, 6);
    // ci50 half-width (70-63=7, 77-70=7) scaled 1.2 -> 8.4, recentred on 71.2.
    expect(got.ci50.lo).toBeCloseTo(62.8, 6);
    expect(got.ci50.hi).toBeCloseTo(79.6, 6);
  });
});

describe("applySignals — identity paths", () => {
  it("returns the same array reference when !on, regardless of reads", () => {
    const nx = nextExam(70, 8, { lo: 63, hi: 77 }, { lo: 57, hi: 83 });
    const stats = [stat("s1", { nextExam: nx })];
    const reads = new Map([["s1", read({ adj: 5, sdMult: 1.4 })]]);
    expect(applySignals(stats, reads, 0.35, false)).toBe(stats);
  });

  it("returns the same array reference when every read is zero (adj 0, sdMult 1)", () => {
    const nx = nextExam(70, 8, { lo: 63, hi: 77 }, { lo: 57, hi: 83 });
    const stats = [stat("s1", { nextExam: nx }), stat("s2", { nextExam: nx })];
    const reads = new Map([
      ["s1", read({ subjectId: "s1" })],
      ["s2", read({ subjectId: "s2" })],
    ]);
    expect(applySignals(stats, reads, 0.35, true)).toBe(stats);
  });

  it("returns the same array reference when the earned weight is 0 and every sdMult is 1", () => {
    const nx = nextExam(70, 8, { lo: 63, hi: 77 }, { lo: 57, hi: 83 });
    const stats = [stat("s1", { nextExam: nx })];
    const reads = new Map([["s1", read({ adj: 3, sdMult: 1 })]]);
    expect(applySignals(stats, reads, 0, true)).toBe(stats);
  });

  it("a desk missing from the reads map passes through by reference", () => {
    const nx = nextExam(70, 8, { lo: 63, hi: 77 }, { lo: 57, hi: 83 });
    const s1 = stat("s1", { nextExam: nx });
    const stats = [s1];
    const reads = new Map<string, SignalRead>(); // empty — s1 has no read at all
    const out = applySignals(stats, reads, 0.35, true);
    expect(out).toBe(stats);
    expect(out[0]).toBe(s1);
  });

  it("a desk with a read but stat.quant === null is tolerated and passed through by reference", () => {
    const s1 = stat("s1", null);
    const stats = [s1];
    const reads = new Map([["s1", read({ adj: 5, sdMult: 1.4 })]]);
    const out = applySignals(stats, reads, 0.35, true);
    expect(out[0]).toBe(s1);
  });

  it("in a mixed board, an unmoved desk keeps its own reference while a moved one gets a new object", () => {
    const nx = nextExam(70, 8, { lo: 63, hi: 77 }, { lo: 57, hi: 83 });
    const still = stat("s1", { nextExam: nx });
    const moving = stat("s2", { nextExam: nx });
    const stats = [still, moving];
    const reads = new Map([
      ["s1", read({ subjectId: "s1" })], // zero read
      ["s2", read({ subjectId: "s2", adj: 5, sdMult: 1.3 })],
    ]);
    const out = applySignals(stats, reads, 0.35, true);
    expect(out).not.toBe(stats);
    expect(out[0]).toBe(still);
    expect(out[1]).not.toBe(moving);
    expect(out[1].quant).not.toBe(moving.quant);
  });
});

describe("applySignals — sdMult is ungated by w (the humility claim)", () => {
  it("w = 0 but sdMult 1.3 still widens the bands while the mean is unchanged", () => {
    const nx = nextExam(70, 8, { lo: 63, hi: 77 }, { lo: 57, hi: 83 });
    const stats = [stat("s1", { nextExam: nx })];
    const reads = new Map([["s1", read({ adj: 9, sdMult: 1.3 })]]);
    const out = applySignals(stats, reads, 0, true);
    const got = out[0].quant!.nextExam;
    expect(got.mean).toBe(70);
    expect(got.sd).toBeCloseTo(10.4, 6);
    expect(got.ci90.hi - got.ci90.lo).toBeGreaterThan(nx.ci90.hi - nx.ci90.lo);
  });
});
