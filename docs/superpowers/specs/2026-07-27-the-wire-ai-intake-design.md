# The Wire — an AI intake desk

*2026-07-27 · status: approved, implemented*

## Problem

Getting a real book into the terminal means hand-typing every print. That tax throttles adoption of
everything downstream — the engine, the elicitation channels, the scorecard all starve without a tape.
Meanwhile every student has report cards, portal screenshots and a memory, and access to some AI
chatbot that can read them.

## Shape

The terminal generates a prompt; the student pastes it into ANY external AI (strong or weak) beside
their documents, or answers the AI's interview; the AI emits one JSON payload; the terminal validates,
itemizes and merges it. Opt-in: the AI may also file its own forecasts for pending sittings, which are
scored against realized marks and — the user's explicit call — **priced**, at an earned, variable,
jointly-ceilinged weight.

## Decisions

1. **One validator.** The wire payload is the existing import envelope plus a `meta` channel
   (`warnings/questions/skipped/sources`) that `parseImport` ignores and `wire/parse.ts` reads.
   Charity at the edge only: fence-stripping and outermost-brace slicing (`extractJson`), and a bare
   `{subjects, entries…}` from a model that forgot the envelope still imports.
2. **Type-locked prompt registry.** `wire/schema.ts` documents every field of every importable entity,
   locked with `satisfies Record<keyof T, FieldSpec>` — schema drift is a compile error. Constraint
   prose imports the exact contracts io.ts enforces (`TYPES`, `RELIABILITY_TAGS`, `ISO_DATE`,
   `TERM_KEY`). The prompt's worked example (`EXAMPLE_PAYLOAD`) is pushed through the real
   `parseImport` in tests with zero drops.
3. **Provenance = the reliability ladder.** Extracted marks carry `reliability` per the evidence class
   (official/returned/remembered/estimated/partial) — priced machinery the engine already has.
4. **Transcribe-only elicitations.** `selfPred`, `duels`, `meanCalls`, `allocations` score the
   STUDENT's skill: the prompt forbids invention, undocumented calls get `createdAt = today` (no
   backdated hindsight), and the review step flags them for explicit confirmation.
5. **AI forecasts live in one new field.** `Upcoming.aiPred?: {point, lo?, hi?, basis? (≤160)}`.
   Scored on the scorecard (`AI ERROR` row, `elicit.ai` derivation). EXPORT_VERSION 8 → 9.
6. **Priced on harsher terms than the student.** `quant/aipool.ts`: `fitAiWeight` mirrors
   `fitSelfWeight` (matched CRPS/abs-error, κ = `AI_POOL_KAPPA` = 4, toward 0, cap
   `AI_POOL_CAP` = 0.35 < 0.45). `poolNextExamJoint` is a three-way moment-matched mixture under the
   joint ceiling `POOL_CEIL` = 0.6 with proportional renormalization — the house model always keeps
   ≥ 40%. With one outside channel live it DELEGATES to `poolNextExam`, so the two mixtures cannot
   drift. Settings switch `aiWeighting` is inverse-convention (absent ⇒ OFF, stored only when true).
7. **Scoring integrity preserved.** `fitAiWeight` is fitted against `rawStats`; `aiPred` lives on
   `upcoming`, outside the register effect's inputs, so a wire call cannot re-run the replay that
   grades it. Exact identity on the committed fixture (no `upcoming` there): §21, `npm run gate` and
   `npm run gen:table` are byte-identical to pre-feature output.
8. **Idempotent re-paste.** Deterministic id recipes in the prompt (`s-<slug>`,
   `e-<ticker>-<date>-<slug>`, `u-…`, `alloc-<roundKey>`, `d-<n>`, `mc-<roundKey>-<n>`) ride the
   id-keyed merge; the prompt orders the AI to echo the current roster ids verbatim (sanitizer drops
   entries whose subject is not in the payload's own roster).
9. **UI: one staged modal.** `WireModal` (BUILD → COPY → PASTE): source checkboxes
   (documents/interview, ≥1), forecast toggle (with priced-channel warning + stronger-model note),
   history-embedding privacy toggle (default OFF — the prompt carries roster/terms/today, never
   marks); copy with clipboard + `execCommand` fallback and a .txt download; validate → manifest
   (NEW/UPDATED/DROPPED per section with lint reasons), AI meta surfaced, per-section include
   toggles, forecast include toggle, elicitation confirmation banner; Merge (primary) /
   Replace (armed double-click) through the existing `doMerge`/`doReplace`. Palette command
   `IMPORT VIA AI — THE WIRE`; launcher in Settings → Data.

## Files

`src/lib/wire/{schema,prompt,parse,review}.ts` (+ `wire.test.ts`) · `src/lib/quant/aipool.ts`
(+ test) · `src/components/modals/WireModal.tsx` (+ test) · touched: `types.ts`, `io.ts` (v9,
`sanitizeAiPred`, exported contracts), `elicit.ts` (`ai` row), `SittingModal` (preserve + read-only
display), `YouVsDeskCard` (`AI ERROR`, `AiWeightRow`), `scorecard/index.tsx`, `App.tsx` (`aiFit`,
`poolBoardJoint`, `aiCharge`, switch, modal, command), `quant/params.ts`, `quant/pool.ts`
(`stakedSittings` predicate), `derive/{facts,earned,skill,index}.ts` (`earn.ai`, `elicit.ai`),
README §25/§29.

## Verification

`npm test` (942 passing, 55 new) · `npm run gate` clean · `npm run gen:table` byte-identical to
pre-feature baseline · `npm run build` clean.
