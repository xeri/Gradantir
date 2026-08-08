import { describe, expect, it } from "vitest";
import { makeRng } from "./rng";

/**
 * The one module in the codebase permitted a pseudo-random number generator.
 * Everything that uses it (the cluster bootstrap, the synthetic book generator)
 * must be reproducible, so the sequence is a pure function of the seed and that
 * is what these tests pin.
 */

describe("makeRng", () => {
  it("is a pure function of the seed", () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("gives different sequences for different seeds", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("draws uniforms in [0, 1)", () => {
    const r = makeRng(7);
    let lo = 1;
    let hi = 0;
    let sum = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      sum += v;
    }
    expect(sum / N).toBeCloseTo(0.5, 2);
    expect(lo).toBeLessThan(0.001);
    expect(hi).toBeGreaterThan(0.999);
  });

  it("draws standard normals", () => {
    const r = makeRng(99);
    const N = 40000;
    const xs = Array.from({ length: N }, () => r.gaussian());
    const mean = xs.reduce((a, b) => a + b, 0) / N;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (N - 1));
    expect(mean).toBeCloseTo(0, 1);
    expect(sd).toBeCloseTo(1, 1);
  });

  it("draws integers in range", () => {
    const r = makeRng(3);
    for (let i = 0; i < 5000; i++) {
      const v = r.int(7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });
});
