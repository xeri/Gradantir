import { round2 } from "./params";

/**
 * shapley.ts — the exact Shapley decomposition of the CLAMPED signal shift
 * (audit Part I §3).
 *
 * The SIGNALS table needs to answer "which channel moved this desk?" and the
 * obvious answer — drop one term and see what `adj` loses — is wrong once the
 * ±SIGNAL_ADJ_CAP clamp binds. The drop-one marginal for term k is
 * `cap − clip(S − pts_k)`, which is not linear in `pts_k`, so with two terms
 * at +3 against a cap of 4 each column reads +1 and the row sums to +2 while
 * ADJ reads +4. README §30 used to carry a section plus a table footer
 * explaining that. The explanation was correct; the design was wrong.
 *
 * Treating the clamped shift as a coalitional game fixes it by axiom:
 *
 *     v(S) = clip( Σ_{k∈S} pts_k , ±cap ),   v(∅) = 0
 *     φ_k  = Σ_{S ⊆ N\{k}} |S|!(n−|S|−1)!/n! · [ v(S∪{k}) − v(S) ]
 *
 * EFFICIENCY gives Σ_k φ_k = v(N) − v(∅) = adj exactly, clamp binding or not,
 * which is the whole point: the columns add up again. SYMMETRY splits a bound
 * cap evenly between equal claimants rather than by declaration order, and the
 * NULL PLAYER axiom means a channel that contributed nothing is paid nothing.
 *
 * Two deliberate boundaries:
 *
 *  · This module knows NOTHING about signals. It takes a vector of
 *    contributions and a cap. §2's per-channel credibility multipliers fold in
 *    upstream as `a_k · pts_k` with no change here — the game never learns
 *    whether a multiplier has been applied to its inputs.
 *  · Enumeration is EXACT, never sampled. Seven channels is 2⁷ = 128
 *    coalitions per desk; a sampled φ would make the table's own additivity
 *    claim approximate, which is the defect this module exists to remove.
 *
 * Shapley, L. S. (1953), "A Value for n-Person Games".
 */

/**
 * Ceiling on the player count. 2^n coalitions is exact and cheap at the seven
 * channels signalread.ts declares (128 masks); the throw is a tripwire for a
 * future caller that hands this an unbounded list rather than a real limit
 * anyone is near.
 */
const MAX_PLAYERS = 12;

const clip = (x: number, cap: number): number => Math.min(cap, Math.max(-cap, x));

/** Index of the single set bit in a power of two. */
const bitIndex = (low: number): number => 31 - Math.clz32(low);

const popcount = (m: number): number => {
  let n = 0;
  for (let x = m; x !== 0; x &= x - 1) n++;
  return n;
};

/**
 * Exact Shapley values of the clamped game over `contribs`. Returns one value
 * per contribution, in the same order. `Σ result === clip(Σ contribs, ±cap)`
 * up to floating point.
 */
export function shapleyValues(contribs: readonly number[], cap: number): number[] {
  const n = contribs.length;
  if (n === 0) return [];
  if (n > MAX_PLAYERS) {
    throw new Error(`shapleyValues: ${n} players exceeds the exact-enumeration limit of ${MAX_PLAYERS}`);
  }

  // v(S) for every coalition, indexed by bitmask. Built incrementally off the
  // lowest set bit so each of the 2^n sums costs one addition, not |S|.
  const size = 1 << n;
  const sums = new Float64Array(size);
  const v = new Float64Array(size); // v(∅) = 0 by initialisation.
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    sums[mask] = sums[mask ^ low] + contribs[bitIndex(low)];
    v[mask] = clip(sums[mask], cap);
  }

  // weight[s] = s!(n−s−1)!/n! — the probability a uniformly random ordering
  // puts exactly the coalition of size s before player k.
  const fact: number[] = [1];
  for (let i = 1; i <= n; i++) fact[i] = fact[i - 1] * i;
  const weight: number[] = [];
  for (let s = 0; s <= n - 1; s++) weight[s] = (fact[s] * fact[n - s - 1]) / fact[n];

  const phi = new Array<number>(n).fill(0);
  for (let mask = 0; mask < size; mask++) {
    const w = weight[popcount(mask)];
    for (let k = 0; k < n; k++) {
      const bit = 1 << k;
      if (mask & bit) continue;
      phi[k] += w * (v[mask | bit] - v[mask]);
    }
  }
  return phi;
}

/**
 * Rounds every value to 2dp and lands the rounding residual on the
 * largest-magnitude line, so the DISPLAYED cells sum to the DISPLAYED total
 * exactly. Mirrors `mark.ts`'s own attribution waterfall (mark.ts:286-301) —
 * the same problem, the same house answer, so the two boards do not resolve a
 * cent two different ways.
 *
 * Efficiency is an identity on the unrounded φ; without this, seven cells each
 * rounded independently could show a row that sums to 4.01 beside an ADJ of
 * 4.00, which is the exact reading failure this whole change removes.
 */
export function roundToTotal(values: readonly number[], total: number): number[] {
  const shown = values.map(round2);
  if (shown.length === 0) return shown;
  const resid = round2(total - shown.reduce((a, b) => a + b, 0));
  if (resid !== 0) {
    let big = 0;
    for (let i = 1; i < shown.length; i++) if (Math.abs(shown[i]) > Math.abs(shown[big])) big = i;
    shown[big] = round2(shown[big] + resid);
  }
  return shown;
}

/**
 * The keyed, display-ready decomposition: one φ per term, already rounded so
 * the map's values sum to `adj` — `round2(clip(Σ pts, ±cap))`, byte-identical
 * to what `signalRead` itself computed. Key order is the caller's term order,
 * preserved.
 */
export function shapleyOf<K extends string>(
  terms: readonly { key: K; pts: number }[],
  cap: number,
): Map<K, number> {
  if (terms.length === 0) return new Map<K, number>();
  const phi = shapleyValues(terms.map((t) => t.pts), cap);
  const total = round2(clip(terms.reduce((a, t) => a + t.pts, 0), cap));
  const shown = roundToTotal(phi, total);
  return new Map(terms.map((t, i) => [t.key, shown[i]]));
}
