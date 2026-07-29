# Subject lineage — splits, renames, and the aggregate denominator

**Date:** 2026-07-22
**Status:** approved, implementing

## The defect

`AGGREGATE` reported 2025 exam rounds out of **700** when the book only ever sat
**600** worth of exams. The denominator is `100 × n`, which is arithmetically
correct; the fault is in `n`.

The book records `ECON` and `BUS` as two desks, but their tapes are byte
identical for every print through `2025-12-03` and diverge only at
`2026-04-08` (64 vs 82). They are not two desks. They are one desk — `BEA` —
that **split** into two in 2026, whose history was copied into both successors.
Every cross-desk sum therefore counts BEA twice.

The same shape exists elsewhere in the user's real book: Social Studies became
Geography + History, and Science became Physics.

### Blast radius

This is not a display bug. Duplicated tapes corrupt the engine:

| site | corruption |
|---|---|
| `examAggregate` / `examAggregateHistory` | `n` and `sum` both double-count the ancestor |
| `aggregateForecast`, `compositeIndex`, `aggregateHistory` | same |
| `poolStats` (empirical-Bayes prior) | ancestor enters as two independent subjects: inflates `k`, biases `grandMean`, **deflates `tau2`** because two identical means shrink the between-subject spread, inflates `sigma2` dof |
| `markBook` / `computeFactors` | ancestor occupies two slots in every cross-sectional percentile |

## Model

One new field:

```ts
interface Subject {
  /** The desk this one descends from — a rename or a split. */
  formerly?: string | null;   // ancestor subject id
}
```

Ancestors are ordinary subjects, archived when they close. A **rename** is an
ancestor with one successor; a **split** is an ancestor with two or more.
Chains walk (`PHYS → SCI → …`).

The prints live on the ancestor **once**. Successors start at the split and
carry only their own prints. Nothing is copied, so nothing can be
double-counted.

### The two tape rules

The whole design rests on one distinction:

- **Aggregates and rosters read OWN entries.** A round contains exactly the
  desks that printed then. `BEA` is in 2025; `ECON`/`BUS` are in 2026. Never
  both.
- **Per-desk pricing reads INHERITED entries.** `ECON`'s tape is BEA's four
  prints plus its own, so a freshly split desk still prices off real history
  instead of a single point.

Because the copies are deleted outright, `poolStats` is fixed with no change to
it — it already keys on real ownership. That is the payoff of the ancestor
model over read-time dedup.

## Module: `src/lib/lineage.ts`

| function | purpose |
|---|---|
| `ancestorsOf(sub, subjects)` | walk the chain, cycle-safe |
| `lineageRootOf(sub, subjects)` | the oldest ancestor — the lineage's identity |
| `successorsOf(sub, subjects)` | desks descending directly from this one |
| `inheritedEntries(sub, subjects, entries)` | ancestor prints + own, date-sorted |
| `rosterAt(subjects, entries, dateIso, cal)` | **the single membership rule** |
| `crossSectionAt(subjects, entries, dateIso)` | who takes part in "versus the book" comparisons |
| `groupByLineage(subjects, entries)` | every print once, grouped for the pooled prior |
| `assertRoster` / `assertLineageIntact` | the two invariants |
| `detectSplits(subjects, entries, ignored)` | find duplicated tapes needing a merge |
| `applySplit(data, plan, ticker, name)` | perform the merge — create ancestor, move prints, set `formerly` |

### Three cross-desk surfaces, three corrections

The duplicated tape corrupted more than the denominator, and each needed its
own fix:

- **Sums** (`examAggregate`) — dedupe on *print identity*. Two desks may
  legitimately report the same physical paper when a split happens before either
  successor sits its own exam; that is one exam, counted once in sum and
  denominator alike. Doing it on identity rather than on lineage makes it true
  however the caller assembled its tapes.
- **The pooled prior** — pool over `groupByLineage`, not over desks. Grouping by
  desk would split one long tape into thin ones at a split; the old duplicated
  book instead presented one tape as two identical subjects, which *deflates*
  τ² and makes the engine spuriously confident.
- **The cross-section** (`markBook`, percentiles) — use `crossSectionAt`. A desk
  qualifies once it prints under its own name and stops when a successor starts
  printing. Without the second half BEA would be ranked beside ECON and BUS
  while all three hold the same prints.

`computeStats` and `pricesAsOf` call the *same* `crossSectionAt`, so a repriced
history and today's board cannot disagree about who was compared with whom —
there is a book test asserting exactly that.

### `SubjectStat.entries` is the lineage tape

Every per-desk figure and every consumer (charts, headlines, breadth) reads a
desk's whole history whatever it used to be called. `own` rides alongside for
callers that need to distinguish. An earlier attempt made `entries` mean *own*
prints; that silently broke the April breadth headline, because a freshly split
desk had one print and no predecessor to be judged red against.

### Round-trip

`formerly` is preserved by `parseImport` and `ignoredSplits` by
`sanitizeSettings`. Dropping either would reintroduce the bug by a different
door: an orphaned successor silently loses its tape, and a forgotten dismissal
re-asks the same question every load until it gets clicked through unread. A
pointer into a desk the file does not contain is cut rather than kept.

`rosterAt` is the anti-regression move. `examAggregateHistory` and
`aggregateHistory` currently hand-roll the same membership loop twice — two
copies of a rule that must agree. Both call `rosterAt` instead.

### Invariant

> A roster may never contain both a desk and any of its ancestors.

`assertRoster` enforces it: throws under test, warns in dev, silent in prod.
This is what makes a 700 structurally impossible rather than merely fixed.

## Detection UX

`detectSplits` flags pairs of desks that share ≥3 prints exactly (same date,
type, score) and diverge after some date. `SplitBanner` raises one prompt:

```
LISTING ANOMALY
ECON and BUS report the SAME 5 prints before 08 APR 2026.
One desk that split, or coincidence?
Ancestor ticker: [BEA]
[MERGE INTO ONE DESK]  [KEEP BOTH]
```

"Keep both" is remembered in `settings.ignoredSplits` so it never asks twice.
Going forward, `SubjectModal` gains a **Split this desk** action that sets the
lineage itself, so detection is only ever needed for books built before this
existed.

## Round-over-round delta across a split

`ECON+BUS` vs `BEA` is two-against-one and not directly comparable. Rule:
**compare lineage-group means** — BEA 82 vs mean(ECON 64, BUS 82) = 73, so
−9 pts/desk. Dropping split desks from the comparison would silently narrow the
basket, which is the same class of bug as the one being fixed.

## Expected result

```
            NOW              AFTER
T1 24    439 / 600        439 / 600     MATH ENG PHYS GEO LAT SPA
MID 24   475 / 600        475 / 600
EOY 24   460 / 600        460 / 600
T1 25    513 / 700   ->   431 / 600     MATH ENG PHYS GEO BEA GRA
MID 25   472 / 700   ->   420 / 600
EOY 25   493 / 700   ->   417 / 600
T1 26    373 / 600        373 / 600     MATH ENG PHYS GEO ECON BUS
```

Every round lands on /600 — a clean six-desk book end to end.

## Testing

- `lineage.test.ts` (27) — chain walking, cycle safety, roster exclusivity,
  detection precision (must NOT merge two desks that merely scored alike),
  merge idempotence.
- `lineage.book.test.ts` — the standing guard over the real book: nothing left
  to detect, no two seated desks share a *run* of prints, no desk ever seated
  with its own ancestor, every round out of 600, lineage survives import.
- `aggregate.book.test.ts` — updated to the corrected tape above.

**Suite: 496 passing; typecheck and production build clean.**

### What the guard caught while building it

`assertLineageIntact` found four call sites — all in tests that had been
passing — doing `subjects.filter(s => !s.archived)` *before* `computeStats`.
That drops ancestors along with merely-closed desks and silently prices every
split desk on a fraction of its tape. The rule is: **compute on the full book,
filter the results**, which is what `App.tsx` already did correctly. That the
invariant caught real instances the moment it existed is the argument for
writing it rather than only fixing the arithmetic.
