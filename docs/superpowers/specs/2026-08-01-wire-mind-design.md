# The Wire's Mind — Design Spec

**Date:** 2026-08-01
**Status:** design, unimplemented
**Supersedes:** §9.4, §9.5, §9.6 of `2026-07-31-accuracy-program-design.md` (this document replaces those
sketches with worked designs; §9.1–9.3, §9.7, §9.8 stand unchanged)
**Companion:** `2026-07-31-prediction-math-audit-design.md` — coordination in §W12

---

## W0 · Why this document exists, and the two findings that reorder it

The original question was "what else can the AI interpret and parse onto the program". The answer that
survives contact with the code is not *more fields*. It is that the wire currently files **one opaque
number per sitting**, that number is **never recalibrated**, and **nothing in the repository can measure
whether any of it works**.

Two findings, both from the code, set the order of everything that follows.

### W0.1 The wire has no clock

`prompt.ts:216-218` states hard rule R8:

> R8 · ELICITATION DATES. A transcribed call is filed `createdAt` = {today} unless the student produces a
> dated note. Backdating an undocumented call lets hindsight masquerade as foresight.

`Upcoming` (`types.ts:324-348`) has no `createdAt`. Neither does `SelfPrediction` (`types.ts:287-294`) nor
`AiPrediction` (`types.ts:304-313`). `chips` is a bare `number[]`. `sanitizeUpcoming`
(`io.ts:370-388`) stamps nothing.

R8 is therefore **unenforceable for the three sitting-level channels** — `selfPred`, `chips`, `aiPred` —
which are precisely the channels that buy a seat in the forecast. `Duel`, `MeanCall` and `Allocation` all
carry `createdAt` and all three are gated on it; `earnAggregate` even prints the gate as a card line
(`earned.ts:287`, *"a round you called before its first paper"*). The forward calendar has no such gate.

The consequence is concrete. `fitAiWeight` (`aipool.ts:68-83`) iterates resolved sittings and scores every
one carrying an `aiPred`. A student who pastes an AI reply today, for a paper sat last month, whose mark is
already on the tape, earns that AI weight from a call made in hindsight. `fitSelfWeight`
(`pool.ts:92-111`) has the identical hole, and `chips` scoring in `elicit.ts:145-155` has it too.

This is the single most damaging defect on the AI surface, because every other feature in this document is
scored, and a scoring channel that cannot distinguish foresight from memory measures nothing. **W1 is the
fix and everything else depends on it.**

### W0.2 Nothing here is gate-adjudicable

```
$ node -e "const b=require('./src/lib/__fixtures__/book.json'); console.log((b.upcoming||[]).length)"
0
```

The committed fixture has **no forward calendar at all**: zero sittings, and therefore zero `selfPred`,
zero `chips`, zero `teacherPred`, zero `aiPred`, zero `meanCalls`, zero `duels`, zero `topics`.

The book-level tests do not close this. `meanpool.book.test.ts:29-32` builds its `MeanCall` objects in the
test file; `signals.book.test.ts:38` is the only book test that reads `upcoming` at all, and it reads an
empty array. So there is no committed end-to-end record of a filed call travelling import → sanitize →
resolve → score → weight → pool → card. The unit tests (`aipool.test.ts`, `pool.test.ts`, `elicit.test.ts`)
prove each hop; nothing proves the chain.

Combined with the accuracy spec's §2 finding — that the gate cannot separate better from luckier on 56
folds — the position is: **`npm run gate` is neutral on every feature in this document, in both
directions.** It will not catch a regression here and it cannot certify an improvement. That is not a
reason to skip the gate; it is a reason to build the missing instrument first (§W2) and to be honest on
every card about what has and has not been measured.

---

## W1 · The filing clock — the prerequisite

**Value:** none directly. **Cost:** small. **Blocks:** every scored feature below.

### W1.1 Shape

One nested object on `Upcoming`, rather than a `filedAt` on each of three differently-shaped payloads:

```ts
/**
 * When each elicitation on this sitting was filed. Stamped by the app at the
 * moment of entry or import — never read from a wire payload for `ai`, because
 * the wire has no document behind its own filing date and every other field it
 * writes is required to have one (R1).
 */
export interface FiledAt {
  /** The student's own call. A dated note may back-date it; today otherwise. */
  self?: string | null;
  /** The staked chip distribution. */
  chips?: string | null;
  /** The wire's call. Importer-stamped, always. */
  ai?: string | null;
}
```

`Upcoming.filed?: FiledAt | null`. `SelfPrediction`, `AiPrediction` and `chips` keep their current shapes,
so `selfPredictive`/`aiPredictive` (`pool.ts:71-77`, `aipool.ts:50-52`) and every moment-match below them
are untouched.

Adding the field forces a `UPCOMING_FIELDS` entry by the `satisfies Record<keyof Upcoming, FieldSpec>` lock
(`schema.ts:266`) — the registry compiles or the prompt is wrong. That lock is doing exactly its job here.

### W1.2 The stamping rules, which are the whole design

| channel | source of the date | rule |
| --- | --- | --- |
| `filed.ai` | the importer's `today` | **never** read from the payload. Not negotiable — see W1.3. |
| `filed.self` | payload `createdAt` if present, else `today` | clamped to ≤ `today`; a future date is corrupt input |
| `filed.chips` | same as `self` | same |

**First filing wins.** On merge, if the stored row already has `filed.X` and the incoming row carries the
same channel, keep the stored date. A re-paste is a re-transmission, not a re-forecast. Without this rule
the idempotency property that `id` conventions buy (`schema.ts:232`) would silently reset the clock on
every paste, which is worse than having no clock, because it would look like it worked.

**Changing a call re-files it.** If the incoming `aiPred.point` differs from the stored one, the stamp is
refreshed to today — it is a new opinion. Byte-identical payload ⇒ stamp preserved. Implement as a
structural compare of the sanitized object, not a reference compare.

### W1.3 Why the wire may not state its own filing date

Every other field the AI writes is constrained by R1 (`prompt.ts:181`, "FACTS ONLY"): it is printed in a
document or stated by the student. A filing date for the AI's own forecast has no document behind it and no
student behind it. It is the one value the AI could assert that no rule can check, and it is the value that
determines whether its record counts. Reading it from the payload would hand the scored party control of
the scoring gate. The app knows when the paste happened; that is the earliest moment it can attest to, and
attestable-and-slightly-late beats unverifiable.

### W1.4 The scoring gate

A channel scores on a resolved sitting **only if `filed < sitting.date`** — strictly before the paper, not
before the mark landing. A call filed on the morning of the exam is still a forecast; a call filed the day
after is a memory even if the mark takes a fortnight.

Applies identically in `fitAiWeight`, `fitSelfWeight`, `elicit.ts`'s `scoreChips` roll-up, and any per-
factor fit added by §W5. One predicate, one place:

```ts
/** A call counts only if it predates the paper. Absent stamp ⇒ legacy, see W1.5. */
export function filedInTime(u: Upcoming, ch: keyof FiledAt): boolean {
  const f = u.filed?.[ch];
  return f == null ? true : f < u.date;
}
```

### W1.5 Legacy books: grandfathered, and flagged

A v9 export has no `filed` at all. Two options:

- **Drop unstamped calls from scoring.** Doctrinally pure, and destroys a record the user built in good
  faith under rules that did not yet exist.
- **Grandfather them, and say so on the card.** Ambiguous evidence is kept and labelled ambiguous.

**Choose the second.** Deleting evidence you cannot adjudicate is its own dishonesty, and the ambiguous set
is finite and shrinking: after this ships, every filing is stamped. The `earn.ai` and `earn.self`
derivations gain a gate line — `{n} of {N} scored sittings pre-date the clock` — and the card shows the
split. When the unstamped count reaches zero the line disappears on its own.

### W1.6 Prompt consequence

R8 currently promises a `createdAt` that three of its five named sections cannot carry. Rewrite it to state
what is true: the student's transcribed calls carry a filing date the AI may source from a dated note;
`aiPred` is stamped by the app on import and **the AI must not emit a date for it**; and a call for a
sitting that has already been sat is worth nothing, so skip it rather than file it.

Add to `forecastBlock` (`prompt.ts:526`, beside "No sitting you cannot reason about"):

> · No sitting whose date has passed. The app stamps your call with the day it
>   receives it; a call filed after the paper scores nothing and is discarded.

---

## W2 · The wire fixture — the missing instrument

**Value:** none directly. **Cost:** small. **Blocks:** honest acceptance of W3–W7.

Per W0.2 there is no committed book carrying a forward calendar. Add a **second** fixture,
`src/lib/__fixtures__/wire-book.json`, deliberately separate from `book.json` so that §21, the printed
table, and every existing baseline stay byte-identical.

Contents — small, synthetic, hand-checkable:

- 3 subjects, ~8 prints each, spanning two terms;
- 6 **resolved** sittings (a filed call, a passed date, a matching `GradeEntry`), carrying between them:
  self calls with and without ranges, chips, teacher predictions, and AI calls with and without ranges;
- 2 **live** sittings ahead of the fixture's `TODAY`, one with an AI call and one without;
- 1 sitting with a **late-filed** AI call (`filed.ai > date`) whose only job is to prove W1.4 excludes it;
- `aiWeighting: true`.

Then `wire-book.test.ts` walks the whole chain on it and asserts, at each hop, a number a human can check
by hand: the resolved set, the per-channel `n`, the raw share, the shrunk weight, the joint ceiling, the
pooled mean, the card's quoted charge. This is the test that would have caught W0.1, and it is the only
place any feature below can be observed end to end.

Explicitly **not** part of `npm run gate`'s accuracy assertions: it is a behavioural fixture, not a skill
baseline. It must never be allowed to become a second thing that has to move when a forecast changes.

---

## W3 · Recalibrating the wire — the cheapest large win

**Value:** high. **Cost:** small. **Depends on:** W1.

### W3.1 The evidence

The prompt asks for a 90% interval and admits in the same breath that the contract is not self-enforcing
(`prompt.ts:522-524`): *"If your interval feels comfortable, it is too narrow."* Telling a forecaster to be
better calibrated is not a calibration mechanism.

What the engine does with the answer: `aiPredictive` → `selfPredictive` (`pool.ts:71-77`) reads
`[lo, hi]` at $Z_{90} = 1.6449$ and uses that σ **verbatim, forever**. `fitAiWeight` computes `aiSd`
(`aipool.ts:88`) — the realized rms of point errors — but uses it **only when no range was given**
(`aipool.ts:139`). So a wire that states ±3 and misses by ±12 every time keeps stating ±3, keeps getting
scored badly by CRPS, and keeps narrowing the pooled band whenever its weight is non-zero.

Meanwhile the engine holds itself to exactly the standard it does not hold the wire to: `biascal.ts:56-58`
fits a `widthScale` from the engine's own realized residuals and applies it at `biascal.ts:72`.

### W3.2 The fix — the wire's own two-parameter recalibration

From the wire's scored, in-time record, with $\sigma_i$ its stated scale and $y_i$ the realized mark:

$$
z_i \;=\; \frac{y_i - \text{point}_i}{\sigma_i}, \qquad
\gamma_{\text{raw}} \;=\; \sqrt{\tfrac1n \textstyle\sum_i z_i^2}, \qquad
b_{\text{raw}} \;=\; \tfrac1n \textstyle\sum_i (y_i - \text{point}_i)
$$

Shrunk by the one credibility rule this repository already has (`shrinkage.ts:60-62`), toward the null that
the wire is honest:

$$
\hat\gamma \;=\; \operatorname{clip}_{[0.7,\,3.0]}\!\left(\frac{n\,\gamma_{\text{raw}} + \kappa_\gamma}{n + \kappa_\gamma}\right),
\qquad
\hat b \;=\; \operatorname{clip}_{[-5,\,5]}\!\left(\frac{n\,b_{\text{raw}}}{n + \kappa_\gamma}\right)
$$

Applied before pooling: $\text{point}^\ast = \text{point} + \hat b$, $\sigma^\ast = \hat\gamma\,\sigma$.

Starting values $\kappa_\gamma = 6$, clip $[0.7, 3.0]$, bias cap $\pm 5$ pts — **starting values, to be
swept on §W2's fixture and the accuracy spec's §2.4 synthetic generator, not asserted.** At $n = 0$ this is
exactly the identity, which is the property that lets it ship before any record exists.

Two deliberate asymmetries:

- **$\hat\gamma$ may go below 1.** A genuinely over-wide wire should be allowed to tighten; refusing on
  the grounds that AIs are usually overconfident would be a prior wearing the costume of a safety rail. The
  floor at 0.7 stops a lucky run of three from collapsing the band.
- **$\hat b$ is capped harder than $\hat\gamma$ is.** A location correction moves the mark; a width
  correction moves only the confidence in it. The asymmetric cap encodes which error is worse.

### W3.3 The invariant this creates — I1

> **I1 · The earned weight must always be fitted on the exact call that gets pooled.**

Once recalibration exists, `fitAiWeight` must score $\text{point}^\ast$, not `point`, and the
$\hat\gamma,\hat b$ used for sitting $i$ must be fitted **only on sittings resolved strictly before $i$'s
date**. Otherwise the weight measures a forecaster that does not exist: a version of the wire retro-fitted
with knowledge of the very outcome being scored. It would look like a large accuracy gain and would be
entirely leakage.

This is the same walk-forward discipline `replay.ts` already enforces for the register, and the same reason
`earned.ts`'s note insists the register is fed the desk's raw call (`earned.ts:77-79`). It is stated as an
invariant rather than a note because §W5's factor fit obeys it too, and two features sharing a leakage
surface is exactly how a leak survives review.

**Acceptance test:** construct a record where the wire is systematically +8 optimistic. Assert the
*in-sample* corrected error is near zero, the *walk-forward* corrected error improves but by less, and
these two numbers differ. A test that cannot tell them apart is not testing the leakage rule.

### W3.4 The feedback block, and its hazard

Cheap and obvious once the record exists: show the wire its own scored record in the prompt, so it can
self-correct. `contextBlock` (`prompt.ts:295-307`) already embeds score history behind a flag; add a `YOUR
RECORD` block listing each past `aiPred`, the realized mark, the signed error, and whether the stated
interval covered.

**The double-correction hazard.** If the app applies $\hat b$ and the AI has also pre-corrected its own
bias in response to seeing the record, the bias is subtracted twice and the wire is now systematically
wrong in the other direction — and $\hat b$, fitted on the pre-corrected calls, will chase it. Two
correctors, one quantity: the audit spec's M4 defect exactly.

Resolution, stated in the prompt rather than assumed:

> This record is shown so you can reason better, not so you can offset. The
> terminal fits and applies its own bias and width corrections to your calls
> from this same record. File your honest belief; correcting for your own
> historical bias here means it is subtracted twice.

And the invariant: **the app owns the affine correction; the wire owns the belief.** If a future design
wants the wire to self-correct instead, it must *remove* $\hat b$, not run both.

---

## W4 · Bands instead of an interval — a distribution the AI can actually state

**Value:** high. **Cost:** small–medium. **Depends on:** W1 (scoring), W2 (adjudication).

### W4.1 Why the interval is the wrong ask

`[lo, hi]` at 90% is a two-parameter symmetric Gaussian assumption imposed at the point of elicitation. A
language model states *"probably high 70s, maybe low 80s, small chance it goes badly"* natively and states
*"my 90% interval is [71.2, 84.6]"* badly. Everything needed to accept the first form already exists:
`STAKE_BANDS` and `STAKE_CHIPS` (`elicit.ts:15-18`), `bandOf` (`elicit.ts:26-32`), `scoreChips`, and
`modelBandPmf` for scoring the desk on the same footing.

### W4.2 Shape

```jsonc
"bands": [0, 0, 1, 5, 3, 1]   // 10 chips over [<50, 50s, 60s, 70s, 80s, 90+]
```

Chips, not probabilities — identical to what the student stakes, so one scorer serves both, and integers
out of ten are harder to state carelessly than six decimals that must sum to 1. `point` stays required;
`bands` is optional and, when present, **supersedes `lo`/`hi`** for the predictive. Two spread claims for
one call would be a second two-owner problem.

### W4.3 Bands → predictive, and the bottom-band trap

Moment-match the pmf: $\mu = \sum_j p_j m_j$, $\ \sigma^2 = \sum_j p_j\,(m_j^2 + v_j) - \mu^2$, where $m_j$
is band $j$'s representative mark and $v_j$ its within-band variance.

**The trap:** the geometric midpoint of `[0, 50]` is 25. Almost nobody scores 25. Any chip in the bottom
band would drag $\mu$ down by several points for a claim the AI did not make. The top band `[90, 100]` has
the mirror problem, smaller.

**Fix:** fit $m_j$ from the book's own prints — the mean of realized scores landing in band $j$ — shrunk
toward the geometric midpoint by $n_j/(n_j + \kappa_m)$ with $\kappa_m = 5$, and falling back to the
midpoint when a band has no prints anywhere. This is `shrinkToward` again, on data the book already has.

**Floor:** $v_j \ge w_j^2/12$ (uniform-over-the-band variance). This is not a nuisance, it is a safety
property worth naming: a wire that dumps all ten chips in one band still implies $\sigma \approx 2.9$ pts,
so a maximally confident categorical call cannot collapse the pooled band the way a maximally confident
`[lo, hi]` can.

### W4.4 Score bands with RPS, not Brier — and fix the student's chips too

`scoreChips` (`elicit.ts:68`) uses the Brier score, and the desk is scored against it by the same rule
(`elicit.ts:151-154`). Brier treats the six bands as unordered: a call
placing mass in the 80s when the truth was the 90s is penalised exactly as hard as one placing it below 50.
For an **ordered** outcome the proper rule is the ranked probability score,

$$
\text{RPS} \;=\; \frac{1}{K-1}\sum_{k=1}^{K-1}\Big(\textstyle\sum_{j\le k} p_j - \mathbb{1}[y \le \text{band } k]\Big)^2 ,
$$

which is proper, coincides with the two-category Brier score up to a constant factor at $K = 2$, and
rewards being close. This is a real defect in the
existing chips channel, not only a requirement of the new one — the student is currently graded by a rule
that cannot tell a near miss from a disaster.

Changing it moves the `chips` numbers on the scorecard. Gate-neutral (no chips in the fixture) but **not**
neutral on a real book, so it lands as its own commit with its own before/after on §W2's fixture, and both
scores are shown on the card during the transition.

### W4.5 If `gradeScale` lands

Accuracy spec §9.2 proposes `Settings.gradeScale`. If it exists, the bands become the book's real grade
bands and the whole channel is elicited on the scale the student actually thinks in. Until then,
`STAKE_BANDS`. The band count must be read from one place, never hard-coded to 6 in the new code — see the
audit spec's fixed-array defects for what happens otherwise.

---

## W5 · `factors[]` — the AI's reasoning, made attributable and firable

**Value:** highest ceiling, most uncertain. **Cost:** large. **Depends on:** W1, W2, W3 (I1).

This is the feature the original question was really about: not more numbers, but the *thought* behind the
number, in a form the terminal can check.

### W5.1 What is wrong with `basis`

`AiPrediction.basis` is ≤160 characters of prose (`schema.ts:226`). It renders on a card and it does
nothing else. It cannot be scored, cannot be contradicted, cannot lose credibility, and cannot appear in
§24's derivation layer as anything but a quotation. README §1's constraint that every printed number be
derivable currently has `basis` as its one blind spot: the number it justifies is opaque and the
justification is unfalsifiable.

### W5.2 Shape

```jsonc
"aiPred": {
  "base": 74.0,
  "point": 70.5,
  "bands": [0, 0, 1, 6, 3, 0],
  "factors": [
    { "key": "syllabusChange", "delta": -2.0, "evidence": "Course outline: Unit 4 replaced for 2026" },
    { "key": "teacherChange",  "delta": -1.5, "evidence": "T2 report: 'welcome Mr Reid to the department'" }
  ],
  "basis": "New standard in Unit 4 plus a mid-year teacher change"
}
```

`base` is the AI's read of **what the tape alone implies**, before its own adjustments. `point` is its
final call. Each factor names a registry key, a signed point delta, and the evidence line behind it.

### W5.3 The identifiability decision, which is the load-bearing choice

Three contracts were considered.

**(A) Explanatory-only** — factors annotate, `point` is free. Rejected: a factor with no arithmetic
relation to the call can never be shown wrong, so it is `basis` with more syntax.

**(B) Additive-closed** — require $\text{point} = \text{base} + \sum_k \delta_k$ exactly, reject otherwise.
Rejected: it discards a good forecast over an arithmetic slip, and it pushes the model to invent a padding
factor to force the sum, which corrupts the registry it is trying to make meaningful.

**(C) Additive with an explicit residual and a tolerance** — **chosen.** On import compute

$$
r \;=\; \text{point} - \text{base} - \textstyle\sum_k \delta_k .
$$

- $|r| \le 1.0$ pt: store $r$ as an implicit `other` factor. The decomposition reconciles.
- $|r| > 1.0$: keep the row, tag it `unreconciled`, **and the factors earn nothing.** The point prices
  exactly as it does today.

**The safety property, stated as an invariant:**

> **I2 · `point` is always what prices. Factors never re-derive the call.**

The engine never recomputes $\text{base} + \sum \beta_k \delta_k$ *in place of* the AI's stated point. A
factor bug, a mis-keyed delta, or a wild `base` can therefore cost credibility but can never move a mark by
a route the stated forecast did not already move it. Everything in §W5.4 changes how much future calls are
*believed*, not what this call *says*.

### W5.4 Scoring a factor — how one loses its seat

With one outcome per sitting and several factors per call, no single sitting attributes anything. The fit
must pool across sittings and across subjects. Over the in-time resolved record,

$$
y_i \;=\; \text{base}_i \;+\; \sum_k \beta_k\,\delta_{ik} \;+\; \varepsilon_i
$$

where $\beta_k = 1$ means "this factor's stated deltas have been exactly right on average", $\beta_k = 0$
means "worthless", $\beta_k < 0$ means "systematically backwards". Fit by ridge **toward the AI's own
claim**, which is the correct null — a factor is not discounted until it has been observed being wrong:

$$
\hat\beta \;=\; \arg\min_\beta \;\sum_i \Big(r_i - \sum_k \beta_k \delta_{ik}\Big)^2 \;+\; \lambda \sum_k (\beta_k - 1)^2,
\qquad r_i = y_i - \text{base}_i
$$

$$
\hat\beta \;=\; \big(\Delta^\top\!\Delta + \lambda I\big)^{-1}\big(\Delta^\top r + \lambda \mathbf{1}\big)
$$

$\Delta$ is $n \times p$ with $p \approx 8$; the existing dense solver at `depth.ts:224` handles it.

**Choosing $\lambda$ so it means something.** Under an orthogonal design,
$\hat\beta_k - 1 = \frac{\sum_i \delta_{ik}^2}{\sum_i \delta_{ik}^2 + \lambda}(\hat\beta^{\text{OLS}}_k - 1)$.
Setting $\lambda = \kappa_f\,\bar s^2$ with $\bar s$ a reference delta size (2.0 pts) makes the shrinkage
factor exactly $n_k/(n_k + \kappa_f)$ for a factor seen $n_k$ times at typical size — **the same
credibility rule as every other channel** (`earned.ts`), expressed in the units this fit works in. That
consistency is the argument for this parameterisation over a hand-tuned $\lambda$.

**Clip $\hat\beta_k$ to $[0, 1.5]$.** The lower clip is the interesting one: a negative $\beta$ means the
app would *reverse* the wire's stated reasoning, which is a strong claim from three observations and is
empirically indistinguishable from the factor simply being mislabelled. Clipping at zero says "this factor
stops counting", which is the honest weaker statement. The upper clip stops amplification of a factor that
got lucky.

**Where $\hat\beta$ is spent.** Not on the call (I2). It is spent on the **credibility** of the channel:
the recalibrated call used for weighting becomes
$\text{point}^{\ast\ast} = \text{base} + \sum_k \hat\beta_k \delta_k + \hat b$, and `fitAiWeight` scores
*that*. A wire whose reasoning has been sound earns weight faster; a wire carried by one bad factor is
discounted without losing its whole seat.

**I1 applies with full force.** $\hat\beta$ used at sitting $i$ is fitted only on sittings resolved before
$i$'s date. With $p = 8$ and $n = 5$ this is deeply underdetermined, which is precisely why the prior is
$\mathbf{1}$ and the shrinkage is aggressive: at small $n$ the fit *is* the identity, and that is the
correct behaviour, not a limitation to be engineered around.

**Acceptance test:** with fewer than ~10 in-time resolved sittings carrying reconciled factors,
$\hat\beta \approx \mathbf{1}$ and the whole layer is the identity to within $10^{-6}$. Assert it. Shipping
a mechanism that does nothing until evidence exists is the point.

### W5.5 The registry — closed, and defended

A factor key earns a place only if it clears three tests: **(i)** it is observable in a document or an
interview line; **(ii)** it is not already priced by the engine, or it double-counts; **(iii)** it
generalises across subjects, or $\beta_k$ is never identified.

Admitted (AI-selectable):

| key | claim | evidence must name |
| --- | --- | --- |
| `syllabusChange` | assessed content differs from what the tape was earned on | the outline / standard that changed |
| `teacherChange` | new teacher or marker since the prints | the report line or the student's statement |
| `formatChange` | paper structure differs from prior prints of this type | the exam notice or matrix |
| `difficultyStep` | a known step up in level (new standard, senior paper) | the course document |
| `topicFit` | the assessed topics favour or disfavour this student's demonstrated topic profile | the topic list *and* the prints it leans on |
| `cohortShift` | class composition changed — streaming, a re-set | the report or the student |
| `assessorLeniency` | documented moderation, scaling, or a re-mark policy | the policy line |
| `priorArtefact` | a specific past print is unrepresentative and is being discounted | the entry id and the reason |
| `externalLoad` | competing documented demands around the sitting | the interview line |

Not AI-selectable, importer-assigned only: `other` (the reconciliation residual, §W5.3).

Eliminated, with reasons — this is the part that keeps the registry honest:

- **`momentum` / `recentForm`** — the ensemble already fits trend three ways (Theil–Sen with a τ gate,
  the Kalman local level, EWMA). A factor for it double-charges the same evidence.
- **`regressionToMean`** — owned by the shrinkage layer. Same objection, stronger.
- **`coverageGap`** — `Upcoming.syllabusCoverage` is already a stated field feeding readiness. A factor
  restating it charges the student's own number twice.
- **`effortChange`** — the effort channel (`effort.ts`, allocations, the drift instrument) owns this, and
  its whole doctrine is that effort→grade is *not* fitted from one student's book. A wire factor asserting
  it would smuggle in the causal claim the engine explicitly refuses to make.
- **`anxiety` / `confidence`** — `Profile.testAnxiety` and `Subject.belief` are the student's own,
  transcribe-only. An outside model inferring them from prose is exactly the sentiment-scoring §9.8 already
  excluded.
- **`nationalDifficulty`** — see §W5.6. This is not a small exclusion.

### W5.6 The smuggling hazard, which is why `evidence` is required

Accuracy spec §9.8 excludes national/standard-level difficulty priors drawn from the AI's own training
knowledge: it is the one proposed input with no document behind it and therefore nothing R1 can constrain.

**A free-form factor list is a route around that exclusion.** Nothing stops a model filing
`{key: "difficultyStep", delta: -4, evidence: "this standard historically has a low national pass rate"}`.
The key is legitimate; the evidence is the banned input wearing its coat.

Three closures, all required, none sufficient alone:

1. **`evidence` is mandatory on every factor** (unlike `basis`, which is optional). A factor without it is
   dropped at import, not tagged.
2. **The prompt states the rule in the factor block, not only in R1:** *"evidence must quote or cite
   something in front of you — a document line, or something the student told you. 'Generally', 'typically',
   'in my experience' and 'historically' are not evidence; if that is all you have, do not file the
   factor."*
3. **The review UI shows every factor's evidence text, verbatim, before import.** The surface exists —
   `upcoming` is already `elicitation: true` (`schema.ts:404`), the flag rides through to the review model
   (`review.ts:261`), and `aiPredCount` is already reported (`review.ts:273`). What is missing is depth:
   today the student confirms *that* the wire filed $k$ calls, never *what it claimed and on what
   grounds*. A count cannot be checked against a document; a quoted line can. The student is the
   last check, and the one who knows whether the quoted line exists.

Even so, this is the weakest link in the design and should be written down as such. A determined model can
produce a plausible-looking citation. The mitigation of last resort is that a factor built on invented
evidence will be wrong at a rate the record eventually prices via $\hat\beta_k$ — slowly, and only after
doing damage. **If this closure fails, the factor channel is a laundering route for exactly the input the
spec banned**, and the correct response is to disable the channel, not to patch the registry.

### W5.7 Derivation layer

A new `ai.factors` derivation: a waterfall from `base`, each factor's $\delta_k$ shown beside its
$\hat\beta_k$ and its $n_k$, the residual as `other`, ending at `point`. Gates: reconciled within
tolerance; every factor carries evidence; the sitting was called in time. `source:
src/lib/quant/aifactors.ts`.

This is what converts the wire from a number that must be trusted into a number that can be read — the same
promise §24 makes about every other quantity on the board.

---

## W6 · The panel — several desks, and disagreement as information

**Value:** medium–high. **Cost:** small. **Depends on:** W1, W3.

`aiPanel[]`: several independent replies, each tagged with a `source` label (`"gpt-5"`, `"gemini-3"`) and
the `promptVersion` it answered.

### W6.1 Per-source weights, one shared seat

Each source earns its **own** weight — a source label is a persistent identity, and one desk being reliably
worse than another is exactly the thing a record can learn. But the wire's total seat does not grow with
the number of replies pasted:

$$
\sum_j w_j \;\le\; \texttt{AI\_POOL\_CAP} = 0.35, \qquad
\Big(\sum_j w_j\Big) + w_{\text{self}} \;\le\; \texttt{POOL\_CEIL} = 0.6
$$

Two-stage proportional scaling, reusing `jointOutsideWeights` (`aipool.ts:98-103`) for the second stage.
Without the first stage, pasting five replies buys five seats and the house model loses its guaranteed 40%
— the one property `aipool.ts:29-31` promises unconditionally.

### W6.2 Why pooling correlated desks is still sound

The obvious objection: panel members share training data and read the same documents, so their calls are
correlated, and averaging correlated estimators understates variance.

It does not bite here, because this is a **mixture**, not an average of independent estimators. The
moment-matched variance $\sigma^2 = \sum_j w_j(\sigma_j^2 + (\mu_j - \mu)^2)$ is bounded below by the
weighted mean of the components' own variances and never shrinks below it. Five identical calls pool to
that call, at that call's width — not to a narrower one. Five disagreeing calls pool wide. That is correct
behaviour in both limits, and it is the same argument `pool.ts:39-43` already makes for the student.

### W6.3 Panel spread is reported, and prices nothing

The dispersion across sources is a genuine uncertainty signal and it is **already fully priced** by the
between-component term. Charging it a second time as its own premium would be the audit spec's M5 defect
verbatim. Report it on the card as `PANEL SPREAD ±x.x`; charge nothing.

`AI_PANEL_MAX = 5`, with the excess dropped and named in `meta.warnings` — a silent truncation would read
as "we used all of them".

---

## W7 · The wire is told what the engine is missing

**Value:** medium. **Cost:** near zero. **Depends on:** nothing.

`voi.ts` already ranks what to log next by gain-per-minute, is pure, and is explicitly display-only
(`voi.ts:29-34`: nothing it returns can move a digit anywhere else). The prompt's interview block
(`prompt.ts:436`) is a fixed script.

Inject the top-N `VoiItem` actions into the interview block, so the interview asks for the information the
engine has computed it is missing rather than a fixed list. Near-zero cost — the ranking already exists —
and it turns the intake adaptive.

**Purity note, to be written into `voi.ts`'s header so nobody "fixes" it later:** feeding VOI into the
prompt does not make VOI price anything. The prompt is not a forecast. What comes back is data, sanitized
on the same path as every other paste, and it moves numbers only by being *logged*, which is the whole
intent.

---

## W8 · Per-topic AI calls

**Value:** high. **Cost:** medium. **Blocked on:** `Upcoming.topicIds` (accuracy spec §8).

The mastery channel weights topic evidence (`mastery.ts:177-191`) but the forward calendar cannot say which
topics a paper covers, so mastery cannot condition on the paper. Once `topicIds` exists, `aiPred.topics[]`
— expected per-topic marks — becomes readable evidence and `topicFit` (§W5.5) becomes checkable rather than
merely assertable.

Do not build before the foreign key. A per-topic call with nothing to attach to is a field that validates
and does nothing.

---

## W9 · Considered and rejected

- **Conditional / counterfactual calls** (`"if coverage reaches 90 by the sitting, +3"`). Genuinely
  attractive — it turns the wire into an advisor making priced claims. Deferred, not killed, for a
  structural reason: it is the §W5 factor machinery with a predicate attached, so building factors first
  makes a conditional a δ that counts only when its condition realized. Building it first means building
  both at once and identifying neither. Revisit when $\hat\beta$ has a real record.
- **A free-text `reasoning` blob beyond `basis`.** Superseded by factors: each factor carries its own
  `evidence`, so the detail has a structured home. An unbounded prose field would grow, be shown, be
  believed, and be scored by nothing.
- **AI-authored `allocations`.** The allocation is the student's *stated intent*, and the whole value of
  `effortDrift` (`earned.ts:439-479`) is the distance between intent and practice. An AI-authored plan
  makes that distance meaningless — it would measure the gap between a model's suggestion and a person's
  week, which is a different quantity wearing the same name.
- **A separate `confidence` tag on extracted facts.** The reliability ladder (R2, `RELIABILITY_TAGS`)
  *is* the fact-confidence channel. A second one is a two-owner problem on the same quantity.
- **Letting the AI edit past `score` values.** R1 covers it; a correction must come from a document, and
  then it is a document, not an opinion.
- **National difficulty priors.** Still excluded — see §W5.6, which is the reason the exclusion needs
  active defending now rather than merely restating.

---

## W10 · Priority

Ordered by (blocks-others, then value ÷ cost). Phase-agnostic, per the request.

| # | item | value | cost | depends on | gate-visible? |
| --- | --- | --- | --- | --- | --- |
| 1 | **W1** filing clock | corrects a scoring defect | S | — | no (fixture is empty) |
| 2 | **W2** wire fixture | none direct; makes 3–8 adjudicable | S | W1 | no, by design |
| 3 | **W3** wire recalibration (γ, b) + I1 | high | S | W1, W2 | no |
| 4 | **W4** bands + RPS | high | S/M | W1, W2 | no |
| 5 | **W7** VOI into the interview | medium | XS | — | no |
| 6 | **W6** panel | medium–high | S | W1, W3 | no |
| 7 | **W5** factors + β̂ | highest ceiling, least certain | L | W1, W2, W3 | no |
| 8 | **W8** per-topic calls | high | M | accuracy spec §8 | no |

W7 is unblocked and independent; run it whenever convenient. W5 is deliberately last despite being the
headline: it is the only item whose accuracy claim is unproven even in principle at these sample sizes, and
it is the only one with a live abuse route (§W5.6). Everything above it either fixes a defect or improves
the shape of what the wire already contributes, at a fraction of the cost.

**Every row is invisible to `npm run gate`.** That is a statement about the fixture, not a licence. Each
lands as its own commit with: the gate still green (identity on an empty forward calendar), §W2's fixture
test green with hand-checkable numbers, and — where a forecast moves — a before/after measured on the
accuracy spec's §2.4 synthetic generator.

---

## W11 · Testing doctrine for this surface

Beyond §W2's chain test, every scored addition here carries four tests, because each corresponds to a way
this class of feature has already been observed to fail:

1. **Identity on empty.** No record ⇒ exact identity. Guards the "ships before it can work" property that
   makes all of this safe to land early.
2. **Walk-forward leakage.** In-sample and out-of-sample corrections must differ (§W3.3). A test that
   cannot distinguish them is not testing anything.
3. **Cap and ceiling.** Per-channel cap, panel sub-cap, joint ceiling — each asserted at its boundary and
   one step past it.
4. **Deliberate failure.** Feed a record where the wire is catastrophically wrong; assert the weight goes
   to zero, and where factors exist, that the offending $\hat\beta_k$ falls below 1 while the others do
   not. A mechanism that cannot be made to fire in the wrong direction has not been shown to fire.

Plus, unchanged from the existing wire discipline: the `satisfies Record<keyof T, FieldSpec>` locks force a
registry entry for every new field, and the golden prompt test (`wire.test.ts`) must be extended for every
new block — the prompt is a compiled artifact and is reviewed as one.

---

## W12 · Coordination

**With `2026-07-31-accuracy-program-design.md`:** this document replaces §9.4–9.6. §9.1 (`topicIds`)
becomes W8's blocker. §9.2 (`gradeScale`) is W4's preferred band source. §2.4's synthetic generator is the
only instrument that can measure W3/W5, so the dependency runs in that direction. Nothing here touches the
ensemble, the register, or `book.json`, so it is orthogonal to §§2–8 and can run alongside them.

**With `2026-07-31-prediction-math-audit-design.md`:** no file conflicts — the audit does not touch
`wire/` or `aipool.ts`. Three of its lessons are load-bearing here and are cited at the point of use rather
than in the abstract: M4 (one owner per quantity) drives §W3.4's double-correction resolution and §W4.2's
"bands supersede lo/hi"; M5 (one charge per piece of evidence) drives §W5.5's eliminations and §W6.3; M6
(no cliffs) is why §W5.4 shrinks rather than thresholding and why every clip in this document sits outside
a shrinkage step rather than replacing one.

**Two invariants introduced here, restated so they can be cited:**

- **I1** — the earned weight is always fitted on the exact call that gets pooled, walk-forward.
- **I2** — `point` is always what prices; factors never re-derive the call.

---

## W13 · Open questions

1. **Does the student paste more than one AI reply in practice?** W6's value is entirely conditional on it.
   Cheap to build, worthless if nobody does. Worth asking before building, not after.
2. **Is `base` a question a model answers well?** §W5.3's whole reconciliation rests on the AI being able
   to state "what the tape alone implies" separately from its final call. If models systematically set
   `base = point` and file zero factors, contract (C) degrades to today's behaviour — safely, but with the
   feature buying nothing. Testable in an afternoon against real models before any code is written, and it
   should be.
3. **Should `filed.self` accept a back-date from a dated note at all?** R8 allows it; it is the one
   remaining route by which a student's hindsight can enter the record. Tightening it to importer-stamped
   only, matching `filed.ai`, would be more defensible and slightly less useful.
