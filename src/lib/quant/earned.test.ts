import { describe, expect, it } from "vitest";
import { NO_WEIGHT, earnedWeight } from "./earned";

describe("earnedWeight", () => {
  it("is the identity on an empty record", () => {
    expect(earnedWeight([], [], { kappa: 4, cap: 0.45 })).toEqual(NO_WEIGHT);
  });

  it("gives nothing to a forecaster the desk has beaten", () => {
    // You score 8 (bad), the desk scores 2 (good): share = 2/10 = 0.2, then
    // shrunk hard toward zero by the pseudo-observations.
    const e = earnedWeight([8, 8], [2, 2], { kappa: 4, cap: 0.45 });
    expect(e.rawShare).toBeCloseTo(0.2, 10);
    expect(e.w).toBeCloseTo((2 * 0.2) / (2 + 4), 10);
    expect(e.w).toBeLessThan(e.rawShare);
  });

  it("hands weight over as the model is persistently off", () => {
    const soft = earnedWeight([4, 4, 4, 4], [6, 6, 6, 6], { kappa: 4, cap: 0.45 });
    const hard = earnedWeight([1, 1, 1, 1], [9, 9, 9, 9], { kappa: 4, cap: 0.45 });
    expect(hard.w).toBeGreaterThan(soft.w);
    expect(hard.rawShare).toBeCloseTo(0.9, 10);
  });

  it("approaches the earned share slowly, and never reaches it", () => {
    const share = (n: number) => earnedWeight(Array(n).fill(1), Array(n).fill(1), { kappa: 4, cap: 1 }).w;
    // A dead heat is a raw share of 0.5; κ = 4 pseudo-sittings hold it back.
    expect(share(1)).toBeCloseTo(0.5 / 5, 10);
    expect(share(4)).toBeCloseTo(0.5 / 2, 10);
    expect(share(100)).toBeLessThan(0.5);
    expect(share(1)).toBeLessThan(share(4));
  });

  it("caps the weight however good the record", () => {
    const e = earnedWeight(Array(500).fill(0.01), Array(500).fill(50), { kappa: 4, cap: 0.45 });
    expect(e.rawShare).toBeGreaterThan(0.99);
    expect(e.w).toBe(0.45);
  });

  it("reads a dead heat at zero as evidence for neither side", () => {
    // Both forecasters perfect: the ratio is 0/0, which is not a mandate.
    const e = earnedWeight([0, 0], [0, 0], { kappa: 4, cap: 0.45 });
    expect(e.rawShare).toBe(0);
    expect(e.w).toBe(0);
    expect(e.n).toBe(2);
  });

  it("reports the means it judged on", () => {
    const e = earnedWeight([2, 4], [6, 10], { kappa: 4, cap: 0.45 });
    expect(e.youScore).toBeCloseTo(3, 10);
    expect(e.modelScore).toBeCloseTo(8, 10);
    expect(e.n).toBe(2);
  });

  it("refuses to score unpaired records", () => {
    expect(() => earnedWeight([1, 2], [1], { kappa: 4, cap: 0.45 })).toThrow();
  });
});
