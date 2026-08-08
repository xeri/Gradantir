# Gradantir — agent brief

Client-only React 18 + Vite 6 + TypeScript (strict). No backend, no router, no
state library. The engine is a real quant pipeline and `README.md` is its paper —
30 numbered sections; cite them as §n. The product is **Gradantir**; the package,
the store key (`grade-exchange:v3`) and the export format still say
`grade-exchange`, deliberately.

**This repo is mid-overhaul.** Only the Invariants below are settled. Everything
else is current shape, not design intent — read `docs/agent-notes.md` before
assuming a red test or an ugly screen is something you broke.

## Commands

| | |
|---|---|
| `npm test` | full suite, ~40s, 105 files |
| `npm run gate` | walk-forward CRPS regression only — the change gate |
| `npm run gen:table` | regenerate §21 and the skill baseline (prints; you paste) |
| `npx tsc --noEmit` | strict, `noUnusedLocals`, `noUnusedParameters` |
| `npm run build` | typecheck + production build |

Run the dev server through the preview tool, never `npm run dev` in a shell
(`.claude/launch.json`, port 5199).

## Invariants

The short list, because a long one gets followed less. These are the rules whose
breach costs real data, real trust, or a silently wrong number.

1. **The calculation layer (`src/lib/`) is pure and clock-free.** No zero-argument
   `new Date()`, no `Date.now()`, no `Math.random()`; `asOf` is always a parameter
   and the clock enters only at the `App` edge. Two runs over the same book must
   agree exactly — the forecast register is *replayed* from the tape, never
   stored, so one clock read makes two people holding the same book disagree.
2. **Core numbers are generated, never hand-typed.** Change one equation or
   constant, then follow README §26: `npm run gate` (CRPS must not regress) →
   `npm run gen:table` → paste the regenerated rows into README §21,
   `mark.book.test.ts` and `baseline.json` in the same commit. Never retune to
   chase §21.
3. **Generated and private files are not editable.** `__fixtures__/book.json` and
   `eval/__snapshots__/baseline.json` are regenerated, never hand-edited; `data/`
   is the real, private, gitignored book — never read it into a commit, a test,
   or an answer.
4. **Every constant lives in a `params.ts`, with a comment saying why that
   number.** An inline magic number is how a retune becomes unauditable.
5. **A comment that states a property is a claim, and a claim needs a test.**
6. **Views consume `SubjectStat`; they never do their own math.** A second
   arithmetic path is a second answer.
7. **Nothing non-finite reaches the board.** The engine divides by counts,
   spreads, cohort sizes and fitted variances, and a school book is full of the
   shapes that make those zero. Guard every divide; `finite.test.ts` sweeps
   randomised degenerate books and fails with a reproducible seed.

Rules 1 and 3 are enforced mechanically (`.claude/settings.json`), not trusted to
prose.

## The bar for new work

This codebase is deliberately over-built, and new work matches it. "The simplest
thing that works" is the wrong instinct; the simplest thing that is **correct,
inspectable and measured** is the target. A new quantity is not done until:

- it is **derived, not asserted** — a named method with a primary-source citation
  in `derive/cite.ts`, never a hand-tuned heuristic;
- its constants sit in a `params.ts` with the reasoning that chose them;
- it hands its intermediates out through `trace.ts`, and has a builder in
  `derive/index.ts` so a reader can open the number and see the working;
- a reconciliation test proves the derivation states the figure the board shows;
- it reports an honest interval, and where terms combine, an attributable share;
- it earns its place **out-of-sample** — `npm run gate`, plus a leave-one-out
  ablation if it joins the ensemble or the premium schedule;
- it survives `finite.test.ts`'s degenerate books, and gets a README § of its own.

A method that cannot be defended out-of-sample does not ship, however elegant.

## Working style

- The comments here carry the reasoning and are usually load-bearing: read before
  editing, and update the comment when the reason changes.
- One commit per logical change; the message names what it closes.
- `README.md` is the spec of record, and `docs/superpowers/{specs,plans}/` may
  already hold an open design for what you are about to build. Where behaviour
  and README disagree, say so rather than silently picking a side.
- **Work is tracked in `docs/board.md`, and the row comes before the plan.** Add
  the row, declare the paths it claims, and check no live row already claims
  them — if one does, sequence the two and say so in the plan's "deliberately
  does NOT fix" section. Update the row's status in the commit that changes it;
  the session-start digest reports any drift between the board and the disk.

## Standing brief

Do not stop at the task. End every substantive turn with at least one concrete
candidate for making the engine better than it is: a signal the model does not
yet read, a method with a stronger claim than the one in place, two estimators
worth blending rather than choosing between, or a term the ablation says is dead
weight and should be cut. Concrete means the named method, its primary source,
the module it plugs into, and the number it would be scored on — "we could try a
GP here" is not a proposal.

Candidates go in `docs/ideas.md`, not only in the reply, and the pipeline is one
direction: idea → board row → spec → plan → commits. README §23 is the standing
list of what is known to be weak and is the honest place to look first; it names
its own biggest unclaimed win.

Nothing outside the invariants is preserved for being old — the console shell,
every screen, the palette, `derivationMode`, and any equation that survives the
§26 gate are all fair game. Propose freely and gate ruthlessly: `npm run gate`
and the leave-one-out ablation decide, not taste, and something that fails to
beat its own absence gets deleted — including something you just built.
