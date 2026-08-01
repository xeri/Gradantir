/**
 * fit.ts — the deterministic 1-D minimiser every fitted weight in this engine
 * is found with (audit Part I §1.2, §2.2).
 *
 * Pure numerics: no domain knowledge, no scoring rule, no notion of what is
 * being fitted. It takes an objective, a closed bracket, and returns the
 * argument that minimises it.
 *
 * TWO STAGES, and the first is not an optimisation:
 *
 *  1. A fixed GRID over the whole bracket. This is the guard against a
 *     non-convex objective — a CRPS-shaped loss over a clamped, capped blend
 *     can carry a second basin, and a search that assumes unimodality would
 *     converge into whichever one its first probes happened to straddle.
 *  2. GOLDEN-SECTION refinement inside the interval bracketing the grid's best
 *     point. This only sharpens the located basin; it cannot leave it, which
 *     is exactly the property that makes stage 1 load-bearing rather than a
 *     warm start.
 *
 * TIES resolve to the SMALLEST x, always. A flat objective has no minimiser,
 * and this function will not invent one: it returns the low end of the bracket
 * so the answer is at least reproducible. A caller whose flat means something
 * (Part II §12.6: a channel with a record that cannot discriminate should
 * return its PRIOR, not an arbitrary point of the flat) must detect the flat
 * itself and say what it wants — see channels.ts's own tie rule.
 */

/**
 * Grid points over the bracket. 101 is the spec's own figure — with a bracket
 * of width 1 that is a step of 0.01, fine enough that a basin narrower than a
 * hundredth of the search range would have to be narrower than any credibility
 * multiplier this engine reports to a student.
 */
const GRID_POINTS = 101;

/**
 * Absolute width the refinement shrinks the bracketing interval to. 1e-6 is
 * six orders below anything displayed (multipliers print at 2dp) and well
 * inside the noise of an objective built from a handful of resolved rounds.
 */
const TOL = 1e-6;

/** 1/φ — the golden-section ratio the refinement contracts by. */
const INV_PHI = (Math.sqrt(5) - 1) / 2;

export interface Fit1d {
  /** The minimising argument found. */
  x: number;
  /** The objective at `x`. */
  fx: number;
  /** Objective evaluations spent. */
  evals: number;
}

export function minimise1d(
  f: (x: number) => number,
  lo: number,
  hi: number,
  opts?: { grid?: number; tol?: number },
): Fit1d {
  let evals = 0;
  const at = (x: number): number => { evals++; return f(x); };

  if (!(hi > lo)) return { x: lo, fx: at(lo), evals };

  const points = Math.max(2, Math.floor(opts?.grid ?? GRID_POINTS));
  const tol = opts?.tol ?? TOL;
  const step = (hi - lo) / (points - 1);

  // Stage 1 — the grid. Strict `<` keeps the FIRST of any tie, which is the
  // smallest x, which is the documented tie rule.
  let bestI = 0;
  let bestX = lo;
  let bestF = at(lo);
  for (let i = 1; i < points; i++) {
    const x = i === points - 1 ? hi : lo + i * step;
    const fx = at(x);
    if (fx < bestF) { bestF = fx; bestX = x; bestI = i; }
  }

  // Stage 2 — golden section inside [x_{i-1}, x_{i+1}], the interval that
  // brackets the grid's best point. Clamped to the bracket at the ends, so a
  // minimum sitting ON an endpoint refines against that endpoint rather than
  // walking off it.
  let a = bestI === 0 ? lo : lo + (bestI - 1) * step;
  let b = bestI === points - 1 ? hi : lo + (bestI + 1) * step;

  let c = b - INV_PHI * (b - a);
  let d = a + INV_PHI * (b - a);
  let fc = at(c);
  let fd = at(d);
  while (b - a > tol) {
    if (fc <= fd) {
      b = d; d = c; fd = fc;
      c = b - INV_PHI * (b - a);
      fc = at(c);
    } else {
      a = c; c = d; fc = fd;
      d = a + INV_PHI * (b - a);
      fd = at(d);
    }
  }

  // The refinement can only improve on the grid, never replace it: if it did
  // not, the grid's own point stands. `<` again, so a tie keeps the grid point.
  const mid = (a + b) / 2;
  const fMid = at(mid);
  if (fMid < bestF) return { x: mid, fx: fMid, evals };
  return { x: bestX, fx: bestF, evals };
}
