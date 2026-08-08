/**
 * The ONLY pseudo-random source in the engine, and it is seeded.
 *
 * `utils.ts`'s `uid()` aside, nothing in the calculation layer may call
 * `Math.random()` — every figure on the board is a pure function of the book,
 * and two people holding the same book must get the same numbers (README §26).
 * The cluster bootstrap and the synthetic book generator genuinely need
 * randomness, so they get it from here, where the sequence is a pure function
 * of an integer the caller supplies and pins in a test.
 *
 * mulberry32: a 32-bit generator with a full 2^32 period, no BigInt, and no
 * dependency. Its statistical quality is far beyond what a 2000-replicate
 * bootstrap or a 30-book simulation can distinguish.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal, Box–Muller on two uniforms. */
  gaussian(): number;
  /** Integer in [0, n). */
  int(n: number): number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    gaussian: () => {
      // u1 is drawn away from exactly 0, where log diverges.
      const u1 = 1 - next();
      const u2 = next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    int: (n: number) => Math.floor(next() * n),
  };
}
