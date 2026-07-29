import { describe, expect, it } from "vitest";
import { normPdf, tCdf, type StudentT } from "../bayes";
import { scoreT } from "./scoring";

/** Normal CRPS at the mean, σ=1: 2φ(0) − 1/√π. A hard absolute anchor. */
const NORMAL_CRPS_AT_MEAN = 2 * normPdf(0) - 1 / Math.sqrt(Math.PI);

/** Independent oracle: CRPS(F, y) = ∫ (F(x) − 1{x≥y})² dx by Riemann sum. */
function crpsNumeric(t: StudentT, y: number): number {
  const h = 0.004;
  let s = 0;
  // Midpoint rule over the transition region; the integrand vanishes in both tails.
  for (let x = t.mean - 50 * t.scale; x <= t.mean + 50 * t.scale; x += h) {
    const F = tCdf((x + h / 2 - t.mean) / t.scale, t.df);
    const step = x + h / 2 >= y ? 1 : 0;
    s += (F - step) * (F - step) * h;
  }
  return s;
}

describe("scoreT — CRPS", () => {
  it("is non-negative and collapses to |y − mean| as the scale → 0", () => {
    const s = scoreT({ mean: 70, scale: 1e-6, df: 6 }, 75);
    expect(s.crps).toBeGreaterThanOrEqual(0);
    expect(s.crps).toBeCloseTo(5, 4);
  });
  it("is symmetric about the mean", () => {
    const up = scoreT({ mean: 70, scale: 8, df: 5 }, 82);
    const dn = scoreT({ mean: 70, scale: 8, df: 5 }, 58);
    expect(up.crps).toBeCloseTo(dn.crps, 10);
  });
  it("is scale-equivariant: CRPS(σ··) = σ·CRPS(·)", () => {
    const a = scoreT({ mean: 0, scale: 2, df: 5 }, 3);
    const b = scoreT({ mean: 0, scale: 1, df: 5 }, 1.5);
    expect(a.crps).toBeCloseTo(2 * b.crps, 9);
  });
  it("matches the normal CRPS closed form at huge df", () => {
    const s = scoreT({ mean: 0, scale: 1, df: 1e6 }, 0);
    expect(s.crps).toBeCloseTo(NORMAL_CRPS_AT_MEAN, 4);
  });
  it("matches numerical integration for a small-df, off-centre case", () => {
    const t: StudentT = { mean: 60, scale: 8, df: 5 };
    expect(scoreT(t, 72).crps).toBeCloseTo(crpsNumeric(t, 72), 2);
    expect(scoreT(t, 44).crps).toBeCloseTo(crpsNumeric(t, 44), 2);
  });
});

describe("scoreT — pinball / PIT / coverage / interval score", () => {
  it("pinball at τ=0.5 is half the absolute error about the median", () => {
    const s = scoreT({ mean: 70, scale: 8, df: 5 }, 76);
    expect(s.pinball["0.5"]).toBeCloseTo(0.5 * 6, 6);
  });
  it("PIT is 0.5 at the mean and → 1 far above it", () => {
    expect(scoreT({ mean: 70, scale: 8, df: 5 }, 70).pit).toBeCloseTo(0.5, 9);
    expect(scoreT({ mean: 70, scale: 8, df: 5 }, 1000).pit).toBeGreaterThan(0.999);
  });
  it("50/90 coverage flags fire only inside the central intervals", () => {
    const centre = scoreT({ mean: 70, scale: 8, df: 5 }, 70);
    expect(centre.cover50).toBe(1);
    expect(centre.cover90).toBe(1);
    const far = scoreT({ mean: 70, scale: 8, df: 5 }, 140);
    expect(far.cover50).toBe(0);
    expect(far.cover90).toBe(0);
  });
  it("interval score equals the band width when covered and grows outside it", () => {
    const covered = scoreT({ mean: 70, scale: 8, df: 5 }, 70);
    const outside = scoreT({ mean: 70, scale: 8, df: 5 }, 140);
    expect(outside.is90).toBeGreaterThan(covered.is90);
  });
});
