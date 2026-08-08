import { describe, expect, it } from "vitest";
import { backtestBook } from "./backtest";
import { synthBook } from "./synth";

/**
 * The generator exists for two jobs and is allowed no third.
 *
 * POWER — 30 books give a sampling distribution the one committed fixture
 * cannot; that is how estimator STRUCTURE gets chosen honestly.
 * CORRECTNESS — an estimator that cannot recover truth on data drawn from its
 * OWN assumptions has a bug, and a CRPS number will absorb that bug silently.
 *
 * What it may NOT do is tune a constant. Synthetic data is generated from the
 * model's assumptions, so tuning against it optimises the assumptions rather
 * than the world. The real book, through the gate, decides what ships.
 */

const BASE = {
  subjects: 4,
  printsPerSubject: 9,
  qPerDay: 0.06,
  tauDifficulty: 0,
  gapDays: 30,
  censorAt: null,
};

describe("synthBook", () => {
  it("is a pure function of the seed", () => {
    expect(synthBook({ ...BASE, seed: 42 })).toEqual(synthBook({ ...BASE, seed: 42 }));
  });

  it("gives different books for different seeds", () => {
    const a = synthBook({ ...BASE, seed: 1 }).data.entries.map((e) => e.score);
    const b = synthBook({ ...BASE, seed: 2 }).data.entries.map((e) => e.score);
    expect(a).not.toEqual(b);
  });

  it("emits a parseable book of the requested size", () => {
    const { data } = synthBook({ ...BASE, seed: 5 });
    expect(data.subjects.length).toBe(4);
    expect(data.entries.length).toBe(36);
    for (const e of data.entries) {
      expect(e.score).toBeGreaterThanOrEqual(0);
      expect(e.score).toBeLessThanOrEqual(100);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(data.subjects.some((s) => s.id === e.subjectId)).toBe(true);
    }
  });

  it("respects the censoring ceiling when one is set", () => {
    const { data } = synthBook({ ...BASE, seed: 11, censorAt: 90 });
    expect(data.entries.every((e) => e.score <= 90)).toBe(true);
    expect(data.entries.some((e) => e.censored === true)).toBe(true);
  });

  it("emits no censored flag when no ceiling is set", () => {
    const { data } = synthBook({ ...BASE, seed: 11 });
    expect(data.entries.every((e) => !e.censored)).toBe(true);
  });
});

describe("the engine on data drawn from its own assumptions", () => {
  /** Mean realized 90% coverage over `n` independently seeded books. */
  const coverageOver = (n: number, opts: Partial<typeof BASE>): number => {
    let covered = 0;
    let total = 0;
    for (let seed = 1; seed <= n; seed++) {
      const { data } = synthBook({ ...BASE, ...opts, seed });
      const bt = backtestBook(data.subjects, data.entries);
      for (const s of bt.subjects) {
        for (const p of s.points) { covered += p.s.cover90; total++; }
      }
    }
    return total ? covered / total : 0;
  };

  it("covers close to 90% when the generator matches the model", () => {
    // No paper-difficulty term, no censoring: a local-level random walk with
    // per-type observation noise, which is exactly what kalman.ts assumes.
    const cov = coverageOver(30, { tauDifficulty: 0 });
    expect(cov).toBeGreaterThan(0.82);
    expect(cov).toBeLessThan(0.97);
  });

  it("loses coverage when the generator adds difficulty the model cannot see", () => {
    // A shared per-sitting difficulty shock with no class average to detrend
    // against is misspecification, and the harness must be able to SEE it —
    // otherwise it cannot adjudicate the difficulty work in Phase C.
    const matched = coverageOver(30, { tauDifficulty: 0 });
    const misspecified = coverageOver(30, { tauDifficulty: 8 });
    expect(misspecified).toBeLessThan(matched);
  });
});
