import { describe, expect, it } from "vitest";
import { derivationFor } from "./index";
import { fmt } from "./types";
import type { DeriveCtx } from "./types";
import type { Subject, SubjectStat } from "../../types";
import type { SignalRead } from "../quant/signals/signalread";
import type { SignalSkill } from "../quant/signals/signalskill";
import type { StockRead } from "../quant/signals/stock";
import type { MasteryRead } from "../quant/signals/mastery";
import type { VoiItem } from "../quant/signals/voi";
import { SIGNAL_ADJ_CAP, STOCK_FLOOR, STOCK_W, MASTERY_W, MASTERY_SCALE, VOI_EFFORT_SCALE } from "../quant/signals/params";

/**
 * signal.* derivations, on HAND-BUILT nonzero reads.
 *
 * `derive.book.test.ts` exercises these same builders, but only against the
 * committed fixture — which carries no life-signals data at all, so every
 * `SignalRead`/`StockRead`/`MasteryRead` it can build is the identity (adj 0,
 * every term 0). A wrong constant (STOCK_W, MASTERY_SCALE, SIGNAL_KAPPA), an
 * inverted sign, or a mis-stated formula would still pass that suite, since
 * every reconciliation there compares "0.00" to "0.00" and the LaTeX-parse
 * test never inspects a substituted VALUE, only that the string parses.
 *
 * This suite is the one place that actually exercises the arithmetic: every
 * fixture below carries a real, nonzero term, and every assertion checks a
 * substituted number, not just that a note exists. Two things it defends
 * specifically because a reviewer caught them missing:
 *
 *  1. `signal.adjust`'s clamp step must substitute `SignalRead.rawSum` — the
 *     engine's own UNCLAMPED, UNFILTERED pre-clamp total — never a re-summed
 *     `terms` (which drops anything under the 0.05pt display floor and would
 *     silently understate the true total). And the "clamp is binding" note
 *     must fire off `adj` itself (`|adj| >= SIGNAL_ADJ_CAP`, exact), not off
 *     that same unreliable re-summed `terms`.
 *  2. The ADJ cell and the W·ADJ cell open the SAME `signal.adjust` note but
 *     must report DIFFERENT `result.value`s — `ctx.key` selects which.
 */

const TODAY = "2026-07-21";

const SUB = (over: Partial<Subject> = {}): Subject => ({
  id: "s1",
  name: "Subject",
  ticker: "SUB",
  color: "#4D7CFE",
  target: null,
  ...over,
});

const STAT = (sub: Subject): SubjectStat => ({ sub, entries: [], quant: null } as unknown as SubjectStat);

const FIT = (over: Partial<SignalSkill> = {}): SignalSkill => ({
  w: 0.3,
  n: 4,
  youScore: 3.2,
  modelScore: 4.1,
  rawShare: 0.56,
  rounds: 4,
  ...over,
});

describe("signal.adjust — the clamp step quotes rawSum, never a re-summed terms", () => {
  it("substitutes SignalRead.rawSum into the clamp, not the sum of the visible term rows", () => {
    // rawSum (1.23) deliberately does NOT equal the sum of the shown terms'
    // pts (1.20) — exactly the sub-floor-contributor case (a mild attendance
    // shave, an unrounded anxiety term) the old bug silently mis-stated.
    const read: SignalRead = {
      subjectId: "s1",
      adj: 1.2,
      rawSum: 1.23,
      sdMult: 1.1,
      terms: [{ key: "stock", pts: 1.2, note: "STUDY +1.2 · 14D VS OWN NORM" }],
      reasons: ["STUDY +1.2 · 14D VS OWN NORM"],
    };
    const ctx: DeriveCtx = {
      stat: STAT(SUB()),
      signalReads: new Map([["s1", read]]),
      signalFit: FIT(),
      settings: { signalWeighting: true } as never,
    };
    const d = derivationFor("signal.adjust", ctx)!;
    const clampStep = d.steps[1];
    // Everything left of the arrow is Σ itself — must be rawSum (1.23), never
    // the shown terms' own total (1.20), which is what the old (buggy)
    // `shownSum` re-derivation would have substituted instead.
    const [sigmaSide] = clampStep.subst!.split("\\Longrightarrow");
    expect(sigmaSide).toContain(fmt(1.23, 2));
    expect(sigmaSide).not.toContain(fmt(1.2, 2));
    expect(clampStep.note).not.toMatch(/CLAMP IS BINDING/);
  });

  it("fires the clamp-binding note exactly off |adj| >= SIGNAL_ADJ_CAP, and abandons the additivity claim", () => {
    const read: SignalRead = {
      subjectId: "s1",
      adj: SIGNAL_ADJ_CAP, // clamped — the true rawSum (5.5) overshot it
      rawSum: 5.5,
      sdMult: 1.3,
      terms: [
        { key: "stock", pts: 3, note: "STUDY +3.0 · 14D VS OWN NORM" },
        { key: "mastery", pts: 2.5, note: "MASTERY +2.5 · BOOK SAYS 70.0 VS DESK 60.0" },
      ],
      reasons: [],
    };
    const ctx: DeriveCtx = {
      stat: STAT(SUB()),
      signalReads: new Map([["s1", read]]),
      signalFit: FIT(),
      settings: { signalWeighting: true } as never,
    };
    const d = derivationFor("signal.adjust", ctx)!;
    const clampStep = d.steps[1];
    expect(clampStep.subst).toContain(fmt(5.5, 2));
    expect(clampStep.subst).toContain(fmt(SIGNAL_ADJ_CAP, 2));
    expect(clampStep.note).toMatch(/CLAMP IS BINDING/);
    expect(clampStep.note).toMatch(/plain sum/i);
  });

  it("would have missed a clamp that only sub-floor terms pushed over the line, under the old shownSum test", () => {
    // Seven sub-floor terms (~0.35pts total, each under the 0.05 display
    // floor) push the TRUE sum from 3.9 to 4.25 — over the cap — while every
    // VISIBLE term sums to only 3.9. The old `shownSum`-based test read this
    // as non-binding; `adj` (already clamped by the engine to 4) exposes it.
    const read: SignalRead = {
      subjectId: "s1",
      adj: SIGNAL_ADJ_CAP,
      rawSum: 4.25,
      sdMult: 1.0,
      terms: [{ key: "stock", pts: 3.9, note: "STUDY +3.9 · 14D VS OWN NORM" }],
      reasons: [],
    };
    const ctx: DeriveCtx = {
      stat: STAT(SUB()),
      signalReads: new Map([["s1", read]]),
      signalFit: FIT(),
      settings: { signalWeighting: true } as never,
    };
    const d = derivationFor("signal.adjust", ctx)!;
    expect(d.steps[1].note).toMatch(/CLAMP IS BINDING/);
  });
});

describe("signal.adjust — ADJ and W·ADJ are different figures behind the same note", () => {
  it("keys the headline result off ctx.key: 'adj' reports adj, anything else reports w·adj", () => {
    const read: SignalRead = {
      subjectId: "s1",
      adj: -2,
      rawSum: -2,
      sdMult: 1.2,
      terms: [{ key: "rest", pts: -2, note: "REST -2.0 · SLEEP DETERIORATING" }],
      reasons: [],
    };
    const fit = FIT({ w: 0.3 });
    const ctx: DeriveCtx = {
      stat: STAT(SUB()),
      signalReads: new Map([["s1", read]]),
      signalFit: fit,
      settings: { signalWeighting: true } as never,
    };
    const adjD = derivationFor("signal.adjust", { ...ctx, key: "adj" })!;
    const wAdjD = derivationFor("signal.adjust", { ...ctx, key: "wadj" })!;
    const defaultD = derivationFor("signal.adjust", ctx)!;

    expect(adjD.result.value).toBe("-2.00");
    expect(wAdjD.result.value).toBe((-0.6).toFixed(2)); // 0.3 * -2 = -0.6
    expect(defaultD.result.value).toBe(wAdjD.result.value); // absent key falls back to w·adj
    expect(adjD.result.value).not.toBe(wAdjD.result.value);
  });
});

describe("signal.stock — the tanh substitution uses the real constants", () => {
  it("substitutes STOCK_W and the STOCK_FLOOR-clamped denominator correctly", () => {
    const k14 = 500;
    const baseline = 100; // below STOCK_FLOOR (240) — denom must clamp to the floor, not baseline
    const denom = Math.max(baseline, STOCK_FLOOR);
    const term = Math.round(STOCK_W * Math.tanh((k14 - baseline) / denom) * 100) / 100;
    const stock: StockRead = { k14, baseline, term, recallRatio: 0.4, hoursPerWeek: 6 };
    const ctx: DeriveCtx = {
      stat: STAT(SUB()),
      card: { signalStock: { s1: stock } },
    };
    const d = derivationFor("signal.stock", ctx)!;
    const tanhStep = d.steps[2];
    expect(tanhStep.subst).toContain(fmt(k14, 1));
    expect(tanhStep.subst).toContain(fmt(baseline, 1));
    expect(tanhStep.subst).toContain(fmt(denom, 0)); // 240, the FLOOR — not 100
    expect(tanhStep.subst).toContain(fmt(term, 2));
    expect(d.result.value).toBe((term >= 0 ? "+" : "") + term.toFixed(2));
  });
});

describe("signal.mastery — the P equation carries the attendance shave honestly", () => {
  it("branches to the shaved form and substitutes s_att when attendancePct < 95", () => {
    const attendancePct = 80;
    const sAtt = 1 - ((95 - attendancePct) / 100) * 0.5; // mastery.ts's own coveredMassShaved factor
    const modelMean = 60;
    const predictedPaper = 72;
    // Three MARKED topics (nMarked >= MASTERY_MIN_MARKS) carrying 4 marks
    // between them, so the term is actually PRICED (subst defined) rather
    // than gated off.
    const totalMarks = 4;
    const term = Math.round(MASTERY_W * Math.tanh((predictedPaper - modelMean) / MASTERY_SCALE) * Math.min(1, totalMarks / 6) * 100) / 100;
    const mastery: MasteryRead = {
      topics: [
        { topicId: "t1", m: 0.8, mEff: 0.75, lastTouched: TODAY, n: 2 },
        { topicId: "t2", m: 0.7, mEff: 0.65, lastTouched: TODAY, n: 1 },
        { topicId: "t3", m: 0.9, mEff: 0.85, lastTouched: TODAY, n: 1 },
      ],
      coverage: 0.5,
      predictedPaper,
      term,
      unevenness: 0.1,
    };
    const ctx: DeriveCtx = {
      stat: STAT(SUB({ attendancePct })),
      card: { signalMastery: { s1: mastery }, signalModelMean: { s1: modelMean } },
    };
    const d = derivationFor("signal.mastery", ctx)!;
    expect(d.steps[0].tex).toContain("s_{\\text{att}}");
    expect(d.steps[0].subst).toContain(fmt(sAtt, 3));
    expect(d.steps[0].note).toMatch(/80%/);
    expect(d.steps[1].subst).toContain(fmt(term, 2));
    expect(d.result.value).toBe((term >= 0 ? "+" : "") + term.toFixed(2));
  });

  it("does not branch to the shave when attendance is at or above 95%", () => {
    const mastery: MasteryRead = {
      topics: [{ topicId: "t1", m: 0.8, mEff: 0.8, lastTouched: TODAY, n: 4 }],
      coverage: 0.5,
      predictedPaper: 70,
      term: 1,
      unevenness: 0,
    };
    const ctx: DeriveCtx = {
      stat: STAT(SUB({ attendancePct: 98 })),
      card: { signalMastery: { s1: mastery }, signalModelMean: { s1: 60 } },
    };
    const d = derivationFor("signal.mastery", ctx)!;
    expect(d.steps[0].tex).not.toContain("s_{\\text{att}}");
  });

  it("describes the saturation as MARKS, not PAPERS — totalMarks can come from one paper", () => {
    const mastery: MasteryRead = {
      topics: [{ topicId: "t1", m: 0.8, mEff: 0.8, lastTouched: TODAY, n: 6 }],
      coverage: 0.5,
      predictedPaper: 70,
      term: 1,
      unevenness: 0,
    };
    const ctx: DeriveCtx = {
      stat: STAT(SUB()),
      card: { signalMastery: { s1: mastery }, signalModelMean: { s1: 60 } },
    };
    const d = derivationFor("signal.mastery", ctx)!;
    expect(d.steps[1].note).not.toMatch(/marked papers/i);
    expect(d.steps[1].note).toMatch(/marks folded in/i);
  });
});

describe("signal.voi — the score substitution uses VOI_EFFORT_SCALE correctly", () => {
  it("computes score = gainPts / (1 + effortMin/VOI_EFFORT_SCALE) with the real constant", () => {
    const gainPts = 3;
    const effortMin = 15;
    const score = gainPts / (1 + effortMin / VOI_EFFORT_SCALE);
    const item: VoiItem = { subjectId: "s1", ticker: "MATH", domain: "marks", action: "MARK 2 MORE PAPERS", gainPts, effortMin, score };
    const ctx: DeriveCtx = { voi: [item], key: "0" };
    const d = derivationFor("signal.voi", ctx)!;
    expect(d.steps[0].subst).toContain(fmt(score, 3));
    expect(d.result.value).toBe(score.toFixed(3));
    // A wrong scale (e.g. 20 instead of 30) would give a materially different
    // score — pin the actual constant's value so a future edit to
    // VOI_EFFORT_SCALE is forced to update this test consciously.
    expect(VOI_EFFORT_SCALE).toBe(30);
  });
});
