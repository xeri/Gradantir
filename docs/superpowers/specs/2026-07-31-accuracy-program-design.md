# The accuracy program — evaluation power, hierarchical reconciliation, difficulty, calibration, and the wire's forward surface

**Date:** 2026-07-31
**Branch:** `life-signals`
**Status:** design, awaiting approval

---

## 0 · Why, and what this is not

The question that started this: *would TensorFlow.js, ml.js or danfo.js help, and what else would make
the prediction as accurate as it can possibly get?*

§1 answers the first half (no, and the reason is structural, not a matter of taste). The rest is the
second half: every route to a lower walk-forward CRPS that this book can actually support, ordered by
what has to be true before the next one can be judged.

**Scope boundary.** The companion spec `2026-07-31-prediction-math-audit-design.md` covers the
*credibility layer* — `earned.ts`, per-channel weights, Shapley, the signals-layer defects, the
bibliography — and explicitly declares §1–§11 core estimation out of scope. This spec is the exact
complement: it touches core estimation, the evaluation harness, and the wire's schema, and it touches
nothing in the credibility layer. The two share one dependency: the audit spec's `quant/fit.ts`
(golden-section minimiser) is reused here rather than duplicated, so whichever audit commit delivers
`fit.ts` should land before this spec's step 5.

**One finding reorders the whole list.** `eval/__snapshots__/baseline.json` records:

```
"n": 56, "perSubjectSkill": 0.26, "cover90": 0.82,
"meanMae": 6.03, "meanNaiveMae": 4.82
```

The all-subject mean — the object README §26 calls "the far-more-forecastable" one, and the object §28
and the COMPOSITE are both built on — is forecast **worse than a last-round-carry-forward naive**, by
25%. Skill on that target is roughly $-0.25$. No test catches this: `eval.book.test.ts:57-59` asserts
only `mean.mae < book.mae` and `mean.naiveMae < book.mae`, both of which hold while the engine loses
to the naive. §5 is the fix and it is the highest-expected-value item in the document.

---

## 1 · Off-the-shelf ML libraries: eliminated

### 1.1 The arithmetic

The committed fixture is 10 subjects, 66 prints, 56 scored walk-forward folds. A live book is smaller.
README §1 opens by listing $n \approx 5\text{–}12$ prints per subject as the first property that breaks
standard machinery, and every design constraint that follows — degrade to a prior at $n=1$, gate the
slope, medians not means — is an answer to it.

A neural network is a function approximator with $O(10^3)$–$O(10^6)$ parameters fitted by SGD. At
$n = 56$ it does not estimate; it memorises. There is no regularisation schedule that recovers this,
because the problem is not variance in the fit — it is that the hypothesis class is unbounded relative
to the evidence.

### 1.2 The architectural blocker, which is worse than the arithmetic

README §1's fifth design constraint: *every point of discount must be attributable.* §24 builds an
entire derivation layer around it — every model-generated figure on the board opens a research note
carrying the equation, the same equation with that desk's live values substituted, and (per the audit
spec's §5) a citation.

A fitted network has no equation to typeset and no substitution to show. Adopting one would not degrade
the derivation layer; it would delete it for whatever the network produces. That is a larger loss than
any plausible CRPS gain, and at this $n$ the plausible CRPS gain is negative.

### 1.3 Per library

| library | verdict | reason |
|---|---|---|
| **TensorFlow.js** | eliminated | §1.1 and §1.2. Also ~1 MB+ of WASM/WebGL backend in a local-first app whose entire dependency list is React, Recharts, KaTeX and two fonts. |
| **danfo.js** | eliminated | It depends on `@tensorflow/tfjs` — adopting it imports §1.1 as a transitive dependency to gain dataframe wrangling over data that already lives in typed structures (`types.ts`) with deterministic tests. |
| **ml.js** | eliminated | KNN, random forest and SVM at $n = 8$ are noise generators. The parts that are defensible (matrix solve, cross-validation splits) already exist: `depth.ts:224` has its own `solve`, `backtest.ts` has the walk-forward split, `stats.ts` has the estimators. |

### 1.4 What a fitted model *would* earn, and why it still needs no library

Two additions in this document are genuinely "fitted models"; both are ~150 lines of the project's own
numerics and neither is available in the libraries above:

- **A Gaussian-process ensemble member** (§9, deferred) with a Matérn-3/2 kernel. It handles the
  irregular spacing README §1 lists as a breaking property *natively*, in closed form, with an exact
  predictive distribution and a derivable equation. `ml.js` has no usable GP.
- **A 1-D golden-section minimiser** for CRPS parameter sweeps — already specified as `quant/fit.ts`
  in the companion audit spec. Reuse it; do not add an optimisation dependency.

**No new runtime dependency is proposed anywhere in this spec.**

---

## 2 · The precondition: the gate cannot currently distinguish better from luckier

Everything downstream is decided by `npm run gate`. If the gate is noise, every subsequent section is
unfalsifiable and the whole program is theatre. This section is therefore the longest, and nothing else
in the ordering may precede it.

### 2.1 The evidence

**The gate is a two-line inequality against a scalar snapshot** (`eval.book.test.ts:69-73`):

```ts
expect(sb.book.skill).toBeGreaterThan(baseline.perSubjectSkill - 0.03);
expect(sb.book.cover90).toBeGreaterThan(baseline.cover90 - 0.05);
```

Three problems, each independently sufficient.

**(a) It is one-sided with a free allowance.** A change that degrades skill from 0.26 to 0.24 ships
green. Nothing records that it degraded. README §26 step 3 says "walk-forward CRPS must not regress" —
the test as written permits a 0.03 regression per commit, and a phase is "a sequence of these commits",
so a five-commit phase can lose 0.15 of skill with every gate green.

**(b) It has no notion of sampling error.** With $n = 56$ folds clustered in 10 subjects, the standard
error on mean CRPS is not small. The gate does not compute it, so a 0.02 improvement and a 0.02
degradation are treated as facts of equal standing when both are almost certainly noise.

**(c) The snapshot cannot support a paired test even if one were written.** `baseline.json` stores
seven aggregate scalars. A paired comparison needs the *per-fold* scores of the baseline model, and they
are not persisted. Today the only possible comparison is unpaired aggregate-vs-aggregate, which throws
away the variance reduction that makes small-$n$ model comparison viable at all.

The same defect appears in the ablation: `ablation.ts:27` sets `EPS = 0.02` with the comment
"smaller swings are noise" — a hard-coded guess at the noise floor, applied uniformly to every member
and every premium, never measured.

### 2.2 The fix: a paired, clustered, two-sided verdict

**Persist per-fold scores.** Extend the snapshot to carry the baseline's per-fold vector:

```jsonc
{
  "modelVersion": "gx-1",
  "aggregate": { "n": 56, "perSubjectSkill": 0.26, "cover90": 0.82, ... },
  "folds": [
    { "k": "s-math|2026-05-14", "crps": 5.41, "crpsNaive": 7.02, "pit": 0.63 },
    ...
  ]
}
```

Keyed by `subjectId|targetDate` — the same deterministic composite discipline the register uses
(README §26). Folds present in one run and not the other are reported and excluded from the paired
statistic, never silently dropped.

**Pair on the fold key.** For each shared fold $i$, $d_i = \text{CRPS}^{\text{new}}_i -
\text{CRPS}^{\text{base}}_i$. The estimand is $\bar d$; negative is an improvement.

**Bootstrap by subject, not by fold.** Folds within a subject share a tape, a pool and an ability path;
they are not independent. Resample the $S$ subjects with replacement, recompute $\bar d$ over the
resampled clusters, repeat $B = 2000$ times, take the 5th and 95th percentiles.

With $S \le 10$ (only subjects that produced folds count) the cluster bootstrap is coarse — an effective
resolution of about one subject in ten. **State this in the harness output rather than hiding it**: report $S$, the
number of folds, and the width of the interval, so a reader can see how weak the evidence is. A gate
that reports "cannot distinguish" is doing its job; a gate that reports a false verdict confidently is
worse than the one we have.

**Three-way verdict**, replacing the one-sided inequality:

| condition | verdict | action |
|---|---|---|
| 90% CI of $\bar d$ entirely $< 0$ | `IMPROVED` | ship; regenerate the baseline in the same commit |
| CI straddles 0 | `INDISTINGUISHABLE` | ship only on a non-CRPS argument (honesty, simplicity, a fixed defect), recorded as such in the commit message |
| CI entirely $> 0$ | `REGRESSED` | revert |

The `INDISTINGUISHABLE` verdict is not a loophole — it is the honest state of most changes at this $n$,
and forcing the commit message to name the non-CRPS reason is exactly the discipline README §26 already
applies to hand-set constants.

**Report the minimum detectable effect.** From the observed per-cluster sd of $d$, compute and print the
$\Delta\text{CRPS}$ this book could detect at 80% power. This single number answers "how much can this
engine even be improved, measurably, on the evidence available" and belongs in README §26 beside the
skill figure. Expect it to be uncomfortably large. That is information, not a defeat.

### 2.3 Failure modes of the fix itself

- **Multiple comparisons.** Running the gate on every candidate change and shipping the ones that pass
  is a selection process that will manufacture false improvements at the nominal rate. Mitigation: the
  hypothesis is stated *before* the run (README §26 step 1 already requires this); the commit message
  records both the hypothesis and the verdict, including for reverted attempts, so the denominator is
  visible.
- **Baseline drift.** Every regeneration of `baseline.json` resets the comparison point. A sequence of
  `INDISTINGUISHABLE` steps can walk downhill. Mitigation: keep an append-only `history.json` of
  aggregate scalars per baseline regeneration, and assert in the gate that current skill has not fallen
  more than 0.05 below the *best* historical value, not merely the previous one.
- **The fixture is one book.** Every number here is a property of ten synthetic subjects. §3 is the
  answer.

### 2.4 A synthetic book generator, and what it may and may not decide

`eval/synth.ts`: generate books from a known process.

```
ability      a_s(t)  = random walk, variance Q_true per day
difficulty   d_p     ~ N(0, τ²) per paper, shared across subjects sitting in the same term
observation  y       = clip_[0,100]( a_s(t) + d_p + ε ),   ε ~ N(0, R_type²)
cohort       classAvg / yearAvg / rank generated from the same latent cohort
calendar     irregular dates drawn from a real SchoolCalendar
```

Seeded PRNG (splitmix64, ~15 lines) — `Math.random` is unavailable in this codebase's deterministic
test discipline and must stay that way.

**Two legitimate uses.**

1. **Power.** 200 generated books give a real sampling distribution for any estimator comparison. This
   is the only way to answer "is member X better than member Y" with authority, because the real book
   cannot.
2. **Correctness.** An estimator that cannot recover $Q_{\text{true}}$, or whose nominal 90% intervals
   do not cover 90% *on data drawn from its own assumptions*, has a bug. This catches implementation
   errors that a CRPS number silently absorbs.

**One illegitimate use, stated as a rule.** Constants must not be tuned on synthetic data, because
synthetic data is generated from the model's own assumptions and tuning against it optimises the
assumptions rather than the world. Synthetic decides *structure* and finds *bugs*; the real book, via
§2.2, decides *shipping*. This rule goes in the module header and in README §26.

---

## 3 · Calibration: conformal width, and the three-owner problem

### 3.1 The evidence

Realized 90% coverage is 0.82 against a nominal 0.90 (`baseline.json`), and the engine knows it — the
test at `eval.book.test.ts:46-52` asserts under-coverage as a *documented property*.

The current remedy is a hand-swept constant: `params.ts:130`, `ENSEMBLE_DISPERSION = 1.15`, applied at
`ensemble.ts:251` as `sd = Math.sqrt(variance) * ENSEMBLE_DISPERSION`. Its docstring is honest about
what it is — a factor swept against walk-forward CRPS, bottoming across a flat 1.1–1.3 basin.

**Three separate mechanisms currently scale the same predictive sd:**

| owner | file | scope | how set |
|---|---|---|---|
| `ENSEMBLE_DISPERSION` | `params.ts:130` → `ensemble.ts:251` | every forecast | hand-swept constant |
| `BiasModel.widthScale` | `biascal.ts:56-58` → `biascal.ts:72` | post-process on `computeStats` | fitted: rms of standardized register errors, shrunk toward 1 |
| `sdMult` (traits) | `signals/traits.ts` | signal-weighted desks | hand-set trait coefficients |

The first two estimate nearly the same quantity from nearly the same data and multiply. On a book with
a populated register they compound: a 1.15 constant on top of a fitted rms that already measured the
same under-dispersion. Nothing tests that they do not double-count.

### 3.2 The fix

**Normalized split conformal, pooled across subjects, fitted per target.**

Nonconformity on the walk-forward folds the backtest already produces:

$$s_i \;=\; \frac{|y_i - \hat\mu_i|}{\hat\sigma_i}$$

and the calibrated multiplier is the $\lceil (n+1)(1-\alpha)\rceil$-th smallest of the $n$ scores.

Under exchangeability this gives finite-sample coverage $\ge 1-\alpha$ with **no asymptotics and no
distributional assumption** — which is precisely why it belongs in an engine whose first design
constraint is small $n$.

**Pooling is what makes it work here.** The score is one-sided (an absolute deviation), so the
$\lceil (n+1)(1-\alpha)\rceil$-th order statistic exists only when $n \ge 9$ at $\alpha = 0.1$; below
that the quantile is undefined and the method degenerates to "widen without bound". Per-subject
$n \approx 6$ is under the floor. Pooling the *standardized* scores across all subjects clears it, and
is the same empirical-Bayes move `shrinkage.ts` already makes for the level — stated as such in the
derivation card rather than left as an implementation convenience.

**Keeping the Student-t family.** `scoring.ts` scores a location-scale $t$ in closed form and the whole
derivation layer quotes it. Conformal produces a width, not a family. Resolution: calibrate the *scale*
so the 90% interval width matches the conformal width —

$$\sigma_{\text{cal}} \;=\; \hat\sigma \cdot \frac{k_{0.90}}{t_{0.95,\,\nu}}$$

— which is exact at the 90% level and approximate elsewhere. The realized 50% coverage becomes a
reported diagnostic rather than a second target. This is a deliberate trade: one exactly-calibrated
level and a preserved closed form, over two approximately-calibrated levels and a lost one.

**Retire two of the three owners.** `ENSEMBLE_DISPERSION` goes to 1.0 and is deleted;
`BiasModel.widthScale` is replaced by the conformal multiplier fitted on the *register* target
(next-exam), while the ensemble's multiplier is fitted on the *one-step-ahead print* target. Different
targets, different score sets, one owner each, no compounding. `biascal.ts` keeps the offset — that part
is a different estimand and is not touched.

### 3.3 Risks

- **Exchangeability fails for time series.** Ability drifts; that is the entire premise of the Kalman.
  Split conformal's guarantee is therefore approximate here. Mitigation: the backtest *measures*
  realized coverage, so the assumption's failure is observable rather than assumed away. If measured
  coverage still misses, adaptive conformal inference (an online update to $\alpha$) is the documented
  next step — but do not ship it speculatively.
- **`widthScale` is currently shrunk toward 1 by `BIAS_KAPPA_WIDTH = 4`** (`params.ts:21`). The
  conformal quantile has no natural shrinkage. Apply the same pseudo-observation shrinkage toward 1 so a
  four-fold register does not swing the band, and document that the finite-sample guarantee is thereby
  traded for stability — an honest, deliberate weakening, not an oversight.

---

## 4 · The stacking objective does not match the gate

### 4.1 The evidence

`ensemble.ts:207`:

```ts
weights[name] = 1 / (sse[name] / cnt[name] + MSE_REGULARIZER);
```

with `MSE_REGULARIZER = 4` pts² (`ensemble.ts:55`). Weights are fitted by **inverse mean squared error
of the point forecast**. README §26 states in its own heading that the objective is CRPS and "MAE is
reported but is never the gate: it rewards overconfidence, and calibration is the deliverable."

The stacking step therefore optimises the one thing the document says is not the objective. A member
that is accurate on average but wildly over-confident is rewarded; a member that is slightly less
accurate but honest about its own uncertainty is penalised. The mixture then inherits that choice at
`ensemble.ts:246`, where each member's own $\hat\sigma_m$ enters the blended variance — so the member
sds *do* reach the published band, but never the weights that select between them.

### 4.2 The fix

Every member already emits `{mean, sd}` (`MemberPred`, `ensemble.ts:25-29`), and `scoreT` already scores
a location-scale $t$. Score each member's *predictive* on the common fold set and weight by

$$w_m \;\propto\; \frac{1}{\overline{\text{CRPS}}_m + \varepsilon_c}, \qquad \varepsilon_c \approx 2\ \text{pts}$$

with $\varepsilon_c$ in **points**, not points², because CRPS is in the units of the observation. The
existing 4 pts² regulariser does not transfer and must be re-swept.

**Honesty about what this is.** Inverse-MSE weighting has a precision-weighting justification under
Gaussian errors. Inverse-CRPS weighting has no such derivation — it is a heuristic that at least points
at the objective. The principled version minimises the mixture's own CRPS over the weight simplex, and
with 4 members over $\le 8$ folds (`LOO_WINDOW = 8`, `params.ts:117`) that will overfit. Recommendation:
ship the heuristic, gate it, and record the simplex fit as available future work once `fit.ts` exists
and §2.4's synthetic harness can measure whether the overfitting is real.

Both the fold-set fairness fix (`ensemble.ts:191`, common folds only) and the ablation seam
(`ensemble.ts:139-145`) are untouched.

---

## 5 · The aggregate is forecast worse than its own naive

### 5.1 The evidence

`baseline.json`: `meanMae 6.03`, `meanNaiveMae 4.82`. The naive is the previous round's realized mean
(`skill.ts:39, 60`). The engine's aggregate forecast is the arithmetic mean of independently produced
per-subject forecasts (`skill.ts:55`, `aggregate.ts:138`).

This is the classic bottom-up failure in hierarchical forecasting: independently-produced component
forecasts do not reconcile, and their errors — which are correlated in the same direction, because a
hard term is hard everywhere — accumulate in the sum rather than cancelling. The engine already knows
the correlation exists: `depth.ts:26` fits `premium[period]`, a common per-term shift, precisely because
one exists.

The consequence is not confined to a diagnostic number. README §28's aggregate pool asks the student to
call the book average and scores them against the desk. The desk is currently worse on that target than
carrying last round forward. §17's COMPOSITE and §16's aggregation inherit it.

### 5.2 The fix: a top-down member and explicit reconciliation

**Add a top-down forecast of the aggregate.** Treat the book mean $m_t$ over exam rounds as its own
series and run the same machinery on it — Kalman local-level plus shrunk mean, the two members that
survive at $n \approx 5$ rounds. This is a *different estimator of the same quantity* as the bottom-up
sum, which is exactly the structure `oracle.ts` already uses for the exam/coursework bridge and the
structure §8 uses for the ensemble mixture.

**Reconcile.** Blend top-down $\hat m^{\text{td}}$ and bottom-up $\hat m^{\text{bu}}$ by inverse
walk-forward CRPS, moment-matched as a mixture so disagreement widens the aggregate band. Then rescale
the per-subject forecasts to sum to the reconciled total:

$$\hat y_s^{\,\text{rec}} \;=\; \hat y_s \;+\; \big(\hat m^{\text{rec}} - \hat m^{\text{bu}}\big)$$

An additive (not proportional) reconciliation, so a desk near the ceiling is not scaled through it, and
so the adjustment is in points and therefore attributable in the §24 waterfall as a named line.

**Gate it on its own metric.** The current gate scores per-subject CRPS only; a change that improves the
aggregate and leaves per-subject flat currently reads as `INDISTINGUISHABLE`. Add to the scoreboard and
the snapshot:

- aggregate CRPS and aggregate skill against the local-level naive;
- realized coverage of the aggregate 90% band.

Without this metric §5 and §6 are both unfalsifiable.

### 5.3 Risk

Reconciliation can *worsen* per-subject scores while improving the aggregate — the two targets genuinely
trade off, and the optimal trade is not ours to assert. Report both, gate both separately, and if they
conflict, take it to the user rather than picking silently. This is the one place in the document where
a change may legitimately regress a gated number.

---

## 6 · Difficulty detrending throws away the class-strength fit it already computes

### 6.1 The evidence

The committed fixture, profiled:

| field | count of 66 entries |
|---|---|
| `yearAvg` | 42 |
| `rank` + `cohortN` | 42 |
| `classAvg` | **0** |
| `cohortSD` | 0 |
| `difficulty` | 0 |
| `reliability` | 0 |
| `censored` | 0 |

`detrend` (`calibration.ts:59-70`) uses `entry.classAvg ?? entry.yearAvg`. With no class averages on the
book, every correction on the fixture runs off the **year-level** mean, and the remaining 24 prints get
`difficultyAdj(null) = 0` — nothing at all.

Meanwhile `fitDepth` (`depth.ts:170-233`) fits, on those same 42 prints,

$$\text{score} - \text{yearAvg} \;=\; \underbrace{\text{premium}[\text{period}]}_{\text{class strength this term}} \;+\; \underbrace{\text{basis}[\text{desk}]}_{\text{this desk's own offset}} \;+\; \sigma_{\text{class}}\cdot z(\text{rank}) \;+\; \varepsilon$$

`premium[period]` **is** the class-and-term-specific difficulty signal that detrending wants, estimated
by pooling across ten desks, ridge-identified (`DEPTH_BASIS_SHRINK`, `depth.ts:222`), and already
exposed as a tape (`peerPremiumTape`, `depth.ts:403-408`). It reaches the order book and the premium
schedule. It never reaches the tape the ensemble fits.

So the engine currently detrends against a year mean while holding a better, term-local estimate of the
same thing in another module.

### 6.2 The fix

Detrend against $\text{yearAvg} + \text{premium}[\text{period}]$ where the depth model has fitted, and
against $\text{premium}[\text{period}]$ alone on prints that carry a rank but no year average.
Everything else in `detrend` — $\lambda = m/(m+2)$, the reference mean, the difficulty-tag fallback —
is unchanged.

### 6.3 The rejected alternative, and the algebra that kills it

The obvious move is to impute the missing class average from the rank:
$\widehat{\text{classAvg}}_i = y_i - \sigma_{\text{class}} z_i$. It is circular, and the circularity is
not subtle. Substituting into the detrend equation:

$$
\tilde y_i \;=\; y_i - \lambda\big(\hat r_i - \bar{\hat r}\big)
\;=\; y_i - \lambda\big(y_i - \bar y - \sigma(z_i - \bar z)\big)
\;=\; (1-\lambda)\,y_i \;+\; \lambda\bar y \;+\; \lambda\sigma\,(z_i - \bar z)
$$

As $\lambda \to 1$ (which is where $\lambda = m/(m+2)$ goes with 42 references) the adjusted tape becomes
$\bar y + \sigma(z_i - \bar z)$ — **the score series is replaced by the rank series**, and the level
information is gone. That is not difficulty detrending; it is a silent change of observable, and it would
pass the gate on any book where rank happens to track score.

The `premium[period]` route avoids this because the premium is estimated across all ten desks, so any one
print contributes $\approx 1/10$ of the correction applied to it, and the ridge penalty explicitly
attributes common shifts to the period rather than to the desk (`depth.ts:221` comment).

### 6.4 The leakage hazard, which is the real cost

`backtest.ts:96` rebuilds the cross-subject pool as-of every fold, specifically so nothing leaks. A
depth-derived correction must get the same treatment: **`fitDepth` must be refit on strictly-earlier
entries at every fold**, or the detrended tape carries information from results that had not happened.

This is not free. `fitDepth` solves a $(G + S + 1)$-square system per call; at 56 folds that is 56 solves
per backtest, and the backtest already runs inside `ablatePremia`'s reprice loop. Expect the gate's
runtime to rise materially. Mitigations, in order of preference:

1. Memoise by cutoff date — `ablation.ts:88` already uses exactly this pattern (`priceByCutoff`), and
   folds share cutoffs across subjects.
2. If still too slow, cache the fit keyed on the sorted set of entry ids seen so far.

Do **not** mitigate by fitting depth once on the full book. That is the leak.

### 6.5 Why this is ranked high

It is the only item in this document that adds a genuinely better *input* to the estimator using data
already on the book, on 42 of 66 fixture prints, with no new user data entry and no new dependency.
README §2's difficulty-detrending claim currently operates at its weakest available setting on the book
§21 reports.

---

## 7 · Cross-subject correlation: estimate $\rho$ instead of hand-setting it to zero

### 7.1 The evidence

`aggregate.ts:53-57` already implements the correlated sum:

$$\operatorname{Var}\Big(\sum_s \hat y_s\Big) \;=\; (1-\rho)\sum_s \sigma_s^2 \;+\; \rho\Big(\sum_s \sigma_s\Big)^2$$

and `aggregate.ts:134` defaults `rho = 0` — exact quadrature. The docstring and README §23 both give the
same reason: *"one student's book cannot identify a cross-subject covariance (no second student to
separate 'a hard term' from 'a bad term')"*.

**That objection is about attribution, and the aggregate band does not need attribution.** Whether a
common shock is the cohort's or the student's changes what the *depth model* should say; it does not
change the variance of the sum. What the band needs is the correlation of the *forecast errors*, and
after §2.2 the replayed register (`eval/replay.ts`) yields exactly that: per-round, per-subject
standardized errors $u_{s,t} = e_{s,t}/\sigma_{s,t}$.

### 7.2 The fix

$$\hat\rho \;=\; \operatorname*{mean}_{t}\left[\frac{\big(\sum_s u_{s,t}\big)^2 - \sum_s u_{s,t}^2}{S_t(S_t-1)}\right],
\qquad \rho \;=\; \operatorname{clip}_{[0,\,0.6]}\Big(\operatorname{shrinkToward}(\hat\rho,\ T,\ 0,\ \kappa_\rho = 4)\Big)$$

with $T$ = number of replayed rounds and a floor of $T \ge 3$ before any value is fitted. Shrunk toward
zero, so a thin book keeps today's behaviour byte-identical and the setting stays a user override.

Cross-check available for free: `depth.ts`'s fitted `premium[period]` is a partly independent read on the
same common component. If $\hat\rho$ is materially positive while the premium tape is flat, one of the two
is wrong and the derivation card should say so rather than reporting both.

### 7.3 Dependency

Unfalsifiable without §5.2's aggregate-band coverage metric — a widened band cannot be scored by a gate
that only reads per-subject CRPS. §5 must land first.

---

## 8 · Paper-specific conditioning: the missing foreign key

### 8.1 The evidence

`types.ts:324-348` — `Upcoming` carries `weight`, `syllabusCoverage`, `selfPred`, `teacherPred`, `chips`,
`aiPred`, `hour`. It carries **no topic reference**.

`mastery.ts:177-191` therefore weights every topic by its share of the *whole subject's* syllabus and
predicts "a paper" — the generic next sitting. `masteryRead` is described in its own header as the one
measured signal in the life-signals layer, and it cannot be told which topics the actual upcoming paper
covers.

So the engine can answer "how good is this student at Mathematics" but not "how good is this student at
the Mathematics this particular paper asks about", even though `topics`, `topicMarks`, `prereqIds`,
`weightPct` and per-topic decayed mastery all already exist.

### 8.2 The fix

Add `Upcoming.topicIds?: string[] | null` — same-subject filtering and a dropped self-reference, exactly
the contract `Topic.prereqIds` already uses (`schema.ts:307-311`). `masteryRead` takes an optional topic
subset; when present, weights renormalise over that subset only; when absent, behaviour is byte-identical
to today.

This is the largest real-world accuracy item in the document per unit of implementation risk, because it
changes *what question is being answered* rather than how well an estimator answers it. It is also
gate-neutral: the fixture carries zero `upcoming` rows and zero `topics`.

### 8.3 Wire consequence

`UPCOMING_FIELDS` (`schema.ts:229-266`) gains one entry, and the `satisfies Record<keyof Upcoming,
FieldSpec>` lock makes the prompt update mandatory rather than optional. The hint should name the real
sources: exam notices, course outlines, "the exam covers Units 3 and 4".

---

## 9 · The wire's forward surface

Everything here is gate-neutral by construction (the fixture carries none of these fields), so this track
can run in parallel with §§2–8 at any point.

The wire already extracts more than the original question assumed: `topicMarks` with `maxMarks` and
`errorKind` (`schema.ts:314-341`), the reliability ladder, `cohortSD`, `regimeBreak`, `traits`/`mix`,
sessions, rest, disruptions. Per-question mark extraction and teacher-comment diagnosis are **already
specified**. What follows is what is genuinely absent.

### 9.1 `Upcoming.topicIds`

Per §8. Highest priority of this section — it is the input the mastery channel is missing.

### 9.2 `Settings.gradeScale` — band cutoffs

An ordered list `{label, minPct}` (e.g. NCEA `N/A/M/E`, or A*–E). Three things it unlocks:

- reporting a **grade** distribution rather than a percentage band, which is what a student actually
  cares about and what a decision is made on;
- a target for the boundary-aware work in §10;
- the `chips` bands (`types.ts:343`, currently the fixed `[<50, 50s, 60s, 70s, 80s, 90+]`) becoming the
  book's real bands, so elicitation is scored on the scale the student thinks in.

### 9.3 `Entry.rawMarks {earned, available}`

`TopicMark.maxMarks` exists; the paper's own raw total does not. It matters twice: 43/60 and 71.7% carry
different granularity, and the raw denominator identifies the discreteness that a continuous likelihood
smooths over. `ENTRY_FIELDS.score` (`schema.ts:151-155`) already instructs the AI to convert
fractions — this asks it to keep both.

### 9.4 `aiPred.factors[]` — the AI's reasoning, made attributable

Today `aiPred` is `{point, lo, hi, basis}` (`schema.ts:222-227`) — one opaque number and 160 characters of
prose. Extend to a **closed registry** of factor keys with signed point deltas and evidence:

```jsonc
"factors": [
  { "key": "syllabusChange", "delta": -2.0, "evidence": "Unit 4 replaced with a new standard for 2026" },
  { "key": "teacherChange",  "delta": -1.5, "evidence": "report notes a new teacher from Term 2" }
]
```

Registry locked in `schema.ts` on the same `satisfies` discipline as every other field, so the AI cannot
invent a factor. Three payoffs: the wire's call becomes attributable in §24's derivation layer instead of
an unfalsifiable number; the deltas can be scored *individually* over time, so a factor the AI is
systematically wrong about can lose its own seat; and README §1's fifth constraint stops having an
exception.

### 9.5 `aiPred.bands[]` — a distribution instead of an interval

Reuse the `chips` shape. Language models state categorical distributions more honestly than they state
90% intervals, the proper scoring machinery for bands already exists, and it puts the AI and the student
on the same scale for the scorecard's `AI ERROR` comparison.

### 9.6 A wire panel

Allow `aiPanel[]` — several independent AI replies, each with a `source` label — pooled by the existing
moment match. Disagreement between outside desks widens the band with no new mathematics
(`aipool.ts` + `POOL_CEIL` already handle the seat). Cheap, because the cost is borne by the student
pasting the prompt more than once.

### 9.7 `Entry.cohortDist` — quartiles when a report prints them

Strictly more information than `cohortSD` alone, and reports that print a distribution chart carry it.
Optional, low cost, feeds `anchorSigma` (`depth.ts:75`).

### 9.8 Deliberately excluded from the wire

- **National / standard-level difficulty priors from the AI's own knowledge.** Genuinely tempting — a
  model plausibly knows published grade distributions — and genuinely dangerous, because it is the one
  proposed field with no document behind it and therefore no way for R1 (`prompt.ts:181`, "FACTS ONLY")
  to constrain it. If it is ever added it must be a separate opt-in module, tagged `estimated`, priced
  only through the earned-weight channel, and never allowed to touch the tape. **Not in this spec.**
- **Marker identity, open/closed-book flags, room/seat.** Thin signal, real entry cost.
- **Sentiment scoring of teacher comments.** The extractable content is *claims*, and `topicMarks` +
  `errorKind` already carry them.

---

## 10 · Boundary-aware likelihood — deferred, and why

README §23 names this "the clearest unclaimed improvement in the model", and it remains true. It is
ranked last here for a specific reason, not from disagreement.

### 10.1 Two separable pieces

**(a) Censoring.** `params.ts:73`'s `CENSORED_MULT = 1.5` is explicitly an interim: a censored print
widens its own observation noise (`ensemble.ts:163`) instead of being read as a bound. The proper fix is a
Tobit update in the Kalman — replace the observation with $E[y \mid y \ge c]$ under the current
predictive, a standard truncated-moment calculation of about 30 lines at `kalman.ts:60-65`, beside the
existing Huber branch. Cheap, well-defined, and **exactly the identity on the committed fixture** (zero
censored prints), which also means the gate cannot evaluate it — §2.4's synthetic harness, which can
generate censoring at will, is the only way to test it honestly. That dependency is why it is not first.

**(b) Shape.** Fitting in logit space, $z = \operatorname{logit}\!\big((y+\tfrac12)/101\big)$, with all
four members and the mixture in $z$-space and quantiles mapped back by $\operatorname{expit}$. Quantiles
are transform-equivariant, so intervals map exactly and stop spilling past 100.

### 10.2 The load-bearing hazard in (b)

**Fair value is an expectation, and the aggregate depends on that.** `FV = clip(μ̂)` (README §9), and §23
closes with *"The point estimates are unaffected — expectations add regardless of correlation."* That
sentence is what licenses §16's aggregation and §5's reconciliation.

$\operatorname{expit}(E[z]) \ne E[\operatorname{expit}(z)]$. If the back-transform publishes the median,
fair value silently becomes a median, and **the sum of medians is not the median of the sum** — §16, §17,
§28 and the COMPOSITE all quietly break, with no test failing, because every invariant they assert
(`mark ≤ fv`, waterfall reconciliation, monotonicity) still holds.

The fix is to keep FV an expectation by integrating numerically over the predictive's own quantiles:
$\hat\mu \approx \frac{1}{J}\sum_{j=1}^{J} \operatorname{expit}\big(z_{(j-\frac12)/J}\big)$ with
$J \approx 20$, using the `tQuantile` already in `bayes.ts`. Cheap, deterministic, exact enough.
**This must be an explicit acceptance test, not an implementation note.**

### 10.3 The rest of the blast radius

- Detrending is additive in raw points (`calibration.ts:66`); in $z$-space the reference must be
  transformed too — including §6's `premium[period]`, which is fitted in points.
- The premium waterfall (§15) charges points and applies *after* the back-transform, so `mark.ts` is
  unchanged. Confirm by test rather than by reading.
- Constant sd in $z$-space means shrinking sd in raw points near the boundary — the desired behaviour,
  and it changes what `RELIABILITY_SD` (`params.ts:34-39`) means. Those constants must be re-swept.
- Every derivation builder in `derive/` that quotes the ensemble equations needs new LaTeX and new
  substitutions.
- §21 and `mark.book.test.ts` regenerate.

### 10.4 The recommendation

Land (a) after §2.4 exists. Hold (b) until §3's conformal calibration has been measured: if conformal
plus §5's reconciliation bring realized coverage to 0.90, the *stated* justification for (b) is coverage,
and coverage would then be solved. (b) would still be the more principled model — but "more principled"
is not a gate verdict, and README §26 exists to stop us shipping on aesthetics.

---

## 11 · Implementation order

Gate-neutral work first, then the change the gate was rebuilt to adjudicate, then information, then
shape. Each numbered step is one or more independently gated commits per README §26.

This is a **program, not a single plan**. Each step below gets its own implementation plan and its own
before/after skill figure; nothing here assumes the whole list ships, and any step may be abandoned on
its own verdict without stranding the ones before it.

| # | step | moves the gate? | depends on |
|---|---|---|---|
| 1 | Per-fold snapshot; paired cluster bootstrap; three-way verdict; MDE readout; `history.json` (§2.2–2.3) | no — changes the test, not the model | — |
| 2 | `eval/synth.ts` generator + recovery/power tests (§2.4) | no | 1 |
| 3 | Aggregate CRPS, aggregate skill, aggregate-band coverage added to scoreboard and snapshot (§5.2) | no — new metrics, no model change | 1 |
| 4 | Conformal width; retire `ENSEMBLE_DISPERSION` and `widthScale` into one owner per target (§3) | **yes** | 1, 2 |
| 5 | Stack members on CRPS; re-sweep the regulariser in points (§4) | **yes** | 1, 4, audit spec's `fit.ts` |
| 6 | Top-down aggregate member + additive reconciliation (§5) | **yes** — on the new aggregate metrics and possibly per-subject | 3, 5 |
| 7 | Detrend against `yearAvg + premium[period]`, refit as-of with cutoff memoisation (§6) | **yes**, and expect the largest single move | 1, 2 |
| 8 | Estimate $\rho$ from the replayed register (§7) | aggregate band only | 3, 6 |
| 9 | `Upcoming.topicIds` + paper-specific `masteryRead` + wire field (§8) | no — fixture has no upcoming/topics | — (parallel) |
| 10 | Wire surface: `gradeScale`, `rawMarks`, `aiPred.factors`, `aiPred.bands`, `aiPanel`, `cohortDist` (§9) | no | 9 for the schema pattern |
| 11 | Tobit censored update in the Kalman; retire `CENSORED_MULT` (§10.1a) | identity on the fixture; tested on synthetic | 2 |
| 12 | Logit-space likelihood, only if §4 + §6 leave coverage short (§10.1b) | **yes**, largest blast radius | 4, 6, 11 |

Steps 9–10 have no dependency on 1–8 and should be scheduled in parallel — they are the only items that
add new *user-facing* capability rather than internal accuracy, and they are the ones that make the
per-paper conditioning of §8 usable in practice.

---

## 12 · Architecture

New modules, one purpose each:

| module | purpose | depends on |
|---|---|---|
| `quant/eval/compare.ts` | paired cluster bootstrap, three-way verdict, MDE | `backtest.ts` |
| `quant/eval/synth.ts` | seeded generative book model + recovery harness | `calendar.ts`, `types.ts` |
| `quant/conformal.ts` | pooled normalized nonconformity, calibrated scale multiplier | `scoring.ts`, `shrinkage.ts` |
| `quant/reconcile.ts` | top-down aggregate estimator + additive reconciliation | `ensemble.ts`, `rounds.ts` |
| `quant/crosscorr.ts` | $\hat\rho$ from replayed register residuals | `eval/replay.ts`, `shrinkage.ts` |

Modified: `ensemble.ts` (weights on CRPS; dispersion retired), `calibration.ts` (premium-aware detrend),
`kalman.ts` (Tobit branch), `biascal.ts` (width owner removed, offset kept), `aggregate.ts` ($\rho$
fitted not passed), `signals/mastery.ts` (optional topic subset), `types.ts` + `wire/schema.ts` +
`wire/prompt.ts` (new fields), `eval/index.ts` + snapshot shape.

Purity discipline is unchanged throughout: every read takes `asOf`, no module reads a clock, no
`Math.random` outside `synth.ts`'s seeded generator, and the calculation layer stays pure with "now"
entering only at the `App` edge.

---

## 13 · Testing

- **`compare.ts`** — recovers a known mean difference on synthetic score vectors; the verdict is
  `INDISTINGUISHABLE` when two identical models are compared; `REGRESSED` when a constant penalty is
  added to every fold; clustering by subject widens the interval versus naive fold resampling (the
  property that justifies the cluster bootstrap at all).
- **`synth.ts`** — byte-identical books for a fixed seed; the generating $Q$ is recovered within a stated
  tolerance by the Kalman; nominal 90% intervals cover $\approx 0.90$ on data drawn from the model's own
  assumptions.
- **`conformal.ts`** — empirical coverage on held-out folds hits the target within the finite-sample
  bound; identity (multiplier 1) on an empty score set; shrinkage toward 1 at small $n$.
- **`reconcile.ts`** — per-subject forecasts sum exactly to the reconciled total; additive adjustment
  leaves no desk outside $[0,100]$ after clipping; the aggregate band widens when top-down and bottom-up
  disagree.
- **`crosscorr.ts`** — $\hat\rho = 0$ on an empty or single-round register; recovers a planted
  equicorrelation on synthetic residuals; clipped and shrunk as specified.
- **Detrend (§6)** — a regression test that the depth fit used at fold $i$ contains no entry dated
  $\ge$ the fold's target date. This is the leakage guard and it is the single most important test in
  the document.
- **§10.2** — fair value remains an expectation under the logit transform: the sum of per-desk fair
  values equals the fair value of the sum to a stated tolerance. Written *before* step 12 begins.
- **Wire** — every new field round-trips through the real `parseImport` via the existing golden-example
  test; the `satisfies` locks compile; the fixture stays byte-identical.
- **Gate** — `npm run gate` green after every step, with the three-way verdict and before/after CRPS in
  each commit message per README §26.

---

## 14 · Eliminated, with reasons

| idea | why not |
|---|---|
| TensorFlow.js / danfo.js / ml.js | §1 |
| LSTM / transformer over the grade sequence | $n = 56$ |
| AutoML, genetic or large-scale hyperparameter search | Overfits 56 folds. The CRPS-basin sweep already used for `ENSEMBLE_DISPERSION` is better *and* self-documenting: a flat basin is evidence, a single argmin is not. |
| Reinforcement-learning study scheduler | Not prediction. |
| Sentiment analysis of teacher comments | The extractable content is claims; `topicMarks.errorKind` already carries them. |
| Wearables, biometrics, keystroke telemetry | Privacy cost, marginal signal; `rest.ts` already takes the useful part as a logged input. |
| Asking the AI to self-report its calibration | Unfalsifiable self-report about a self-report. |
| "What if I studied X hours" conditional forecasts | No ground truth; would contaminate a channel that is currently scoreable. |
| Storing the forecast register rather than replaying it | Already rejected and already fixed (README §26). |
| Per-subject conformal quantiles | $n \approx 6$ per subject cannot support a 90% empirical quantile. Pooling is the fix, not a compromise. |
| National grade-distribution priors from AI knowledge | §9.8 — no document behind it, so R1 cannot constrain it. Separate opt-in module if ever. |

---

## 15 · Open questions

1. **Is the grading scale ordinal underneath?** If the real outcome is NCEA `N/A/M/E` per standard and
   the 0–100 score is a derived artifact (`ENTRY_FIELDS.score`'s hint at `schema.ts:154` already
   band-midpoints it), then the faithful likelihood is ordinal and §9.2's `gradeScale` becomes the
   primary model surface rather than a display convenience. This changes §10 more than any other answer
   in this document. **Needs the user's answer before step 9.**
2. **§5.3's trade-off.** If reconciliation improves the aggregate and regresses per-subject, which wins?
   Proposed default: report both, ship nothing until asked.
3. **Will raw marks (§9.3) actually be entered?** If the honest answer is no, drop it — an unused field
   is schema weight and a prompt paragraph for nothing.
4. **Does the user want the MDE printed in README §26?** It is an uncomfortable number and it belongs in
   public, but it is the user's document.

---

## 16 · Out of scope

- Everything in `2026-07-31-prediction-math-audit-design.md`: `earned.ts`, per-channel signal weights,
  Shapley, the M3–M9 signals defects, the bibliography. No overlap.
- The premium schedule (§15), loss aversion (§14), the order book (§17) and the advisor (§20). §23 is
  right that they have no ground truth to fit against; the ablation is the correct instrument for them
  and it already exists.
- Any new runtime dependency.
- UI work beyond what a new field or a new derivation card requires.
