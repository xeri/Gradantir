# Prediction-model audit — estimator, per-channel credibility, Shapley, and the bibliography

**Date:** 2026-07-31
**Branch:** `life-signals`
**Status:** design, approved for planning

---

## 0 · Why

Two things prompted this. First, an audit of the prediction engine's mathematics turned up a
structural flaw in the one rule every priced channel shares (`earned.ts`) plus nine defects
concentrated in the newest layer (§30, life signals). Second, the layer that makes the engine
*checkable* — the derivation drawer and its bibliography — stops at §29: the entire life-signals
layer ships with one citation, and ~14 derivation cards across the whole engine ship with none.

The engine's own doctrine (`cite.ts` header) says a derivation that shows the formula but not
where it came from is a magic trick. §30 is currently a magic trick.

This spec covers the audit's findings and the work that closes them.

**Part II (§10–§19) is a second audit**, run over the whole engine rather than the newest layer.
It found nothing in §1–§9 that needs revising, and **fifty-nine further defects plus one missed
opportunity** — most of them outside the signals layer, several of them in the machinery §1's
acceptance criterion depends on. Read §11 before implementing §1: the gate that §1 is gated on
does not score the forecast the board ships.

Every finding cites `file:line`. They are derived from reading the code and from the arithmetic,
not from executing repro cases — §21 sequences them so each lands behind its own gate run.

---

## 1 · The credibility estimator

### 1.1 The defect

`earned.ts` fits every priced channel's weight from a **score share**:

```
rawShare = modelScore / (youScore + modelScore)
w        = clamp(shrinkToward(rawShare, n, toward, κ), 0, cap)
```

Two problems.

**It cannot find an interior optimum.** For §27 (self) and §29 (wire) the two sides are separate
forecasters and a share is at least defensible. For §30 (signals) they are not: the "you" side is
the *model itself, adjusted* — `you = model + 1·adj` with `sd·sdMult`. The channel is **nested**.
So if `adj` points the right direction but is three times too large, the full-strength forecast
scores worse than the model, the share falls below ½, and `w` shrinks toward the prior — when the
true optimum is `w ≈ 0.33`. A layer built entirely from hand-set constants is precisely the case
where "right sign, wrong size" dominates, and the current estimator is structurally blind to it.

**It is biased toward the channel.** At exactly equal skill, `rawShare = 0.5`: a channel that adds
nothing is handed half weight before shrinkage.

### 1.2 The fix

Fit the weight that minimises the walk-forward proper score of the blend itself:

```
w* = argmin_w  (1/n) Σ_i  L_i( blend_i(w) ),      w ∈ [0, cap]
w  = clamp( shrinkToward(w*, n, toward, κ), 0, cap )
```

Because every `L_i` is a proper scoring rule, the minimiser is the honest answer (Gneiting &
Raftery 2007). Shrinkage and the cap are unchanged — this replaces *how the raw share is
estimated*, not the credibility discipline around it.

**Search:** a fixed grid over `[0, cap]` at 101 steps, then golden-section refinement inside the
bracketing interval. Deterministic and reproducible; no unimodality assumption, since the grid
guards against a non-convex objective and the refinement only sharpens the located basin.

### 1.3 The new interface

`earnedWeight` stops taking two parallel score arrays and takes one **objective**: for each
resolved outcome, a function from `w` to that outcome's loss. Pairing stays the caller's job; the
"scores must be paired outcome-for-outcome" throw becomes structurally unnecessary because there
is now one array of closures rather than two arrays that could disagree in length.

```ts
export interface EarnedOutcome {
  /** Loss of the blend at weight w, under this channel's own proper rule. */
  lossAt: (w: number) => number;
}

export function earnedWeight(outcomes: EarnedOutcome[], opts: EarnedOpts): EarnedWeight
```

`EarnedWeight` keeps `w`, `n`, `rawShare` (now `w*`, the unshrunk minimiser) and gains
`youScore`/`modelScore` as `lossAt(cap)` and `lossAt(0)` means — so every existing display that
quotes "your mean CRPS vs the desk's" keeps a true number, now defined as the endpoints of the
same curve rather than a separate computation.

### 1.4 Per channel

| channel | `blend_i(w)` | loss |
|---|---|---|
| self §27 (`pool.ts`) | `(1−w)·model ⊕ w·selfPred` | CRPS when a range was stated; abs error when only a point was — the existing matched rule, unchanged |
| wire §29 (`aipool.ts`) | `(1−w)·model ⊕ w·aiPred` | same matched rule |
| aggregate §28 (`meanpool.ts`) | `(1−w)·deskAvg + w·yourCall` | abs error |
| signals §30 (`signalskill.ts`) | `μ + w·adj`, `σ·(1 + w(sdMult−1))` | CRPS |
| readiness §15c (`readiness.ts`) | `z_i(w) = (1−w)·z_model,i + w·z_elo,i` | **Bradley–Terry log-loss** (see 1.5) |

The blend used in the fit must be the **same** pooling arithmetic the board actually applies. Any
divergence between "the blend we scored" and "the blend we ship" would silently invalidate the
fit, so each channel's fit calls its own pooling function rather than reimplementing it.

### 1.5 Readiness

Readiness's current loss is `1 − hitRate(pairs, ranking)` — a 0-1 rate over pairwise comparisons,
therefore **piecewise-constant in `w`**. A minimiser over a step function lands on an arbitrary
point of a flat, and the answer would move discontinuously with a single flipped pair.

Readiness moves to **Bradley–Terry log-loss** over the blended latent score:

```
L(w) = − Σ_{(i,j) : i beat j}  log σ( z_i(w) − z_j(w) )
```

Smooth, proper for paired comparisons, and `bradley1952` is already in the bibliography. The
reported `hitRate`/`modelHitRate` fields stay — they remain the honest human-readable summary —
but they no longer drive the weight.

§15c's prose is rewritten to describe the new objective.

### 1.6 Risk and acceptance

This moves §21 and `eval/__snapshots__/baseline.json`. §26 rule 3 is binding: *walk-forward CRPS
must not regress; if it does, revert, never retune to chase §21.*

Acceptance is therefore **per channel**, not global. Each channel's conversion is a separate
commit with its own `npm run gate`. A channel whose gate regresses reverts to score-share on its
own and the reason is recorded in §26 — the other channels still ship. A minimiser can regress
out-of-sample even though it improves in-sample, and that possibility is the whole point of
having the gate.

---

## 2 · Per-channel credibility for the signals layer

### 2.1 The requirement

Seven signal terms currently share one earned weight. A student cannot tell whether the mastery
channel is carrying the layer while chronotype is noise, and gets no benefit if so. The hand-set
constants stay — they are the prior — and measurement moves them.

### 2.2 The model

```
adj = clamp( Σ_k a_k · pts_k ,  ± SIGNAL_ADJ_CAP )
a_k = shrinkToward( â_k , n_k , 1 , SIGNAL_CHANNEL_KAPPA )
```

- `pts_k` — the hand-set channel read, exactly as today.
- `a_k` — a credibility multiplier with **prior 1**, i.e. "this channel pulls exactly the weight
  it was authored with" until its own record says otherwise.
- `n_k` — the number of scored rounds in which channel `k` actually fired (non-zero `pts_k`).
- `â_k` — fitted by coordinate descent, each step a 1-D grid search on the same walk-forward CRPS
  objective §1 defines, holding the other channels at their current `a`.

A channel with `n_k < SIGNAL_CHANNEL_MIN_ROUNDS` gets `a_k = 1` exactly — no measurement, pure
hand-set prior. Every `a_k` is clamped to `[SIGNAL_A_MIN, SIGNAL_A_MAX]`.

`SIGNAL_CHANNEL_KAPPA`, `SIGNAL_CHANNEL_MIN_ROUNDS`, `SIGNAL_A_MIN` and `SIGNAL_A_MAX` live in
`quant/params.ts`'s life-signals block beside `SIGNAL_KAPPA`/`SIGNAL_CAP`/`SIGNAL_PRIOR` — they
are channel-credibility knobs, not formula knobs, and belong with their siblings rather than in
`signals/params.ts`. Their values are chosen during implementation and justified in the same
comment style as the rest of that block.

### 2.3 Identifiability

`w · a_k` is a product; only the product is identified from the data. Fitting both freely would
leave the split between them arbitrary and the displayed numbers meaningless.

**Resolution:** after fitting, `a_k` is normalised so its mean over *firing* channels is exactly
1. `a_k` then carries only *relative* channel credibility and `w` carries absolute size. This is
both identified and directly readable: "MASTERY pulls 1.8× its stated weight, CHRONO pulls 0.3×."

Fit order is fixed and documented: shape (`a_k`, normalised) first, then scale (`w`) on the
reshaped `adj`.

### 2.4 Overfitting

With `n` typically 6–12 resolved rounds and 7 channels, an unshrunk fit would be worthless. Three
defences, all already house style: shrinkage toward the authored prior with its own κ, a minimum
round count before a channel is measured at all, and hard clamps on `a_k`.

### 2.5 What the student sees

A **channel scoreboard** on the SIGNALS floor: one row per channel with `a_k`, `n_k`, the ΔCRPS
that dropping it would cost, and a verdict. This is the deliverable that makes the layer act
rather than assert — it tells a student which of their own logging habits actually predicts, which
is the only honest basis for asking them to keep logging it.

---

## 3 · Shapley decomposition

### 3.1 The defect

The SIGNALS table's per-term columns are drop-one marginals. Once two or more terms jointly bind
the ±`SIGNAL_ADJ_CAP` clamp they stop summing to `adj`, and README §30 devotes a section plus a
table footer to explaining why. The explanation is correct; the design is wrong.

### 3.2 The fix

Treat the clamped shift as a coalitional game and report Shapley values:

```
v(S) = clamp( Σ_{k∈S} a_k·pts_k , ±SIGNAL_ADJ_CAP ),   v(∅) = 0

φ_k  = Σ_{S ⊆ N\{k}}  |S|!·(n−|S|−1)!/n! · [ v(S∪{k}) − v(S) ]
```

The efficiency axiom gives `Σ_k φ_k = v(N) − v(∅) = adj` **exactly**, clamp binding or not.
Seven channels means 2⁷ = 128 coalitions per desk — computed exactly, no sampling.

Shapley lands *before* §2 in the sequence, so at that point `a_k ≡ 1` and the game reads
`v(S) = clamp(Σ_{k∈S} pts_k, ±CAP)`. §2 then slots the fitted `a_k` into the same `v` with no
change to `shapley.ts` itself — the module takes a vector of per-channel contributions and the
cap, and never knows whether a multiplier has been applied to them.

### 3.3 Consequences

- `SignalRead` must expose **every candidate** `pts_k`, including those under the 0.05pt display
  floor, since a sub-floor term still participates in a coalition. New field `rawTerms`; the
  existing `terms` (filtered, sorted) stays for the reasons list.
- The SIGNALS view stops re-running `signalRead` seven times with `{drop}` and computes φ from
  one read. The `{drop}` seam stays — §4 M9 needs it for VOI.
- README §30's "Per-term marginals do not sum to `adj`" paragraph and the table footer's
  non-additivity sentence are **deleted**. The caveat is fixed, not documented.
- `signal.stock` / `signal.mastery` derivations report φ rather than a drop-one marginal, and the
  `Δ_marg` step is rewritten as the Shapley step.

---

## 4 · Defect fixes

Each is independently testable and, being confined to the signals layer, gate-neutral: the
committed fixture carries no signal slices, so `npm run gate` and README §21 are unmoved by M3–M9
and E1. Only §1's `earned.ts` work moves them.

**M3 — prereq gate contradicts its own spec.** `mastery.ts` gates a topic against the **mean** of
its prerequisites while `params.ts`'s `PREREQ_HEADROOM` comment says "the weakest prerequisite"
and README:1379 says "a shaky prerequisite caps everything built on it." A mean lets one failed
prerequisite hide behind two strong ones, which is not a cap. Change to `min`. The doctrine was
right; the code was wrong.

**M4 — attendance priced two ways, ~20× apart.** A desk with no topic breakdown charges
`−min(1, (95−pct)/10 · 0.5)` in points (−1.00 at 75% attendance). A desk *with* one instead shaves
mastery coverage by `1 − (95−pct)/100 · 0.5` (≈−0.05 points at the same attendance, on a typical
gap). Same student, same attendance, order-of-magnitude different charge, selected by whether a
topic list happens to exist. Unify: one attendance function, one scale, the no-topics path
expressing the same arithmetic in points.

**M5 — sleep charged twice.** A short night before a study day already docks that session through
`ENCODING_PENALTY` in `stock.ts`, shrinking `k14` and so the stock term. The same nights then
drive `rest.ts`'s chronic deterioration term. One deterioration, two charges.

The two terms measure genuinely different things — the encoding penalty is a *mechanistic* charge
on a specific study session that was encoded badly, the chronic term is a *sustained baseline
shift* — so the fix is to stop them overlapping rather than to delete either. The chronic term
prices deterioration only over nights that did **not** already dock a session through
`ENCODING_PENALTY`: nights already charged mechanistically are excluded from the recent-window
mean before it is compared against the baseline. A student who studies every day they sleep badly
is charged once, through the specific mechanism; a student whose sleep has deteriorated on nights
they were not studying is charged once, through the baseline shift.

**M6 — chronotype is a cliff on an integer hour.** `owl && hour ≤ 9 ⇒ −0.75`; `hour = 10 ⇒ 0`. A
9am and a 10am sitting differ by the entire channel. Replace with a continuous function of sitting
hour scaled by the strength of the self-report. The owl-full / lark-half asymmetry is either given
a cited argument or dropped.

**M7 — anxiety is mislabelled.** The term computes trait anxiety × *stakes* (`worthPct` is grade
weight, not cognitive load). That is the attentional-control / processing-efficiency account
(Eysenck et al. 2007), not the Yerkes–Dodson arousal inverted-U the comment claims. Rename and
re-derive the term to what it actually is, and cite it correctly. Yerkes & Dodson stays in the
bibliography as the historical antecedent it is, not as the term's source.

**M8 — book-wide terms enter the aggregate as if diversifiable.** `rest`, `disruption`, `anxiety`
and `chronotype` are person-level: four of seven terms shift *every* desk by the same amount. A
book-wide sleep shock is a perfectly correlated move, but `aggregateForecast(booked, agg, rho)`
widens only on a user-set subject-affinity prior that knows nothing about it. The signals layer
reports its common-mode component and the aggregate widens on it.

**M9 — VOI mixes units and measures nothing.** Every row prints "TIGHTEN CI90 BY ±x.x" while
`VOI_SESSIONS_GAIN = 2.0` describes a silent *mean* channel and `VOI_MARKS_GAIN_W = 3.0` is the
mastery *point* weight. Compute the real answer through the `{drop}` ablation seam that already
exists, in genuine CI90 units. Where a counterfactual genuinely cannot be computed (an input that
has never existed anywhere on the book), the heuristic stays — and says so on its own card.

**E1 — README §30:1429's claim is false.** "Every constant below is quoted from `params.ts` ...
never hand-typed." Hand-typed knobs in the priced path: `rest.ts` `6.5`×2 and `(regSd−60)/60`;
`mastery.ts` `0.3`, `/6`, `95`, `0.5`; `signalread.ts` `(anx−3)/2`, `hour≤9`, `hour≥15`, `/2`,
`95`, `/10`, `0.5`; `disrupt.ts` `0.5+0.5·min(d,7)/7`; `traits.ts` `0.25` and `0.05`×2. All lift
into `signals/params.ts` with their own justification comments, making the claim true. This
includes killing the layer's **second, invisible short-sleep threshold**: `rest.ts` hardcodes 6.5h
for the acute term while `SHORT_SLEEP_H = 6.0` governs the encoding penalty, so the layer has two
different definitions of a short night and only one of them is visible.

**B5 — a live failing spec.** `App.tsx`'s `aiCharge` reads `stats` (pre-signals) where it must
read `signalled`. `src/App.aicharge.test.tsx` currently fails on `main`'s working tree. Fix as
part of this work.

---

## 5 · Citations, links, and the derivation layer

### 5.1 The gap

`cite.ts` carries ~60 entries and **none** for the life-signals layer, whose prose invokes the
testing effect, distributed practice, the forgetting curve and savings, Yerkes–Dodson, sleep and
encoding, chronotype synchrony, class attendance, and "hours correlate r ≈ 0.2." Across the whole
engine ~14 derivation cards carry no `refs` at all: `book.ts` (2 of 2 uncited), `desk.ts` (3 of
6), `factors.ts` (2 of 5), `signals.ts` (3 of 4), plus single gaps in `earned.ts` and `price.ts`.

### 5.2 New entries

At minimum the mechanisms §30 already claims: Ebbinghaus 1885 (forgetting curve, savings);
Roediger & Karpicke 2006 (testing effect); Cepeda et al. 2006 (distributed practice); Bjork &
Bjork 1992 (storage vs retrieval strength — the savings floor); Dunlosky et al. 2013 (technique
utility); Credé & Kuncel 2008 (study habits, the r ≈ 0.2 claim); Credé et al. 2010 (class
attendance meta-analysis); Yerkes & Dodson 1908; Eysenck et al. 2007 (attentional control theory);
Hembree 1988 (test anxiety); Yoo et al. 2007 (sleep deprivation and encoding); Diekelmann & Born
2010 (consolidation); Okano et al. 2019 (sleep duration, quality, regularity vs grades); Goldstein
et al. 2007 (synchrony effect); Preckel et al. 2011 (chronotype meta-analysis); Shapley 1953.

Beyond those, the existing uncited derivations are audited and given sources — the coverage target
is **every derivation card carries at least one `ref`**, not merely the new ones.

### 5.3 Links

`Citation` gains an optional `url`. `cite.ts`'s own header is binding here: *an entry that is
wrong is wrong forever and silently.* So identifiers are **verified by lookup before they are
authored**, and where a lookup is inconclusive the entry carries no identifier and `citeUrl()`
falls back to a constructed exact-title search that always resolves. No DOI is typed from memory.

### 5.4 UI

- Five **new derivation cards** — `signal.rest`, `signal.disruption`, `signal.anxiety`,
  `signal.chronotype`, `signal.attendance` — so every column of the SIGNALS table is hoverable.
  Today only stock and mastery are.
- Two more for the new machinery: the channel scoreboard (§2) and the Shapley decomposition (§3).
- `refs` populated on all of them and on the four that already exist.
- A **bibliography panel**: the whole reference list, grouped by the section each supports,
  clickable.
- The derivation drawer renders each ref as a link rather than plain text.

---

## 6 · Architecture and boundaries

New modules, each with one purpose and its own tests:

| module | purpose | depends on |
|---|---|---|
| `quant/fit.ts` | 1-D grid + golden-section minimiser over `[0, cap]`. Pure numerics, no domain knowledge. | — |
| `quant/earned.ts` (rewritten) | the credibility rule: minimise, shrink, clamp | `fit.ts`, `shrinkage.ts` |
| `quant/signals/channels.ts` | per-channel `a_k` fit, normalisation, scoreboard rows | `fit.ts`, `shrinkage.ts`, `signalread.ts` |
| `quant/signals/shapley.ts` | exact Shapley over the clamped game | `params.ts` |
| `derive/cite.ts` (extended) | `url`, `citeUrl()`, new entries | — |

`signalskill.ts` keeps its walk-forward replay and `bookBefore` cutoff discipline unchanged — only
what it hands the estimator changes. `apply.ts` is untouched: the shift arithmetic is already
correct.

Every existing invariant holds: the committed fixture stays byte-identical through the signals
layer; `applySignals` still runs house-side before the §27/§29 pool; `rawStats` and the forecast
register stay unadjusted; all reads stay pure and clock-free with `asOf` passed in.

---

## 7 · Testing

- **`fit.ts`** — recovers a known minimum on analytic convex and bimodal objectives; deterministic
  across runs; respects the bracket.
- **`earned.ts`** — identity at `n = 0` (returns `toward`, clamped); a channel that strictly worsens
  every outcome fits `w* = 0`; a channel that strictly improves fits `w* = cap`; **a channel that is
  directionally right but 3× oversized fits an interior `w* ≈ 1/3`** — the case the old estimator
  could not represent, and the regression test that proves the fix.
- **`channels.ts`** — `a_k = 1` exactly below the minimum round count; normalisation holds mean 1
  over firing channels; clamps bind.
- **`shapley.ts`** — efficiency (`Σφ = adj`) under a binding clamp, the exact case the old
  marginals failed; symmetry; null player; agreement with drop-one marginals when the clamp is
  slack.
- **Defect fixes** — one test per M-number pinning the corrected behaviour, and for M4 a test that
  the two attendance paths agree to within a stated tolerance at the same attendance percentage.
- **`cite.ts`** — every `CiteKey` referenced by a derivation exists; **every derivation exposes at
  least one `ref`**; every `url` is well-formed.
- **Gate** — `npm run gate` green after each §1 channel conversion, with before/after CRPS in the
  commit message per §26.

---

## 8 · Sequencing

Gate-neutral work first, so the risky change lands alone and its effect is unambiguous.

1. **B5** — `aiCharge` reads `signalled`; the failing spec goes green.
2. **E1** — lift every hand-typed constant into `signals/params.ts`; kill the duplicate short-sleep
   threshold. Pure refactor, numbers unmoved except where the duplicate threshold is reconciled.
3. **M3–M7** — the per-term defects, one commit each.
4. **`shapley.ts`** + `rawTerms` + the SIGNALS table + README §30 caveat deletion.
5. **`channels.ts`** + the channel scoreboard.
6. **M8, M9** — common-mode aggregation, and VOI by real ablation.
7. **§5** — bibliography expansion, verified links, the five new derivation cards, the
   bibliography panel, `refs` coverage across the whole engine.
8. **`fit.ts` + `earned.ts`** — one commit per channel: signals, self, wire, aggregate, readiness.
   Each gated separately per §26; a regressing channel reverts alone.
9. **README** — §12, §15c, §26, §27, §28, §29, §30 updated to describe what the engine now does;
   §21 and `mark.book.test.ts` regenerated via `npm run gen:table` in the same commit as step 8.

Steps 1–7 cannot move `npm run gate`. Step 8 is the only one that can, and it is decomposed so
that each channel's risk is isolated.

---

## 9 · Out of scope

- The `derive.book.test.ts` LaTeX-parse timeout (5s) is a pre-existing suite-speed issue, not a
  correctness one. Noted, not fixed here.
- No change to `applySignals`'s shift arithmetic.

*(The original §9 also excluded README §1–§11 core estimation on the grounds that "the audit found
no defect there." Part II retracts that: §10 and §14 are defects in exactly that layer. The
exclusion is withdrawn.)*

---
---

# Part II — the second audit

**Date:** 2026-07-31 · same branch · scope: the whole engine, not the newest layer.

Part I audited §30 and the one rule every priced channel shares. This part audits everything
else: the predictive distribution, the eval harness, the channel stack, the post-processing
chain, the two clocks, the depth fit, and the data flow through `App`. Fifty-nine findings,
grouped by the thing that is actually wrong rather than by the file it lives in.

Three of them (§11.1, §12.1, §13.1) are load-bearing on Part I: §1's acceptance rests on
`npm run gate`, and the gate is blind to most of what §1 changes.

---

## 10 · The predictive distribution treats a t-scale as a standard deviation

Six places. It is one mistake, repeated, and it compounds — every one of them widens or narrows
in the same direction as the last, and the constants tuned to compensate are tuned to the sum.

For a Student-t with df ν and scale s, `Var = s²·ν/(ν−2)`. This engine lives at ν = 3+n, i.e.
ν ∈ [4, 14] on the fixture, where that factor is **1.17 to 2.00**. It is not a rounding error.

### 10.1 The NIG prior asserts twice the pooled variance

`bayes.ts:27` — `defaultPrior` sets `alpha: 1.5, beta: pool.sigma2`. For an Inverse-Gamma,
`E[σ²] = β/(α−1) = β/0.5 = 2β`. So the prior's mean variance is **2 × the measured pooled
within-subject variance**, on a prior the comment describes as "weak … centred on the book's
grand mean". The mean is centred; the scale is doubled. It bites hardest at n = 1–2, where the
prior dominates and the `shrunk` member's sd comes straight off `nigPredictive`.

**Fix:** `beta = pool.sigma2 * (alpha − 1)`, so `E[σ²] = pool.sigma2` exactly. Same for the
`PRIOR_VAR` fallback. Gate-moving; own commit.

### 10.2 The ensemble's moment match is undone by the line after it

`ensemble.ts:242–251` moment-matches the mixture — correctly — then ships `sd = √variance` as
the **scale** of a t with `df = 3+n`. The resulting predictive has variance `variance·ν/(ν−2)`,
not `variance`. The mixture was matched and then unmatched.

`ENSEMBLE_DISPERSION = 1.15` (`params.ts:130`) was swept against walk-forward CRPS and lands in
a flat 1.1–1.3 basin — i.e. it is currently absorbing this error. But the error is **n-dependent**
(1.41× in sd terms at n=1, 1.08× at n=11) and the correction is a constant, so it over-widens the
long tapes and under-widens the thin ones. The comment attributes the whole gap to "the members'
own estimation uncertainty"; part of it is arithmetic.

**Fix:** `scale = √(variance·(df−2)/df)`, then re-sweep `ENSEMBLE_DISPERSION` against CRPS. If
the re-swept optimum lands near 1.0 the dispersion markup was the moment error all along, and
that is worth knowing and stating in §26 either way.

### 10.3 The width recalibrator inflates a perfectly calibrated engine

`biascal.ts:56` — `widthScale` is the rms of `error/sd` shrunk toward 1. For a **calibrated** t
predictive, `E[(error/scale)²] = ν/(ν−2)`, so rms ≈ 1.29 at ν=5. A flawless engine is told its
bands are 29% too tight, and `applyBias` widens them. The correction has a systematic
mis-target baked into its own definition, and (because it only ever fires once a book has
resolved rounds) it is invisible on the fixture.

**Fix:** standardise by the predictive sd, not the scale — `(error/(sd·√(ν/(ν−2))))²` — or
recalibrate on PIT uniformity, which is scale-free and already computed in `scoring.ts`.

### 10.4 The headline aggregate band is narrow twice over

`aggregate.ts:39` — `Z90 = 1.6449`, with the comment "the per-desk t-tails have already been
priced in; the sum is ~normal". Neither half holds:

- `nextExam.sd` is the t **scale**, so `correlatedSumSd` sums `scale²`, not variances. Under-states
  the sum's variance by the same `ν/(ν−2)` factor — ~40% at the fixture's typical ν.
- Six desks at ν≈5 is not a CLT regime. A normal quantile on a sum of six heavy-tailed
  components under-covers in exactly the tail the CI90 is about.

The same applies to `compositeIndex` (`aggregate.ts:180`). These two numbers are the terminal's
headline instruments and its most-quoted claim ("the aggregate is the level this engine can
genuinely forecast" — README §26, `meanpool.ts` header). They are the least honestly bounded
figures on the board.

**Fix:** convert each desk to a variance before summing; quote the interval off a t with
`ν = min ν_i` (the thinnest desk sets the tails, matching `oracle.ts:100`'s own rule) rather
than off Z90.

### 10.5 The pools mix scales from different df as if they were commensurate

`pool.ts:147` and `aipool.ts:142`. The mixture variance adds `model.sd²` (a t-scale at ν≈5) to
`you.scale²` (a t-scale at `SELF_DF = 30`) to `wire.scale²` (same). Those three numbers are not
the same kind of quantity. The desk's component contributes ~1.67× the variance the formula
credits it with, so pooling in a student systematically **narrows** the band relative to truth —
which inverts the module's central safety argument ("DISAGREEMENT WIDENS THE BAND", `pool.ts:39`).

The between-component term `w(1−w)(μ_y−μ_m)²` is correct and does widen. The within-component
term is not, and on a desk with a thin tape it is the larger of the two.

**Fix:** convert every component to a variance before mixing; keep the desk's df on the output
as the header already argues.

### 10.6 The oracle's coursework side is priced as if δ̂ were exact

`oracle.ts:69` — `cwSide = cw.mean + offset.delta`, and `oracle.ts:87` weights that side by
`pC = 1/cw.sd²`. `offset.delta` is a shrunk winsorized-mean gap estimated from a handful of
prints; its own standard error is easily 3–5 points and is nowhere in the arithmetic. The
coursework side is therefore over-precise, which does two things at once: it takes too much
weight in the precision blend, and the blended band is too tight.

**Fix:** `calibration.examOffset` returns `se` alongside `delta` (it has `nExams`, the winsorized
spread and κ — everything needed); `cwSide`'s variance becomes `cw.sd² + se²`.

---

## 11 · The gate does not score the forecast the board ships

This is the finding that most changes Part I. §1.6 makes `npm run gate` the acceptance criterion
for every channel conversion. `package.json` defines the gate as `vitest run src/lib/quant/eval`,
and `eval/` scores **`ensemble.mean`, one step ahead, over all four print types**
(`backtest.ts:97–99`).

### 11.1 What the gate cannot see

| shipped | gated |
|---|---|
| `examOracle` — the two-sided exam forecast | ✗ never called in `eval/` |
| `markDesk` — the price on screen | ✗ except indirectly, via `ablatePremia`'s pinball |
| `applyBias` | ✗ |
| `applySignals` | ✗ |
| `poolBoardJoint` (§27/§29) | ✗ |
| `poolAggregate` (§28) | ✗ |
| the truncated `ci50`/`ci90` the board draws | ✗ — see 11.2 |
| `ensemble.mean` at h=1 over quizzes and assignments | ✓ |

Of the five channels §1 converts, **four are invisible to the gate**. A channel whose conversion
regresses the shipped forecast can pass green, and a channel whose conversion improves it can
show no movement at all. "Walk-forward CRPS must not regress" is currently a statement about a
quantity nothing on the board displays.

**Fix (prerequisite for §1, not optional):** add `eval/oracle.ts` — the same walk-forward
discipline as `backtest.ts`, but targeting the **next exam** with `examOracle`, scored against
the exam that landed. That is the object every §1 channel actually blends into. Snapshot it into
`baseline.json` beside the existing rows, and make §26 rule 3 read *both*. `replay.ts` already
computes exactly this per round and throws the score away into a `ForecastLog` — the harness is
half-built already.

### 11.2 The engine is scored on one distribution and displays another

`bayes.predictiveInterval` returns the quantiles of the **[0,100]-truncated** t (`bayes.ts:196`,
the C4b boundary work). `scoring.scoreT` computes `q05`/`q95`/`q25`/`q75` as
`mean + tQuantile(τ,df)·scale` — **untruncated** (`scoring.ts:60–63`). So:

- `cover90`, `cover50`, `is90` and `pit` describe an interval the board never draws.
- `ForecastLog` stores the truncated `ci90` next to an `is90` scored on the untruncated one —
  two inconsistent objects inside one record.
- README §26's "honest under-coverage" and §21's calibration claims are measured on the
  un-shipped object.

Near a boundary — a desk printing in the 80s, which is half the fixture — the two intervals
differ materially, and truncation is exactly the correction that was supposed to fix coverage.

**Fix:** `scoreT` takes the same truncation bounds and uses `truncatedQuantile`. CRPS needs the
truncated form too (or an explicit, documented decision to score CRPS untruncated and coverage
truncated — but not silently).

### 11.3 The advertised mean-skill number measures a different estimator

`skill.ts:55` forecasts each desk's exam with `ensemble(past).mean` — the all-types capability
price. The shipped PREDICTION headline is `Σ nextExam.mean`, i.e. the **oracle**. README §26's
"the far-more-forecastable all-subject mean" and the MAE ≈ 3.5 claim therefore describe an
instrument the terminal does not sell.

**Fix:** `meanSkill` calls `examOracle`. Expect the number to move; record the before/after in
§26 per the change protocol.

### 11.4 The naive benchmark borrows the model's tails

`backtest.ts:103` — `naivePred.df = ens.df`. A last-value naive has no df of its own; handing it
the model's makes the skill ratio partly insensitive to the model's tail choice, which is one of
the things skill is supposed to be measuring.

**Fix:** fix the naive's df (or score it Gaussian) and state the choice.

### 11.5 The ablation scoreboard prints two different objectives in one column

`ablation.ts` — `ablateMembers` deltas are **CRPS of the ensemble**; `ablatePremia` deltas are
**τ=0.25 pinball of the mark**. They land in one table with a shared `delta` and `verdict`
column, and `EPS = 0.02` is applied to both. A CRPS point and a pinball point are not the same
unit, and `verdictOf` has no noise floor derived from the data — "prune" is a hand constant
against a single number on a six-desk book with no standard error.

**Fix:** label the objective per row in the type (`objective: "crps" | "pinball@0.25"`), and
derive the neutral band from the fold-level spread (a paired bootstrap over folds is cheap and
already deterministic) rather than from a constant.

---

## 12 · The unaudited-channel stack has no joint calibration

Five channels now move the next-exam forecast: bias (§26), signals (§30), self (§27), wire
(§29), aggregate (§28). Each is fitted **independently against the same raw register**, and they
are then applied **in sequence**. Nothing measures their combined effect, and nothing bounds it.

### 12.1 The 40% floor is not a floor

`params.ts:316–324`: *"the house model always keeps ≥ 40% of every forecast it makes."*

`POOL_CEIL = 0.6` bounds `w_self + w_wire`. It does not bound `applyBias`, whose offset is an
unbounded points shift, and it does not bound `applySignals`, which shifts by `w·adj` with
`w ≤ SIGNAL_CAP = 0.35`. By the time `poolBoardJoint` runs (`App.tsx:293`), the "house" component
it preserves 40% of has **already been moved twice by unaudited channels**. The stated invariant
is a statement about a mixture weight, not about information, and as written it is false.

**Fix:** either state the true invariant (the *pooling* weight has a floor; the house *estimate*
does not), or extend the ceiling to a genuine information budget across all four channels. The
second is the honest one and belongs in §26 as a named invariant with a test.

### 12.2 Four corrections fitted on one signal, applied in series

Bias, signals, self and wire are all fitted on the question *"has the desk been off, and in which
direction?"* — all four against the same `replayRegister` output. If the model has been 3 points
optimistic, all four channels see it, all four correct for it, and the board moves by roughly
their sum. There is no orthogonalisation and no joint fit, and the application order
(bias → signals → self/wire, `App.tsx:198 → 256 → 293`) is fixed and unjustified.

**Fix:** fit the channels on **residuals after the preceding correction**, in the documented
order — which is exactly the structure §1's `lossAt(w)` closure makes cheap, since each channel's
objective already takes the board it is blending into. This is the largest single design change
Part II proposes and it should follow §1, not precede it.

### 12.3 The signal channel is scored against one baseline and applied to another

`App.tsx:243` fits `signalFit` against `register` (raw, uncorrected model calls). `App.tsx:255`
applies it to `stats` — the **bias-corrected** board. And `signalReads` (`App.tsx:230`) compares
mastery's "book says X vs desk Y" against `modelMeans`, also taken off the corrected board. The
weight was earned against one number and spends against a different one.

This is the same defect class as Part I's **B5** (`aiCharge` reading `stats` where it must read
`signalled`), one layer up. B5's fix should generalise: every channel states, in one place, which
board it fits against and which board it applies to, and a test asserts the pair.

### 12.4 The signal channel is scored with one of its seven terms switched off

`signalskill.ts:100` — `const next: NextSitting = { date: cutoff, hour: null, weight: … }`. With
`hour = null` the chronotype term cannot fire, so **every scored round is scored on a six-term
`adj`**, and the fitted `w` is then applied live to a seven-term one. Textbook train/serve skew,
and it interacts badly with Part I §2: chronotype's `n_k` is structurally zero, so it will sit at
`a_k = 1` forever with no possibility of being measured, while silently riding the weight the
other six earned.

**Fix:** either recover the sitting hour for resolved rounds (`upcoming` carries it; the resolved
sitting is findable by `resolvedEntryId`), or exclude chronotype from the live `adj` on any desk
whose rounds could not score it. Do not leave it scored-at-zero and applied-at-full.

### 12.5 One credibility rule, two behaviours on the same situation

The situation: a round the register never called.

- `meanpool.ts:120` — `if (points.length !== called.length || !points.length) continue;`
  **skips it**, with the header stating why: *"A round the register never called is skipped
  rather than handed a free win — the comparison must be like for like or the ratio means
  nothing."*
- `readiness.ts:185` — `const modelRate = hitRate(pairs, model) ?? 0.5;` **credits the model a
  coin flip** and scores the round anyway.

Both channels claim to obey `earned.ts`. They do not obey each other. With `WARMUP = 2` in
`replay.ts`, early rounds are systematically uncalled, so the readiness pile is measured against
a coin on precisely the rounds where a real ordering was hardest — and earns weight for it.

**Fix:** one rule, in `earned.ts`'s doc and enforced at the call sites. `meanpool`'s is the
defensible one.

### 12.6 A perfect record scores as no record

`earned.ts:84` — `const denom = youScore + modelScore; rawShare = denom > 0 ? … : 0`. The guard
is right for CRPS and absolute error, which never reach exactly 0. It is wrong for
`readiness.ts`, whose loss is `1 − hitRate`: on a three-desk book (three pairs) both sides
hitting 1.00 is ordinary, `denom = 0`, and `rawShare = 0` — **a flawless pile is treated as an
empty one** and shrinks to `READINESS_PRIOR`.

§1.2's rewrite removes the ratio, but the degenerate case survives it: with an objective that is
flat in `w` (every weight scores identically), the minimiser lands on an arbitrary grid point.
The rewrite must define the tie explicitly — return `toward`, and say so — rather than inherit
whichever end of the bracket the search happens to visit.

### 12.7 Readiness credibility ignores the per-desk count it already holds

`readiness.ts:82` — `credibility = (live.length/(live.length+κ)) · skill`, computed **once for
the whole pile** and stamped on every desk. A desk duelled once inside a forty-duel pile carries
the same credibility as one duelled thirty times. `r.wins` and `r.losses` are right there on the
next line, unused for this purpose.

**Fix:** `credibility_i = ((wins_i+losses_i)/((wins_i+losses_i)+κ)) · skill`, with κ rescaled for
the per-desk count. The premium is already per-desk; only its credibility is not.

### 12.8 Elo is an online estimator solving an offline problem

`readiness.ts:78` calls `eloRank(live, subjectIds)` and then reads the ratings as
Bradley–Terry log-strength (`/ELO_PER_LOGIT`). Elo *approaches* BT asymptotically; on a
twenty-duel static pile it is order-dependent (sequential updates, path-dependent K), so the
same pile in a different order gives different λ, and therefore a different mark.

The pile is fixed, small, and re-fitted from scratch on every render. There is no reason not to
fit BT directly — a dozen Newton steps on a 6-parameter logistic, deterministic, order-free, and
it gives standard errors for 12.7's credibility for free. Part I §1.5 already moves readiness'
*scoring* to BT log-loss; this moves its *estimation* there too, and the two should land in one
commit so the module speaks one language.

### 12.9 The aggregate weight is earned on a subset and spent on the whole

`meanpool.ts:110–129` scores your call against `score.realizedAvg` over **the desks you ranked**,
and scores the register over the same desks. Correct. `poolAggregate` then applies the resulting
`w` to `model.pct` — the aggregate over **every priced desk** (`aggregate.ts:138`). Weight earned
on one population, spent on another. On a book where you consistently rank five of six desks,
these are different numbers.

**Fix:** score against, and pool into, the same desk set; or state the mismatch on the card.

---

## 13 · Post-processing leaves derived fields stale, and one derivation prints a false equation

`PriceResult` carries fields that are **functions of each other** — `carry = nextExam.mean − fv`
by construction (`price.ts:134`). Four separate post-processes replace `nextExam` and none of
them re-derives the fields that depend on it.

### 13.1 `carry` is stale, and the derivation card says so out loud

`applyBias` (`stats.ts:290`), `applySignals` (`apply.ts:56`) and `poolBoardJoint`
(`aipool.ts:187`) each spread `{...quant, nextExam}`. `carry`, `fv`, `price`, `discount`,
`premia` and `rating` all survive unchanged. After any of the three moves the mean, the identity
`carry = nextExam.mean − fv` is broken.

`derive/price.ts:426` renders that identity as a substitution:

```
c = {nextExam.mean} − {fv} = {carry}
```

`deriveCtx.stats = booked` (`App.tsx:407`), which is the **fully pooled** board. So on any book
where a single channel has moved a single desk, the derivation drawer prints an equation whose
two sides do not match — in the one layer whose entire purpose is to be checkable, on a project
whose doctrine (`cite.ts` header) is that showing the formula without its provenance is a magic
trick. Showing a formula that is arithmetically false is worse than a magic trick.

The team has already hit this hazard once and fixed it in the right way: `derive/facts.ts:92`
threads `signalModelMean` explicitly *"not `stat.quant.nextExam.mean`, which by the time a
derivation reads it may already carry this very channel's own shift."* The same reasoning applies
to `carry` and was not applied.

**Fix:** make the dependency structural rather than remembered. Either recompute `carry` inside
every post-process (and `rating`'s inputs, see 13.2), or move the post-processed forecast to a
separate field (`nextExamShipped`) so the derivation layer can quote the pre- and post-channel
numbers as two honest rows. A test should assert `|carry − (nextExam.mean − fv)| < 0.05` on every
board the derivation layer can see.

### 13.2 `ratings.ts`'s convergence anchor is the mark, and its comment says it is not

`ratings.ts:280`:

```ts
// prevPrice is the rewound ENSEMBLE mean, i.e. the previous fair
// value — which is exactly the anchor the convergence term wants.
fv: quant.prevPrice ?? quant.fv,
```

It was, when `price.ts:122` set it. `stats.ts:233` then overwrites it:

```ts
prevPrice = loo ? loo.mark : prevPrice;
```

— the previous **mark**. So the previous rating's convergence term is anchored on a
discount-bearing price, which is precisely the failure the module header warns against in
capitals: *"Against the mark they would sum to the discount instead, quietly paying every
analyst on a distressed desk φ·𝒟 of pure bookkeeping."* Every `prev` rating on a discounted desk
carries `ECM_ADJUSTMENT · 𝒟` of pure bookkeeping, which is what `ratingMove` compares against to
decide UPGRADE/DOWNGRADE. Upgrades are being printed off an arithmetic artefact.

**Fix:** carry the rewound fair value separately (`prevFv`) rather than reusing `prevPrice` for
two jobs, and delete the stale comment. This is a live wire-copy defect, not a cosmetic one.

### 13.3 The leave-one-out rewind ages the desk it rewinds

`stats.ts:207–222` — `looInput` drops the latest print and then computes
`staleDays: silence(latest.date)` with `latest` being the *second*-newest print and `todayIso`
still today. So the rewound desk is charged for a silence that, at the moment being reconstructed,
had not happened. Past `STALE_FREE_SESSION_DAYS = 65`, `prevPrice` picks up a stale premium the
real previous mark never had, and `priceDelta` — the number the ticker prints — is inflated by
exactly that amount.

**Fix:** rewind the clock too: `silence(latest.date)` evaluated as of the dropped print's date,
not today. (The same argument applies to the CUSUM and the exam-age decay inside the rewound
`markBook` pass.)

---

## 14 · Two clocks, three detrends, and a bridge measured in the wrong units

### 14.1 The premium sheet ages two ways at once

`stats.ts:89` documents the split deliberately — silence on **session** days, ability drift on
**calendar** days. That is defensible. What is not is that both clocks run inside *one premium
sheet*:

- `mark.ts:241` — STALE TAPE charges off `ctx.staleDays`, **session** days.
- `mark.ts:143` — EXAM SHOCK decays off `ctx.examAgeDays`, computed at `markBook:342` as
  `(today − examDate)/86400000` — **calendar** days.

A shock that happened in December and a silence that started in December are aged by different
calendars in the same attribution waterfall, and `decayFactor`'s own comment
(`factors.ts:206`) claims *"sessions are the market clock"* while its `ageDays` argument is not
in sessions.

**Fix:** one clock per question, named in the type. `examAgeDays` becomes
`examAgeSessionDays`, and `DECAY_CAL_HORIZON_DAYS`/`DECAY_CAL_HALF_LIFE_DAYS` are re-expressed at
the session rhythm the way `STALE_FREE_SESSION_DAYS` already was.

### 14.2 δ̂ is measured on raw scores and applied to detrended ones

`calibration.examOffset` (`calibration.ts:27–29`) computes the exam-vs-coursework gap from
`e.score` — **raw**. It is then added to a **detrended** level in two places:
`oracle.ts:69` (`cw.mean + offset.delta`, where `cw` came through `ensemble` → `detrend`) and
`factors.ts:262` (`impliedExam = cw.mean + off.delta`, same).

Detrending already removes the part of the exam/coursework gap that is a marking-difficulty
difference — coursework is usually marked against a different cohort reference than exams. δ̂ then
re-adds it. The bridge is crossed once, as the module insists, but it is crossed in the wrong
units, and the double-count lands squarely in `surpriseZ`, which drives a 6-point capped premium.

**Fix:** `examOffset` takes the detrended series (it already receives the entries; `detrend` is
one call), so both sides of the gap live on the same scale as everything it is added to.

### 14.3 The same print gets three different detrended values

`detrend`'s correction is `score − λ(ref − meanRef)` where `meanRef` is the mean of refs **in the
entries it was handed** (`calibration.ts:47–53`). It is handed:

- the whole tape, by `priceSubject` → `ensemble(sorted)`;
- the **exam-only** tape, by `examOracle` → `ensemble(exams)`;
- the **coursework-only** tape, by `examOracle` → `ensemble(coursework)`;

and separately, `poolableScores` (`shrinkage.ts:77`) re-centres on a **book-wide** `meanRef`.

Four centres, one print. The exam-side and coursework-side ensembles inside the oracle are
therefore comparing two quantities that have been recentred on different origins, and the
precision blend that weighs them is blind to it.

**Fix:** compute `meanRef` once per desk (or once per book) and pass it in. It is one parameter
and it makes every downstream comparison well-posed.

### 14.4 The pooled prior and the local mean live on different scales

`ensemble.ts:106–111` — the `shrunk` member takes `past.map(p => p.y)`, which is **detrended**,
and blends it toward `pool.grandMean`, which `poolStats(poolableScores(...))` computed from
**raw scores re-centred on the book's mean reference**. Two different corrections, blended as if
they were the same quantity. On a book where cohort references vary across subjects — which is
the whole reason `poolableScores` exists — the shrinkage pulls toward a target that is not where
it thinks it is.

### 14.5 `detrendMeta` averages class means and year means together

`calibration.ts:49` — `e.classAvg ?? e.yearAvg` collected into one `refs` array and averaged into
one `meanRef`. A class average and a year-level average are means of different populations; on a
streamed book they differ by exactly the `premium` that `depth.ts` fits. Mixing them makes
`meanRef` a weighted blend of two origins whose weights depend on which fields the student
happened to record.

`stats.ts:130` already handles this correctly for alpha — it picks *one* reference kind for the
whole desk (`withClass.length ? "class" : "year"`) and never mixes. `detrend` should do the same.

### 14.6 Cross-subject shrinkage counts a quiz as a full observation

`shrinkage.ts:55` — `B = τ²/(τ² + σ²/scores.length)`. `scores.length` is the raw print count. The
engine asserts elsewhere that a quiz is twice as noisy as an exam (`RELIABILITY_SD`) and worth
about half as much (`SIGNAL_WEIGHT`), and threads `rMult` through the Kalman for exactly this
reason. The shrinkage member ignores all of it: eight quizzes buy the same trust in local data as
eight exams.

**Fix:** effective n — `n_eff = (Σw)²/Σw²` with `w_i = 1/RELIABILITY_SD[type_i]²` — which is the
same Kish count `ratings.ts:166` already uses for the analysts.

### 14.7 The forecast horizon is a backward statistic when the forward date is known

`ensemble.ts:222` — `horizonDays = median(gaps)`, the desk's median historical print gap. That
number then sets `forward`, `carry`, the Kalman's variance inflation, the ratings' `risk` and the
damped-trend saturation.

Meanwhile `data.upcoming` carries the **actual dated sitting**, and `stakedSittings`
(`pool.ts:170`) already finds it in order to pool a self-prediction into the forecast. So the
engine pools a student's call *about a specific paper on a specific date* into a model forecast
*one median gap out*. The two forecasts are about different targets, and every scored comparison
between them (`fitSelfWeight`, `fitAiWeight`) inherits the mismatch.

**Fix:** when a live sitting exists for a desk, forecast to **its** date. Fall back to the median
gap only when nothing is scheduled. This also makes the summer-gap problem concrete rather than
theoretical: a desk whose next exam is 120 days out across a holiday currently gets a 30-day
band.

---

## 15 · Cliffs — M6 is not the only one

Part I §4's **M6** treats chronotype's integer-hour cliff as a signals-layer defect. It is a
house-wide pattern, and the same argument condemns four more:

| # | site | cliff |
|---|---|---|
| **C1** | `robust.ts:152` `shrunkSlope` | `p > 0.5 ⇒ 0`, else `slope·(1−p)²`. At p = 0.499 the multiplier is **0.251**; at 0.501 it is **0**. A single pair flipping erases a quarter of the trend, and the trend feeds MOMENTUM, REL LAG and every analyst's drift. |
| **C2** | `factors.ts:412` `consistent` | Five hard gates ANDed (`vol ≤ 3.5`, `volRatio ≤ 0.8`, `slope30 ≥ −0.5`, `missStreak === 0`, `n ≥ 6`) switching a **−1 to −2 pt** credit on and off. RMSSD 3.49 vs 3.51 is a two-point swing in the mark. |
| **C3** | `factors.ts:297` `volBasis` | Flips `exam` ↔ `mixed` at exactly four exams, changing what volatility *means* mid-tape. The fourth exam can raise or lower RMSSD by a factor of two. |
| **C4** | `mark.ts:72` `REGIME_BANDS` | Discrete bands are defensible for a *label*; the CUSUM override on the next line (`if alarm && (PRIME|STABLE) ⇒ STRESSED`) makes the label jump two bands on one boolean. |
| **C5** | `depth.ts:269` `streamed` | `|premiumMean| > 2·max(premiumSe, 0.5)` — a binary verdict on a continuous, and (see §16.1) unidentified, quantity. |

**C1 is the one worth fixing on its own merits**: it is in the priced path, it is the largest of
the five, and the fix is the same shape as M6's — replace the hard gate with a continuous
function of `p` that goes to zero smoothly (`(1−p)²` extended to a smooth taper over
`p ∈ [0.4, 0.7]`, or an explicit `exp(−p/p₀)`). The others should be audited together and
documented as accepted where they are accepted; a cliff nobody has decided about is different
from one somebody has.

---

## 16 · Market depth: a verdict on an unidentified quantity, fitted with more parameters than data

### 16.1 `streamed` is an artefact of a regularisation constant

`depth.ts:222` — the ridge is applied to the **basis block only**, which is what identifies the
system (correctly, and the header says so). The consequence the header does not draw: the split
between `premium` and `basis` is fixed *by the ridge*. Shifting `DEPTH_BASIS_SHRINK` moves every
premium up and every basis down, one for one.

`premiumMean` is therefore not a property of the data. `depth.ts:269` tests it:

```ts
streamed: Math.abs(premiumMean) > 2 * Math.max(premiumSe, 0.5)
```

So the board's answer to *"is this school streamed?"* — a real, checkable claim about the world,
printed in the settings diagnostic — is a function of a hand-set penalty. `DEPTH_BASIS_SHRINK = 2`
becomes 0.5 and the same book reads differently.

**Fix:** test a quantity the ridge cannot move — the **spread** of premiums across periods
(`premVar`), which is invariant to a common shift. "The classes differ from period to period" is
both identified and the thing the verdict actually means.

### 16.2 The fit gate counts observations, not residual degrees of freedom

`depth.ts:196` gates on `obs.length < DEPTH_MIN_PRINTS (6)` and `groupKeys.length < 2`. The
parameter count is `P = G + S + 1`. Six ranked prints across six subjects and two groups fits
**nine parameters on six observations**. The ridge regularises only the S basis terms; the G
premiums and σ_class are unpenalised, so the system is genuinely under-determined in the
direction the verdict above reads.

**Fix:** gate on `obs.length ≥ P + DEPTH_MIN_DF` with an explicit `DEPTH_MIN_DF`, and put the
effective df on `DepthModel` so the panel can state it.

### 16.3 The reported fit quality cannot detect a bad fit

`depth.ts:240` — `rmse = √(sse/obs.length)`. With n near P, sse → 0 and the panel reports a
near-perfect fit precisely when the fit is least trustworthy. Divide by residual df.

### 16.4 A negative σ_class is silently clamped

`depth.ts:231` — `Math.max(DEPTH_SIGMA_FLOOR, sol[P-1])`. Nothing constrains the least-squares
coefficient on `z` to be positive. A negative fit means placement is *anti*-correlated with score
inside the class — a data-entry error worth surfacing (a rank recorded ascending instead of
descending is the obvious cause) — and it becomes an innocuous `2`.

### 16.5 The field-percentile history switches estimator mid-series

`depth.ts:305–309` — `fieldZ` uses the direct route `(score − yearAvg)/σ_year` when the print
carries a year mark, and the via-the-class route otherwise. The header states the two agree when
the residual is zero; the residual is not zero. So a desk's `history` — drawn as a tape — steps
at whichever print the student started or stopped recording `yearAvg`. The step is an artefact of
data recording, and it is drawn as if it were a change in standing.

### 16.6 The depth fit ignores lineage, six lines after the pool insists on it

`stats.ts:82` pools over `groupByLineage(subjects, entries)` with a five-line comment on why
pooling over desks would double-count a split tape. `stats.ts:88` then calls
`fitDepth(entries, settings)` on the **raw** entries. A split desk's ranked prints enter the
depth fit under two subject ids and get two independent basis terms.

Worse, the keys disagree: `fitDepth` keys basis on `e.subjectId` (`depth.ts:187`), `readOf` looks
it up by `e.subjectId` (`depth.ts:304`), but `subjectDepth` reports
`basis: model.basis[sub.id]` (`depth.ts:394`) — on an inherited tape those are different desks,
so the reported basis and the applied basis are not the same number.

---

## 17 · The history tape and the live board are priced by different engines

`aggregate.ts:216` states the invariant plainly: *"the same fair pricing and the same harsh
marking sweep the live board runs, so the history tape and today's board never disagree about
what a desk was worth."*

They disagree.

### 17.1 `pricesAsOf` prices no elicited inputs

`aggregate.ts:243–251` builds its `FactorInput`s with no `effort` and no `readiness` fields, so
`markBook` reads `null` for both (`mark.ts:352–353`) and both premia vanish. The live board
(`stats.ts:189–206`) prices both. Therefore:

- `aggregateHistory`'s **live "NOW" point** (`aggregate.ts:346`) and the `compositeIndex`
  headline (`App.tsx:346`) are the same desks on the same day at two different prices.
- `index.delta` — "VS LAST TERM" — compares an effort-and-readiness-priced today against a
  past priced without them. **The composite's term-over-term delta contains the entire effort and
  readiness premium as a spurious jump**, appearing the moment a student first files a budget or
  answers a duel.

Both features advertise themselves as exact identities on a book that has never used them
(`params.ts:230`, `params.ts:246`). That is true of the mark and false of the delta.

**Fix:** thread the elicited inputs through `pricesAsOf`, asking `effortFor` for the allocation
filed for the round **at that cutoff** (it is keyed by round already) and the duel pile as it
stood then (`d.createdAt < cutoff`, the same discipline `readinessSkill` already uses). A test
should assert `aggregateHistory`'s live point equals `compositeIndex`'s sum on the fixture.

### 17.2 The register dates a call before some of its own inputs existed

`replay.ts:104–105`:

```ts
const asOf = past[past.length - 1].date;
const q = priceSubject(past, poolBefore(exam.date), settings, asOf);
```

The desk's own tape is cut at `asOf`. The **cross-subject pool** is cut at `exam.date` — which
can be months later. So the forecast is stamped `createdAt: asOf` while its prior was built from
other desks' prints that had not happened on that date.

This matters more than it looks: the register is the *uncontaminated* baseline every elicitation
channel is scored against (`App.tsx:161–169`, and it is the entire argument of README §26). "The
desk's call as of the day the call was made" is the claim; the pool is as of a later day.

**Fix:** `poolBefore(asOf)`. It is one argument and it is strictly more conservative.

### 17.3 `examAggregate`'s headline and its delta use different denominators

`aggregate.ts:93` sums over `counted`; `aggregate.ts:99–104` computes `delta`/`pctDelta` over
`common` (desks with a prior exam). A desk sitting its first exam raises `sum` and is absent from
`delta`. Defensible, but nothing on the card says the two numbers describe different books.

---

## 18 · Data flow and bottlenecks

Nothing in `src/lib/quant/` is memoised — `grep` finds exactly one cache in the whole layer
(`depth.ts:88`, and it is keyed on an integer). Everything else recomputes from scratch, on the
main thread, inside React memos keyed on the book.

### 18.1 `tQuantile` is the hot spot and is trivially memoisable

`bayes.ts:177` — 100 bisection steps, each calling `tCdf` → `betaInc` → a continued fraction.
`scoreT` calls it **nine times** per score (`scoring.ts:54, 60–63`), of which **two are exact
duplicates** — τ = 0.25 and 0.75 are computed once for pinball and again for `cover50`.

`tQuantile(τ, ν)` is a pure function of two arguments, and this app uses roughly five values of τ
and a dozen values of ν. **A `Map` keyed on `` `${τ}|${ν}` `` collapses the entire eval harness's
quantile cost to a few dozen evaluations for the process lifetime.** This is the cheapest
performance fix available and it changes no output.

Second-order: replace the fixed 100-step bisection with bisection-to-1e-6 followed by two Newton
steps on `tPdf` (already implemented, `bayes.ts:107`), which converges in ~15 `tCdf` calls.

### 18.2 `computeStats` is quadratic in desks

`stats.ts:224–241` — for every desk with ≥2 prints it runs a **whole-book `markBook`** (leave-one-
out rewind), each of which runs `computeFactors` over every desk. With D desks that is D+1 full
factor passes. Inside `deskFactors`, `detrend` is called **three separate times** per desk
(`factors.ts:289`, `:354`, and again inside `courseworkSignal:249`), and `missStreak`
(`factors.ts:191`) runs a fresh regression per print — O(n²) — on every one of them.

Plus D full `priceSubject` calls for the rewind (`stats.ts:217`), each running the ensemble's
walk-forward folds, each fold running Theil–Sen at O(n²).

**Fix, in order of value:** hoist `detrend` to once per desk and pass it down; memoise
`missStreak`'s prefix regressions; make the LOO rewind incremental (only the rewound desk's
factors change — the cross-sectional medians can be updated rather than recomputed).

### 18.3 The eval harness recomputes an identical pool inside its inner loops

- `backtest.ts:96` — `poolStats(poolableScores(groupByLineage(subjects, entries.filter(e => e.date < target.date))))` **inside the per-print loop**, and `backtestSubject` is called once per subject, so the same pool is rebuilt once per (subject, print) pair. There are ~50 distinct dates on the fixture.
- `skill.ts:53` — the identical expression **inside the per-subject loop inside the per-round loop**, where it does not even depend on the subject. It is recomputed S times per round for one value.
- `skill.ts:45` — `inheritedEntries(...).sort()` rebuilt per (round, subject).

**Fix:** one `Map<cutoffDate, PoolStats>` per harness run. Pure memoisation; no output moves.

### 18.4 The composite history reprices the book seventeen times, synchronously, on every edit

`App.tsx:360` — `compHist` calls `aggregateHistory`, which calls `pricesAsOf` once per round
(up to `ROUNDS_BACK = 16`) plus a live point. Each `pricesAsOf` prices and marks **every desk**.
`App.tsx:341` — `index` calls `pricesAsOf` again for the previous term-end.

Neither is deferred. The register replay is pushed past first paint (`App.tsx:150`, a 40ms
timeout) and the skill backtest is deferred inside the Scorecard — but the most expensive memo on
the page is not. And it runs regardless of the active view: switching to BLOTTER still pays for
the composite tape, the VOI ranker and the depth fit.

**Fix:** same treatment the register already gets — defer `compHist` past first paint, and gate
the view-specific memos (`voi`, `compHist`) on `view`. The pattern is already in the codebase;
it just was not applied here.

### 18.5 Linear scans where a Map is one line away

- `meanpool.ts:117` — `register.find(x => x.roundKey === key && x.subjectId === id)` inside a loop over desks inside a loop over rounds.
- `readiness.ts:180` — `for (const l of register)` per round, with `ids.includes(...)` inside.
- `signalskill.ts:99` — `entries.find(e => e.id === log.resolvedEntryId)` per resolved log.
- `depth.ts:278` — `model.groups.find(g => g.key === key)` per print read.

The register grows with every round × desk; the entries list grows forever. Index once.

### 18.6 The persistence layer has no budget and no version

`storage.ts:102` — `JSON.stringify(data)` of the entire book on **every** state change
(`App.tsx:106–109`), with no debounce. The book now carries `topics`, `topicMarks`, `sessions`,
`rest` and `disruptions` — the last three of which a student is *encouraged by the VOI panel to
log daily*. Against a ~5MB `localStorage` budget with no size telemetry, the first signal a user
gets is the hard-failure banner.

There is also **no schema version field** in the saved payload — `coerceStored` sniffs shape, and
`ENGINE_VERSION` is stamped only on forecasts, which are no longer stored. A future migration has
nothing to key on.

**Fix:** debounce the save; write a `version` field; report bytes-used in the settings
diagnostic while there is still room to act on it.

### 18.7 The clock is an undeclared input to almost every memo

`todayStr()` is called inside ~15 memo bodies in `App.tsx` and appears in **none** of their
dependency arrays. Meanwhile a 30-second interval (`App.tsx:111`) re-renders the shell for the
session-phase indicator, which the memos correctly ignore. Net effect: the board's "today" is
frozen at the last data edit. Leave the tab open overnight and staleness, the pending round,
staked sittings and the live composite point are all a day behind, silently.

**Fix:** hoist one `today` value into state, advance it when the date actually changes, and put
it in the dependency arrays where it belongs. It is currently the only undeclared input in an
architecture that is otherwise scrupulous about this.

---

## 19 · Smaller findings, and one documentation defect

| # | finding |
|---|---|
| **S1** | **Two `normCdf` implementations, both live.** `bayes.ts:64` (Zelen & Severo) and `robust.ts:96` (Abramowitz & Stegun 7.1.26) — same polynomial, different files, different stated error bounds. `depth.ts` imports one, `ratings.ts` the other. One of them should go. |
| **S2** | **Inconsistent empty-input contracts.** `avg([])` returns `NaN` (`utils.ts:11`); `stdev([])` returns `0`; `median([])` returns `null`. Three conventions for the same situation in one 47-line file. `avg`'s NaN is the dangerous one — it propagates silently through the whole desk. |
| **S3** | **`round1` is asymmetric across zero.** `Math.round(-0.5) === -0`, so a −0.05 credit rounds to 0 while a +0.05 charge rounds to 0.1. `mark.ts:294` filters on `|pts| ≥ 0.05` and then rounds, so the asymmetry lands directly on the attribution waterfall — and is then absorbed by the residual-reallocation loop, which hides it. |
| **S4** | **The winsorisation the bridge advertises almost never fires.** `robust.ts:82` — `winsorize` is a no-op below n = 5. `examOffset` winsorises the exam list, which on this book is 3–5 prints. So `derive/price.ts:415`'s note *"THE MEANS ARE WINSORIZED SO A SINGLE DISASTER IN EITHER COLUMN CANNOT SET THE BRIDGE"* is false for most desks most of the time. Either lower the threshold for small samples or change the copy. |
| **S5** | **Theil–Sen's p-value uses the untied variance.** `robust.ts:140` — `varS = n(n−1)(2n+5)/18` assumes no ties, but `theilSen` explicitly handles `dx === 0` and `dy === 0` pairs. With ties present the true Var(S) is smaller, so p is overstated and `shrunkSlope` over-gates — which compounds with C1's cliff. |
| **S6** | **`UNSCORED_SELF_SD` is unreachable.** `meanpool.ts:52` — `poolAggregate` returns early unless `w > 0`, which requires `n > 0` (no `toward` is passed), which guarantees `selfSd` is set. Dead constant with a comment explaining a case that cannot occur. |
| **S7** | **`bandVarCache` is a module-level mutable global** (`depth.ts:88`) in a layer whose stated discipline is "every read pure and clock-free". Safe as written (keyed on an integer, deterministic), but it is the exception that should be named in the header rather than found. |
| **S8** | **README §21's prose contradicts its own asserted table.** The table gives PHYS `𝒟 = 18.0` (and `70.8 − 52.8 = 18.0`); the prose at README:964 says *"PHYS carries the deepest discount on the book (17.6…)"*. §21 opens by claiming *"every one in the table is **asserted** in `mark.book.test.ts`… so a retune that rewrites this section fails the build"* — the **prose is not asserted**, and it has already drifted, which is exactly the failure §21 says it exists to prevent. `gen:table` should emit the prose figures too, or the prose should quote the table by reference. |

---

## 20 · One constructive opportunity the engine is refusing

`aggregate.ts:47–51`:

> *"The correlation is a prior, not a fit — one student's book cannot identify a cross-subject
> covariance (no second student to separate 'hard term' from 'bad term'), so the user sets it."*

That is true of the tape alone. It is **not** true of this book, because `depth.ts` already fits
`premium[period]` — the form class's strength over the year level, per reporting period, shared
by every desk in it. The year-level average *is* the second student. A period whose premium is
low is a period where the cohort found it hard, and that is precisely the common factor
`correlatedSumSd`'s ρ is standing in for.

So the engine estimates a common period effect in one module and asserts it is unidentifiable in
another. This also gives Part I's **M8** (book-wide signal terms entering the aggregate as if
diversifiable) a measured ρ to widen against instead of a user-set prior.

**Proposal:** derive a data-driven ρ̂ from the depth fit's period premiums — the share of
cross-desk residual variance the common period effect explains — shrunk toward the user's prior
with its own κ, and shown on the aggregate card as a measured number with its n. Where no
placements exist the user's ρ still governs, exactly as today. This is the single largest honest
improvement available to the headline instrument, and the fit is already running.

---

## 21 · Sequencing for Part II

Ordered so that each step's effect is measurable before the next one lands. Steps marked ⚠ move
`npm run gate` or `§21` and take their own commit with before/after CRPS per §26.

1. **§11.1 — build `eval/oracle.ts`.** Nothing else in Part II or Part I can be honestly gated
   until the gate scores the shipped forecast. This is the prerequisite for Part I §1.
2. **§11.2 — truncate the scoring.** ⚠ Coverage/PIT/IS90 start describing the displayed interval.
3. **§18.1, §18.3, §18.5 — memoise.** Pure speed, zero output movement; makes every later gate
   run fast enough to iterate on.
4. **§13.1, §13.2, §13.3 — stale derived fields.** No gate movement; fixes a false derivation
   card and a false rating transition. Land before the bibliography work in Part I §5, which
   otherwise documents an equation that does not hold.
5. **§17.1, §17.2 — one engine for the history and the board.** ⚠ Moves the composite delta.
6. **§10.1 → §10.6 — the scale/sd family**, one commit each, in that order. ⚠ Each moves the
   gate; §10.2 requires re-sweeping `ENSEMBLE_DISPERSION` in the same commit.
7. **§14.2 → §14.6 — the detrend/bridge family.** ⚠
8. **§15 C1 — the slope cliff**, alongside Part I's M6, so the two land as one doctrine.
9. **§16 — depth**, self-contained, no gate movement (depth does not enter the price).
10. **§12.4, §12.5, §12.6, §12.7, §12.8, §12.9 — channel consistency.** After Part I §1, since
    §1 rewrites the estimator these all call.
11. **§12.1, §12.2 — the joint channel budget.** Last, and the largest. It is a design change,
    not a defect fix, and it should be re-specced once §1 has landed and the per-channel
    objectives exist.
12. **§20 — measured ρ̂**, and **§18.4, §18.6, §18.7 — the App-level data flow.** Independent of
    everything above; can run in parallel.

**Not in scope for Part II:** the `derive.book.test.ts` LaTeX timeout (already noted in Part I
§9); any change to the lineage rules, the calendar, or the wire's intake schema, none of which
this audit found a defect in.
