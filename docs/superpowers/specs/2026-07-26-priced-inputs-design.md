# Priced user inputs, a derived register, and a granular book

**Date:** 2026-07-26
**Status:** approved, in implementation

## The problem

The effort spider (D1) is the only elicited input the engine actually prices. It carries a
switch — *effort priced into predictions* — and a banner that says out loud what the charge
costs. The other two elicitation cards, READINESS DUELS (D2) and AGGREGATE CALL (D4), collect
real information and then do nothing with it: the Elo pile is drawn and the mean call is scored,
but no mark and no forecast moves. A card that asks you for an opinion and then discards it is
worse than no card, because it implies the opinion counted.

Three further defects travel with that:

* **The book forgets.** The aggregate card wipes its draft on submit and renders only the last
  call for the round. A revision made after seeing the model's number — the most informative
  thing a student ever does — is indistinguishable from a first guess.
* **Removal is all-or-nothing.** The duel pile has one control: drop all of it. There is no way
  to delete a mis-clicked duel, one bad call, or a single term's budget.
* **The engine's own predictions are persisted.** `data.forecasts` — the bias register — is
  written to localStorage, exported, imported and merged. It is derived state stored as if it
  were evidence, and it can drift from the model that supposedly produced it.

## Principles

1. **Nothing is charged that the data cannot identify.** A forced-choice pile is *ordinal*
   information about relative readiness; it gets an ordinal channel. An aggregate call is a
   *level* claim about the book; it gets a level channel. Neither is allowed the other's power.
2. **Every weight is earned, shrunk and capped.** No user input weighs anything until it has
   beaten the desk on a scored, resolved outcome — and the more persistently the model is off,
   the more the input weighs. This is the existing §27 mechanism, generalised.
3. **Inputs are stored; outputs are computed.** The book holds what you told it. Everything the
   model says is recomputed from that, every load, by a pure function.
4. **Identity on an empty book.** Every channel here is exactly zero on the committed fixture,
   so §21 and `npm run gate` are untouched by this work's existence.

## 1 · Shared earned-weight machinery

`src/lib/quant/earned.ts`

```
share = S_model / (S_model + S_you)          proper scores, lower is better
w     = clamp(share · n/(n+κ), 0, cap)       identity at n = 0
```

This is §27's formula lifted verbatim out of `fitSelfWeight`, which becomes its first caller
with no behavioural change (the existing pool tests lock this). Two new callers follow.

The `n/(n+κ)` shrinkage is what makes "the models are always off, so my input matters more"
safe: the share your record implies is barely identified from a handful of outcomes, so it is
approached slowly and never fully.

## 2 · Channel A — readiness duels price the MARK, ordinally

`src/lib/quant/readiness.ts`

Elo ratings from the existing `eloRank` are standardised **and centred across the desks in the
cross-section**, so Σz ≈ 0. The consequence is the whole safety argument: a readiness pile can
retilt desks against one another and *cannot move the book's aggregate in either direction*.
A gut call about which paper you are more ready for is evidence about ordering and says nothing
about level; the channel is built so that it cannot accidentally claim otherwise.

The premium follows the effort lines' shape — loss-averse, capped, credibility-shrunk:

```
READINESS   pts = READINESS_W · (−z_i)^+ · c        cap 2.5
                  −READINESS_W · (z_i)^+ · c · η    (damped credit)
c = w_ready · n_duels/(n_duels + κ_d)
```

`w_ready` is earned: for every closed round with two or more exam prints, the readiness ordering
*as it stood before that round* is scored by pairwise hit-rate against the realized exam
ordering, and the model's as-of ordering is scored the same way on the same pairs. Those two
scores go through `earned.ts`. A pile that has never predicted an ordering correctly charges
nothing.

Gated by `settings.readinessWeighting` (absent ⇒ on, like effort). Zero on a book with no duels.

## 3 · Channel B — the aggregate call pools into the BOOK forecast

`src/lib/quant/meanpool.ts`

Your predicted overall average for the pending round pools with §18's `aggregateForecast` by the
same moment-matched mixture as §27:

```
μ  = (1−w)μ_m + w μ_y
σ² = (1−w)σ_m² + w σ_y² + w(1−w)(μ_y − μ_m)²
```

The between-component term is retained deliberately: disagreeing with the desk widens the band
rather than sharpening it, so a contested aggregate is an uncertain one.

`w` is earned from `scoreMeanCall`'s history — your absolute error on the average against the
model's as-of aggregate error over the same rounds — through `earned.ts`, with κ = 4 and the
same cap as §27. Your σ_y is the rms of your past errors, with a wide default before any land.

The forced ranking is scored (Spearman ρ) and displayed, but sets nothing. Level and ordering
stay separate claims, priced by separate channels, so neither double-counts the other.

This channel touches the book-level forecast (AGGREGATE BAND, ticker tape) and **never a
per-desk mark**. Gated by `settings.aggregateCallWeighting`.

## 4 · The register is derived, not stored

`src/lib/quant/eval/replay.ts` rebuilds `ForecastLog[]` from the tape: for each exam print,
refit on strictly-earlier prints (the no-leakage discipline already proven in `backtest.ts`) and
emit the model's as-of next-exam call, then resolve it against the print that followed. One live
unresolved log per desk covers the pending round. Pure, deterministic, clock-free.

Consequences:

* `forecasts` leaves `AppData`, localStorage, and the export envelope. `EXPORT_VERSION` → 8.
  An older export carrying the key still imports cleanly; the key is ignored.
* `App` computes the register in a deferred effect, as it already does for the skill backtest.
  First paint is the uncorrected board; the bias correction lands a beat later.
* The replay is load-bearing for §2 and §3: it supplies the model's *as-of* ordering and
  *as-of* aggregate, which is exactly what both new channels score themselves against. Without
  it, "did you beat the desk" could only be asked against a desk that had already seen the answer.
* `io.test.ts`'s `forecast register persistence (v6)` block is rewritten to lock the new
  contract rather than deleted.

## 5 · Memory

* The aggregate card keeps its draft and seeds it from your last call, so a revision is one edit
  rather than a re-entry. Every call for a round is listed newest-first with its score once the
  round lands. Revisions are new rows, not overwrites — an input made *after* the model printed
  is exactly the thing worth keeping.
* The duel pile lists individually, each row removable, alongside the existing two-click wipe.
* Allocations get a visible per-round list with per-round removal.

## 6 · Granularity

* `serializeExport` always emits `upcoming`, `allocations`, `duels` and `meanCalls` — empty
  arrays included. "Always there" means the shape of a book never depends on what you happen to
  have filled in.
* Settings → Data gains a **DATA LEDGER**: every stored section, its count, expandable to rows,
  with per-row removal and a per-section clear.

## 7 · Structure

`views/Scoreboard.tsx` (954 lines) becomes `views/scoreboard/` — one file per card plus the
shared `Card` chrome. `components/ui/PricedBanner.tsx` extracts the effort card's toggle and
`TriangleAlert` warning, and is reused by all three priced cards so the "here is what this
actually costs you" discipline lives in one place.

## Testing

Each new lib module gets its own unit tests: `earned` (shrinkage, cap, identity), `readiness`
(centring sums to zero, ordering scoring, identity with no duels), `meanpool` (mixture moments,
disagreement widens, identity at w = 0), `replay` (no leakage — a forecast never sees its own
outcome; determinism; idempotence). `npm run gate` and `gen:table` must be clean with the
fixture table byte-identical, which the identity properties guarantee.
