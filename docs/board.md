# The board — what is in flight

One row per workstream, and the row exists **before** the plan does. The `touches`
column is the point of the whole file: two live rows claiming the same paths is
the overlap you are trying to avoid, and `.claude/hooks/board.mjs` reports it at
every session start.

The pipeline is one direction:

`docs/ideas.md` (unproven candidate) → **board row** (accepted, scoped, claims
paths) → `docs/superpowers/specs/` (design) → `docs/superpowers/plans/` (tasks) →
commits → `done`.

Statuses: `active` (someone is on it) · `open` (accepted, unstarted) · `blocked`
(name the blocker) · `done` (prune when the branch reaches `main`). `gate` says
whether the work is *expected* to move `npm run gate` — so a gate move is read as
the point rather than as a leak.

## Workstreams

| id | status | kind | title | artifact | touches | gate |
|---|---|---|---|---|---|---|
| audit-2 | active | model | Prediction-math audit Part II, §10–19 | specs/2026-07-31-prediction-math-audit-design.md | src/lib/quant/signals/**, src/lib/derive/** | moves |
| accuracy-a | done | model | Accuracy Program Phase A — a gate that separates skill from luck | specs/2026-07-31-accuracy-program-design.md + plans/2026-07-31-accuracy-program-phase-a.md | src/lib/quant/eval/** | neutral |
| wire-mind | open | feature | Wire Mind — give the wire a clock and a scored forward surface | specs/2026-08-01-wire-mind-design.md | src/lib/wire/**, src/views/** | moves |
| console | open | overhaul | Console revamp — the zero-whitespace grid shell | none yet | src/views/**, src/components/**, src/theme.ts, src/index.css | neutral |

**Known conflicts.** `wire-mind` and `console` both claim `src/views/**`. Wire
Mind rebuilds the forward-facing screens, so anything pixel-matched before it
lands is built twice — sequence the console shell and the dense tables first, and
leave the wire's own screens until after.

**Sequencing note, now that `accuracy-a` has landed.** Phase A had to precede the
audit's §8 (`fit.ts` + `earned.ts`), because after it the baseline has a new
shape and each channel's conversion is gated against it. `fit.ts` is already in;
`earned.ts` is still on the old score-share estimator, so §8 is the next audit
step and it is now correctly ordered. Phases B–E of the accuracy program need
their own plans written against the numbers Phase A produced — the MDE (±2.12
points) says which of them this book can actually adjudicate.

## Loose ends

One-commit fixes with no plan of their own. Delete the row in the commit that
fixes it.

| id | status | title | where |
|---|---|---|---|
| hex-assert | open | Test asserts the pre-retint brand hex, fails since `c8b7f80` | src/components/SpiderAllocator.test.tsx |
| latex-timeout | open | KaTeX corpus test exceeds the 5000ms default on slower machines | src/lib/derive/derive.book.test.ts |
| ds-palette | open | `conventions.md` still documents the pre-Console palette | .design-sync/conventions.md |
| amber-rename | open | `C.amber` no longer holds amber; migrate call sites to `C.brand` | src/theme.ts and its consumers |

## Landed

Shipped; the artifacts stay for the reasoning, not the queue. Listed so the
digest stops asking about them. `git log` is the real record.

- 2026-07-22-subject-lineage-design.md
- 2026-07-26-priced-inputs-design.md
- 2026-07-27-the-wire-ai-intake-design.md
- 2026-07-29-life-signals-design.md · 2026-07-29-life-signals.md
- 2026-08-01-signals-audit-part-i-steps-1-3.md
- 2026-08-01-signals-audit-part-i-step-4-shapley.md
- 2026-08-01-signals-audit-part-i-step-5-channels.md
