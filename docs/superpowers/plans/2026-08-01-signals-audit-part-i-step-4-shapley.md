# Prediction-Math Audit — Part I §8 step 4 (Shapley) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SIGNALS table's drop-one marginals with an exact Shapley decomposition of the clamped shift, so the per-term columns sum to `ADJ` whether or not the ±`SIGNAL_ADJ_CAP` clamp is binding — and delete the README caveat and footer copy that exist only to excuse the old non-additivity.

**Architecture:** One new pure module, `quant/signals/shapley.ts`, which takes a vector of per-channel contributions and a cap and knows nothing else — no signal semantics, no multipliers, so §2's fitted `a_k` can later be folded into `pts_k` upstream with no change here. `SignalRead` gains `rawTerms` (every candidate that fired, sub-floor ones included) so the coalitional game can be evaluated from **one** read instead of seven `{drop}` re-runs. The `{drop}` seam itself stays — §4 M9 needs it for VOI.

**Tech Stack:** TypeScript 5.6, Vitest 3.2, React 18. No new runtime or dev dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-prediction-math-audit-design.md` — Part I §3 (all of it), §3.3's four consequences, §5.2's `shapley1953` entry, §7's `shapley.ts` test list, and §8 step 4.

**Branch:** `signals-audit`. Predecessor: `docs/superpowers/plans/2026-08-01-signals-audit-part-i-steps-1-3.md` (B5, E1, M3–M7 — all seven commits landed).

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`npm run gate` must stay green and unmoved.** The committed fixture `src/lib/__fixtures__/book.json` carries no signal slices, so nothing in this plan can move a gate number. If one moves, **stop and escalate** — it means a change leaked outside the signals layer.
- **Never run `npm run gen:table`.** Nothing here moves README §21.
- **The committed fixture is never edited.**
- **Every new constant lives in `src/lib/quant/signals/params.ts`** with a justification comment in the surrounding style. No number typed inline in a module body — this is E1's doctrine and it now has a test that reads the module sources back (`params.test.ts`).
- **Determinism is absolute.** No `Math.random()`, no `new Date()` in the calculation layer. `asOf` is always a parameter. The Shapley computation is **exact enumeration, never sampling** — 2⁷ = 128 coalitions is cheap and a sampled φ would make the table's own additivity claim approximate.
- **Pure reads.** Every function in `signals/` stays pure and clock-free.
- **One commit per task**, message body naming the audit item it closes.
- **A comment that states a property is a claim, and a claim needs a test.**

**Working-tree baseline before Task 1:**

- `npm run gate` green, `npx vitest run` green, `npx tsc --noEmit` clean.
- Three untracked spec/plan docs unrelated to this work (`accuracy-program`, `wire-mind`). Leave them alone.

**Why the order below.** `shapley.ts` lands first as pure numerics with no caller, then `rawTerms` gives it its input, then the view switches over, then the derivation cards, then the prose. Each commit leaves the tree green; only Task 3 changes a pixel.

---

## File Structure

| file | responsibility | tasks |
|---|---|---|
| `src/lib/quant/signals/shapley.ts` | **new** — exact Shapley over the clamped coalitional game, plus the display apportionment that keeps rounded cells summing to `adj` | 1 |
| `src/lib/quant/signals/shapley.test.ts` | **new** — efficiency under a binding clamp, symmetry, null player, agreement with drop-one when the clamp is slack | 1 |
| `src/lib/quant/signals/params.ts` | gains `round2` (moved out of `signalread.ts` so `shapley.ts` and `signalread.ts` round identically, one owner) | 1 |
| `src/lib/quant/signals/signalread.ts` | `SignalRead.rawTerms` + the canonical `SIGNAL_TERM_ORDER`; imports `round2` | 1, 2 |
| `src/views/signals/index.tsx` | computes φ from ONE read, drops the seven `{drop}` re-runs, new footer copy | 3 |
| `src/lib/derive/facts.ts` | `signalMarginal` → `signalShapley`, all seven keys | 3 |
| `src/lib/derive/signals.ts` | `signal.stock`/`signal.mastery` report φ; the `Δ_marg` step becomes the Shapley step | 4 |
| `src/lib/derive/cite.ts` | gains `shapley1953` | 4 |
| `README.md` §30 | the non-additivity caveat is deleted, not documented | 5 |

---

## Task 1: `shapley.ts` — the exact decomposition of the clamped game

The SIGNALS table's per-term columns are drop-one marginals: `adj(full) − adj(drop k)`. That is `cap − clip(S − pts_k)` once the clamp binds, which is not linear in `pts_k`, so the columns stop summing to `ADJ` exactly when a student most wants to know where the shift came from. Two terms at +3 with `cap = 4` each show +1 and sum to +2 against a displayed `ADJ` of +4.

Treat the clamped shift as a coalitional game and the problem disappears by axiom:

```
v(S) = clip( Σ_{k∈S} pts_k , ±SIGNAL_ADJ_CAP ),   v(∅) = 0
φ_k  = Σ_{S ⊆ N\{k}}  |S|!·(n−|S|−1)!/n! · [ v(S∪{k}) − v(S) ]
```

Efficiency gives `Σ_k φ_k = v(N) − v(∅) = adj` exactly, clamp binding or not.

**Files:**
- Create: `src/lib/quant/signals/shapley.ts`
- Create: `src/lib/quant/signals/shapley.test.ts`
- Modify: `src/lib/quant/signals/params.ts` (add `round2`)
- Modify: `src/lib/quant/signals/signalread.ts` (delete the local `round2`, import it)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  // params.ts
  export const round2: (v: number) => number

  // shapley.ts
  export function shapleyValues(contribs: readonly number[], cap: number): number[]
  export function roundToTotal(values: readonly number[], total: number): number[]
  export function shapleyOf<K extends string>(
    terms: readonly { key: K; pts: number }[],
    cap: number,
  ): Map<K, number>
  ```
  Task 3 calls `shapleyOf` only; `shapleyValues`/`roundToTotal` are exported for their own tests and for §2, which will feed `a_k · pts_k` into the same `shapleyValues` with no change here.

- [ ] **Step 1: Move `round2` into `params.ts`**

`shapley.ts` must round display cells the same way `signalRead` rounds `adj`, or the residual it reallocates would chase a rounding difference. One owner, per E1.

In `src/lib/quant/signals/params.ts`, beside `attendanceShave`, add:

```ts
/**
 * Rounds the MAGNITUDE (plain Math.round, which ties toward +Infinity) and
 * reapplies the sign, rather than rounding the signed value directly — see
 * rest.ts's negRound2 for why: plain Math.round on a negative x.xx5 ties
 * toward +Infinity, which rounds a CHARGE down (e.g. -0.375 -> -0.37,
 * understating it) instead of to the nearest cent of magnitude. Also
 * normalises -0 to 0 so an untriggered sum never fails a strict `toBe(0)`.
 *
 * Owned here rather than in signalread.ts because shapley.ts rounds its
 * display cells with the SAME rule `adj` itself was rounded with — a residual
 * reallocated against a different rounding convention would not close.
 */
export const round2 = (v: number): number => {
  const r = Math.round(Math.abs(v) * 100) / 100;
  if (r === 0) return 0;
  return v < 0 ? -r : r;
};
```

In `src/lib/quant/signals/signalread.ts`, delete the module-local `const round2 = ...` and its comment block (lines ~115–127) and add `round2` to the existing `./params` import list.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/quant/signals/shapley.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { roundToTotal, shapleyOf, shapleyValues } from "./shapley";
import { SIGNAL_ADJ_CAP } from "./params";

/**
 * §3 of the prediction-math audit. The SIGNALS table used to print drop-one
 * marginals, which stop summing to `adj` the moment two or more terms jointly
 * bind the clamp — README §30 carried a whole section explaining why. The
 * explanation was correct and the design was wrong: the efficiency axiom gives
 * additivity for free, so the caveat is fixed rather than documented.
 */

const CAP = SIGNAL_ADJ_CAP;
const clip = (x: number) => Math.min(CAP, Math.max(-CAP, x));
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("shapleyValues — the axioms the table's honesty rests on", () => {
  it("EFFICIENCY: sums to the clamped total when the clamp is BINDING", () => {
    // The exact case the old marginals failed: two terms at +3, cap 4.
    // Drop-one gives each 4 - clip(3) = +1, summing to +2 against adj +4.
    const phi = shapleyValues([3, 3], CAP);
    expect(sum(phi)).toBeCloseTo(clip(6), 12);
    expect(sum(phi)).toBeCloseTo(4, 12);
    // Symmetric players, so the cap is split evenly rather than by order.
    expect(phi[0]).toBeCloseTo(2, 12);
    expect(phi[1]).toBeCloseTo(2, 12);
  });

  it("EFFICIENCY holds on the negative side and on a mixed-sign coalition", () => {
    for (const c of [[-3, -3], [-5, 1, 0.5], [3.2, -1.1, 2.4, 0.9], [2, 2, 2, 2]]) {
      expect(sum(shapleyValues(c, CAP)), `contribs ${c}`).toBeCloseTo(clip(sum(c)), 12);
    }
  });

  it("SYMMETRY: two players with identical contributions get identical φ", () => {
    const phi = shapleyValues([2.5, 1.0, 2.5], CAP);
    expect(phi[0]).toBeCloseTo(phi[2], 12);
  });

  it("NULL PLAYER: a zero contribution earns exactly zero, and moves no one else", () => {
    const without = shapleyValues([3, 3], CAP);
    const with0 = shapleyValues([3, 0, 3], CAP);
    expect(with0[1]).toBeCloseTo(0, 12);
    expect(with0[0]).toBeCloseTo(without[0], 12);
    expect(with0[2]).toBeCloseTo(without[1], 12);
  });

  it("agrees with the drop-one marginal exactly when the clamp is SLACK", () => {
    // Unclamped, v is additive, so φ_k = pts_k and both readings coincide —
    // which is why the old column was defensible on most books and wrong on
    // precisely the ones where the layer had the most to say.
    const contribs = [0.4, -0.9, 1.2, 0.05];
    const phi = shapleyValues(contribs, CAP);
    contribs.forEach((c, i) => expect(phi[i]).toBeCloseTo(c, 12));
  });

  it("is deterministic — the same input twice is the same array", () => {
    const c = [1.7, -2.3, 3.1, 0.4, -0.8, 2.2, 1.1];
    expect(shapleyValues(c, CAP)).toEqual(shapleyValues(c, CAP));
  });

  it("handles the empty game and refuses one it cannot enumerate exactly", () => {
    expect(shapleyValues([], CAP)).toEqual([]);
    expect(() => shapleyValues(new Array(13).fill(1), CAP)).toThrow(/exact/i);
  });
});

describe("roundToTotal — the displayed cells sum to the displayed total", () => {
  it("puts the rounding residual on the largest line, mark.ts's own rule", () => {
    const shown = roundToTotal([1.005, 1.005, 1.99], 4);
    expect(sum(shown)).toBeCloseTo(4, 10);
    expect(Math.abs(shown[2])).toBeGreaterThanOrEqual(Math.abs(shown[0]));
  });

  it("is a no-op on an empty vector", () => {
    expect(roundToTotal([], 0)).toEqual([]);
  });
});

describe("shapleyOf — keyed, rounded, and additive against adj", () => {
  it("reproduces adj exactly from the terms, clamp binding or not", () => {
    for (const terms of [
      [{ key: "stock", pts: 3 }, { key: "mastery", pts: 3 }],
      [{ key: "stock", pts: 0.4 }, { key: "rest", pts: -0.9 }, { key: "anxiety", pts: -0.03 }],
      [{ key: "stock", pts: -2.5 }, { key: "rest", pts: -2.5 }, { key: "disruption", pts: -1 }],
    ] as { key: string; pts: number }[][]) {
      const adj = Math.round(Math.abs(clip(sum(terms.map((t) => t.pts)))) * 100) / 100
        * (clip(sum(terms.map((t) => t.pts))) < 0 ? -1 : 1);
      const phi = shapleyOf(terms, CAP);
      expect([...phi.values()].reduce((a, b) => a + b, 0), `terms ${JSON.stringify(terms)}`).toBeCloseTo(adj, 10);
      expect([...phi.keys()]).toEqual(terms.map((t) => t.key));
    }
  });

  it("returns an empty map for a desk that fired no candidate", () => {
    expect(shapleyOf([], CAP).size).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quant/signals/shapley.test.ts`
Expected: FAIL — `Failed to resolve import "./shapley"`.

- [ ] **Step 4: Write `shapley.ts`**

Create `src/lib/quant/signals/shapley.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quant/signals/shapley.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify nothing else moved**

Run: `npx tsc --noEmit` — clean.
Run: `npx vitest run src/lib/quant/signals` — PASS (the `round2` move must not have changed a single read).
Run: `npm run gate` — PASS, unchanged.
Run: `npx vitest run` — PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/quant/signals/shapley.ts src/lib/quant/signals/shapley.test.ts src/lib/quant/signals/params.ts src/lib/quant/signals/signalread.ts
git commit -m "feat(signals): exact Shapley decomposition of the clamped shift

The per-term columns were drop-one marginals, which stop summing to adj once
two or more terms jointly bind the +/-SIGNAL_ADJ_CAP clamp: two terms at +3
against a cap of 4 each read +1 and sum to +2 beside an ADJ of +4. README §30
carried a section and a table footer explaining why. The explanation was
correct; the design was wrong.

shapley.ts treats the clamped shift as a coalitional game over
v(S) = clip(sum of S, +/-cap) and enumerates all 2^n coalitions exactly (128
at seven channels, never sampled). Efficiency gives sum(phi) = adj exactly,
clamp binding or not. Display cells are rounded with mark.ts's own residual
rule so the shown row sums to the shown total.

The module knows nothing about signals — it takes contributions and a cap, so
§2's fitted a_k folds in upstream as a_k*pts_k with no change here.

No caller yet. Gate unmoved.
Audit Part I §3."
```

---

## Task 2: `rawTerms` — the game needs every candidate, floor or no floor

§3.3's first consequence: a term under the 0.05pt display floor still participates in a coalition, so `SignalRead` must expose **every** candidate `pts_k`, not just the ones that earned a row. The existing `terms` (filtered, sorted harshest-first) stays exactly as it is — it is the reasons list, and it is what `signal.adjust` tabulates.

This also removes the reason the view calls `signalRead` seven times: with `rawTerms` on the read, φ comes from one read.

**Files:**
- Modify: `src/lib/quant/signals/signalread.ts`
- Modify: `src/lib/quant/signals/signalread.test.ts` (identity literals + new cases)
- Modify: `src/lib/quant/signals/apply.test.ts` (the `read()` helper literal)
- Modify: `src/lib/derive/signals.test.ts` (the hand-built `SignalRead` literals)

**Interfaces:**
- Consumes: nothing new.
- Produces, from `src/lib/quant/signals/signalread.ts`:
  ```ts
  export interface SignalRawTerm { key: SignalTermKey; pts: number }

  /** Canonical term order — declaration order of SignalTermKey. */
  export const SIGNAL_TERM_ORDER: readonly SignalTermKey[]

  // SignalRead gains:
  /** Every candidate that fired with a non-zero read, in SIGNAL_TERM_ORDER,
   *  UNFILTERED by the display floor. The coalitional game's player list. */
  rawTerms: SignalRawTerm[]
  ```

**Design note — why exact zeros are omitted.** A contribution of exactly 0 is a null player: `v(S ∪ {k}) = v(S)` for every `S`, so its own φ is 0 and — this is the part that matters — every *other* player's φ is unchanged by its presence. Dropping it is therefore free, and it is what keeps the layer's load-bearing identity intact: on a book with no signal data the stock, mastery and rest candidates all fire at 0.00, and `rawTerms` must stay `[]` so the empty-book read is still `{adj: 0, rawSum: 0, sdMult: 1, terms: [], rawTerms: [], reasons: []}`. Sub-floor **non-zero** terms are kept — that is the whole point of the field.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/quant/signals/signalread.test.ts`:

```ts
import { SIGNAL_TERM_ORDER } from "./signalread";
import { SIGNAL_NOTE_FLOOR } from "./params";

/**
 * §3.3 of the prediction-math audit. The Shapley game is played over EVERY
 * candidate a desk fired, including the ones too small to earn a display row —
 * a 0.03pt contribution still shifts what its coalition partners are worth
 * once the clamp is in play. `terms` is the reasons list and stays filtered;
 * `rawTerms` is the player list and is not.
 */
describe("rawTerms — the coalitional game's player list", () => {
  it("carries a sub-floor candidate that `terms` drops", () => {
    // Build a desk whose attendance shave lands under SIGNAL_NOTE_FLOOR.
    const out = signalRead(SUB({ attendancePct: 94 }), emptySignalBook, [], null, null, ASOF);
    const att = out.rawTerms.find((t) => t.key === "attendance");
    expect(att, "the attendance candidate must be a player").toBeTruthy();
    expect(Math.abs(att!.pts)).toBeLessThan(SIGNAL_NOTE_FLOOR);
    expect(out.terms.find((t) => t.key === "attendance"), "and must NOT earn a display row").toBeUndefined();
  });

  it("sums to rawSum exactly — the players ARE the pre-clamp total", () => {
    const out = signalRead(SUB({ attendancePct: 94 }), emptySignalBook, [], null, null, ASOF);
    expect(out.rawTerms.reduce((a, t) => a + t.pts, 0)).toBeCloseTo(out.rawSum, 12);
  });

  it("is ordered by SIGNAL_TERM_ORDER, never by which branch happened to fire first", () => {
    const out = signalRead(SUB({ attendancePct: 94 }), emptySignalBook, [], null, null, ASOF);
    const idx = out.rawTerms.map((t) => SIGNAL_TERM_ORDER.indexOf(t.key));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("omits an exact zero — a null player is worth nothing and moves no one", () => {
    // The empty-book identity: stock, mastery and rest all fire, all at 0.00.
    const out = signalRead(SUB(), emptySignalBook, [], null, null, ASOF);
    expect(out.rawTerms).toEqual([]);
  });

  it("declares every key exactly once", () => {
    expect(new Set(SIGNAL_TERM_ORDER).size).toBe(SIGNAL_TERM_ORDER.length);
    expect(SIGNAL_TERM_ORDER.length).toBe(7);
  });
});
```

Use whatever base-subject helper (`SUB`/`baseSubject`/`sub()`) and `ASOF` constant the file already defines; do not build a second one. If the helper does not take an `attendancePct` override, spread one: `{ ...baseSubject, attendancePct: 94 }`.

Then update the three identity assertions already in that file (lines ~106, ~112, ~117 and the `signalBoard` one at ~479) to include the new field:

```ts
expect(out).toEqual({ subjectId: "s1", adj: 0, rawSum: 0, sdMult: 1, terms: [], rawTerms: [], reasons: [] });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quant/signals/signalread.test.ts`
Expected: FAIL — `does not provide an export named 'SIGNAL_TERM_ORDER'`.

- [ ] **Step 3: Add `SIGNAL_TERM_ORDER` and `rawTerms`**

In `src/lib/quant/signals/signalread.ts`, after the `SignalTermKey` union:

```ts
/**
 * The canonical term order — the declaration order of SignalTermKey, named so
 * that anything iterating the channels (the SIGNALS table's columns, the
 * Shapley player list) does so identically. `Object.keys` on the candidate
 * record would follow whichever branch happened to fire, which is stable today
 * and would silently stop being so the first time a branch moves.
 */
export const SIGNAL_TERM_ORDER: readonly SignalTermKey[] = [
  "stock", "mastery", "rest", "disruption", "anxiety", "chronotype", "attendance",
] as const;

/** One player in the clamped coalitional game — see shapley.ts. */
export interface SignalRawTerm {
  key: SignalTermKey;
  pts: number;
}
```

Extend `SignalRead`, after `terms`:

```ts
  /**
   * Every candidate that fired with a NON-ZERO read, in SIGNAL_TERM_ORDER and
   * UNFILTERED by the 0.05pt display floor — the player list of the clamped
   * coalitional game `shapley.ts` decomposes (audit Part I §3.3). A sub-floor
   * term earns no row in `terms` but still shifts what its coalition partners
   * are worth once the clamp binds, so the game must see it.
   *
   * An EXACT zero is omitted: it is a null player, worth 0 itself and leaving
   * every other φ unchanged, so dropping it costs nothing and keeps this
   * module's load-bearing identity intact — an untouched book fires stock,
   * mastery and rest at 0.00 and must still read `rawTerms: []`.
   */
  rawTerms: SignalRawTerm[];
```

Replace the candidate-key line:

```ts
  const keys = SIGNAL_TERM_ORDER.filter((k) => raw[k] != null);
```

and add, beside the `terms` build:

```ts
  const rawTerms: SignalRawTerm[] = keys
    .filter((k) => raw[k]!.pts !== 0)
    .map((k) => ({ key: k, pts: raw[k]!.pts }));
```

and add `rawTerms,` to the returned object, between `terms` and `reasons`.

- [ ] **Step 4: Fix the other hand-built `SignalRead` literals**

`src/lib/quant/signals/apply.test.ts` — the `read()` helper's base literal gains `rawTerms: []` (before the `...over` spread).

`src/lib/derive/signals.test.ts` — every `const read: SignalRead = { ... }` literal gains `rawTerms: []`. These fixtures test `signal.adjust`, which reads `rawSum`/`adj`/`terms` and nothing else, so an empty player list is honest for them.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quant/signals src/lib/derive`
Expected: PASS.

- [ ] **Step 6: Verify nothing else moved**

Run: `npx tsc --noEmit` — clean. (`src/views/signals/index.tsx`'s `IDENTITY_READ` will fail here; add `rawTerms: []` to it. That is the only view-side change this task makes.)
Run: `npm run gate` — PASS, unchanged.
Run: `npx vitest run` — PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/quant/signals src/lib/derive/signals.test.ts src/views/signals/index.tsx
git commit -m "feat(signals): SignalRead exposes rawTerms, the coalitional game's player list

The Shapley decomposition is played over every candidate a desk fired, not
just the ones clearing the 0.05pt display floor — a 0.03pt contribution still
changes what its partners are worth once the clamp binds. `terms` stays the
filtered, sorted reasons list; `rawTerms` is the unfiltered player list, in a
named canonical order rather than whichever branch happened to fire first.

An exact zero is omitted: a null player is worth nothing and leaves every
other phi unchanged, so an untouched book still reads rawTerms: [] and the
layer's empty-book identity is unmoved.

Gate unmoved. Audit Part I §3.3."
```

---

## Task 3: the SIGNALS table computes φ from one read

Today the view re-runs `signalRead` seven times per desk with `{drop}` to build the marginal columns. With `rawTerms` on the read, φ comes from one call to `shapleyOf`. The `{drop}` seam itself **stays on `signalRead`** — §4 M9 needs it for VOI's real ablation.

**Files:**
- Modify: `src/views/signals/index.tsx`
- Modify: `src/lib/derive/facts.ts` (`signalMarginal` → `signalShapley`)

**Interfaces:**
- Consumes: `shapleyOf` (Task 1), `SignalRead.rawTerms` (Task 2), `SIGNAL_ADJ_CAP`.
- Produces:
  ```ts
  // facts.ts — replaces signalMarginal
  signalShapley?: Record<string, Partial<Record<SignalTermKey, number>>> | null;
  ```

- [ ] **Step 1: Swap the fact in `facts.ts`**

In `src/lib/derive/facts.ts`, replace the `signalMarginal` field and its comment block with:

```ts
  /**
   * Per-desk SHAPLEY value of each term's contribution to `adj` — computed
   * once by the SIGNALS view (audit Part I §3) and handed down so
   * `signal.stock`/`signal.mastery` report the SAME figure the STOCK/MASTERY
   * columns show when opened from that cell. Already display-rounded, so the
   * values sum to `adj` exactly. A key absent from a desk's record means the
   * channel fired nothing at all, which is a genuine zero.
   */
  signalShapley?: Record<string, Partial<Record<SignalTermKey, number>>> | null;
```

Add the type import: `import type { SignalTermKey } from "../quant/signals/signalread";` beside the existing signal-layer type imports.

- [ ] **Step 2: Rewrite the `rows` memo**

In `src/views/signals/index.tsx`:

Imports — drop `signalRead` and add `shapleyOf`/`SIGNAL_ADJ_CAP`:

```ts
import { type NextSitting, type SignalBook, type SignalRead, type SignalTermKey } from "../../lib/quant/signals/signalread";
import { shapleyOf } from "../../lib/quant/signals/shapley";
import { SIGNAL_ADJ_CAP } from "../../lib/quant/signals/params";
```

`NextSitting` and the `soonestNext` helper are now unused — **delete `soonestNext` entirely** and drop `NextSitting` from the import. (It existed only so the seven `{drop}` re-runs could resolve the identical `next` the baseline read had used. There are no re-runs left.)

Replace the memo:

```tsx
  const rows = useMemo(() => {
    const live = stats.filter((s) => !s.sub.archived);
    return live.map((s) => {
      const full = signalReads.get(s.sub.id) ?? IDENTITY_READ(s.sub.id);
      // ONE read, not eight. Each column is this term's SHAPLEY value in the
      // clamped game over `rawTerms` — the share of `adj` attributable to it,
      // averaged over every order the channels could have arrived in. The
      // columns sum to ADJ exactly whether or not the clamp is binding, which
      // the old drop-one marginals could not do (see shapley.ts's header).
      const shapley = shapleyOf(full.rawTerms, SIGNAL_ADJ_CAP);
      return { sub: s.sub, stat: s, adj: full.adj, wAdj: signalFit.w * full.adj, shapley };
    });
  }, [stats, signalReads, signalFit.w]);
```

Note the dependency array shrinks to three entries and the `eslint-disable` line above it goes with them — `entries`, `upcoming`, `modelMeans`, `signalBook` and `todayIso` are no longer read here.

- [ ] **Step 3: Point the cells and the derivation context at φ**

Cell body:

```tsx
                      const v = r.shapley.get(c.key) ?? 0;
```

In the `dctx` memo, replace the `marginalOf` block:

```tsx
    const shapleyOfDesk: Record<string, Partial<Record<SignalTermKey, number>>> = {};
    for (const r of rows) shapleyOfDesk[r.sub.id] = Object.fromEntries(r.shapley);
```

and the fact it passes:

```tsx
        signalShapley: shapleyOfDesk,
```

Update the comment above `dctx` that describes `signalMarginal` to describe `signalShapley` instead: it is `rows`' own decomposition, reused rather than recomputed, so `signal.stock`/`signal.mastery` report the same φ the columns show.

The `<Derive>` triggers on the STOCK/MASTERY cells change key from `"marginal"` to `"shapley"`:

```tsx
                            <Derive id={derivedId} ctx={{ ...dctx, stat: r.stat, key: "shapley" }} passive>{cell}</Derive>
```

- [ ] **Step 4: Rewrite the footer**

Replace the `<p>` under the table:

```tsx
        <p className="px-3 py-2 border-t text-[10px] tracking-wider leading-relaxed" style={{ borderColor: C.line, color: C.faint, fontFamily: FONT.mono }}>
          EACH TERM COLUMN IS ITS SHAPLEY VALUE IN POINTS — THIS DESK'S CLAMPED SHIFT SPLIT ACROSS THE CHANNELS THAT
          CAUSED IT, AVERAGED OVER EVERY ORDER THEY COULD HAVE ARRIVED IN. THE COLUMNS SUM TO ADJ EXACTLY, WHETHER OR
          NOT THE ±{SIGNAL_ADJ_CAP}PT CAP IS BINDING. ADJ = THE DESK'S OWN CLAMPED SHIFT. W·ADJ = WHAT ACTUALLY MOVES
          THE NEXT-EXAM MEAN ONCE THE EARNED WEIGHT ABOVE IS APPLIED.
        </p>
```

- [ ] **Step 5: Update the view's module doc**

In the header comment, replace the paragraph beginning "one row per live desk with one column per term: NOT the term's raw point read, but its MARGINAL contribution…" with:

```
 * `PricedBanner` carries the `signalWeighting` switch and the channel's own
 * earned weight — the same "say the cost before the instrument is touched"
 * discipline the Scorecard's three elicitation cards hold. Below it, one row
 * per live desk with one column per term: NOT the term's raw point read, but
 * its SHAPLEY VALUE in the clamped game `shapley.ts` decomposes (audit Part I
 * §3) — the share of ADJ attributable to that channel, averaged over every
 * order the channels could have arrived in. The columns sum to ADJ exactly,
 * clamp binding or not. This replaced a drop-one marginal, which could not:
 * with two terms at +3 against a ±4 cap each marginal read +1 and the row
 * summed to +2 beside an ADJ of +4, and the SIGNALS footer plus a whole README
 * §30 section existed to excuse it.
 *
 * One read per desk, not eight — `SignalRead.rawTerms` carries the player list
 * so the game needs no ablation re-runs. `signalRead`'s `{drop}` seam stays
 * where it is: VOI's real-ablation work (M9) is its remaining caller.
```

and the identity paragraph's "every marginal is 0" becomes "every φ is 0".

- [ ] **Step 6: Run the view tests**

Run: `npx vitest run src/views/signals`
Expected: PASS. `signals.book.test.tsx` asserts zero columns / 0.00 ADJ on the untouched fixture; φ is 0 everywhere there because `rawTerms` is empty, so the rendered cells are still `—`. If its module comment says "marginals", update the wording.

- [ ] **Step 7: Verify nothing else moved**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/lib/derive/signals.ts` and `src/lib/derive/derive.book.test.ts`, which still read `signalMarginal` — Task 4 fixes both. If it is clean, `signalShapley` was added without removing `signalMarginal`; remove it.

Do not run the full suite here; it will fail on the same two files. Commit and move to Task 4.

- [ ] **Step 8: Commit**

```bash
git add src/views/signals/index.tsx src/lib/derive/facts.ts
git commit -m "feat(signals): the SIGNALS table shows Shapley values, computed from one read

Each term column is now its Shapley value in the clamped game rather than a
drop-one marginal, so the columns sum to ADJ exactly whether or not the cap is
binding. The footer's 'where two or more terms jointly hit the cap, the
marginals no longer sum to ADJ' caveat is deleted, because it is no longer
true.

The view also stops re-running signalRead seven times per desk: rawTerms
carries the player list, so one read is enough. signalRead's {drop} seam is
untouched — M9's VOI ablation is its remaining caller.

Gate unmoved. Audit Part I §3.3."
```

---

## Task 4: the derivation cards report φ, and the bibliography gains Shapley

§3.3's last consequence: `signal.stock`/`signal.mastery` report φ rather than a drop-one marginal, and the `Δ_marg` step is rewritten as the Shapley step. The card that now shows the formula must cite where it came from — `cite.ts`'s own header is binding: a derivation that shows the formula but not its source is a magic trick.

**Files:**
- Modify: `src/lib/derive/signals.ts`
- Modify: `src/lib/derive/cite.ts` (add `shapley1953`)
- Modify: `src/lib/derive/derive.book.test.ts`

**Interfaces:**
- Consumes: `ctx.card.signalShapley` (Task 3), `ctx.key === "shapley"`.
- Produces: no new exports. `signal.stock` and `signal.mastery` gain `refs: ["shapley1953"]`.

- [ ] **Step 1: Add the citation**

In `src/lib/derive/cite.ts`, beside the other mid-century entries, add:

```ts
  shapley1953: {
    short: "Shapley (1953)",
    authors: "Shapley, L. S.",
    year: 1953,
    title: "A Value for n-Person Games",
    venue: "Contributions to the Theory of Games II, Annals of Mathematics Studies 28, 307–317",
  },
```

`derive.book.test.ts` asserts every citation has a referrer, so this must land in the same commit as the two `refs` below.

- [ ] **Step 2: Rewrite `signal.stock`'s marginal step**

In `src/lib/derive/signals.ts`, in `signalStock`:

```ts
  const phi = id != null ? ctx.card?.signalShapley?.[id]?.stock : undefined;

  // The STOCK column in the per-desk table shows this term's SHAPLEY VALUE —
  // its share of the clamped ADJ, not the raw channel read below. A different
  // figure with a different formatter (fmtShare's "—" at zero vs sgn's
  // "+0.00"). `ctx.key === "shapley"` is what that cell passes; anything else
  // (including no key at all, e.g. a direct `signal.stock` lookup with no
  // decomposition on the context) reports the raw read instead.
  const headlineShapley = ctx.key === "shapley" && phi != null;
  const resultSym = headlineShapley ? "\\varphi_{\\text{stock}}" : "\\pi_{\\text{stock}}";
  const resultVal = headlineShapley ? fmtShare(phi as number) : sgn(stock.term, 2);
```

Rename the local `fmtMarginal` helper to `fmtShare` (same body, updated comment: it mirrors the per-desk table's own Shapley cell). Update `title`/`claim`:

```ts
    title: headlineShapley ? "STUDY STOCK · SHARE OF THE SHIFT" : "STUDY STOCK · 14D VS OWN NORM",
```

```ts
    claim: headlineShapley
      ? "THIS CHANNEL'S SHARE OF THE DESK'S CLAMPED SHIFT — ITS SHAPLEY VALUE, AVERAGED OVER EVERY ORDER THE CHANNELS COULD HAVE ARRIVED IN. EVERY COLUMN'S SHARE SUMS TO ADJ EXACTLY, CAP BINDING OR NOT."
      : "HOW MUCH QUALITY-WEIGHTED STUDY YOU HAVE ACTUALLY BANKED LATELY, AGAINST YOUR OWN TRAILING RATE — NEVER AGAINST ANOTHER DESK.",
```

Replace the fourth step (the `Δ_marg` one) with:

```ts
      {
        tex: `\\varphi_k \\;=\\; \\sum_{S\\subseteq N\\setminus\\{k\\}} \\frac{|S|!\\,(n-|S|-1)!}{n!}\\Big[v(S\\cup\\{k\\}) - v(S)\\Big], \\qquad v(S) \\;=\\; \\operatorname{clip}_{[-${SIGNAL_ADJ_CAP},\\,${SIGNAL_ADJ_CAP}]}\\!\\Big(\\textstyle\\sum_{j\\in S}\\pi_j\\Big)`,
        subst: phi != null ? `\\varphi_{\\text{stock}} \\;=\\; ${v(phi, 2)}` : undefined,
        note:
          `THE STOCK COLUMN SHOWS THIS SHARE, NOT THE RAW READ ABOVE — THEY AGREE EXACTLY UNTIL THE ±${SIGNAL_ADJ_CAP} CLAMP BINDS, AT WHICH POINT THE CAP HAS TO BE SPLIT BETWEEN THE CHANNELS THAT CAUSED IT. EVERY COALITION IS ENUMERATED EXACTLY (2⁷ = 128 AT SEVEN CHANNELS, NEVER SAMPLED), AND THE EFFICIENCY AXIOM MAKES THE COLUMNS SUM TO ADJ — WHICH THE DROP-ONE MARGINAL THIS REPLACED COULD NOT DO.`,
      },
```

Update the input row:

```ts
      { sym: "\\varphi_{\\text{stock}}", label: "share of adj (table column)", value: phi == null ? "—" : fmtShare(phi), missing: phi == null },
```

and add to the card:

```ts
    refs: ["shapley1953"],
```

- [ ] **Step 3: Do the same in `signal.mastery`**

Identical treatment in `signalMastery`: `phi` off `ctx.card?.signalShapley?.[id]?.mastery`, `headlineShapley`, `\\varphi_{\\text{mastery}}`, the title `"MASTERY · SHARE OF THE SHIFT"`, the same claim wording with MASTERY in place of STOCK, the same Shapley step (with `\\varphi_{\\text{mastery}}` in the `subst`), the same input row, and `refs: ["shapley1953"]`.

- [ ] **Step 4: Update `signal.adjust`'s clamp note and the module header**

In `signalAdjust`, the clamp-binding note's parenthetical currently says the table's marginal column "differs again". Replace that parenthetical with:

```
(THE PER-DESK TABLE'S OWN COLUMNS SPLIT THIS CLAMPED TOTAL BY SHAPLEY VALUE, SO THEY DO SUM TO ADJ — IT IS THE RAW ROWS ABOVE THAT DO NOT.)
```

In the module header, the paragraph beginning "And per Task 15's finding: once two or more terms jointly bind the ±SIGNAL_ADJ_CAP clamp, the per-term breakdown no longer sums to `adj`" is about the RAW rows this card tabulates and stays true — but its last clause must stop implying the board has no additive view. Append to it:

```
 * The per-desk TABLE is a different question and now has an exact answer:
 * `shapley.ts` splits the clamped total across the channels that caused it, so
 * those columns do sum to `adj` (audit Part I §3). The rows on THIS card are
 * the raw reads, and raw reads still overshoot a bound cap.
```

- [ ] **Step 5: Update `derive.book.test.ts`**

Rename the harness's `signalMarginalOf` to `signalShapleyOf`, drop the two `{drop}` re-runs, and build it from the read itself:

```ts
const signalShapleyOf: Record<string, Partial<Record<SignalTermKey, number>>> = {};
```

inside the `for (const sub of active)` loop, replacing the `droppedStock`/`droppedMastery` lines:

```ts
  // The SIGNALS view's own decomposition (views/signals/index.tsx), reproduced
  // here so `signal.stock`/`signal.mastery` can be exercised keyed "shapley"
  // exactly as the STOCK/MASTERY table cells trigger them.
  const full = signalReads.get(sub.id)!;
  signalShapleyOf[sub.id] = Object.fromEntries(shapleyOf(full.rawTerms, SIGNAL_ADJ_CAP));
```

The `signalRead` import and the `subjEntries` local in that loop become unused — remove them. Add imports for `shapleyOf`, `SIGNAL_ADJ_CAP` and the `SignalTermKey` type.

In `signalCardFacts`, `signalMarginal: signalMarginalOf` becomes `signalShapley: signalShapleyOf`.

In the reconciliation test, replace the marginal block:

```ts
    // Keyed "shapley" — exactly what the STOCK/MASTERY table cells trigger: a
    // DIFFERENT figure (this channel's share of the clamped adj) with a
    // DIFFERENT formatter ("—" at zero, never "+0.00"). On this untouched book
    // no channel fires at all, so every share is absent and the two modes'
    // result strings are a genuinely discriminating check.
    const share = signalShapleyOf[stats[0].sub.id];
    expect(share.stock ?? 0).toBe(0);
    expect(share.mastery ?? 0).toBe(0);
```

The two `expect(...key: "marginal"...).toBe("—")` assertions become `key: "shapley"`. **Note the behaviour change:** on the untouched fixture `rawTerms` is empty, so `shapleyOf` returns an empty map and `phi` is `undefined` — the card falls back to the raw read, not `"—"`. So those two lines become:

```ts
    // No channel fired, so there is no share to report and the card falls back
    // to the raw read — the same fallback the `signalShapley: null` case below
    // exercises, reached here by an honestly empty decomposition.
    expect(derivationFor("signal.stock", { ...signalCtx, key: "shapley" })!.result.value).toBe((stock.term >= 0 ? "+" : "") + stock.term.toFixed(2));
    expect(derivationFor("signal.mastery", { ...signalCtx, key: "shapley" })!.result.value).toBe((mastery.term >= 0 ? "+" : "") + mastery.term.toFixed(2));
```

and the `noMarginalCtx` local becomes `noShapleyCtx` with `signalShapley: null` and `key: "shapley"`.

To keep a discriminating test of the `"—"` branch — the one the fixture can no longer reach — add a unit test to `src/lib/derive/signals.test.ts`:

```ts
describe("signal.stock — the SHAPLEY headline is a different figure from the raw read", () => {
  it("reports the share, formatted as the table cell formats it", () => {
    const ctx: DeriveCtx = {
      stat: STAT(SUB()),
      card: {
        signalStock: { s1: STOCK_READ },
        signalShapley: { s1: { stock: 0 } },
      },
      key: "shapley",
    } as unknown as DeriveCtx;
    // An exact-zero share prints the table's em-dash, never "+0.00".
    expect(derivationFor("signal.stock", ctx)!.result.value).toBe("—");
    expect(derivationFor("signal.stock", ctx)!.symbol).toBe("\\varphi_{\\text{stock}}");
  });
});
```

Build `STOCK_READ` from whatever `StockRead` literal the file already uses, or a minimal one: `{ k14: 0, baseline: null, term: 0.4, recallRatio: null, hoursPerWeek: null }` — match the actual `StockRead` fields.

- [ ] **Step 6: Run the derive tests**

Run: `npx vitest run src/lib/derive`
Expected: PASS, including `derive.book.test.ts`'s "every citation has a referrer" and "every registered id builds somewhere".

- [ ] **Step 7: Verify nothing else moved**

Run: `npx tsc --noEmit` — clean.
Run: `npm run gate` — PASS, unchanged.
Run: `npx vitest run` — PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/derive README.md
git commit -m "feat(derive): signal.stock and signal.mastery report a Shapley share, cited

The two cards' Delta_marg step was a drop-one marginal, which is exactly the
figure that stops summing to adj under a binding clamp. It is now the Shapley
step, with the formula, the coalitional value function, and Shapley (1953)
behind it — cite.ts's own header is binding here: a derivation that shows the
formula but not where it came from is a magic trick.

signal.adjust's clamp note stops telling the reader the table column 'differs
again': the table columns now sum to adj, and it is the raw rows on that card
that do not.

Gate unmoved. Audit Part I §3.3."
```

---

## Task 5: README §30 — the caveat is deleted, not documented

§3.3: README §30's "Per-term marginals do not sum to `adj`" paragraph and the table footer's non-additivity sentence are **deleted**. The footer went in Task 3; this is the prose.

**Files:**
- Modify: `README.md` (§30, "Two things worth stating plainly", ~line 1604)
- Modify: `src/views/signals/MasteryPanel.tsx` (header comment), `src/views/signals/VoiPanel.tsx` (header comment) — both refer to "the per-term marginal table"

- [ ] **Step 1: Replace the caveat paragraph**

In `README.md`, replace the whole `**Per-term marginals do not sum to \`adj\`** …` paragraph (through "…not just here.") with:

```markdown
**Per-term columns sum to `adj` exactly** — including when the ±`SIGNAL_ADJ_CAP` clamp is binding.
The SIGNALS view shows each term column as its *Shapley value* in the clamped coalitional game
(`quant/signals/shapley.ts`), not its raw read:

$$
v(S) = \operatorname{clip}_{\pm\text{CAP}}\!\Big(\sum_{j\in S}\pi_j\Big),\qquad
\varphi_k = \sum_{S\subseteq N\setminus\{k\}} \frac{|S|!\,(n-|S|-1)!}{n!}\big[v(S\cup\{k\}) - v(S)\big].
$$

The efficiency axiom gives $\sum_k \varphi_k = v(N) - v(\emptyset) = \text{adj}$ exactly, cap binding or
not, and symmetry splits a bound cap evenly between equal claimants rather than by declaration order.
All $2^7 = 128$ coalitions are enumerated exactly — never sampled, because a sampled $\varphi$ would
make the table's own additivity claim approximate. The displayed cells are rounded to 2dp with the
residual landing on the largest line, `mark.ts`'s own attribution rule, so the shown row sums to the
shown `ADJ` too.

This replaced a drop-one marginal, $\text{adj(full)} - \text{adj(drop } k)$, which is
$\text{cap} - \operatorname{clip}(S - \pi_k)$ once the clamp binds and therefore not linear in $\pi_k$:
with two terms at +3 and `adj` capped at +4, each marginal read $4 - \operatorname{clip}(3) = +1$ and
the row summed to +2 beside an `ADJ` of +4. This section used to explain that at length. The
explanation was correct and the design was wrong, so the design changed.

The **raw** term rows on `signal.adjust`'s own card are a different question and still overshoot a
bound cap — that card says so, on the clamp step, whenever the clamp actually binds.
```

The section heading "Two things worth stating plainly" still governs this paragraph and the "never set vs set to a neutral default" one below it; leave the heading and that second paragraph alone.

- [ ] **Step 2: Check every other README mention**

Run: `grep -n "marginal" README.md`

Every hit inside §30 must now describe the Shapley column. Hits outside §30 (the effort/allocation sections' "marginal hour") are a different sense of the word and stay.

- [ ] **Step 3: Sweep the stale view comments**

`src/views/signals/MasteryPanel.tsx:17` and `src/views/signals/VoiPanel.tsx:11` both describe "the per-term marginal table" one level up. Change both to "the per-term Shapley table". No behaviour change.

- [ ] **Step 4: Final verification**

Run: `npx tsc --noEmit` — clean.
Run: `npm run gate` — PASS, and the skill number **identical** to its value before Task 1.
Run: `npx vitest run` — PASS.

Run the tranche's own claims:

```bash
grep -rn "marginal" src/views/signals src/lib/derive/signals.ts src/lib/quant/signals   # nothing but shapley.ts's own historical note
git log --oneline HEAD~5..HEAD                                                          # five commits
```

- [ ] **Step 5: Commit**

```bash
git add README.md src/views/signals
git commit -m "docs(readme): §30's non-additivity caveat is deleted, not documented

The section explained at length why per-term marginals stop summing to adj
under a binding clamp. The explanation was correct and the design was wrong.
The columns are Shapley values now and they sum to adj by the efficiency
axiom, so the caveat describes nothing that still happens.

The raw term rows on signal.adjust's card DO still overshoot a bound cap, and
the README says so, in one sentence, where it is true.

Gate unmoved. Closes audit Part I §3."
```

---

## Close-out

- [ ] **Report what is next**

Part I §8 step 5 is `channels.ts` + the channel scoreboard (§2). It needs a 1-D minimiser on the walk-forward CRPS objective, which is step 8's `fit.ts` — so either `fit.ts` lands early (pure numerics, no gate movement of its own) or step 5 waits. Flag the ordering before starting it.

Part II §21 step 1 (`eval/oracle.ts`) remains the prerequisite for any `earned.ts` work and still collides with the unstarted `accuracy-program-phase-a` plan's `baseline.json` restructure.

---

## Spec coverage

| spec item | task |
|---|---|
| §3.1 the defect — drop-one marginals stop summing under a bound clamp | 1 (test), 5 (README) |
| §3.2 the fix — exact Shapley over the clamped game, 128 coalitions, no sampling | 1 |
| §3.2 "lands before §2, so `a_k ≡ 1`; the module never knows a multiplier was applied" | 1 (module takes a bare contribution vector) |
| §3.3 `rawTerms` — every candidate, including sub-floor | 2 |
| §3.3 the view stops re-running `signalRead` seven times; `{drop}` seam stays | 3 |
| §3.3 README §30 paragraph + table footer deleted | 3 (footer), 5 (prose) |
| §3.3 `signal.stock`/`signal.mastery` report φ; `Δ_marg` step rewritten | 4 |
| §5.2 `shapley1953` in the bibliography | 4 |
| §7 efficiency under a binding clamp, symmetry, null player, drop-one agreement when slack | 1 |
| §8 step 4 sequencing | task order |
| §8 "steps 1–7 cannot move `npm run gate`" | every task's verify step + close-out |

**Deliberately out of this plan** (the spec sequences them later): §2's `channels.ts` and the channel scoreboard (step 5); M8/M9 (step 6); the bibliography sweep, `Citation.url`, the five new derivation cards and the Shapley card of §5.4 (step 7); `fit.ts`/`earned.ts` (step 8); all of Part II.
