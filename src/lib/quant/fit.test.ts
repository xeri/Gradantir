import { describe, expect, it } from "vitest";
import { minimise1d } from "./fit";

/**
 * §1.2 of the prediction-math audit specifies the search this module is:
 * "a fixed grid over [0, cap] at 101 steps, then golden-section refinement
 * inside the bracketing interval. Deterministic and reproducible; no
 * unimodality assumption, since the grid guards against a non-convex
 * objective and the refinement only sharpens the located basin."
 *
 * The bimodal case below is the whole argument for the grid. A bare
 * golden-section search started on the full bracket converges into whichever
 * basin its first two probes happen to straddle.
 */

describe("minimise1d — a convex objective", () => {
  it("recovers a known interior minimum", () => {
    const fit = minimise1d((x) => (x - 0.37) * (x - 0.37), 0, 1);
    expect(fit.x).toBeCloseTo(0.37, 5);
    expect(fit.fx).toBeCloseTo(0, 9);
  });

  it("returns the bracket's own endpoint when the minimum sits outside it", () => {
    // Monotone decreasing on [0,1] — the answer is the right endpoint exactly,
    // not an interior point the refinement drifted to.
    expect(minimise1d((x) => -x, 0, 1).x).toBe(1);
    expect(minimise1d((x) => x, 0, 1).x).toBe(0);
  });

  it("never evaluates outside the bracket", () => {
    const seen: number[] = [];
    minimise1d((x) => { seen.push(x); return (x - 2) * (x - 2); }, 0.5, 1.5);
    for (const x of seen) {
      expect(x).toBeGreaterThanOrEqual(0.5);
      expect(x).toBeLessThanOrEqual(1.5);
    }
  });
});

describe("minimise1d — a bimodal objective, the case the grid exists for", () => {
  it("finds the GLOBAL well, not the first one it meets", () => {
    // Shallow well at 0.2 (depth 0.1), deep well at 0.8 (depth 1.0).
    const f = (x: number) =>
      -0.1 * Math.exp(-((x - 0.2) ** 2) / 0.002) - 1.0 * Math.exp(-((x - 0.8) ** 2) / 0.002);
    const fit = minimise1d(f, 0, 1);
    expect(fit.x).toBeCloseTo(0.8, 3);
    expect(fit.fx).toBeLessThan(-0.9);
  });
});

describe("minimise1d — degenerate and deterministic", () => {
  it("handles a zero-width bracket without searching", () => {
    const fit = minimise1d((x) => x, 0.4, 0.4);
    expect(fit.x).toBe(0.4);
    expect(fit.evals).toBe(1);
  });

  it("handles an inverted bracket by returning its low end", () => {
    expect(minimise1d((x) => x, 1, 0).x).toBe(1);
  });

  it("is FLAT-SAFE: a constant objective returns the low end, never a random grid point", () => {
    // Part II §12.6's rule, met here first: a minimiser over a flat lands on an
    // arbitrary point unless the tie is defined. Ties resolve to the SMALLEST
    // x; a caller wanting a different tie (a prior, a `toward`) detects the
    // flat itself and does not ask this function to guess.
    expect(minimise1d(() => 7, 0.25, 2.5).x).toBe(0.25);
  });

  it("is deterministic — the same objective twice is the same result", () => {
    const f = (x: number) => Math.sin(5 * x) + x * x;
    expect(minimise1d(f, 0, 2)).toEqual(minimise1d(f, 0, 2));
  });

  it("spends the grid plus a bounded refinement, not an unbounded search", () => {
    const fit = minimise1d((x) => (x - 0.37) * (x - 0.37), 0, 1);
    expect(fit.evals).toBeGreaterThanOrEqual(101);
    expect(fit.evals).toBeLessThan(160);
  });
});
