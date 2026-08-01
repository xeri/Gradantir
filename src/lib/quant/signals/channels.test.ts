import { describe, expect, it } from "vitest";
import { SIGNAL_A_MAX, SIGNAL_A_MIN, SIGNAL_CHANNEL_MIN_ROUNDS } from "../params";
import { NO_CHANNEL_FIT, fitSignalChannels } from "./channels";
import { SIGNAL_TERM_ORDER, type SignalRawTerm, type SignalTermKey } from "./signalread";
import type { SignalRound } from "./signalskill";

/**
 * §2 of the prediction-math audit. Seven signal terms used to share one earned
 * weight, so a student could not tell whether the mastery channel was carrying
 * the layer while chronotype was noise, and got no benefit if so. The hand-set
 * constants stay — they are the prior — and measurement moves a multiplier.
 *
 * The identification claim (§2.3) is the load-bearing one: w * a_k is a
 * product, only the product is identified, so a_k is normalised to mean 1 over
 * the channels actually measured and carries RELATIVE credibility only.
 */

const ROUND = (terms: SignalRawTerm[], over: Partial<SignalRound> = {}): SignalRound => ({
  subjectId: "s1",
  cutoff: "2026-04-01",
  rawTerms: terms,
  sdMult: 1,
  point: 70,
  sd: 5,
  df: 8,
  realized: 70,
  modelCrps: 2,
  ...over,
});

/**
 * `n` rounds in which `key` is the only channel firing, reading `truth *
 * factor` against a desk that landed `70 + truth` on a call of 70. So the
 * channel is pointing the right way and is `factor` times too big, and the
 * weight that scores best is exactly `1 / factor`.
 *
 * Keep `truth * factor * SIGNAL_A_MAX` inside SIGNAL_ADJ_CAP (= 4) wherever the
 * test needs the objective to have an interior optimum: past the cap the
 * clamped game is genuinely flat in `a_k`, which is a real property worth
 * testing on purpose (see the tie case) and a silent fixture bug everywhere
 * else. `month` keeps two calls from colliding on a cutoff date; `n` <= 9.
 */
const oversized = (
  key: SignalTermKey, truth: number, factor: number, n: number, month = "04",
): SignalRound[] =>
  Array.from({ length: n }, (_, i) =>
    ROUND([{ key, pts: truth * factor }], { realized: 70 + truth, cutoff: `2026-${month}-0${i + 1}` }),
  );

describe("fitSignalChannels — the prior, held until a channel has a record", () => {
  it("returns every multiplier at exactly 1 with no rounds at all", () => {
    const fit = fitSignalChannels([], true);
    for (const k of SIGNAL_TERM_ORDER) expect(fit.weights[k]).toBe(1);
    expect(fit.rows.every((r) => r.verdict === "UNMEASURED")).toBe(true);
    expect(fit.rounds).toBe(0);
  });

  it("is the identity fit when the channel is switched off", () => {
    expect(fitSignalChannels(oversized("stock", 1, 3, 8), false)).toBe(NO_CHANNEL_FIT);
  });

  it("holds a_k at EXACTLY 1 below the minimum round count", () => {
    const rounds = oversized("stock", 1, 3, SIGNAL_CHANNEL_MIN_ROUNDS - 1);
    const fit = fitSignalChannels(rounds, true);
    expect(fit.weights.stock).toBe(1);
    const row = fit.rows.find((r) => r.key === "stock")!;
    expect(row.verdict).toBe("UNMEASURED");
    expect(row.raw).toBeNull();
    expect(row.normalised).toBeNull();
    expect(row.n).toBe(SIGNAL_CHANNEL_MIN_ROUNDS - 1);
  });

  it("pins Part II §12.4: chronotype can never be measured from a replay", () => {
    // signalskill.ts scores every round with `hour: null`, so the chronotype
    // candidate never fires and its n_k is structurally zero. This test exists
    // so that the day §12.4 is fixed, it fails and is deliberately updated —
    // rather than the channel quietly riding an unmeasured multiplier forever.
    const fit = fitSignalChannels(oversized("stock", 1, 3, 8), true);
    const chrono = fit.rows.find((r) => r.key === "chronotype")!;
    expect(chrono.n).toBe(0);
    expect(chrono.a).toBe(1);
    expect(chrono.verdict).toBe("UNMEASURED");
  });
});

describe("fitSignalChannels — identification (§2.3)", () => {
  // Two measured channels on disjoint rounds: stock reads three times the
  // error it is trying to correct, mastery reads it exactly. Only the RATIO
  // between them is identified — w carries the absolute size — so the best
  // absolute weights (1/3 and 1) normalise to (0.5, 1.5).
  const TWO = [...oversized("stock", 1, 3, 6), ...oversized("mastery", 1, 1, 6, "05")];

  it("normalises to mean EXACTLY 1 over the measured channels", () => {
    const fit = fitSignalChannels(TWO, true);
    const measured = fit.rows.filter((r) => r.normalised != null);
    expect(measured).toHaveLength(2);
    const mean = measured.reduce((a, r) => a + (r.normalised as number), 0) / measured.length;
    expect(mean).toBeCloseTo(1, 10);
  });

  it("recovers the RATIO between a correctly sized channel and a 3x oversized one", () => {
    const fit = fitSignalChannels(TWO, true);
    const stock = fit.rows.find((r) => r.key === "stock")!.normalised as number;
    const mastery = fit.rows.find((r) => r.key === "mastery")!.normalised as number;
    // mastery is right, stock is 3x too big — so mastery pulls about three
    // times the relative credibility stock does. This is the reading the old
    // one-weight-for-seven-channels design could not produce at all.
    expect(mastery / stock).toBeCloseTo(3, 1);
  });

  it("shrinks toward the authored prior, so the shipped a_k sits between the fit and 1", () => {
    const fit = fitSignalChannels(TWO, true);
    for (const key of ["stock", "mastery"] as const) {
      const row = fit.rows.find((r) => r.key === key)!;
      const lo = Math.min(row.normalised as number, 1);
      const hi = Math.max(row.normalised as number, 1);
      expect(row.a, key).toBeGreaterThanOrEqual(lo);
      expect(row.a, key).toBeLessThanOrEqual(hi);
    }
  });

  it("clamps the search at SIGNAL_A_MIN, and every shipped multiplier stays in range", () => {
    // stock reads EIGHT times the error: the weight that would score best is
    // 0.125, outside the bracket, so the fit lands on its floor.
    const rounds = [...oversized("stock", 0.5, 8, 8), ...oversized("mastery", 0.5, 1, 8, "05")];
    const fit = fitSignalChannels(rounds, true);
    expect(fit.rows.find((r) => r.key === "stock")!.raw).toBeCloseTo(SIGNAL_A_MIN, 6);
    for (const r of fit.rows) {
      expect(r.a, r.key).toBeGreaterThanOrEqual(SIGNAL_A_MIN);
      expect(r.a, r.key).toBeLessThanOrEqual(SIGNAL_A_MAX);
    }
  });
});

describe("fitSignalChannels — the flat objective, and the scoreboard", () => {
  it("keeps the prior when the record cannot discriminate (Part II §12.6)", () => {
    // stock reads 100pt, so a_k * pts is clamped to SIGNAL_ADJ_CAP across the
    // WHOLE bracket and no weight scores better than any other. The channel
    // has a record (8 firings, well over the minimum) and the record cannot
    // discriminate, which is exactly the case a bare minimiser answers with an
    // arbitrary point of the flat.
    const rounds = [...oversized("stock", 100, 1, 8), ...oversized("mastery", 1, 1, 8, "05")];
    const fit = fitSignalChannels(rounds, true);
    expect(fit.rows.find((r) => r.key === "stock")!.raw).toBe(1);
    // And the tie must not leak into the OTHER channel through the mean-1
    // normalisation: without the tie rule stock fits 0.25, the mean drops to
    // 0.625, and mastery would print 1.60 despite being exactly right.
    expect(fit.rows.find((r) => r.key === "mastery")!.normalised).toBeCloseTo(1, 10);
    expect(fit.weights.stock).toBe(1);
  });

  it("prices what dropping a channel would cost, in CRPS points", () => {
    const fit = fitSignalChannels(oversized("stock", 1, 1, 8), true);
    const stock = fit.rows.find((r) => r.key === "stock")!;
    // The channel is reading the error exactly right, so dropping it costs.
    expect(stock.dCrps).toBeGreaterThan(0);
    expect(stock.verdict).toBe("CARRIES");
  });

  it("returns rows in SIGNAL_TERM_ORDER, one per channel, always", () => {
    const fit = fitSignalChannels(oversized("stock", 1, 3, 8), true);
    expect(fit.rows.map((r) => r.key)).toEqual([...SIGNAL_TERM_ORDER]);
  });

  it("is deterministic — the same rounds twice are the same fit", () => {
    const rounds = oversized("stock", 1, 3, 8);
    expect(fitSignalChannels(rounds, true)).toEqual(fitSignalChannels(rounds, true));
  });
});
