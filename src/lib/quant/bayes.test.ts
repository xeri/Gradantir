import { describe, expect, it } from "vitest";
import { betaFn, defaultPrior, gammaln, nigPredictive, nigUpdate, normPdf, predictiveInterval, tCdf, tPdf, tQuantile, truncatedQuantile } from "./bayes";

describe("Student-t CDF / quantile", () => {
  it("is 0.5 at the centre and symmetric", () => {
    expect(tCdf(0, 3)).toBeCloseTo(0.5, 9);
    expect(tCdf(-1.7, 5) + tCdf(1.7, 5)).toBeCloseTo(1, 9);
  });
  it("df=1 is the Cauchy closed form", () => {
    expect(tCdf(1, 1)).toBeCloseTo(0.75, 6); // 0.5 + atan(1)/π
    expect(tQuantile(0.75, 1)).toBeCloseTo(1, 5);
  });
  it("huge df collapses to the normal distribution", () => {
    expect(tCdf(1.959964, 1e6)).toBeCloseTo(0.975, 3);
    expect(tQuantile(0.975, 1e6)).toBeCloseTo(1.96, 2);
  });
  it("quantile inverts the cdf", () => {
    for (const [p, df] of [[0.9, 2], [0.05, 4], [0.5, 7], [0.995, 3]] as const) {
      expect(tCdf(tQuantile(p, df), df)).toBeCloseTo(p, 6);
    }
  });
  it("fat tails at small df: the 95th percentile explodes as df shrinks", () => {
    expect(tQuantile(0.95, 1)).toBeGreaterThan(tQuantile(0.95, 5));
    expect(tQuantile(0.95, 5)).toBeGreaterThan(tQuantile(0.95, 50));
  });
});

describe("gamma / beta / t-density helpers (CRPS building blocks)", () => {
  it("gammaln matches ln of known factorials and Γ(½)=√π", () => {
    expect(gammaln(1)).toBeCloseTo(0, 9);            // 0! = 1
    expect(gammaln(0.5)).toBeCloseTo(0.5723649429, 8); // ln √π
    expect(gammaln(5)).toBeCloseTo(Math.log(24), 8); // 4!
    expect(gammaln(10)).toBeCloseTo(Math.log(362880), 7); // 9!
  });
  it("betaFn matches its closed forms", () => {
    expect(betaFn(1, 1)).toBeCloseTo(1, 9);          // B(1,1) = 1
    expect(betaFn(0.5, 0.5)).toBeCloseTo(Math.PI, 7); // B(½,½) = π
    expect(betaFn(2, 3)).toBeCloseTo(1 / 12, 9);     // Γ2Γ3/Γ5 = 1/12
  });
  it("tPdf is the standard t density: df=1 is the Cauchy closed form", () => {
    expect(tPdf(0, 1)).toBeCloseTo(1 / Math.PI, 9);       // Cauchy peak
    expect(tPdf(1, 1)).toBeCloseTo(1 / (2 * Math.PI), 9); // 1/(π(1+x²))
  });
  it("tPdf is symmetric and collapses to the normal density at huge df", () => {
    expect(tPdf(1.3, 4)).toBeCloseTo(tPdf(-1.3, 4), 12);
    expect(tPdf(0.7, 1e6)).toBeCloseTo(normPdf(0.7), 5);
  });
  it("tPdf integrates to ~1 over a wide grid", () => {
    let area = 0;
    const h = 0.01;
    for (let x = -60; x <= 60; x += h) area += tPdf(x, 3) * h;
    expect(area).toBeCloseTo(1, 3);
  });
});

describe("NIG conjugate update", () => {
  const prior = defaultPrior(null);
  it("no data returns the prior unchanged", () => {
    expect(nigUpdate(prior, [])).toEqual(prior);
  });
  it("a weight-2 observation equals the observation twice", () => {
    expect(nigUpdate(prior, [80], [2])).toEqual(nigUpdate(prior, [80, 80]));
  });
  it("the posterior mean moves toward the data as n grows", () => {
    const n1 = nigUpdate(prior, [90]);
    const n6 = nigUpdate(prior, Array(6).fill(90));
    expect(n1.mu).toBeGreaterThan(prior.mu);
    expect(n6.mu).toBeGreaterThan(n1.mu);
    expect(n6.mu).toBeLessThanOrEqual(90);
  });
  it("predictive df grows with n (2α)", () => {
    const p2 = nigPredictive(nigUpdate(prior, [70, 80]));
    const p8 = nigPredictive(nigUpdate(prior, [70, 80, 70, 80, 70, 80, 70, 80]));
    expect(p8.df).toBeGreaterThan(p2.df);
  });
  it("small n yields honestly wider predictive intervals", () => {
    const p2 = nigPredictive(nigUpdate(prior, [70, 80]));
    const p8 = nigPredictive(nigUpdate(prior, [70, 80, 70, 80, 70, 80, 70, 80]));
    const w2 = predictiveInterval(p2, 0.9);
    const w8 = predictiveInterval(p8, 0.9);
    expect(w2.hi - w2.lo).toBeGreaterThan(w8.hi - w8.lo);
  });
  it("is boundary-aware near the ceiling — the upper bound stays interior (C4b)", () => {
    // A symmetric t at mean 95 would push the 95th quantile past 100 and clamp it
    // there, quietly under-covering. The boundary-aware interval reports the true
    // central interval of the [0,100]-truncated predictive: its upper bound is
    // INSIDE the range, and the interval is asymmetric (more room below the mean).
    const iv = predictiveInterval({ mean: 95, scale: 10, df: 4 }, 0.9);
    expect(iv.hi).toBeGreaterThan(95);
    expect(iv.hi).toBeLessThan(100); // not pinned at the ceiling
    expect(iv.lo).toBeGreaterThanOrEqual(0);
    expect(95 - iv.lo).toBeGreaterThan(iv.hi - 95); // asymmetric toward the interior
  });
  it("is ~symmetric and matches the plain t interval far from any boundary", () => {
    const iv = predictiveInterval({ mean: 60, scale: 6, df: 8 }, 0.9);
    expect(iv.hi - 60).toBeCloseTo(60 - iv.lo, 1); // negligible truncation ⇒ symmetric
  });
  it("truncatedQuantile renormalizes onto [0,100] and stays monotone", () => {
    const t = { mean: 96, scale: 12, df: 5 };
    const q10 = truncatedQuantile(t, 0.1);
    const q90 = truncatedQuantile(t, 0.9);
    expect(q10).toBeGreaterThanOrEqual(0);
    expect(q90).toBeLessThanOrEqual(100);
    expect(q90).toBeGreaterThan(q10);
    // the median of a ceiling-pressed predictive sits below its (unbounded) mean
    expect(truncatedQuantile(t, 0.5)).toBeLessThan(96);
  });
});
