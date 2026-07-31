import { describe, expect, it } from "vitest";
import { roundToTotal, shapleyOf, shapleyValues } from "./shapley";
import { SIGNAL_ADJ_CAP, round2 } from "./params";

/**
 * §3 of the prediction-math audit. The SIGNALS table used to print drop-one
 * marginals, which stop summing to `adj` the moment two or more terms jointly
 * bind the clamp — README §30 carried a whole section explaining why. The
 * explanation was correct and the design was wrong: the efficiency axiom gives
 * additivity for free, so the caveat is fixed rather than documented.
 */

const CAP = SIGNAL_ADJ_CAP;
const clip = (x: number) => Math.min(CAP, Math.max(-CAP, x));
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("shapleyValues — the axioms the table's honesty rests on", () => {
  it("EFFICIENCY: sums to the clamped total when the clamp is BINDING", () => {
    // The exact case the old marginals failed: two terms at +3, cap 4.
    // Drop-one gives each 4 - clip(3) = +1, summing to +2 against adj +4.
    const phi = shapleyValues([3, 3], CAP);
    expect(sum(phi)).toBeCloseTo(clip(6), 12);
    expect(sum(phi)).toBeCloseTo(4, 12);
    // Symmetric players, so the cap is split evenly rather than by order.
    expect(phi[0]).toBeCloseTo(2, 12);
    expect(phi[1]).toBeCloseTo(2, 12);
  });

  it("EFFICIENCY holds on the negative side and on a mixed-sign coalition", () => {
    for (const c of [[-3, -3], [-5, 1, 0.5], [3.2, -1.1, 2.4, 0.9], [2, 2, 2, 2], [1.7, -2.3, 3.1, 0.4, -0.8, 2.2, 1.1]]) {
      expect(sum(shapleyValues(c, CAP)), `contribs ${c}`).toBeCloseTo(clip(sum(c)), 12);
    }
  });

  it("SYMMETRY: two players with identical contributions get identical φ", () => {
    const phi = shapleyValues([2.5, 1.0, 2.5], CAP);
    expect(phi[0]).toBeCloseTo(phi[2], 12);
  });

  it("NULL PLAYER: a zero contribution earns exactly zero, and moves no one else", () => {
    const without = shapleyValues([3, 3], CAP);
    const with0 = shapleyValues([3, 0, 3], CAP);
    expect(with0[1]).toBeCloseTo(0, 12);
    expect(with0[0]).toBeCloseTo(without[0], 12);
    expect(with0[2]).toBeCloseTo(without[1], 12);
  });

  it("agrees with the drop-one marginal exactly when the clamp is SLACK", () => {
    // Unclamped, v is additive, so φ_k = pts_k and both readings coincide —
    // which is why the old column was defensible on most books and wrong on
    // precisely the ones where the layer had the most to say.
    const contribs = [0.4, -0.9, 1.2, 0.05];
    const phi = shapleyValues(contribs, CAP);
    contribs.forEach((c, i) => expect(phi[i]).toBeCloseTo(c, 12));
  });

  it("is deterministic — the same input twice is the same array", () => {
    const c = [1.7, -2.3, 3.1, 0.4, -0.8, 2.2, 1.1];
    expect(shapleyValues(c, CAP)).toEqual(shapleyValues(c, CAP));
  });

  it("handles the empty game and refuses one it cannot enumerate exactly", () => {
    expect(shapleyValues([], CAP)).toEqual([]);
    expect(() => shapleyValues(new Array(13).fill(1), CAP)).toThrow(/exact/i);
  });
});

describe("roundToTotal — the displayed cells sum to the displayed total", () => {
  it("puts the rounding residual on the largest line, mark.ts's own rule", () => {
    const shown = roundToTotal([1.005, 1.005, 1.99], 4);
    expect(sum(shown)).toBeCloseTo(4, 10);
    expect(Math.abs(shown[2])).toBeGreaterThanOrEqual(Math.abs(shown[0]));
  });

  it("is a no-op on an empty vector", () => {
    expect(roundToTotal([], 0)).toEqual([]);
  });
});

describe("shapleyOf — keyed, rounded, and additive against adj", () => {
  it("reproduces adj exactly from the terms, clamp binding or not", () => {
    const cases: { key: string; pts: number }[][] = [
      [{ key: "stock", pts: 3 }, { key: "mastery", pts: 3 }],
      [{ key: "stock", pts: 0.4 }, { key: "rest", pts: -0.9 }, { key: "anxiety", pts: -0.03 }],
      [{ key: "stock", pts: -2.5 }, { key: "rest", pts: -2.5 }, { key: "disruption", pts: -1 }],
      [
        { key: "stock", pts: 1.7 }, { key: "mastery", pts: 2.3 }, { key: "rest", pts: -0.4 },
        { key: "disruption", pts: 0.9 }, { key: "anxiety", pts: -0.02 }, { key: "chronotype", pts: -1.1 },
        { key: "attendance", pts: 0.66 },
      ],
    ];
    for (const terms of cases) {
      // The SAME arithmetic signalRead itself applies: round2(clip(Σ)).
      const adj = round2(clip(sum(terms.map((t) => t.pts))));
      const phi = shapleyOf(terms, CAP);
      expect(sum([...phi.values()]), `terms ${JSON.stringify(terms)}`).toBeCloseTo(adj, 10);
      expect([...phi.keys()]).toEqual(terms.map((t) => t.key));
    }
  });

  it("returns an empty map for a desk that fired no candidate", () => {
    expect(shapleyOf([], CAP).size).toBe(0);
  });
});
