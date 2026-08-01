# Prediction-Math Audit — Part I §8 step 5 (per-channel credibility) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of the seven life-signal channels its own measured credibility multiplier `a_k` — prior 1, fitted on the same walk-forward CRPS the layer is already scored on, normalised so only the identified quantity is reported, shrunk toward the authored prior at its own evidence rate — and put the result on the SIGNALS floor as a channel scoreboard, so a student can tell which of their own logging habits actually predicts.

**Architecture:** Two new pure modules. `quant/fit.ts` is the 1-D minimiser the spec's §1 also needs later (grid then golden-section, no unimodality assumption); it lands here first because §2's coordinate descent is its first caller and it carries no gate risk of its own. `quant/signals/channels.ts` is the fit itself: rounds in, `a_k` and a scoreboard out, knowing nothing about how the weights are spent. The multipliers reach the board by one route only — `signalRead`'s new `opts.weights`, which folds `a_k · pts_k` at the point the candidates are assembled, so `terms`, `rawTerms`, `rawSum`, `adj` and the Shapley game all read the reshaped contribution with no second arithmetic path to disagree with the first.

**Tech Stack:** TypeScript 5.6, Vitest 3.2, React 18. No new runtime or dev dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-prediction-math-audit-design.md` — Part I §2 (all of it), §6's `fit.ts` and `channels.ts` rows, §7's `fit.ts`/`channels.ts` test lists, and §8 step 5. Part II §12.6's tie rule is honoured early (a flat objective returns the prior, explicitly) because this plan's minimiser meets that case before `earned.ts` does.

**Branch:** `signals-audit`. Predecessor: `docs/superpowers/plans/2026-08-01-signals-audit-part-i-step-4-shapley.md` (all five commits landed).

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`npm run gate` must stay green and unmoved.** The committed fixture `src/lib/__fixtures__/book.json` carries no signal slices, so every round's as-of read is the identity, `fitSignalChannels` sees no scored round, every `a_k` is exactly 1, and every read is byte-identical to today's. If a gate number moves, **stop and escalate** — it means a change leaked outside the signals layer.
- **Never run `npm run gen:table`.** Nothing here moves README §21.
- **The committed fixture is never edited.**
- **Every new constant lives in a `params.ts`** with a justification comment in the surrounding style. The channel-credibility knobs go in `src/lib/quant/params.ts`'s life-signals block beside `SIGNAL_KAPPA`/`SIGNAL_CAP`/`SIGNAL_PRIOR` — the spec (§2.2) is explicit that they are credibility knobs, not formula knobs, and belong with their siblings rather than in `signals/params.ts`. `fit.ts` is pure numerics outside the signals package and carries its own algorithm parameters as module constants with justification comments, the precedent `shapley.ts`'s `MAX_PLAYERS` already set.
- **Determinism is absolute.** No `Math.random()`, no `new Date()` in the calculation layer. `asOf` is always a parameter. The coordinate descent runs a fixed number of passes over a fixed key order and every search is a deterministic grid plus a deterministic refinement — two runs over the same rounds return the identical vector, and there is a test that says so.
- **Pure reads.** Every function in `signals/` stays pure and clock-free.
- **`a_k` is a credibility multiplier, never a formula knob.** The hand-set constants in `signals/params.ts` are the prior and do not move. A channel with no record pulls exactly the weight it was authored with.
- **One commit per task**, message body naming the audit item it closes.
- **A comment that states a property is a claim, and a claim needs a test.**

**Working-tree baseline before Task 1:**

- `npm run gate` green, `npx vitest run` green, `npx tsc --noEmit` clean.
- Three untracked spec/plan docs unrelated to this work (`accuracy-program`, `wire-mind`). Leave them alone.

**Why the order below.** `fit.ts` lands first as pure numerics with no caller. Then `signalRead` learns to take weights (identity when none are passed, so nothing moves). Then `signalskill.ts` splits its walk-forward replay from its scoring, so the replay can be done once and handed to two fitters instead of being run twice. Then `channels.ts` fits. Only then does `App` wire it, and only then does a pixel change.

---

## What this plan deliberately does NOT fix

**Part II §12.4 — chronotype is scored with the channel switched off.** `signalskill.ts` builds every scored round's `NextSitting` with `hour: null`, so the chronotype candidate never fires in the replay. Its `n_k` is therefore **structurally zero**, it can never clear `SIGNAL_CHANNEL_MIN_ROUNDS`, and it sits at `a_k = 1` forever while riding the weight the other six earned. `GradeEntry` carries no `hour` field, so the sitting hour of a resolved round is not recoverable from the book as it stands — the fix is a data-model change plus a decision the spec sequences at Part II §21 step 10, after §1.

This plan does not fix it and does not hide it: Task 4 pins the fact in a test that names §12.4, and Task 6 prints `UNMEASURED` beside the channel with a footer that says why. A defect somebody has decided about is different from one nobody has.

---

## File Structure

| file | responsibility | tasks |
|---|---|---|
| `src/lib/quant/fit.ts` | **new** — deterministic 1-D minimiser over a closed bracket: grid, then golden-section inside the bracketing interval | 1 |
| `src/lib/quant/fit.test.ts` | **new** — recovers a known minimum on convex and bimodal objectives, respects the bracket, deterministic | 1 |
| `src/lib/quant/signals/signalread.ts` | `SignalChannelWeights`, `adjOf`, `opts.weights` folded into every candidate before the terms are built; `signalBoard` passes them through | 2 |
| `src/lib/quant/signals/signalread.test.ts` | weight identity, the reshaped `adj`/`rawTerms`/notes, `adjOf`'s own contract | 2 |
| `src/lib/quant/signals/signalskill.ts` | split: `signalRounds` (the walk-forward replay) and `signalSkill(rounds, weights, enabled)` (the score-share fit on the reshaped `adj`) | 3 |
| `src/lib/quant/params.ts` | the channel-credibility block: κ, minimum rounds, clamps, passes, tolerances, the verdict band | 4 |
| `src/lib/quant/signals/channels.ts` | **new** — coordinate-descent fit of `a_k`, mean-1 normalisation, shrinkage, clamps, scoreboard rows | 4 |
| `src/lib/quant/signals/channels.test.ts` | **new** — the prior below the minimum count, mean-1 identification, ratio preservation on a 3× oversized channel, clamps, the flat-objective tie, determinism | 4 |
| `src/App.tsx` | one replay, then shape, then scale, then the board | 5 |
| `src/views/signals/ChannelPanel.tsx` | **new** — the channel scoreboard | 6 |
| `src/views/signals/index.tsx` | mounts the scoreboard, takes `signalChannels` | 6 |
| `README.md` §30 | the layer documents its measured channel credibility | 7 |

---

## Task 1: `fit.ts` — the deterministic 1-D minimiser

§2.2 fits each `a_k` by a 1-D search on the walk-forward CRPS objective, and §1.2 later fits every channel's `w` the same way. Both need one minimiser with one contract, and neither may assume the objective is unimodal: a clamped, capped, CRPS-shaped objective can carry a second basin, and a pure golden-section search would happily converge into the wrong one.

The house answer is the spec's: **a fixed grid over the bracket, then golden-section refinement inside the interval that brackets the grid's best point.** The grid guards against non-convexity; the refinement only sharpens the located basin.

**Files:**
- Create: `src/lib/quant/fit.ts`
- Create: `src/lib/quant/fit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface Fit1d {
    /** The minimising argument found. */
    x: number;
    /** The objective at `x`. */
    fx: number;
    /** Objective evaluations spent — asserted in tests, shown nowhere. */
    evals: number;
  }

  export function minimise1d(
    f: (x: number) => number,
    lo: number,
    hi: number,
    opts?: { grid?: number; tol?: number },
  ): Fit1d
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/quant/fit.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quant/fit.test.ts`
Expected: FAIL — `Failed to resolve import "./fit"`.

- [ ] **Step 3: Write `fit.ts`**

Create `src/lib/quant/fit.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quant/fit.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify nothing else moved**

Run: `npx tsc --noEmit` — clean.
Run: `npm run gate` — PASS, unchanged (nothing imports `fit.ts` yet).

- [ ] **Step 6: Commit**

```bash
git add src/lib/quant/fit.ts src/lib/quant/fit.test.ts
git commit -m "feat(quant): fit.ts — the deterministic 1-D minimiser

Grid over the whole bracket, then golden-section inside the interval that
brackets the grid's best point. The grid is the guard against a non-convex
objective, which a CRPS-shaped loss over a clamped blend can genuinely be;
the refinement only sharpens the basin the grid located and cannot leave it.

Ties resolve to the smallest x and the function refuses to invent a minimiser
for a flat objective — a caller whose flat means 'keep the prior' (Part II
§12.6) detects it and says so itself.

No caller yet. Gate unmoved.
Audit Part I §1.2, §6."
```

---

## Task 2: `signalRead` takes channel weights

`a_k` reaches the board through exactly one door. Folding it at the point the candidates are assembled means `terms`, `rawTerms`, `rawSum`, `adj` and the Shapley game every read feeds are all computed from the same reshaped contribution — there is no second arithmetic path that could disagree with the first, which is the failure mode Part II §13.1 catalogues in the post-processing chain.

§3.2's promise is kept here and nowhere else: `shapley.ts` is untouched, because the game is played over `rawTerms`, and `rawTerms` is already `a_k · pts_k` by the time the game sees it.

**Files:**
- Modify: `src/lib/quant/signals/signalread.ts`
- Modify: `src/lib/quant/signals/signalread.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces, from `src/lib/quant/signals/signalread.ts`:
  ```ts
  /** Per-channel credibility multipliers, prior 1. An absent key means 1. */
  export type SignalChannelWeights = Partial<Record<SignalTermKey, number>>;

  /** The clamped shift a player list implies — one owner, so the fit and the board agree. */
  export function adjOf(terms: readonly SignalRawTerm[], cap: number): { rawSum: number; adj: number }

  // signalRead's opts gains `weights`; signalBoard gains a trailing weights argument.
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/quant/signals/signalread.test.ts`:

```ts
import { adjOf, signalBoard, type SignalChannelWeights } from "./signalread";
import { SIGNAL_ADJ_CAP } from "./params";

/**
 * §2 of the prediction-math audit. Each channel earns a credibility multiplier
 * `a_k` with prior 1 — "this channel pulls exactly the weight it was authored
 * with" until its own record says otherwise. It folds in HERE, at the point the
 * candidates are assembled, so every downstream reading of the read (the terms
 * list, the Shapley player list, rawSum, adj) is computed from the same
 * reshaped number rather than from two arithmetic paths that could drift.
 */
describe("signalRead — channel credibility weights", () => {
  it("is the IDENTITY when no weights are passed", () => {
    const bare = signalRead(SUB({ attendancePct: 75 }), emptySignalBook, [], null, null, ASOF);
    const empty = signalRead(SUB({ attendancePct: 75 }), emptySignalBook, [], null, null, ASOF, { weights: {} });
    expect(empty).toEqual(bare);
  });

  it("is the IDENTITY when every weight is exactly 1", () => {
    const bare = signalRead(SUB({ attendancePct: 75 }), emptySignalBook, [], null, null, ASOF);
    const ones = signalRead(SUB({ attendancePct: 75 }), emptySignalBook, [], null, null, ASOF, {
      weights: { attendance: 1, stock: 1, mastery: 1, rest: 1, disruption: 1, anxiety: 1, chronotype: 1 },
    });
    expect(ones).toEqual(bare);
  });

  it("scales the channel's contribution, and rawSum/adj with it", () => {
    const bare = signalRead(SUB({ attendancePct: 75 }), emptySignalBook, [], null, null, ASOF);
    const half = signalRead(SUB({ attendancePct: 75 }), emptySignalBook, [], null, null, ASOF, {
      weights: { attendance: 0.5 },
    });
    const bareAtt = bare.rawTerms.find((t) => t.key === "attendance")!.pts;
    const halfAtt = half.rawTerms.find((t) => t.key === "attendance")!.pts;
    expect(halfAtt).toBeCloseTo(bareAtt * 0.5, 12);
    expect(half.rawSum).toBeCloseTo(bare.rawSum * 0.5, 12);
  });

  it("says so on the note when a channel is not pulling its authored weight", () => {
    const out = signalRead(SUB({ attendancePct: 75 }), emptySignalBook, [], null, null, ASOF, {
      weights: { attendance: 0.5 },
    });
    const note = out.terms.find((t) => t.key === "attendance")!.note;
    // The raw channel read is still described; the multiplier is stated, not hidden.
    expect(note).toMatch(/×0\.50 EARNED/);
  });

  it("carries no multiplier suffix at the authored weight", () => {
    const out = signalRead(SUB({ attendancePct: 75 }), emptySignalBook, [], null, null, ASOF);
    expect(out.terms.find((t) => t.key === "attendance")!.note).not.toMatch(/EARNED/);
  });

  it("a zero weight makes the channel a null player, not a zero-point row", () => {
    const out = signalRead(SUB({ attendancePct: 75 }), emptySignalBook, [], null, null, ASOF, {
      weights: { attendance: 0 },
    });
    expect(out.rawTerms.find((t) => t.key === "attendance")).toBeUndefined();
    expect(out.adj).toBe(0);
  });

  it("applies the display floor to the WEIGHTED contribution, not the raw one", () => {
    // 85% attended charges -0.15pt at MASTERY_W; at a_k = 0.2 that is -0.03,
    // under SIGNAL_NOTE_FLOOR — no longer a reason, still a player.
    const out = signalRead(SUB({ attendancePct: 85 }), emptySignalBook, [], null, null, ASOF, {
      weights: { attendance: 0.2 },
    });
    expect(out.terms.find((t) => t.key === "attendance")).toBeUndefined();
    expect(out.rawTerms.find((t) => t.key === "attendance")).toBeTruthy();
  });

  it("leaves sdMult alone — credibility reshapes the SHIFT, never the humility", () => {
    const sub = SUB({ attendancePct: 75, traits: { determinism: 1, breadth: 1 } as never });
    const bare = signalRead(sub, emptySignalBook, [], null, null, ASOF);
    const scaled = signalRead(sub, emptySignalBook, [], null, null, ASOF, { weights: { attendance: 0.25 } });
    expect(scaled.sdMult).toBe(bare.sdMult);
  });
});

describe("adjOf — one owner of the clamped shift", () => {
  it("sums the players and clamps, exactly as signalRead does", () => {
    const out = adjOf([{ key: "stock", pts: 3 }, { key: "mastery", pts: 3 }], SIGNAL_ADJ_CAP);
    expect(out.rawSum).toBeCloseTo(6, 12);
    expect(out.adj).toBe(SIGNAL_ADJ_CAP);
  });

  it("is 0/0 on an empty player list", () => {
    expect(adjOf([], SIGNAL_ADJ_CAP)).toEqual({ rawSum: 0, adj: 0 });
  });

  it("agrees with signalRead's own adj on a real read", () => {
    const read = signalRead(SUB({ attendancePct: 75 }), emptySignalBook, [], null, null, ASOF);
    expect(adjOf(read.rawTerms, SIGNAL_ADJ_CAP).adj).toBe(read.adj);
  });
});

describe("signalBoard — weights reach every desk", () => {
  it("passes the multipliers through to each desk's read", () => {
    const subs = [SUB({ id: "s1", attendancePct: 75 })];
    const weights: SignalChannelWeights = { attendance: 0.5 };
    const bare = signalBoard(subs, emptySignalBook, [], [], new Map(), ASOF);
    const scaled = signalBoard(subs, emptySignalBook, [], [], new Map(), ASOF, weights);
    expect(scaled.get("s1")!.rawSum).toBeCloseTo(bare.get("s1")!.rawSum * 0.5, 12);
  });
});
```

If the file's `SUB` helper does not accept a `traits` override in the shape above, use whatever traits literal the file's existing `traitSdMult` tests already build — the assertion is that `sdMult` is unmoved, so any subject whose `sdMult > 1` will do.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quant/signals/signalread.test.ts`
Expected: FAIL — `does not provide an export named 'adjOf'`.

- [ ] **Step 3: Add the type and `adjOf`**

In `src/lib/quant/signals/signalread.ts`, after the `SignalRawTerm` interface:

```ts
/**
 * Per-channel credibility multipliers (audit Part I §2). `a_k` scales the
 * channel's own authored point read before it enters the sum: prior 1, meaning
 * "this channel pulls exactly the weight it was authored with", moved only by
 * its own measured record (see channels.ts). An ABSENT key is 1, so a caller
 * that has fitted nothing passes nothing and every read is byte-identical to
 * the unweighted one.
 *
 * The hand-set constants in ./params.ts are NOT touched by this — they are the
 * prior, and measurement moves the multiplier, never the constant.
 */
export type SignalChannelWeights = Partial<Record<SignalTermKey, number>>;

/**
 * The clamped shift a player list implies. ONE owner, because two of them now
 * need this arithmetic — `signalRead` building a desk's read, and
 * `signalskill`/`channels` replaying a scored round at a candidate weight
 * vector without re-reading the book. A fit computed against different
 * arithmetic from the board it ships to would be silently invalid (audit
 * §1.4's rule, applied one layer down).
 */
export function adjOf(terms: readonly SignalRawTerm[], cap: number): { rawSum: number; adj: number } {
  const rawSum = terms.reduce((a, t) => a + t.pts, 0);
  return { rawSum, adj: round2(clamp(rawSum, -cap, cap)) };
}
```

- [ ] **Step 4: Fold the weights into `signalRead`**

Extend the options parameter:

```ts
  opts?: { drop?: ReadonlySet<SignalTermKey>; weights?: SignalChannelWeights },
```

Replace the block that begins `const keys = SIGNAL_TERM_ORDER.filter(...)` and ends at the `rawTerms` build (currently lines ~279-299) with:

```ts
  const keys = SIGNAL_TERM_ORDER.filter((k) => raw[k] != null);

  // CHANNEL CREDIBILITY (audit Part I §2). Every candidate's authored read is
  // scaled by its own measured multiplier before anything else looks at it, so
  // `terms`, `rawTerms`, `rawSum` and `adj` are all one arithmetic path rather
  // than four that could drift apart. Absent (the ordinary case, and the only
  // case the committed fixture ever sees) is 1, and the read is identical to
  // what it was before this parameter existed.
  const weightOf = (k: SignalTermKey): number => opts?.weights?.[k] ?? 1;
  const pts: Partial<Record<SignalTermKey, number>> = {};
  for (const k of keys) pts[k] = weightOf(k) * raw[k]!.pts;

  // The player list: every candidate that actually contributed AFTER its own
  // multiplier, floor or no floor. An exact zero is a null player — worth
  // nothing itself and leaving every other φ unchanged — so it is dropped,
  // which is what keeps an untouched book reading `rawTerms: []`, and what
  // makes a channel measured all the way down to a_k = 0 disappear from the
  // game rather than sit in it at zero.
  const rawTerms: SignalRawTerm[] = keys
    .filter((k) => pts[k] !== 0)
    .map((k) => ({ key: k, pts: pts[k] as number }));

  const { rawSum: sum, adj } = adjOf(rawTerms, SIGNAL_ADJ_CAP);

  const terms: SignalTerm[] = keys
    .filter((k) => Math.abs(pts[k] as number) >= SIGNAL_NOTE_FLOOR)
    .map((k) => {
      const a = weightOf(k);
      // The note describes the CHANNEL READ, which is the authored number, and
      // then states the multiplier when it is not 1. Quoting the scaled figure
      // under the channel's own label would misreport what the channel read;
      // omitting the multiplier would misreport what it was paid.
      const note = a === 1 ? raw[k]!.note() : `${raw[k]!.note()} · ×${a.toFixed(2)} EARNED`;
      return { key: k, pts: pts[k] as number, note };
    })
    .sort((a, b) => {
      // Harshest first: most-negative first, then positives by |pts| desc.
      if (a.pts < 0 && b.pts < 0) return a.pts - b.pts;
      if (a.pts >= 0 && b.pts >= 0) return b.pts - a.pts;
      return a.pts < 0 ? -1 : 1;
    });
```

The old `const sum = keys.reduce(...)` and `const adj = round2(clamp(...))` lines are replaced by the `adjOf` call above — delete them. The returned object is unchanged (`rawSum: sum`).

- [ ] **Step 5: Thread the weights through `signalBoard`**

Add a trailing parameter and pass it down:

```ts
export function signalBoard(
  subjects: Subject[],
  book: SignalBook,
  entries: GradeEntry[],
  upcoming: Upcoming[],
  modelMeans: Map<string, number | null>,
  asOf: string,
  weights?: SignalChannelWeights | null,
): Map<string, SignalRead> {
```

and the call at the end of its loop:

```ts
    out.set(sub.id, signalRead(sub, book, subEntries, next, modelMean, asOf, weights ? { weights } : undefined));
```

Add to `signalBoard`'s doc comment:

```
 * `weights` are the per-channel credibility multipliers (audit Part I §2),
 * fitted by channels.ts and passed straight through — absent means every
 * channel pulls its authored weight, which is what an unscored book gets.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quant/signals`
Expected: PASS — including every pre-existing read test, unchanged. If any existing assertion moved, the identity is broken and the weighting is not defaulting to 1; fix that rather than the test.

- [ ] **Step 7: Verify nothing else moved**

Run: `npx tsc --noEmit` — clean.
Run: `npm run gate` — PASS, unchanged.
Run: `npx vitest run` — PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/quant/signals/signalread.ts src/lib/quant/signals/signalread.test.ts
git commit -m "feat(signals): signalRead folds per-channel credibility weights

a_k reaches the board through exactly one door: the multiplier is applied
where the candidates are assembled, so terms, rawTerms, rawSum and adj are one
arithmetic path rather than four that could drift. shapley.ts is untouched —
the game is played over rawTerms, which is already a_k*pts_k by the time it
sees it, which is what §3.2 promised.

adjOf is the single owner of 'sum the players, clamp, round': the walk-forward
fit needs the same arithmetic the board ships, and computing it twice is how
a fit silently stops measuring what it prices.

Absent weights are 1 and the read is byte-identical, which is what keeps the
committed fixture unmoved. A note states the multiplier when a channel is not
pulling its authored weight rather than quietly reporting a scaled number
under the channel's own label.

Gate unmoved. Audit Part I §2."
```

---

## Task 3: split the walk-forward replay from the scoring

`signalSkill` currently reads the book once per resolved round and immediately collapses the result to two score arrays. `channels.ts` needs the same rounds and the same as-of discipline, and re-running the replay a second time would double the most expensive part of the layer and — worse — create a second copy of the `bookBefore` cutoff rules that could drift from the first.

Split it: `signalRounds` does the replay and returns what a scored round IS; `signalSkill` scores it at a candidate weight vector.

**Files:**
- Modify: `src/lib/quant/signals/signalskill.ts`
- Modify: `src/lib/quant/signals/signalskill.test.ts`
- Modify: `src/lib/derive/derive.book.test.ts` (its `signalSkill` call)

**Interfaces:**
- Consumes: `adjOf`, `SignalChannelWeights`, `SignalRawTerm` (Task 2).
- Produces, from `src/lib/quant/signals/signalskill.ts`:
  ```ts
  export interface SignalRound {
    subjectId: string;
    /** The round's resolution date — the as-of cutoff its read was taken at. */
    cutoff: string;
    /** The desk's per-channel candidate reads as of `cutoff`, UNWEIGHTED. */
    rawTerms: SignalRawTerm[];
    sdMult: number;
    /** The register's own stored call: mean, scale, df. */
    point: number;
    sd: number;
    df: number;
    realized: number;
    /** The register's own CRPS on this outcome — the model side of the ratio. */
    modelCrps: number;
  }

  export function signalRounds(
    register: ForecastLog[],
    book: SignalBook,
    subjects: Subject[],
    entries: GradeEntry[],
  ): SignalRound[]

  export function signalSkill(
    rounds: SignalRound[],
    weights: SignalChannelWeights | null,
    enabled: boolean,
  ): SignalSkill
  ```

- [ ] **Step 1: Write the failing tests**

At the top of `src/lib/quant/signals/signalskill.test.ts`, replace the import of `signalSkill` with:

```ts
import { NO_SIGNAL_SKILL, signalRounds, signalSkill } from "./signalskill";
```

and add, immediately below the file's constant helpers, a shim that keeps every existing test's call shape working:

```ts
/**
 * The replay and the scoring are two functions now (audit Part I §2 needs the
 * rounds without the score share). Every case below still asks the same
 * question — "what does this register earn?" — so it asks it through one
 * helper rather than restating the split at each call site.
 */
const fit = (
  register: ForecastLog[],
  book: SignalBook,
  subjects: Subject[],
  entries: GradeEntry[],
  enabled = true,
  weights: SignalChannelWeights | null = null,
) => signalSkill(signalRounds(register, book, subjects, entries), weights, enabled);
```

with `import type { SignalChannelWeights } from "./signalread";` added to the imports. Then replace every `signalSkill(` call in the existing cases with `fit(` — the argument order is identical.

Append the new cases:

```ts
describe("signalRounds — the replay, split from the scoring", () => {
  it("returns one round per resolved exam log it could read", () => {
    const rounds = signalRounds([LOG()], SIGNAL_BOOK, [SUB()], [ENTRY()]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].cutoff).toBe(CUTOFF);
    expect(rounds[0].modelCrps).toBe(3);
  });

  it("carries the UNWEIGHTED candidate reads, so one replay serves every weight vector", () => {
    const rounds = signalRounds([LOG()], SIGNAL_BOOK, [SUB()], [ENTRY()]);
    const scaled = signalSkill(rounds, { stock: 0.5 }, true);
    const bare = signalSkill(rounds, null, true);
    // The rounds are the same objects; only the scoring changed.
    expect(rounds).toEqual(signalRounds([LOG()], SIGNAL_BOOK, [SUB()], [ENTRY()]));
    expect(scaled.rounds).toBeLessThanOrEqual(bare.rounds);
  });

  it("skips a round the read cannot move, at the weights it is scored with", () => {
    // Every channel zeroed is the identity read: not a tie, not evidence.
    const rounds = signalRounds([LOG()], SIGNAL_BOOK, [SUB()], [ENTRY()]);
    expect(signalSkill(rounds, { stock: 0, mastery: 0, rest: 0, disruption: 0, anxiety: 0, chronotype: 0, attendance: 0 }, true).rounds).toBe(0);
  });

  it("is empty on a book with no signal data, which is what keeps the fixture unmoved", () => {
    const rounds = signalRounds([LOG()], emptySignalBook, [SUB()], [ENTRY()]);
    expect(signalSkill(rounds, null, true).rounds).toBe(0);
  });
});
```

`SIGNAL_BOOK` is whatever populated `SignalBook` literal the file already builds for its "a book with signal data scores rounds" case — reuse it by name; if it is built inline in that test, hoist it to a module-level `const SIGNAL_BOOK: SignalBook = ...` and have both use it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quant/signals/signalskill.test.ts`
Expected: FAIL — `does not provide an export named 'signalRounds'`.

- [ ] **Step 3: Split `signalskill.ts`**

Replace everything from `export interface SignalSkill` to the end of the file with:

```ts
export interface SignalSkill extends EarnedWeight {
  /** Scored (non-skipped) pairs. */
  rounds: number;
}

/** `enabled: false` — no track record is consulted at all. */
export const NO_SIGNAL_SKILL: SignalSkill = { ...NO_WEIGHT, rounds: 0 };

/**
 * One resolved round, replayed: the desk's per-channel candidate reads as of
 * that round's resolution, beside the register's own stored call and score on
 * the same outcome.
 *
 * `rawTerms` is UNWEIGHTED on purpose. The replay is the expensive half of
 * this file (a book filter and a full `signalRead` per round) and it does not
 * depend on the credibility multipliers at all, so it runs ONCE and both
 * fitters — `channels.ts` searching over `a_k`, and `signalSkill` scoring the
 * result — replay it arithmetically through `adjOf` rather than re-reading the
 * book. A second copy of `bookBefore`'s cutoff discipline is exactly the kind
 * of duplicate that drifts.
 */
export interface SignalRound {
  subjectId: string;
  /** The round's resolution date — the as-of cutoff its read was taken at. */
  cutoff: string;
  /** The desk's per-channel candidate reads as of `cutoff`, UNWEIGHTED. */
  rawTerms: SignalRawTerm[];
  sdMult: number;
  point: number;
  sd: number;
  df: number;
  realized: number;
  /** The register's own CRPS on this outcome — the model side of the ratio. */
  modelCrps: number;
}

/**
 * Replay every resolved exam round in the register through the life-signals
 * book as it stood at that round's resolution.
 */
export function signalRounds(
  register: ForecastLog[],
  book: SignalBook,
  subjects: Subject[],
  entries: GradeEntry[],
): SignalRound[] {
  const subjectsById = new Map(subjects.map((s) => [s.id, s]));
  // crps must be present alongside realized for a resolved log (replayRegister
  // always sets both together) — required here so `log.crps as number` below
  // is an honest cast rather than a silent `undefined` corrupting the score.
  const resolved = register.filter((l) => l.target === "exam" && l.realized != null && l.crps != null);

  const out: SignalRound[] = [];
  for (const log of resolved) {
    const cutoff = log.resolvedAt;
    if (cutoff == null) continue;
    const sub = subjectsById.get(log.subjectId);
    if (!sub) continue;

    const resolvedEntry = log.resolvedEntryId != null ? entries.find((e) => e.id === log.resolvedEntryId) ?? null : null;
    // `hour: null` — Part II §12.4: a resolved sitting's hour is not recorded
    // anywhere on the book (GradeEntry has no hour field), so the chronotype
    // candidate cannot fire in the replay and its own record is structurally
    // empty. channels.ts pins that fact in a test and the scoreboard prints it
    // rather than letting the channel ride an unmeasured multiplier silently.
    const next: NextSitting = { date: cutoff, hour: null, weight: resolvedEntry?.worthPct ?? null };

    const entriesBefore = entries.filter((e) => e.subjectId === log.subjectId && e.date < cutoff);
    const read = signalRead(sub, bookBefore(book, entries, cutoff), entriesBefore, next, log.point, cutoff);

    out.push({
      subjectId: log.subjectId,
      cutoff,
      rawTerms: read.rawTerms,
      sdMult: read.sdMult,
      point: log.point,
      sd: log.sd,
      df: log.df,
      realized: log.realized as number,
      modelCrps: log.crps as number,
    });
  }
  return out;
}

/**
 * The adjusted forecast a round implies at a given weight vector — the SAME
 * arithmetic `applySignals` ships, so the fit scores what the board sells.
 */
export function roundForecast(
  round: SignalRound,
  weights: SignalChannelWeights | null,
): { adj: number; mean: number; scale: number; df: number } {
  const terms = weights
    ? round.rawTerms.map((t) => ({ key: t.key, pts: (weights[t.key] ?? 1) * t.pts })).filter((t) => t.pts !== 0)
    : round.rawTerms;
  const { adj } = adjOf(terms, SIGNAL_ADJ_CAP);
  return { adj, mean: clamp(round.point + adj, 0, 100), scale: round.sd * round.sdMult, df: round.df };
}

/**
 * Fit the weight the life-signals channel has earned, from every replayed
 * round, at the channel credibility `channels.ts` has already fitted.
 *
 * A round the read cannot move at all (adj 0, sdMult 1 — the identity, no
 * evidence logged as of that cutoff, or every channel measured down to
 * nothing) is not a tie, it is not evidence, and is skipped rather than scored.
 * That test runs at the SHIPPED weights, not the authored ones: a channel the
 * record has zeroed genuinely contributes no evidence to the scale fit.
 */
export function signalSkill(
  rounds: SignalRound[],
  weights: SignalChannelWeights | null,
  enabled: boolean,
): SignalSkill {
  if (!enabled) return NO_SIGNAL_SKILL;

  const you: number[] = [];
  const model: number[] = [];
  for (const round of rounds) {
    const fc = roundForecast(round, weights);
    if (fc.adj === 0 && round.sdMult === 1) continue;
    you.push(scoreT({ mean: fc.mean, scale: fc.scale, df: fc.df }, round.realized).crps);
    model.push(round.modelCrps);
  }

  const fit = earnedWeight(you, model, { kappa: SIGNAL_KAPPA, cap: SIGNAL_CAP, toward: SIGNAL_PRIOR });
  return { ...fit, rounds: you.length };
}
```

Update the imports at the top of the file:

```ts
import { adjOf, signalRead, type NextSitting, type SignalBook, type SignalChannelWeights, type SignalRawTerm } from "./signalread";
import { SIGNAL_ADJ_CAP } from "./params";
```

`bookBefore` and the module doc comment are unchanged, except that the doc's closing paragraph gains:

```
 * The replay and the scoring are two functions (audit Part I §2). `channels.ts`
 * fits the SHAPE of the adjustment — one credibility multiplier per channel —
 * on the same rounds this file scores the SCALE on, and the replay is done once
 * and shared rather than run twice against two copies of the cutoff rules.
```

- [ ] **Step 4: Fix the other caller**

`src/lib/derive/derive.book.test.ts:174` becomes:

```ts
const signalFit = signalSkill(signalRounds(register, signalBook, subjects, entries), null, true);
```

with `signalRounds` added to that file's import from `../quant/signals/signalskill`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quant/signals src/lib/derive`
Expected: PASS.

- [ ] **Step 6: Verify nothing else moved**

Run: `npx tsc --noEmit`
Expected: ONE error, in `src/App.tsx:245` — `signalSkill` now takes rounds. Task 5 fixes it. Do not fix it here and do not run the full suite yet.

- [ ] **Step 7: Commit**

```bash
git add src/lib/quant/signals/signalskill.ts src/lib/quant/signals/signalskill.test.ts src/lib/derive/derive.book.test.ts
git commit -m "refactor(signals): split the walk-forward replay from the scoring

signalRounds replays every resolved round through the book as it stood at that
round's resolution and stops there. signalSkill scores those rounds at a given
channel-weight vector. The replay is the expensive half and does not depend on
the weights at all, so channels.ts's coordinate descent and this file's score
share share ONE replay instead of running two copies of bookBefore's cutoff
discipline that could drift apart.

roundForecast is the shared 'what does this round look like at these weights'
step, built on adjOf, so the fit scores the arithmetic applySignals ships.

Behaviour at null weights is identical, round for round.
Audit Part I §2. Part II §12.4 is named where it bites, not fixed here."
```

---

## Task 4: `channels.ts` — the fit, the identification, and the scoreboard rows

§2.2's model:

```
adj = clamp( Σ_k a_k · pts_k ,  ± SIGNAL_ADJ_CAP )
a_k = shrinkToward( ã_k , n_k , 1 , SIGNAL_CHANNEL_KAPPA )
```

with `â_k` fitted by coordinate descent on the walk-forward CRPS, `ã_k` the normalised `â_k`, and three defences against a 7-parameter fit on 6-12 rounds: shrinkage toward the authored prior, a minimum round count before a channel is measured at all, and hard clamps.

**§2.3's identification is the part that is easy to get wrong.** `w · a_k` is a product; only the product is identified. The resolution is to normalise `a_k` to mean exactly 1 over the channels that were actually measured, so `a_k` carries only RELATIVE channel credibility and `w` carries absolute size. That is why the shape is fitted at full strength (`w = 1`) and `w` is fitted afterwards on the reshaped `adj`, in that order, and why the mean-1 claim is asserted on `ã` — the normalised fit — rather than on the shrunk vector, where seven different `n_k` pull seven different distances toward 1.

**Files:**
- Modify: `src/lib/quant/params.ts`
- Create: `src/lib/quant/signals/channels.ts`
- Create: `src/lib/quant/signals/channels.test.ts`

**Interfaces:**
- Consumes: `minimise1d` (Task 1), `SignalChannelWeights` (Task 2), `SignalRound`/`roundForecast` (Task 3), `shrinkToward`, `scoreT`.
- Produces, from `src/lib/quant/signals/channels.ts`:
  ```ts
  export type ChannelVerdict = "CARRIES" | "NEUTRAL" | "COSTS" | "UNMEASURED";

  export interface ChannelRow {
    key: SignalTermKey;
    /** Scored rounds in which this channel actually fired. */
    n: number;
    /** The unshrunk, un-normalised minimiser. Null when unmeasured. */
    raw: number | null;
    /** After mean-1 normalisation over measured channels. Null when unmeasured. */
    normalised: number | null;
    /** The shipped multiplier: normalised, shrunk toward 1, clamped. */
    a: number;
    /** Mean CRPS the book would pay to drop this channel entirely. Null when unmeasured. */
    dCrps: number | null;
    verdict: ChannelVerdict;
  }

  export interface SignalChannelFit {
    /** Every key present — 1 for an unmeasured channel. */
    weights: SignalChannelWeights;
    /** One row per channel, in SIGNAL_TERM_ORDER. */
    rows: ChannelRow[];
    /** Rounds the fit could see (those where some channel fired). */
    rounds: number;
  }

  export const NO_CHANNEL_FIT: SignalChannelFit
  export function fitSignalChannels(rounds: SignalRound[], enabled: boolean): SignalChannelFit
  ```

- [ ] **Step 1: Add the credibility knobs**

In `src/lib/quant/params.ts`, immediately after `SIGNAL_PRIOR` (currently line 352) and before the `/* ── Market depth ── */` divider:

```ts
/**
 * Pseudo-rounds shrinking each SIGNAL CHANNEL's own credibility multiplier
 * toward 1 — "this channel pulls exactly the weight it was authored with"
 * (audit Part I §2.2). Larger than SIGNAL_KAPPA because the layer's scarce
 * resolved rounds are split SEVEN ways here: the channel-level record is
 * always thinner than the layer-level one it is carved out of, so it is
 * approached more slowly.
 */
export const SIGNAL_CHANNEL_KAPPA = 3;

/**
 * Rounds in which a channel must actually have FIRED before it is measured at
 * all. Below this it is not fitted, not normalised and not scored — its
 * multiplier is exactly 1, the hand-set prior, and the scoreboard says
 * UNMEASURED rather than printing a number nobody should read. Four is the
 * point at which a channel has a record rather than an anecdote on a book that
 * typically carries 6-12 resolved rounds in total.
 */
export const SIGNAL_CHANNEL_MIN_ROUNDS = 4;

/**
 * Hard clamps on the credibility multiplier. A channel may be measured down to
 * a quarter of its authored weight or up to two and a half times it; past that
 * the fit is describing this book's noise rather than this channel's worth.
 * Wide enough to admit the readings the layer is meant to surface ("MASTERY
 * pulls 1.8x its stated weight, CHRONO pulls 0.3x"), narrow enough that seven
 * multipliers fitted on a handful of rounds cannot rewrite the layer.
 */
export const SIGNAL_A_MIN = 0.25;
export const SIGNAL_A_MAX = 2.5;

/**
 * Sweeps of the coordinate descent over the measured channels. Each sweep is a
 * full 1-D search per channel holding the others fixed; three is where the
 * objective stops moving on books of this size, and a fixed count (rather than
 * "until converged") keeps the fit deterministic and its cost bounded.
 */
export const SIGNAL_CHANNEL_PASSES = 3;

/**
 * Improvement in mean CRPS, in score points, a channel's own search must beat
 * to move it off the authored prior at all. Part II §12.6's rule met early: an
 * objective that is flat in the parameter has no minimiser, and a search over
 * a flat lands on an arbitrary point of it. Below this the channel keeps
 * a_k = 1 and says so.
 */
export const SIGNAL_CHANNEL_TOL = 1e-4;

/**
 * Neutral band, in mean CRPS points, on the scoreboard's drop-one verdict. A
 * channel whose removal moves the book's walk-forward score by less than this
 * is reported NEUTRAL rather than credited or blamed for noise. A stated
 * constant, not a fitted one — deriving the band from the fold-level spread is
 * Part II §11.5's job for the whole ablation layer, and this row will move to
 * it when that lands.
 */
export const SIGNAL_CHANNEL_EPS = 0.01;
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/quant/signals/channels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SIGNAL_A_MAX, SIGNAL_A_MIN, SIGNAL_CHANNEL_MIN_ROUNDS,
} from "../params";
import { fitSignalChannels, NO_CHANNEL_FIT } from "./channels";
import { SIGNAL_TERM_ORDER, type SignalRawTerm, type SignalTermKey } from "./signalread";
import type { SignalRound } from "./signalskill";

/**
 * §2 of the prediction-math audit. Seven signal terms used to share one earned
 * weight, so a student could not tell whether the mastery channel was carrying
 * the layer while chronotype was noise, and got no benefit if so. The hand-set
 * constants stay — they are the prior — and measurement moves a multiplier.
 *
 * The identification claim (§2.3) is the load-bearing one: w * a_k is a
 * product, only the product is identified, so a_k is normalised to mean 1 over
 * the channels actually measured and carries RELATIVE credibility only.
 */

const ROUND = (terms: SignalRawTerm[], over: Partial<SignalRound> = {}): SignalRound => ({
  subjectId: "s1",
  cutoff: "2026-04-01",
  rawTerms: terms,
  sdMult: 1,
  point: 70,
  sd: 5,
  df: 8,
  realized: 70,
  modelCrps: 2,
  ...over,
});

/**
 * `n` rounds in which `key` is the only channel firing, reading `truth *
 * factor` against a desk that landed `70 + truth` on a call of 70. So the
 * channel is pointing the right way and is `factor` times too big, and the
 * weight that scores best is exactly `1 / factor`.
 *
 * Keep `truth * factor * SIGNAL_A_MAX` inside SIGNAL_ADJ_CAP (= 4) wherever the
 * test needs the objective to have an interior optimum: past the cap the
 * clamped game is genuinely flat in `a_k`, which is a real property worth
 * testing on purpose (see the tie case) and a silent fixture bug everywhere
 * else. `month` keeps two calls from colliding on a cutoff date; `n` <= 9.
 */
const oversized = (
  key: SignalTermKey, truth: number, factor: number, n: number, month = "04",
): SignalRound[] =>
  Array.from({ length: n }, (_, i) =>
    ROUND([{ key, pts: truth * factor }], { realized: 70 + truth, cutoff: `2026-${month}-0${i + 1}` }),
  );

describe("fitSignalChannels — the prior, held until a channel has a record", () => {
  it("returns every multiplier at exactly 1 with no rounds at all", () => {
    const fit = fitSignalChannels([], true);
    for (const k of SIGNAL_TERM_ORDER) expect(fit.weights[k]).toBe(1);
    expect(fit.rows.every((r) => r.verdict === "UNMEASURED")).toBe(true);
    expect(fit.rounds).toBe(0);
  });

  it("is the identity fit when the channel is switched off", () => {
    expect(fitSignalChannels(oversized("stock", 1, 3, 8), false)).toEqual(NO_CHANNEL_FIT);
  });

  it("holds a_k at EXACTLY 1 below the minimum round count", () => {
    const rounds = oversized("stock", 1, 3, SIGNAL_CHANNEL_MIN_ROUNDS - 1);
    const fit = fitSignalChannels(rounds, true);
    expect(fit.weights.stock).toBe(1);
    const row = fit.rows.find((r) => r.key === "stock")!;
    expect(row.verdict).toBe("UNMEASURED");
    expect(row.raw).toBeNull();
    expect(row.normalised).toBeNull();
    expect(row.n).toBe(SIGNAL_CHANNEL_MIN_ROUNDS - 1);
  });

  it("pins Part II §12.4: chronotype can never be measured from a replay", () => {
    // signalskill.ts scores every round with `hour: null`, so the chronotype
    // candidate never fires and its n_k is structurally zero. This test exists
    // so that the day §12.4 is fixed, it fails and is deliberately updated —
    // rather than the channel quietly riding an unmeasured multiplier forever.
    const fit = fitSignalChannels(oversized("stock", 1, 3, 8), true);
    const chrono = fit.rows.find((r) => r.key === "chronotype")!;
    expect(chrono.n).toBe(0);
    expect(chrono.a).toBe(1);
    expect(chrono.verdict).toBe("UNMEASURED");
  });
});

describe("fitSignalChannels — identification (§2.3)", () => {
  // Two measured channels on disjoint rounds: stock reads three times the
  // error it is trying to correct, mastery reads it exactly. Only the RATIO
  // between them is identified — w carries the absolute size — so the best
  // absolute weights (1/3 and 1) normalise to (0.5, 1.5).
  const TWO = [...oversized("stock", 1, 3, 6), ...oversized("mastery", 1, 1, 6, "05")];

  it("normalises to mean EXACTLY 1 over the measured channels", () => {
    const fit = fitSignalChannels(TWO, true);
    const measured = fit.rows.filter((r) => r.normalised != null);
    expect(measured).toHaveLength(2);
    const mean = measured.reduce((a, r) => a + (r.normalised as number), 0) / measured.length;
    expect(mean).toBeCloseTo(1, 10);
  });

  it("recovers the RATIO between a correctly sized channel and a 3x oversized one", () => {
    const fit = fitSignalChannels(TWO, true);
    const stock = fit.rows.find((r) => r.key === "stock")!.normalised as number;
    const mastery = fit.rows.find((r) => r.key === "mastery")!.normalised as number;
    // mastery is right, stock is 3x too big — so mastery pulls about three
    // times the relative credibility stock does. This is the reading the old
    // one-weight-for-seven-channels design could not produce at all.
    expect(mastery / stock).toBeCloseTo(3, 1);
  });

  it("shrinks toward the authored prior, so the shipped a_k sits between the fit and 1", () => {
    const fit = fitSignalChannels(TWO, true);
    for (const key of ["stock", "mastery"] as const) {
      const row = fit.rows.find((r) => r.key === key)!;
      const lo = Math.min(row.normalised as number, 1);
      const hi = Math.max(row.normalised as number, 1);
      expect(row.a, key).toBeGreaterThanOrEqual(lo);
      expect(row.a, key).toBeLessThanOrEqual(hi);
    }
  });

  it("clamps the search at SIGNAL_A_MIN, and every shipped multiplier stays in range", () => {
    // stock reads EIGHT times the error: the weight that would score best is
    // 0.125, outside the bracket, so the fit lands on its floor.
    const rounds = [...oversized("stock", 0.5, 8, 8), ...oversized("mastery", 0.5, 1, 8, "05")];
    const fit = fitSignalChannels(rounds, true);
    expect(fit.rows.find((r) => r.key === "stock")!.raw).toBeCloseTo(SIGNAL_A_MIN, 6);
    for (const r of fit.rows) {
      expect(r.a, r.key).toBeGreaterThanOrEqual(SIGNAL_A_MIN);
      expect(r.a, r.key).toBeLessThanOrEqual(SIGNAL_A_MAX);
    }
  });
});

describe("fitSignalChannels — the flat objective, and the scoreboard", () => {
  it("keeps the prior when the record cannot discriminate (Part II §12.6)", () => {
    // stock reads 100pt, so a_k * pts is clamped to SIGNAL_ADJ_CAP across the
    // WHOLE bracket and no weight scores better than any other. The channel
    // has a record (8 firings, well over the minimum) and the record cannot
    // discriminate, which is exactly the case a bare minimiser answers with an
    // arbitrary point of the flat.
    const rounds = [...oversized("stock", 100, 1, 8), ...oversized("mastery", 1, 1, 8, "05")];
    const fit = fitSignalChannels(rounds, true);
    expect(fit.rows.find((r) => r.key === "stock")!.raw).toBe(1);
    // And the tie must not leak into the OTHER channel through the mean-1
    // normalisation: without the tie rule stock fits 0.25, the mean drops to
    // 0.625, and mastery would print 1.60 despite being exactly right.
    expect(fit.rows.find((r) => r.key === "mastery")!.normalised).toBeCloseTo(1, 10);
    expect(fit.weights.stock).toBe(1);
  });

  it("prices what dropping a channel would cost, in CRPS points", () => {
    const fit = fitSignalChannels(oversized("stock", 1, 1, 8), true);
    const stock = fit.rows.find((r) => r.key === "stock")!;
    // The channel is reading the error exactly right, so dropping it costs.
    expect(stock.dCrps).toBeGreaterThan(0);
    expect(stock.verdict).toBe("CARRIES");
  });

  it("returns rows in SIGNAL_TERM_ORDER, one per channel, always", () => {
    const fit = fitSignalChannels(oversized("stock", 1, 3, 8), true);
    expect(fit.rows.map((r) => r.key)).toEqual([...SIGNAL_TERM_ORDER]);
  });

  it("is deterministic — the same rounds twice are the same fit", () => {
    const rounds = oversized("stock", 1, 3, 8);
    expect(fitSignalChannels(rounds, true)).toEqual(fitSignalChannels(rounds, true));
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quant/signals/channels.test.ts`
Expected: FAIL — `Failed to resolve import "./channels"`.

- [ ] **Step 4: Write `channels.ts`**

Create `src/lib/quant/signals/channels.ts`:

```ts
import { clamp } from "../../utils";
import { scoreT } from "../eval/scoring";
import { minimise1d } from "../fit";
import {
  SIGNAL_A_MAX, SIGNAL_A_MIN, SIGNAL_CHANNEL_EPS, SIGNAL_CHANNEL_KAPPA,
  SIGNAL_CHANNEL_MIN_ROUNDS, SIGNAL_CHANNEL_PASSES, SIGNAL_CHANNEL_TOL,
} from "../params";
import { shrinkToward } from "../shrinkage";
import { SIGNAL_TERM_ORDER, type SignalChannelWeights, type SignalTermKey } from "./signalread";
import { roundForecast, type SignalRound } from "./signalskill";

/**
 * channels.ts — per-channel credibility for the life-signals layer (audit
 * Part I §2).
 *
 * Seven signal terms used to share ONE earned weight. A student could not tell
 * whether the mastery channel was carrying the layer while chronotype was
 * noise, and got no benefit if it was. The hand-set constants in ./params.ts
 * stay exactly as they are — they are the PRIOR, the authored claim about how
 * much each mechanism is worth — and what this module adds is measurement:
 *
 *     adj = clamp( Σ_k a_k · pts_k , ±SIGNAL_ADJ_CAP )
 *     a_k = clamp( shrinkToward( ã_k , n_k , 1 , SIGNAL_CHANNEL_KAPPA ), A_MIN, A_MAX )
 *
 * with prior 1: an unmeasured channel pulls exactly the weight it was authored
 * with, and the whole layer on an unscored book is byte-identical to the layer
 * before this module existed.
 *
 * IDENTIFICATION (§2.3) is the part that has to be got right. `w · a_k` is a
 * product and only the product is identified from the data, so fitting both
 * freely would leave the split between them arbitrary and both displayed
 * numbers meaningless. The resolution:
 *
 *   · SHAPE first, at full strength. The fit below searches `a_k` with the
 *     adjustment applied at w = 1, because it is fitting the shape of `adj`,
 *     not its size.
 *   · Then NORMALISE `â_k` to mean exactly 1 over the channels actually
 *     measured. `a_k` now carries only RELATIVE credibility — "MASTERY pulls
 *     1.8× its stated weight, CHRONO pulls 0.3×" — and is directly readable.
 *   · Then SCALE: signalSkill fits `w` on the reshaped `adj`, and absolute
 *     size lives there and only there.
 *
 * OVERFITTING (§2.4): seven parameters on the 6-12 resolved rounds a real book
 * carries would be worthless unshrunk. Three defences, all house style —
 * shrinkage toward the authored prior with its own κ, a minimum round count
 * before a channel is measured at all, and hard clamps on `a_k`.
 *
 * The mean-1 claim holds on `ã`, the normalised fit, and NOT on the shipped
 * `a`: shrinkage pulls each channel toward 1 at its own evidence rate, and
 * seven different `n_k` pull seven different distances. That is the honest
 * behaviour — identification is a statement about what the data can separate,
 * shrinkage is a statement about how much of it to believe — and the tests
 * assert each on the vector it is true of.
 */

export type ChannelVerdict = "CARRIES" | "NEUTRAL" | "COSTS" | "UNMEASURED";

export interface ChannelRow {
  key: SignalTermKey;
  /** Scored rounds in which this channel actually fired. */
  n: number;
  /** The unshrunk, un-normalised minimiser. Null when unmeasured. */
  raw: number | null;
  /** After mean-1 normalisation over measured channels. Null when unmeasured. */
  normalised: number | null;
  /** The shipped multiplier: normalised, shrunk toward 1, clamped. */
  a: number;
  /** Mean CRPS the book would pay to drop this channel entirely. Null when unmeasured. */
  dCrps: number | null;
  verdict: ChannelVerdict;
}

export interface SignalChannelFit {
  /** Every key present — 1 for an unmeasured channel. */
  weights: SignalChannelWeights;
  /** One row per channel, in SIGNAL_TERM_ORDER. */
  rows: ChannelRow[];
  /** Rounds the fit could see — those in which some channel fired. */
  rounds: number;
}

const ONES = (): SignalChannelWeights =>
  Object.fromEntries(SIGNAL_TERM_ORDER.map((k) => [k, 1])) as SignalChannelWeights;

const UNMEASURED_ROWS = (counts?: Map<SignalTermKey, number>): ChannelRow[] =>
  SIGNAL_TERM_ORDER.map((key) => ({
    key, n: counts?.get(key) ?? 0, raw: null, normalised: null, a: 1, dCrps: null, verdict: "UNMEASURED" as const,
  }));

/** `enabled: false` — no channel record is consulted at all. */
export const NO_CHANNEL_FIT: SignalChannelFit = {
  weights: ONES(),
  rows: UNMEASURED_ROWS(),
  rounds: 0,
};

/**
 * Mean CRPS of the replayed rounds at a candidate weight vector, under the
 * SAME arithmetic the board ships (`roundForecast` → `adjOf`). Scoring a blend
 * the board does not apply would silently invalidate the fit, which is §1.4's
 * rule one layer down.
 */
function meanCrps(rounds: SignalRound[], weights: SignalChannelWeights): number {
  if (!rounds.length) return 0;
  let total = 0;
  for (const round of rounds) {
    const fc = roundForecast(round, weights);
    total += scoreT({ mean: fc.mean, scale: fc.scale, df: fc.df }, round.realized).crps;
  }
  return total / rounds.length;
}

export function fitSignalChannels(rounds: SignalRound[], enabled: boolean): SignalChannelFit {
  if (!enabled) return NO_CHANNEL_FIT;

  // Only a round some channel actually fired in carries information about the
  // shape of the adjustment. An identity round is not a tie, the same rule
  // signalSkill's own skip applies to the scale fit.
  const scored = rounds.filter((r) => r.rawTerms.length > 0);
  const counts = new Map<SignalTermKey, number>(SIGNAL_TERM_ORDER.map((k) => [k, 0]));
  for (const r of scored) {
    for (const t of r.rawTerms) if (t.pts !== 0) counts.set(t.key, (counts.get(t.key) as number) + 1);
  }

  const measured = SIGNAL_TERM_ORDER.filter((k) => (counts.get(k) as number) >= SIGNAL_CHANNEL_MIN_ROUNDS);
  if (!scored.length || !measured.length) {
    return { weights: ONES(), rows: UNMEASURED_ROWS(counts), rounds: scored.length };
  }

  // ── SHAPE: coordinate descent, each step a bracketed 1-D search ──────────
  const fitted: SignalChannelWeights = ONES();
  for (let pass = 0; pass < SIGNAL_CHANNEL_PASSES; pass++) {
    for (const k of measured) {
      const atPrior = meanCrps(scored, { ...fitted, [k]: 1 });
      const best = minimise1d((x) => meanCrps(scored, { ...fitted, [k]: x }), SIGNAL_A_MIN, SIGNAL_A_MAX);
      // Part II §12.6's rule: an objective that cannot discriminate has no
      // minimiser, and a search over a flat returns an arbitrary point of it.
      // The tie is defined here rather than inherited from wherever the grid
      // happened to land — the channel keeps its authored prior.
      fitted[k] = atPrior - best.fx > SIGNAL_CHANNEL_TOL ? best.x : 1;
    }
  }

  // ── IDENTIFICATION: mean 1 over the measured channels ────────────────────
  const meanFitted = measured.reduce((a, k) => a + (fitted[k] as number), 0) / measured.length;
  const normalised: SignalChannelWeights = ONES();
  if (meanFitted > 0) for (const k of measured) normalised[k] = (fitted[k] as number) / meanFitted;

  // ── CREDIBILITY: shrink each toward the prior at its own evidence rate ───
  const weights = ONES();
  for (const k of measured) {
    const n = counts.get(k) as number;
    weights[k] = clamp(
      shrinkToward(normalised[k] as number, n, 1, SIGNAL_CHANNEL_KAPPA),
      SIGNAL_A_MIN,
      SIGNAL_A_MAX,
    );
  }

  // ── THE SCOREBOARD: what would this book pay to drop each channel? ───────
  const base = meanCrps(scored, weights);
  const rows: ChannelRow[] = SIGNAL_TERM_ORDER.map((key) => {
    const n = counts.get(key) as number;
    if (!measured.includes(key)) {
      return { key, n, raw: null, normalised: null, a: 1, dCrps: null, verdict: "UNMEASURED" as const };
    }
    const dCrps = meanCrps(scored, { ...weights, [key]: 0 }) - base;
    const verdict: ChannelVerdict =
      dCrps > SIGNAL_CHANNEL_EPS ? "CARRIES" : dCrps < -SIGNAL_CHANNEL_EPS ? "COSTS" : "NEUTRAL";
    return {
      key,
      n,
      raw: fitted[key] as number,
      normalised: normalised[key] as number,
      a: weights[key] as number,
      dCrps,
      verdict,
    };
  });

  return { weights, rows, rounds: scored.length };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quant/signals/channels.test.ts src/lib/quant/signals/params.test.ts`
Expected: PASS.

If the ratio test fails because both channels fit to the same value, check that the two channels' rounds are genuinely distinct rounds (different `cutoff`, one channel's term each) — a round carrying both channels lets either absorb the other's error and the ratio is then not identified from that round alone, which is the correct behaviour and the wrong fixture.

- [ ] **Step 6: Verify nothing else moved**

Run: `npx tsc --noEmit`
Expected: the same single `src/App.tsx:245` error from Task 3, and no other.
Run: `npm run gate` — PASS, unchanged (nothing on the fixture path calls this yet).

- [ ] **Step 7: Commit**

```bash
git add src/lib/quant/params.ts src/lib/quant/signals/channels.ts src/lib/quant/signals/channels.test.ts
git commit -m "feat(signals): per-channel credibility, fitted and identified

Seven signal terms shared one earned weight, so a student could not tell
whether mastery was carrying the layer while chronotype was noise. Each
channel now earns its own multiplier a_k with prior 1 — the hand-set constants
are the prior and do not move; measurement moves the multiplier.

Fitted by coordinate descent on the same walk-forward CRPS the layer is scored
on, at full strength, because this fits the SHAPE of adj. w * a_k is a product
and only the product is identified (§2.3), so a_k is then normalised to mean
exactly 1 over the channels actually measured and carries relative credibility
only; signalSkill fits the absolute scale afterwards on the reshaped adj.

Three defences against seven parameters on a dozen rounds, all house style:
shrinkage toward the authored prior with its own kappa, a minimum round count
before a channel is measured at all, and hard clamps.

A flat objective returns the prior explicitly rather than an arbitrary point
of the flat — Part II §12.6's rule, met here before earned.ts meets it. And a
test pins Part II §12.4: chronotype's record is structurally empty because the
replay scores every round with no sitting hour, so it reads UNMEASURED rather
than riding a multiplier nobody measured.

Gate unmoved — no scored round on the committed fixture, so every a_k is 1.
Audit Part I §2."
```

---

## Task 5: App wires shape, then scale, then the board

One replay, shared. The order is the spec's fit order and it is not negotiable: `signalRounds` → `fitSignalChannels` (shape) → `signalSkill` (scale, on the reshaped `adj`) → `signalBoard` (the shipped read, at the fitted weights) → `applySignals` (unchanged).

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `signalRounds`/`signalSkill` (Task 3), `fitSignalChannels`/`SignalChannelFit`/`NO_CHANNEL_FIT` (Task 4), `signalBoard`'s weights parameter (Task 2).
- Produces: `signalChannels: SignalChannelFit`, passed to the SIGNALS view in Task 6.

- [ ] **Step 1: Update the imports**

```ts
import { NO_SIGNAL_SKILL, signalRounds, signalSkill } from "./lib/quant/signals/signalskill";
import { fitSignalChannels, NO_CHANNEL_FIT } from "./lib/quant/signals/channels";
```

- [ ] **Step 2: Replace the signals memo block**

The current order is `modelMeans` → `signalReads` → `signalFit` → `signalled`. The board can no longer be built before the weights exist, so it becomes `modelMeans` → `rounds` → `signalChannels` → `signalFit` → `signalReads` → `signalled`. Replace the `signalReads` and `signalFit` memos (currently lines ~230-249) with:

```tsx
  /* The walk-forward replay, ONCE (audit Part I §2). Both fits below read the
     same rounds: the shape fit searches the per-channel multipliers over them
     and the scale fit scores the result. Reads the REGISTER and the raw
     subjects/entries only — never `pooled`, never even `stats` — the same
     two-board discipline the self/wire pools hold against `rawStats`. */
  const signalRoundsMemo = useMemo(
    () => (data ? signalRounds(register, signalBook, data.subjects, data.entries) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [register, signalBook, data?.subjects, data?.entries],
  );
  /* SHAPE (audit Part I §2). Which of the seven channels has actually been
     predicting, as a multiplier on its own authored weight with prior 1.
     Fitted BEFORE the scale below and normalised to mean 1, because w · a_k is
     a product and only the product is identified from one student's book. */
  const signalChannels = useMemo(
    () => (data ? fitSignalChannels(signalRoundsMemo, data.settings.signalWeighting !== false) : NO_CHANNEL_FIT),
    [signalRoundsMemo, data],
  );
  /* SCALE — the channel's earned weight (D5), fitted on the RESHAPED adj, so
     the weight is earned by the same adjustment the board is about to apply.
     `signalWeighting` follows the other student-input switches' polarity:
     absent => ON. */
  const signalFit = useMemo(
    () => (data
      ? signalSkill(signalRoundsMemo, signalChannels.weights, data.settings.signalWeighting !== false)
      : NO_SIGNAL_SKILL),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signalRoundsMemo, signalChannels, data?.settings.signalWeighting],
  );
  /* The per-desk life-signals read, priced against the house's OWN nextExam
     mean so mastery's "book says X vs desk Y" comparison is against the same
     number the board is about to show — and at the fitted channel weights, so
     the SIGNALS table's Shapley columns decompose the adjustment that ships. */
  const signalReads = useMemo(
    () => (data
      ? signalBoard(data.subjects, signalBook, data.entries, data.upcoming ?? [], modelMeans, todayStr(), signalChannels.weights)
      : new Map()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.subjects, signalBook, data?.entries, data?.upcoming, modelMeans, signalChannels],
  );
```

`signalled` is unchanged and stays where it is, immediately below.

- [ ] **Step 3: Hand the fit to the SIGNALS floor**

In the `view === "signals"` block, beside `signalFit={signalFit}`:

```tsx
                signalChannels={signalChannels}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: ONE error, in `src/views/signals/index.tsx` — `signalChannels` is not a declared prop. Task 6 declares it.

Run: `npx vitest run src/lib/quant src/lib/derive`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): fit the signal channels' shape before their scale

One walk-forward replay, shared by both fits. fitSignalChannels searches the
per-channel credibility multipliers over those rounds; signalSkill then earns
the layer's weight on the RESHAPED adj, so the weight is earned by the same
adjustment the board applies; signalBoard reads at the fitted weights, so the
SIGNALS table decomposes what ships.

Shape before scale is the spec's order and it is load-bearing: w * a_k is a
product, only the product is identified, and the normalisation that resolves
it belongs to the shape step.

Gate unmoved — the fixture scores no round, so every multiplier is 1.
Audit Part I §2, §2.3."
```

---

## Task 6: the channel scoreboard

§2.5's deliverable, and the one that makes the layer act rather than assert: one row per channel with `a_k`, `n_k`, the ΔCRPS that dropping it would cost, and a verdict. It is the only honest basis on which to ask a student to keep logging something.

**Files:**
- Create: `src/views/signals/ChannelPanel.tsx`
- Create: `src/views/signals/ChannelPanel.test.tsx`
- Modify: `src/views/signals/index.tsx`

**Interfaces:**
- Consumes: `SignalChannelFit`/`ChannelRow` (Task 4).
- Produces: `<ChannelPanel fit={...} />`; `SignalsProps` gains `signalChannels: SignalChannelFit`.

- [ ] **Step 1: Write the failing test**

Create `src/views/signals/ChannelPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChannelPanel } from "./ChannelPanel";
import { NO_CHANNEL_FIT, type SignalChannelFit } from "../../lib/quant/signals/channels";

/**
 * §2.5 of the prediction-math audit — the deliverable that makes the layer act
 * rather than assert. A student can read which of their own logging habits
 * actually predicts, which is the only honest basis for asking them to keep
 * logging it.
 */

const MEASURED: SignalChannelFit = {
  ...NO_CHANNEL_FIT,
  rounds: 8,
  weights: { ...NO_CHANNEL_FIT.weights, mastery: 1.8, rest: 0.3 },
  rows: NO_CHANNEL_FIT.rows.map((r) =>
    r.key === "mastery"
      ? { ...r, n: 8, raw: 1.9, normalised: 1.9, a: 1.8, dCrps: 0.42, verdict: "CARRIES" as const }
      : r.key === "rest"
        ? { ...r, n: 6, raw: 0.3, normalised: 0.3, a: 0.3, dCrps: -0.05, verdict: "COSTS" as const }
        : r,
  ),
};

describe("ChannelPanel", () => {
  it("says nothing has been measured on an unscored book", () => {
    render(<ChannelPanel fit={NO_CHANNEL_FIT} />);
    expect(screen.getAllByText("UNMEASURED")).toHaveLength(7);
    expect(screen.getByText(/NO ROUND HAS SCORED/i)).toBeTruthy();
  });

  it("prints the multiplier, the round count, the drop cost and the verdict", () => {
    render(<ChannelPanel fit={MEASURED} />);
    expect(screen.getByText("×1.80")).toBeTruthy();
    expect(screen.getByText("×0.30")).toBeTruthy();
    expect(screen.getByText("CARRIES")).toBeTruthy();
    expect(screen.getByText("COSTS")).toBeTruthy();
    expect(screen.getByText("+0.42")).toBeTruthy();
  });

  it("shows an unmeasured channel at the authored prior, never a fitted-looking number", () => {
    render(<ChannelPanel fit={MEASURED} />);
    // The five channels with no record all read ×1.00 and an em-dash cost.
    expect(screen.getAllByText("×1.00")).toHaveLength(5);
  });
});
```

If this suite is the first component test in `src/views/signals/`, copy the render/import preamble from an existing view test (`src/views/signals/signals.book.test.tsx`) rather than introducing a second harness style.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/signals/ChannelPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./ChannelPanel"`.

- [ ] **Step 3: Write `ChannelPanel.tsx`**

Create `src/views/signals/ChannelPanel.tsx`:

```tsx
import { C, FONT, microLabel } from "../../theme";
import { SIGNAL_A_MAX, SIGNAL_A_MIN, SIGNAL_CHANNEL_MIN_ROUNDS } from "../../lib/quant/params";
import type { ChannelRow, SignalChannelFit } from "../../lib/quant/signals/channels";
import type { SignalTermKey } from "../../lib/quant/signals/signalread";

/**
 * The channel scoreboard (audit Part I §2.5) — one row per signal channel:
 * what it has been measured to be worth against what it was authored to be
 * worth, over how many rounds, and what the book would pay to drop it.
 *
 * This is the deliverable that makes the layer ACT rather than assert. The
 * seven terms used to share one earned weight, so a student could not tell
 * whether mastery was carrying the layer while chronotype was noise, and got
 * no benefit if it was. Telling them which of their own logging habits
 * actually predicts is the only honest basis for asking them to keep logging
 * it.
 *
 * ×EARNED is a RELATIVE number by construction (§2.3): `w · a_k` is a product
 * and only the product is identified from one student's book, so the
 * multipliers are normalised to mean 1 over the measured channels and the
 * absolute size lives in the earned weight above. "MASTERY pulls 1.8× what it
 * was authored to" is a claim about mastery VERSUS the other measured
 * channels, and the footer says so.
 */

const LABEL: Record<SignalTermKey, string> = {
  stock: "STUDY STOCK",
  mastery: "TOPIC MASTERY",
  rest: "REST",
  disruption: "DISRUPTION",
  anxiety: "ANXIETY",
  chronotype: "CHRONOTYPE",
  attendance: "ATTENDANCE",
};

const VERDICT_TONE: Record<ChannelRow["verdict"], string> = {
  CARRIES: C.up,
  COSTS: C.down,
  NEUTRAL: C.faint,
  UNMEASURED: C.faint,
};

const fmtDelta = (v: number | null): string => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`);

export function ChannelPanel({ fit }: { fit: SignalChannelFit }) {
  const measured = fit.rows.filter((r) => r.verdict !== "UNMEASURED").length;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              <th className="px-2.5 py-2 text-left" style={{ ...microLabel, color: C.faint }}>CHANNEL</th>
              <th className="px-2.5 py-2 text-right" style={{ ...microLabel, color: C.faint }}>ROUNDS</th>
              <th className="px-2.5 py-2 text-right" style={{ ...microLabel, color: C.faint }}>×EARNED</th>
              <th className="px-2.5 py-2 text-right" style={{ ...microLabel, color: C.faint }}>ΔCRPS IF DROPPED</th>
              <th className="px-2.5 py-2 text-right" style={{ ...microLabel, color: C.faint }}>VERDICT</th>
            </tr>
          </thead>
          <tbody>
            {fit.rows.map((r) => (
              <tr key={r.key} className="border-b last:border-0" style={{ borderColor: C.line }}>
                <td className="px-2.5 py-2 text-xs tracking-wider" style={{ fontFamily: FONT.mono, color: C.text }}>
                  {LABEL[r.key]}
                </td>
                <td className="px-2.5 py-2 text-right text-xs tabular-nums" style={{ fontFamily: FONT.mono, color: C.faint }}>
                  {r.n}
                </td>
                <td
                  className="px-2.5 py-2 text-right text-xs font-bold tabular-nums"
                  style={{ fontFamily: FONT.mono, color: r.verdict === "UNMEASURED" ? C.faint : r.a >= 1 ? C.up : C.down }}
                >
                  ×{r.a.toFixed(2)}
                </td>
                <td className="px-2.5 py-2 text-right text-xs tabular-nums" style={{ fontFamily: FONT.mono, color: C.faint }}>
                  {fmtDelta(r.dCrps)}
                </td>
                <td className="px-2.5 py-2 text-right text-xs" style={{ ...microLabel, color: VERDICT_TONE[r.verdict] }}>
                  {r.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 border-t text-[10px] tracking-wider leading-relaxed" style={{ borderColor: C.line, color: C.faint, fontFamily: FONT.mono }}>
        {measured === 0 ? (
          <>
            NO ROUND HAS SCORED A LIVE SIGNAL READ YET, SO EVERY CHANNEL PULLS EXACTLY THE WEIGHT IT WAS AUTHORED WITH.
            A CHANNEL IS MEASURED ONCE IT HAS FIRED IN {SIGNAL_CHANNEL_MIN_ROUNDS} SCORED ROUNDS.
          </>
        ) : (
          <>
            ×EARNED IS RELATIVE, NOT ABSOLUTE: THE MULTIPLIERS ARE NORMALISED TO AVERAGE 1 ACROSS THE MEASURED
            CHANNELS, SO ×1.80 MEANS "PULLS 1.8× WHAT IT WAS AUTHORED TO, AGAINST THE OTHER MEASURED CHANNELS" —
            THE LAYER'S ABSOLUTE SIZE IS THE EARNED WEIGHT ABOVE. CLAMPED TO ×{SIGNAL_A_MIN.toFixed(2)}–×
            {SIGNAL_A_MAX.toFixed(2)} AND SHRUNK TOWARD ×1.00 UNTIL A CHANNEL'S OWN RECORD SAYS OTHERWISE.
            ΔCRPS IS WHAT THIS BOOK'S WALK-FORWARD SCORE WOULD PAY TO DROP THE CHANNEL — POSITIVE MEANS IT IS
            CARRYING ITS SEAT.
          </>
        )}
      </p>
      <p className="px-3 pb-2 text-[10px] tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
        CHRONOTYPE CANNOT BE MEASURED FROM THIS BOOK: A RESOLVED SITTING'S HOUR IS NOT RECORDED ANYWHERE, SO THE
        CHANNEL NEVER FIRES IN THE REPLAY AND KEEPS ITS AUTHORED WEIGHT. THAT IS A DATA-MODEL LIMIT, STATED RATHER
        THAN LEFT TO BE WONDERED ABOUT.
      </p>
    </div>
  );
}
```

If `C.text` is not the theme's body-text key, use whatever the sibling tables use for a primary cell (`MasteryPanel.tsx` is the nearest precedent).

- [ ] **Step 4: Mount it on the SIGNALS floor**

In `src/views/signals/index.tsx`:

```ts
import { ChannelPanel } from "./ChannelPanel";
import type { SignalChannelFit } from "../../lib/quant/signals/channels";
```

`SignalsProps` gains, beside `signalFit`:

```ts
  /** The per-channel credibility fit (audit Part I §2) — App's own memo,
   *  reused. The multipliers it carries are already folded into `signalReads`;
   *  this is the scoreboard's copy of the same fit, never a second one. */
  signalChannels: SignalChannelFit;
```

Add `signalChannels` to the destructured parameter list, and mount the panel directly under the PER-DESK TERMS panel:

```tsx
      <Panel title="CHANNEL CREDIBILITY — WHAT EACH SIGNAL HAS EARNED" pad={false}>
        <ChannelPanel fit={signalChannels} />
      </Panel>
```

Add to the view's module doc, after the paragraph about `rawTerms`:

```
 * Below the per-desk table, the CHANNEL CREDIBILITY scoreboard (audit Part I
 * §2.5): what each of the seven channels has been MEASURED to be worth against
 * what it was AUTHORED to be worth, over how many scored rounds, and what
 * dropping it would cost the book's walk-forward CRPS. The seven terms used to
 * share one earned weight, so a student could not tell whether mastery was
 * carrying the layer while chronotype was noise — and got no benefit if so.
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/views/signals`
Expected: PASS. `signals.book.test.tsx` renders the whole floor; if it constructs `SignalsProps` by hand it needs `signalChannels={NO_CHANNEL_FIT}` — which is also the honest fixture value, since the committed book scores no round.

- [ ] **Step 6: Verify nothing else moved**

Run: `npx tsc --noEmit` — clean.
Run: `npm run gate` — PASS, unchanged.
Run: `npx vitest run` — PASS.

- [ ] **Step 7: Commit**

```bash
git add src/views/signals
git commit -m "feat(signals): the channel credibility scoreboard

One row per channel: what it has been measured to be worth against what it was
authored to be worth, over how many scored rounds, and what the book's
walk-forward CRPS would pay to drop it.

This is the deliverable that makes the layer act rather than assert. Seven
terms shared one earned weight, so a student could not tell whether mastery
was carrying the layer while chronotype was noise, and got no benefit if it
was — and telling them which of their own logging habits actually predicts is
the only honest basis for asking them to keep logging it.

The footer states what the multiplier is and is not: normalised to average 1
across the measured channels, so it is relative credibility and the absolute
size is the earned weight above. And it states, rather than hides, that
chronotype cannot be measured from this book at all.

Gate unmoved. Audit Part I §2.5."
```

---

## Task 7: README §30 documents the measured channel

**Files:**
- Modify: `README.md` §30

- [ ] **Step 1: Add the channel-credibility subsection**

In `README.md` §30, immediately after the section that describes the per-term Shapley columns (the paragraph Task 5 of the previous plan rewrote), add:

```markdown
**Each channel earns its own credibility.** The seven terms above are authored with hand-set
weights in `quant/signals/params.ts` — that is the *prior*, a claim about how much each mechanism
is worth. It stays. What measurement adds is one multiplier per channel:

$$
\text{adj} = \operatorname{clip}_{\pm\text{CAP}}\!\Big(\sum_k a_k\,\pi_k\Big),\qquad
a_k = \operatorname{clamp}\!\big(\operatorname{shrink}(\tilde a_k,\; n_k,\; 1,\; \kappa_{\text{ch}}),\;
a_{\min},\, a_{\max}\big).
$$

$\hat a_k$ is fitted by coordinate descent over the same walk-forward CRPS the layer's own weight
is scored on, one bracketed 1-D search per channel per sweep (`quant/fit.ts`: a grid over the
whole bracket, then golden-section inside the interval that brackets its best point — the grid is
the guard against a second basin). $n_k$ counts the scored rounds in which channel $k$ actually
fired. A channel below `SIGNAL_CHANNEL_MIN_ROUNDS` firings is not fitted at all: $a_k = 1$
exactly, the authored prior, and the scoreboard reads UNMEASURED.

**Only the product is identified.** $w \cdot a_k$ is a product, and one student's book cannot
separate "the layer is half as big as it thinks" from "every channel is half as credible as it
thinks". So the fit runs in a fixed order — *shape first, then scale* — and $\hat a_k$ is
normalised to mean exactly 1 over the measured channels before the layer's own weight $w$ is
fitted on the reshaped $\text{adj}$. $a_k$ then carries only **relative** channel credibility and
$w$ carries absolute size, which is both identified and directly readable: *MASTERY pulls 1.8× its
stated weight, REST pulls 0.3×.*

Three defences against seven parameters on the six-to-twelve resolved rounds a real book carries,
all of them the house's existing discipline: shrinkage toward the authored prior with its own
$\kappa$, a minimum round count before a channel is measured at all, and hard clamps on $a_k$.
The mean-1 property is a statement about $\tilde a$, the normalised fit — the shipped $a_k$ are
each pulled toward 1 at their own evidence rate, so seven different $n_k$ pull seven different
distances, and the tests assert each property on the vector it is true of.

The **CHANNEL CREDIBILITY** table on the SIGNALS floor prints all of it: `×EARNED`, the round
count, and the CRPS the book would pay to drop the channel entirely.

One honest limit, stated here rather than left to be found: **chronotype cannot be measured at
all.** The walk-forward replay scores every round with no sitting hour, because a resolved
sitting's hour is not recorded anywhere on the book, so the chronotype candidate never fires and
its $n_k$ is structurally zero. It keeps its authored weight, the scoreboard says UNMEASURED, and
the fix is a data-model change tracked as Part II §12.4 of the audit.
```

- [ ] **Step 2: Check the surrounding claims still hold**

Run: `grep -n "one earned weight\|share one earned\|seven terms" README.md`

Any §30 sentence claiming the seven terms share a single weight is now false — the layer's weight is still shared, but each channel's *contribution* to the shift is credibility-scaled first. Reword such a sentence to "the layer earns one weight; each channel earns its own credibility inside it."

- [ ] **Step 3: Final verification**

Run: `npx tsc --noEmit` — clean.
Run: `npm run gate` — PASS, and the skill number **identical** to its value before Task 1.
Run: `npx vitest run` — PASS.

Run the tranche's own claims:

```bash
npx vitest run src/lib/quant/fit.test.ts src/lib/quant/signals/channels.test.ts   # the two new modules
git log --oneline HEAD~7..HEAD                                                    # seven commits
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): §30 documents per-channel credibility

The layer earns one weight; each channel now earns its own credibility inside
it, with prior 1 and the hand-set constants untouched. The section states the
fit, the fixed shape-then-scale order and why the order is load-bearing (only
the product w*a_k is identified), the three overfitting defences, and which
vector the mean-1 property is actually true of.

It also states the one honest limit: chronotype cannot be measured from this
book at all, because a resolved sitting's hour is not recorded anywhere.

Gate unmoved. Closes audit Part I §2."
```

---

## Close-out

- [ ] **Report what is next**

Part I §8 step 6 is **M8** (book-wide signal terms — `rest`, `disruption`, `anxiety`, `chronotype` — entering the aggregate as if diversifiable, when four of seven terms shift every desk by the same amount) and **M9** (VOI computed by real `{drop}` ablation in genuine CI90 units, instead of mixing a mean-channel constant with a point weight). Neither needs new numerics; the `{drop}` seam M9 wants is still on `signalRead` and still has no other caller.

Note for step 6: `fit.ts` now exists, so §20's measured ρ̂ and §1's `earned.ts` rewrite both have their minimiser waiting. `earned.ts` still must not be touched until Part II §11.1 (`eval/oracle.ts`) lands, because four of the five channels §1 converts are invisible to the current gate — and that work still collides with the unstarted `accuracy-program-phase-a` plan's `baseline.json` restructure. That collision is now the oldest unresolved item in the audit and should be settled before either plan starts.

---

## Spec coverage

| spec item | task |
|---|---|
| §1.2 the search: fixed grid then golden-section, no unimodality assumption | 1 |
| §2.1 the requirement — seven terms, one weight, no per-channel benefit | 4 (module doc), 6 (the scoreboard), 7 (README) |
| §2.2 the model: `a_k` prior 1, `n_k` = rounds the channel fired, coordinate descent on walk-forward CRPS | 4 |
| §2.2 the four knobs live in `quant/params.ts`'s life-signals block | 4 step 1 |
| §2.3 identification: normalise to mean 1 over firing channels; fixed shape-then-scale order | 4 (normalisation), 5 (order), 7 (README) |
| §2.4 overfitting: shrinkage with its own κ, minimum round count, hard clamps | 4 |
| §2.5 the channel scoreboard: `a_k`, `n_k`, ΔCRPS, verdict | 6 |
| §3.2 "§2 slots the fitted `a_k` into the same `v` with no change to `shapley.ts`" | 2 (weights fold in upstream of `rawTerms`) |
| §6 `quant/fit.ts`, `quant/signals/channels.ts` and their dependencies | 1, 4 |
| §7 `fit.ts` — known minimum, bimodal, deterministic, respects the bracket | 1 |
| §7 `channels.ts` — `a_k = 1` below the minimum count, mean-1 normalisation, clamps bind | 4 |
| §8 step 5 sequencing, and "steps 1–7 cannot move `npm run gate`" | task order + every verify step |
| Part II §12.6's tie rule (a flat objective returns the prior, explicitly) | 1 (the numeric tie), 4 (the prior tie) |
| Part II §12.4 named, tested and printed rather than silently inherited | 3 (comment), 4 (test), 6 (footer), 7 (README) |

**Deliberately out of this plan** (the spec sequences them later): M8/M9 (step 6); the bibliography sweep, `Citation.url`, the five new derivation cards, the Shapley card and the channel-scoreboard derivation card of §5.4 (step 7); `fit.ts`'s use by `earned.ts` (step 8); all of Part II, including §12.4's actual fix.
