# Candidate ledger

Where proposals live so they survive the session that produced them. Append
freely; delete an entry the moment it ships or is disproved. This is a queue, not
a record — nothing here is a commitment, and a rejected entry is more useful kept
with its reason than quietly removed.

**Row format.** Every entry states the named method, its primary source, the
module it plugs into, and the number that would decide it. An entry missing the
scoring line is not a candidate yet.

**Promotion.** An entry that survives scrutiny leaves this file and becomes a row
in `docs/board.md`, which is where it acquires claimed paths and a spec. Nothing
is worked on straight from here.

---

### Boundary-aware likelihood (censored-t or beta)

**Source:** the ceiling problem, README §1 and §23 · **Plugs into:** the
observation model in `kalman.ts` / `bayes.ts`, and the predictive in `price.ts` ·
**Scored on:** CRPS plus realized 90 coverage, restricted to desks printing in
the 90s · **Status:** open — §23 names it "the clearest unclaimed improvement".

Every quoted interval is a symmetric t-interval truncated to [0,100] for display,
which is a presentation convention, not a boundary-aware likelihood. The input
side already exists: a print can be tagged `censored` and currently only widens
its observation noise. The one-sided likelihood that reads it as a true bound is
the pending core change.

### Cross-subject covariance in the aggregate band

**Source:** §17's common period effect $\pi_t$, against §23's quadrature
assumption · **Plugs into:** `aggregate.ts` · **Scored on:** realized coverage of
the PREDICTION and COMPOSITE bands · **Status:** blocked on identifiability.

Both bands add subject errors in quadrature, so they are too tight by the
covariance term, and a term that goes badly across the board falls outside them
more often than 1-in-10. §23 is explicit that one student's book cannot separate
"a hard term" from "a bad term". The tractable version reuses the $\pi_t$ the
depth fit already estimates rather than trying to identify a full covariance.

### Robustify the miss-streak reference line

**Source:** §5's Kendall-$\tau$-gated Theil–Sen, against §23's own admission ·
**Plugs into:** `missStreak` in `quant/factors.ts` · **Scored on:** the
leave-one-out ablation delta of the miss premium · **Status:** open.

The detector's walk-forward reference is plain OLS over the last ten prints, with
no gate and no robustness — the one place in the engine where a single wild print
moves an internal reference line. The asymmetry is argued for in §23; it has
never been measured against the robust alternative.

### Channel interactions in the life-signals layer

**Source:** §30's Shapley decomposition, which already treats the channels as a
coalitional game · **Plugs into:** `signals/channels.ts` (the $a_k$ fit) and
`signals/signalread.ts` · **Scored on:** `signalSkill`'s walk-forward CRPS ·
**Status:** open, speculative.

Credibility is fitted per channel and the contributions are additive. A short
night before a hard paper is plausibly worse than the sum of its parts, but a
pairwise term is barely identified from one student's log — it would need the
same hard shrinkage toward zero interaction that `BIAS_KAPPA_SUBJECT` applies to
the per-subject offsets.

### Settle the ensemble's moment match on synthetic books, not on the fixture

**Source:** the standard Student-t moment identity $\mathrm{Var}=s^2\nu/(\nu-2)$,
against the audit's Part II §10.2 · **Plugs into:** the moment match in
`ensemble.ts` (`sd = √variance` shipped as the t *scale*) and
`ENSEMBLE_DISPERSION` in `params.ts` · **Scored on:** realized `cover90` over
`eval/synth.ts` books at **matched truth**, then the gate's verdict on the real
fixture · **Status:** open, and newly decidable.

Phase A's generator says the under-coverage is **structural**: over 840 folds
from 30 books drawn from the model's own assumptions — local-level walk, the
model's own $q=0.06$, per-type observation noise, no unmodelled difficulty —
realized 90% coverage is **0.864, not 0.90**. There is nothing left for
misspecification to explain, so the shortfall is arithmetic in the predictive
itself.

§10.2 names a candidate: the mixture is moment-matched to a *variance* and then
shipped as a t *scale* at $\nu = 3+n$. On the real fixture that fix cannot be
read, because `ENSEMBLE_DISPERSION = 1.15` was swept against CRPS and is
absorbing whatever the error is — the two are confounded, and the fixture's MDE
(±2.12 pts) is far too wide to separate them. On synthetic books the truth is
known and the sample size is whatever the question needs, so the fix can be
scored directly: apply $s=\sqrt{\mathrm{Var}\,(\nu-2)/\nu}$, hold the dispersion
markup at 1.0, and read `cover90` back. If it lands at 0.90 the markup was the
moment error all along and retires; if it does not, the loss is somewhere else
and this is ruled out cheaply. Either answer is worth having, and neither is
obtainable from one book of ten desks.

### Fitting $\eta$ and the premium weights

**Source:** §23, "chosen, not fitted" · **Plugs into:** `mark.ts`, `params.ts` ·
**Scored on:** undecided — that is the problem · **Status:** open question, read
§11 first.

There is no observable correct price to fit against, which is why they are
calibrated for interpretability instead. Any proposal here has to answer §11's
argument that fair value is deliberately not a price before it proposes a loss
function, or it is a category error dressed as an improvement.
