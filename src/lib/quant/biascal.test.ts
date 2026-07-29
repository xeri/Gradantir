import { describe, expect, it } from "vitest";
import { applyBias, fitBias } from "./biascal";
import { BIAS_KAPPA_GLOBAL } from "./params";
import type { ForecastLog } from "../../types";

let seq = 0;
const log = (subjectId: string, error: number, sd = 6): ForecastLog => ({
  id: `f${seq++}`,
  subjectId,
  roundKey: "2026-T2",
  target: "exam",
  createdAt: "2026-05-01",
  modelVersion: "gx-1",
  point: 70,
  sd,
  df: 8,
  ci90: { lo: 60, hi: 80 },
  resolvedEntryId: `e${seq}`,
  resolvedAt: "2026-08-01",
  realized: 70 - error, // error = point − realized
  error,
});

describe("fitBias", () => {
  it("is the identity model on an empty register", () => {
    expect(fitBias([], "exam")).toEqual({ global: 0, bySubject: {}, widthScale: 1, n: 0, nBySubject: {} });
  });

  it("estimates a pooled global offset, shrunk toward zero", () => {
    const logs = Array.from({ length: 10 }, () => log("s1", 2));
    const m = fitBias(logs, "exam");
    // (10·2 + κ·0)/(10+κ): shrunk below the raw +2 but clearly positive.
    expect(m.global).toBeCloseTo((10 * 2) / (10 + BIAS_KAPPA_GLOBAL), 6);
    expect(m.global).toBeGreaterThan(0);
    expect(m.global).toBeLessThan(2);
  });

  it("shrinks a barely-identified per-subject offset HARD toward the global", () => {
    // s2 has one wild +12 error; everyone else is ~0. Its per-subject offset must
    // stay close to the global, not run off to +12 (that is what oscillates).
    const logs = [
      ...Array.from({ length: 8 }, () => log("s1", 0)),
      log("s2", 12),
    ];
    const m = fitBias(logs, "exam");
    expect(m.bySubject.s2).toBeDefined();
    expect(Math.abs(m.bySubject.s2 - m.global)).toBeLessThan(2); // pulled home
    expect(m.bySubject.s2).toBeLessThan(12);
  });

  it("widens the band when realized errors exceed the predicted sd", () => {
    // Overconfident: |error| ≈ 2·sd on every log ⇒ widthScale > 1.
    const overconfident = Array.from({ length: 12 }, (_, i) => log("s1", i % 2 ? 12 : -12, 6));
    expect(fitBias(overconfident, "exam").widthScale).toBeGreaterThan(1);
    // Calibrated: |error| ≈ sd ⇒ widthScale near 1.
    const calibrated = Array.from({ length: 12 }, (_, i) => log("s1", i % 2 ? 6 : -6, 6));
    expect(fitBias(calibrated, "exam").widthScale).toBeLessThan(fitBias(overconfident, "exam").widthScale);
  });

  it("only reads logs matching the requested target", () => {
    const logs = [log("s1", 5), { ...log("s1", -5), target: "price" as const }];
    // Only the "exam" log (error +5) counts.
    expect(fitBias(logs, "exam").n).toBe(1);
  });
});

describe("applyBias", () => {
  const model = { global: 2, bySubject: { s1: 3 }, widthScale: 1.5, n: 10, nBySubject: { s1: 4 } };

  it("subtracts the per-subject offset from the forecast and widens the band", () => {
    const shifted = applyBias({ mean: 70, sd: 6, df: 8 }, model, "s1");
    expect(shifted.mean).toBeCloseTo(67, 6); // 70 − 3
    expect(shifted.sd).toBeCloseTo(9, 6); // 6 × 1.5
  });

  it("falls back to the global offset for an unseen subject", () => {
    const shifted = applyBias({ mean: 70, sd: 6, df: 8 }, model, "unknown");
    expect(shifted.mean).toBeCloseTo(68, 6); // 70 − 2
  });

  it("the identity model leaves the forecast untouched", () => {
    const identity = { global: 0, bySubject: {}, widthScale: 1, n: 0, nBySubject: {} };
    expect(applyBias({ mean: 70, sd: 6, df: 8 }, identity, "s1")).toEqual({ mean: 70, sd: 6, df: 8 });
  });
});
