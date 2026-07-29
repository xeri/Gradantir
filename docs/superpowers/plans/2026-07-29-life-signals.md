# Life-Signals Prediction Layer (§30) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. On execution start, copy this plan to `docs/superpowers/plans/2026-07-29-life-signals.md`.

**Goal:** Ingest the high-value-density student inputs (study sessions, sleep, topic mastery from marked papers, syllabus structure, disruptions, subject traits, psych profile), price them into next-exam forecasts through the existing earned-weight machinery, model subject structure (C/D/B axes → honest interval widths), and add a value-of-information layer — backend first, basic UI only.

**Architecture:** New stored slices on `AppData` (inputs only, never derived state) + a pure engine package `src/lib/quant/signals/` that is an exact identity on empty data + one new earned-weight channel that adjusts the **house** forecast (composing before the self/wire pool, like biascal — not under `POOL_CEIL`) + Wire sections so an external AI can transcribe data exhaust (marked papers → topic marks, sleep exports → rest logs, syllabus → topics/traits) + one new SIGNALS view.

**Tech Stack:** Existing only — Vite + React 18 + TS, vitest, hand-rolled stats/validation. No new dependencies.

## Global Constraints

- **Identity on the committed fixture is load-bearing.** `src/lib/__fixtures__/book.json` carries no signal data; `npm run gate`, README §21, `mark.book.test.ts`, `baseline.json` must be byte-identical throughout. Every task ends with `npm run gate` + `npm test` green.
- **Inputs are stored; outputs are computed.** No derived state on `AppData`. Sanitizers rebuild objects field-by-field. `EXPORT_VERSION` 9 → 10, one bump.
- **The two-board invariant:** every fit (`signalSkill` included) reads `rawStats`/the register; only boards read pooled/adjusted stats. Signal slices stay outside `replayRegister`'s inputs (`subjects`, `entries`, `settings`) — caveat: `Subject.traits`/`Settings.profile` ride the replay memo key, but replay never reads them, so re-runs are byte-identical (deterministic ids); document in a comment.
- **One credibility rule:** the channel weight comes from `quant/earned.ts` `earnedWeight`, never asserted. Constants in `quant/params.ts` with justification prose.
- **Switch polarity:** `signalWeighting` is a student-input switch — absent ⇒ ON, store only `false`.
- **Deviation-shaped terms doctrine (new, record in spec + README §30):** every signal *level* term measures deviation from the desk's own baseline (trailing norm, the model's own mean, typical exam weight), so constant habits ⇒ adj ≈ 0 and biascal cannot double-count. Static scalars (self-efficacy, absolute chronic sleep) are variance/VOI/display only.
- **Claim boundaries:** signals make a level claim on `nextExam` (house-side, earned-gated) + a variance claim (`sdMult`, ungated humility like the pool's disagreement term). They never touch the MARK, premia, ratings, the aggregate, or the register.
- Frozen `TODAY` in every test; `App.tsx` is the only place a real clock/`uid()` is allowed; memos keyed on the slices they read, never on `data`.
- **Change protocol (README §26)** applies to every commit: gate must not regress; core numbers generated, never hand-typed.

## Scope: spec-item → implementation map

| Spec inputs | Seat |
|---|---|
| #1 mocks, #8 homework trend | already `GradeEntry` (mock ⇒ type Exam — existing wire convention) |
| #2 topic mastery, #23 error taxonomy, #22 time-pressure (partial), #21 essay scores | `Topic` + `TopicMark` (linked to entries) → `mastery.ts` |
| #3 timetable, #16 exam density, #14 teacher grade | already `Upcoming` (+ new `hour?`); density stays future work if ablation-worthy |
| #4 hours, #5 spacing, #6 recall ratio, #28 tutoring, sleep×study interaction | `StudySession` → `stock.ts` |
| #7 coverage, #13 prerequisites, #15 attendance | `Topic.weightPct/prereqIds`, `Subject.attendancePct` → `mastery.ts` |
| #9–11 sleep (chronic/regularity/acute) | `RestLog` → `rest.ts` |
| #12 self-efficacy | `Subject.belief` → variance nudge + VOI only |
| #17 anxiety, #20 chronotype × exam hour | `Settings.profile` + `Upcoming.hour` → interaction terms |
| #24 disruptions | `Disruption` → `disrupt.ts` |
| C/D/B axes + knowledge/procedure/skill mixture | `Subject.traits`/`Subject.mix` → `traits.ts` (variance) + decay half-lives in `stock.ts`/`mastery.ts` |
| Effective study stock K(t) | `stock.ts` |
| Missing data / partial pooling | identity-on-absent design + `earnedWeight` shrinkage (native missingness) |
| VOI layer | `voi.ts` + VoiPanel |
| Validation discipline | `signalskill.ts` walk-forward vs register; `{drop}` ablation seam per term |
| **Cut (state in spec doc):** Tier 3 (spec authorizes), #26 grade boundaries + #27 question-exposure scraping (no scraping infra in a localStorage app), #19 distraction index (no OS API) | — |

## New stored types (`src/types.ts`)

```ts
export type SessionKind = "recall" | "practice" | "reading" | "class" | "tutoring";
export type ErrorKind = "careless" | "conceptual" | "procedural" | "time";
export type DisruptionKind = "illness" | "family" | "event" | "other";
export type Chronotype = "lark" | "owl";

export interface Topic { id: string; subjectId: string; name: string;
  weightPct?: number | null;        // share of assessed syllabus; absent ⇒ equal weight
  prereqIds?: string[]; }
export interface TopicMark { id: string; entryId: string; topicId: string;
  scorePct: number;                 // 0–100 on this topic's questions in that paper
  maxMarks?: number | null; errorKind?: ErrorKind | null; }
export interface StudySession { id: string; subjectId: string; date: string;
  minutes: number; kind: SessionKind; topicIds?: string[]; }
export interface RestLog { id: string; date: string; hours: number;
  bedtime?: string | null; }        // "HH:MM" as the sleep export states it
export interface Disruption { id: string; date: string;
  days?: number | null; kind: DisruptionKind; note?: string | null; }
export interface SubjectTraits { cumulativeness: number; determinism: number; breadth: number; } // 0–1
export interface SubjectMix { knowledge: number; procedure: number; skill: number; }             // sums to 1
export interface Profile { chronotype?: Chronotype | null; testAnxiety?: number | null; }        // anxiety 1–5
```

Field additions: `Subject += traits?: SubjectTraits|null; mix?: SubjectMix|null; belief?: number|null; attendancePct?: number|null` · `Settings += signalWeighting?: boolean; profile?: Profile|null` · `Upcoming += hour?: number|null` (0–23) · `AppData += topics?: Topic[]; topicMarks?: TopicMark[]; sessions?: StudySession[]; rest?: RestLog[]; disruptions?: Disruption[]`.

## Engine constants

`src/lib/quant/params.ts` (channel credibility, beside SELF/AI/READINESS, each with justification prose):
- `SIGNAL_KAPPA = 2` (exam rounds are scarce — readiness precedent)
- `SIGNAL_CAP = 0.35` (self-logged state, below `SELF_POOL_CAP = 0.45`)
- `SIGNAL_PRIOR = 0.3` (a state channel is worth something the moment data exists — readiness argument — but lower than `READINESS_PRIOR` because signals make a level claim on the forecast)

`src/lib/quant/signals/params.ts` (formula constants, package-local — pool.ts `Z90`/`SELF_DF` precedent):

| Constant | Value | Justification |
|---|---|---|
| `QUALITY` | recall 2.0 · practice 1.6 · tutoring 1.5 · class 1.0 · reading 0.8 | testing effect g ≈ 0.5–0.7 ⇒ ~1.5–2× per minute; rereading below classroom baseline |
| `HALF_LIFE` | knowledge 14d · procedure 45d · skill 120d; blend `H = exp(k·ln14 + p·ln45 + s·ln120)`; null mix ⇒ 45 | Ebbinghaus vs consolidation vs slow skills |
| `SPACING_MULT` | 1.15 if prev same-subject session 1–7d earlier; 1.0 same-day; 1.05 if gap > 7d | distributed-practice benefit 10–30%, conservative |
| `SHORT_SLEEP_H` / `ENCODING_PENALTY` | 6.0 / ×0.75 | sleep-deprived encoding deficit 20–40% |
| `STOCK_W` / `STOCK_FLOOR` | 2.0 pts / 240 eff-min | tanh cap on the whole hours channel (raw hours r ≈ 0.2) |
| `MASTERY_ALPHA` / `MASTERY_FLOOR_FRAC` | 0.4 / 0.6 | EWMA on repeat sightings; savings effect keeps ≥ 60% |
| `CARELESS_CREDIT` | 0.3 | careless miss reveals partial mastery but recurs under pressure |
| `PREREQ_HEADROOM` | 0.25 | in cumulative subjects a topic can't sit far above its prereqs |
| `MASTERY_W` / `MASTERY_SCALE` / `MASTERY_MIN_MARKS` | 3.0 pts / 8 / 3 topics | the largest term — only *measured* signal; ramps `min(1, nMarks/6)` |
| `REST_CHRONIC_W` / `REST_REG_W` / `REST_ACUTE_W` / `REST_MIN_NIGHTS` | 0.75 pts/h (cap −1.5) / 0.5 (cap −0.5) / 0.8 pts/h (cap −2) / 7 | modest r ≈ 0.1–0.2; deterioration-only |
| `DISRUPT_SEV` / `DISRUPT_TAU` / `DISRUPT_CAP` | illness 1.5 · family 1.5 · event 0.75 · other 1.0 / 10d / −2.5 | transient dummies, exponential recovery; duration mult `0.5 + 0.5·min(days,7)/7` |
| `ANX_W` / `CHRONO_W` | 1.5 / 0.75 | only the high-arousal Yerkes–Dodson arm, only on unusually heavy papers; synchrony ~0.05–0.1 sd |
| `TRAIT_MARKER_W` / `TRAIT_SAMPLING_W` / `TRAIT_SDMULT_CAP` | 0.20 / 0.15 / 1.4 | marker reliability adds ~15–25% sd on low-D; sampling luck on low-B, worse when mastery uneven |
| `SIGNAL_ADJ_CAP` | 4 pts | whole layer pre-gate (≈ `EFFORT_ACTUAL_W`); post-gate max ±1.4 |

## Engine modules (`src/lib/quant/signals/`)

All pure, all take `asOf: string`, all identity on empty inputs.

**`stock.ts`** — `StockRead { k14; baseline: number|null; term; recallRatio: number|null; hoursPerWeek: number|null }`, `studyStock(sessions, rest, mix, asOf)`. Effective minutes = `minutes · QUALITY[kind] · spacingMult · encodingMult(rest night of session date)`, decayed `exp(−ln2·Δt/H)`. `k14` = trailing 14d; `baseline` = per-day mean days 15–56 × 14 (null when span < 28d or < 3 sessions). Term = `STOCK_W · tanh((k14 − baseline)/max(baseline, STOCK_FLOOR))`; 0 when baseline null.

**`mastery.ts`** — `TopicMastery { topicId; m; mEff; lastTouched; n }`, `MasteryRead { topics; coverage: number|null; predictedPaper: number|null; term; unevenness }`. `topicMastery(topics, marks, sessions, entries, traits, asOf)`: EWMA per topic in entry-date order with careless credit; decay `mEff = m·(0.6 + 0.4·exp(−ln2·Δt/H))` from last touch (mark or session listing the topic); prereq gate `m' = (1−C)·mEff + C·min(mEff, meanPrereq + PREREQ_HEADROOM)`. `masteryRead(..., modelMean, attendancePct, asOf)`: `P = Σ wₜ·m'ₜ + uncoveredMass·(modelMean/100)` (uncovered topics neutral ⇒ pure deviation from the model's own call); attendance < 95 shaves covered mass by `(95−att)/100·0.5`. Term = `MASTERY_W · tanh((100P − modelMean)/MASTERY_SCALE) · min(1, nMarks/6)`; 0 unless ≥ 3 marked topics and coverage ≥ 0.3.

**`rest.ts`** — `RestRead { mean14; mean56; regSd; chronicTerm; regTerm; acuteTerm; nights }`, `restRead(rest, examDate, asOf)`. Chronic = `−REST_CHRONIC_W·clamp(mean56 − mean14, 0, 2)` (needs ≥ 7 nights window, ≥ 14 baseline). Regularity = `−REST_REG_W·clamp((sdBedtimeMin − 60)/60, 0, 1)` (absent bedtimes ⇒ 0). Acute fires only on a logged night `examDate − 1` with `hours < 6.5`: `−REST_ACUTE_W·(6.5 − hours)`, cap −2.

**`disrupt.ts`** — `disruptionTerm(disruptions, examDate) → { term; notes }`: Σ `SEV[kind]·durMult·exp(−max(0, exam − end)/DISRUPT_TAU)`, clamp −2.5.

**`traits.ts`** — `traitSdMult(traits, unevenness, timeErrorShare, belief)`: `clamp(1 + 0.20·(1−D) + 0.15·(1−B)·(1+unevenness) + (timeErrorShare ≥ 0.25 ? 0.05 : 0) + (belief ≤ 2 ? 0.05 : 0), 1, 1.4)`. Null traits contribute 0. Variance-only claim.

**`signalread.ts`** — the combiner:
```ts
export type SignalTermKey = "stock"|"mastery"|"rest"|"disruption"|"anxiety"|"chronotype"|"attendance";
export interface SignalTerm { key: SignalTermKey; pts: number; note: string; }
export interface SignalRead { subjectId: string; adj: number; sdMult: number; terms: SignalTerm[]; reasons: string[]; }
export interface SignalBook { topics; topicMarks; sessions; rest; disruptions; profile: Profile|null; }
export const emptySignalBook: SignalBook;
export function signalRead(sub, book, entries, next: {date; hour; weight}|null, modelMean, asOf,
  opts?: { drop?: ReadonlySet<SignalTermKey> }): SignalRead;
export function signalBoard(subjects, book, entries, upcoming, modelMeans: Map<string, number|null>, asOf): Map<string, SignalRead>;
```
Anxiety: `−ANX_W·max(0,(anx−3)/2)·clamp(weight/typicalExamWeight − 1, 0, 1)` (typical = median past exam `worthPct`, else 0). Chronotype: owl & hour ≤ 9 ⇒ −0.75; lark & hour ≥ 15 ⇒ −0.375; needs `hour`. `next` = soonest live exam sitting. `adj = clamp(Σ, ±SIGNAL_ADJ_CAP)`. `{drop}` is the per-term ablation seam (mirrors `pricesAsOf(...,{drop})`). Empty book + null traits/profile ⇒ `adj=0, sdMult=1, terms:[]` on every path.

**`apply.ts`** — `applySignals<T extends SubjectStat>(stats, reads, w, on): T[]`. Mirrors `correctNextExam`/`applyBias`: `mean' = clamp(mean + w·adj, 0, 100)`, half-widths × `sdMult` re-centred, `sd × sdMult`, df kept. Returns **the same array reference** when `!on` or nothing moves (one code path for off and unearned). `sdMult` applies ungated when on — a widening is a humility claim, like the pool's disagreement term.

**`signalskill.ts`** — the walk-forward scorer:
```ts
export interface SignalSkill extends EarnedWeight { rounds: number; }
export function signalSkill(register: ForecastLog[], book: SignalBook, subjects, entries, enabled): SignalSkill;
```
Filter register to `target === "exam" && realized != null`. Per log: cutoff = `log.resolvedAt`; as-of read via `bookBefore(cutoff)` (sessions/rest/disruptions by date, topicMarks by their entry's date; chronotype excluded — past sittings' hours unknowable), `next = {date: cutoff, hour: null, weight: resolved entry's worthPct}`, `modelMean = log.point`. **Skip rounds where `adj === 0 && sdMult === 1`** (no data ⇒ not evidence). Pairs, outcome-for-outcome, CRPS both sides via `scoreT`:
- `you[i] = scoreT({mean: clamp(log.point + adj, 0, 100), scale: log.sd·sdMult, df: log.df}, log.realized).crps`
- `model[i] = log.crps`

Then `earnedWeight(you, model, {kappa: SIGNAL_KAPPA, cap: SIGNAL_CAP, toward: SIGNAL_PRIOR})`. Zero scored rounds ⇒ `w = SIGNAL_PRIOR` (multiplies adj = 0 on an empty book, so fixture identity holds). `enabled: false` ⇒ identity object `w = 0`.

**`voi.ts`** — `VoiItem { subjectId; ticker; domain; action; gainPts; effortMin; score }`, `valueOfInformation(subjects, book, desks, todayIso)`. Deterministic heuristics: no rest book-wide ⇒ gain 1.5 / 10 min; no sessions ⇒ 2.0 per desk / 15 min-wk; no topics on a desk with sd ≥ 6 ⇒ `0.15·sd·1.64` / 10 min; topics but < 3 marked ⇒ `3.0·min(1, sd/8)` / 5 min-paper; traits unset ⇒ `0.2·sd·1.64` (interval honesty) / 2 min; profile unset ⇒ 0.75 / 1 min. `score = gainPts/(1 + effortMin/30)`, top 8. Copy: "LOG 14 NIGHTS OF SLEEP → TIGHTEN MATH CI90 BY ±1.5".

## App composition (`src/App.tsx`)

```
signalBook  = useMemo(bundle, [data?.topics, data?.topicMarks, data?.sessions, data?.rest, data?.disruptions, data?.settings.profile])
signalReads = useMemo(signalBoard(subjects, signalBook, entries, upcoming, meansOf(stats), today), [...])
signalFit   = useMemo(signalSkill(register, signalBook, subjects, entries, settings.signalWeighting !== false), [...])
signalled   = useMemo(applySignals(stats, signalReads, signalFit.w, settings.signalWeighting !== false), [...])
pooled      = poolBoardJoint(signalled, ...)   // one-word change to the existing memo
voi         = useMemo(valueOfInformation(...), [...])
```
Signals modify the **house** side (the desk's own read of the desk) so they compose before the outside-channel pool and are **not** under `POOL_CEIL`. `rawStats` untouched — all fits still read raw/register.

## Tasks

Each task: write failing test(s) → run to see fail → implement minimally → `npm test` + `npm run gate` green → commit. Follow repo test conventions (named vitest imports, frozen TODAY, file-level doc comment stating the invariant defended, regex text queries, `.book.` suffix only for fixture-locked tests).

### Task 1: Spec doc
- [ ] Write `docs/superpowers/specs/2026-07-29-life-signals-design.md` — Problem/Shape/Decisions/Files/Verification format (copy the wire spec's shape). Decisions to record: deviation-shaped terms doctrine; house-side seat (not under POOL_CEIL); state prior 0.3; belief/absolute-sleep demoted to variance/VOI; TopicMark dual-FK integrity rule; scope cuts (#19/#26/#27, Tier 3). Commit (docs only).

### Task 2: Types + io v10 + storage
**Files:** `src/types.ts`, `src/lib/io.ts`, `src/lib/storage.ts`, `src/lib/wire/schema.ts` (field maps only — `satisfies` locks break compile the moment Subject/Upcoming gain keys), tests `src/lib/io.test.ts`, `src/lib/storage.test.ts`.
- [ ] Failing tests in `io.test.ts`: v10 round-trip of all five slices + subject traits/mix/belief/attendance + profile + upcoming.hour + `signalWeighting: false` polarity; dropped-row cases (topicMark whose topic and entry disagree on subject; session topicIds filtered to that subject's topics; rest deduped by date last-wins, hours clamped 0–14; disruption days clamped 1–60; mix renormalised); a v9 file imports unchanged. `storage.test.ts`: `coerceStored` carries the new slices.
- [ ] Implement: types; `EXPORT_VERSION = 10` + doc paragraph; `SignalIntake` group interface (ForwardCalendar precedent); `sanitizeTopic/TopicMark/Session/Rest/Disruption`; extend `sanitizeSubject`/`sanitizeSettings`/`sanitizeUpcoming`; envelope emits new sections unconditionally (v8 doctrine); `mergeData` handles the new slices with subjectId remapping; `coerceStored` destructures them. Minimal `SUBJECT_FIELDS`/`UPCOMING_FIELDS` FieldSpec entries so `wire/schema.ts` compiles (full sections in Task 13).
- [ ] `npm test` + `npm run gate` green; commit.

### Task 3: Params
- [ ] `quant/params.ts`: `SIGNAL_KAPPA/SIGNAL_CAP/SIGNAL_PRIOR` with justification prose. New `quant/signals/params.ts` with the constants table above. Constants sanity test (caps positive, mix half-life blend monotone). Commit.

### Task 4: `signals/stock.ts` (+ test)
- [ ] Tests: identity on empty; quality/spacing/encoding multipliers by hand-values; half-life from mix; baseline gating (< 28d span ⇒ term 0); tanh cap; **deviation property** (constant logging ⇒ term ≈ 0); a session on a < 6h logged night encodes at 0.75.
- [ ] Implement; green; commit.

### Task 5: `signals/mastery.ts` (+ test)
- [ ] Tests: EWMA order; careless credit; decay refreshed by a session touching the topic; prereq gate scales with C; **uncovered-mass neutrality** (nothing covered ⇒ `100P === modelMean` ⇒ term 0); evidence ramp; min-marks/coverage gates; unevenness output.
- [ ] Implement; green; commit.

### Task 6: `signals/rest.ts` + `signals/disrupt.ts` (+ tests)
- [ ] Tests: min-nights gates; deterioration-only chronic (improving sleep ⇒ 0); bedtime-sd regularity (absent bedtimes ⇒ 0); acute needs the night-before row; disruption decay/caps/duration multiplier.
- [ ] Implement; green; commit.

### Task 7: `signals/traits.ts` (+ test)
- [ ] Tests: null ⇒ exactly 1; component caps; unevenness scaling; belief/time-error nudges; global cap 1.4.
- [ ] Implement; green; commit.

### Task 8: `signals/signalread.ts` (+ test)
- [ ] Tests: **empty-book identity on every path**; term assembly + ±4 clamp; anxiety requires stakes deviation; chronotype requires `hour`; `{drop}` removes exactly one term; deterministic reasons ordering (harshest first).
- [ ] Implement (including `signalBoard`); green; commit.

### Task 9: `signals/apply.ts` + fixture identity proof
**Files:** `signals/apply.ts`, `signals/apply.test.ts`, `signals/signals.book.test.ts`.
- [ ] Tests: interval math vs hand values; same-array-reference when `!on` or nothing moves; `signals.book.test.ts` — load the committed fixture, `applySignals(computeStats(...), signalBoard(fixture + emptySignalBook ...), 0.35, true)` **returns the same array reference**.
- [ ] Implement; run `npm run gate` AND `npm run gen:table`, confirm zero table diff; state so in the commit message (§26 protocol). Commit.

### Task 10: `signals/signalskill.ts` (+ test)
- [ ] Tests with a hand-built synthetic `ForecastLog[]` register + slices: as-of cutoff (a session dated on/after `resolvedAt` is excluded); adj-0 rounds skipped; CRPS pairing same-rule-both-sides; `w = SIGNAL_PRIOR` at zero scored rounds; w rises when adjusted CRPS beats raw; cap at 0.35; `enabled: false ⇒ w = 0`.
- [ ] Implement; green; commit.

### Task 11: `signals/voi.ts` (+ test)
- [ ] Tests: determinism; ranking; empty book produces bootstrap items; fully-instrumented book produces none.
- [ ] Implement; green; commit.

### Task 12: App wiring
**Files:** `src/App.tsx`, `src/App.boot.test.tsx` or a new jsdom test.
- [ ] The composition memos above, keyed on actual inputs; `pooled` reads `signalled`; comment on the replay effect re traits/profile churn being benign.
- [ ] Test: a book with signal slices renders without NaN; a book with empty slices renders numbers identical to pre-feature. Green; commit.

### Task 13: Wire sections + prompt
**Files:** `src/lib/wire/schema.ts`, `prompt.ts`, `parse.ts`, `review.ts`, `WireModal.tsx` (`SECTION_LABEL`), `wire.test.ts`.
- [ ] Five new `SectionSpec`s (`topics`, `topicMarks`, `sessions`, `rest`, `disruptions`) with id conventions (`t-<subject>-<slug>`, `tm-<entryId>-<topicId>`, `ss-<subject>-<date>-<n>`, `r-<date>`, `d-<date>-<kind>`) and transcribe notes ("transcribe the sleep export; never invent a night"); complete the Subject/Upcoming FieldSpecs from Task 2; prompt guidance blocks: PARSING A MARKED PAPER (per-question marks → per-topic %), PARSING A SLEEP EXPORT, ASSIGNING SUBJECT TRAITS from a syllabus; `EXAMPLE_PAYLOAD` rows per new section (golden test pushes them through real `parseImport`); `WireRaw` keys, `lintRow` cases, `filterPayload`.
- [ ] Registry-coverage test auto-asserts new fields render. Green; commit.

### Task 14: Ledger
- [ ] `lib/ledger.ts`: five new sections (`SectionKey`, `bookLedger`, `removeFromBook`, `clearSection`); rest rows read "2026-07-28 · 6.5H · BED 23:40". App remove-handler union extended. Update `ledger.test.ts`. Commit.

### Task 15: SIGNALS view shell
**Files:** `src/App.tsx` (View union + TABS + main switch + Scorecard-style props), `src/views/signals/index.tsx`, update `App.boot.test.tsx`/palette assertions (TABS 6 → 7).
- [ ] View with plain `Panel`s: `PricedBanner` (hosts the `signalWeighting` switch; shows earned `w`, `n`, and the per-desk `w·adj` quote) + per-desk terms table with per-term marginal pts via the `{drop}` seam. Static-markup `.book.test.tsx`. Commit.

### Task 16: Quick-log panels
- [ ] `src/views/signals/LogPanels.tsx`: study session (subject, minutes, kind, topic chips), rest night (hours, bedtime), disruption. Discrete events ⇒ file-on-submit (no drag, no draft needed). App handlers `update({sessions: [...]})` etc. jsdom test: logging one session appends exactly one row, touches no other slice. Commit.

### Task 17: Mastery panel + traits/profile editors
- [ ] `MasteryPanel.tsx` (per-topic mastery bars, coverage %, topic add/edit); `TraitsEditor.tsx` — **draft-then-commit** sliders for C/D/B, mix, belief, attendance, profile: local draft, one book write on COMMIT (whole-book serialisation rule). jsdom test: dragging fires zero saves; commit fires one. Commit.

### Task 18: VOI panel
- [ ] `VoiPanel.tsx` rendering `valueOfInformation` in terminal copy. Static-markup test. Commit.

### Task 19: Derivation layer
**Files:** `src/lib/derive/signals.ts`, `derive/index.ts`, `derive/types.ts` (DeriveCtx += `signalReads?/signalFit?/voi?`), `derive/facts.ts` if threading via ScorecardFacts, App `deriveCtx` memo, Signals view `<Derive>` triggers.
- [ ] Builders: `signal.adjust` (terms → `w·adj` walkthrough, reuse `creditSteps()` for the earned weight), `signal.stock`, `signal.mastery`, `signal.voi`. **Triggers wired in the same commit** — `derive.book.test.ts` dead-id check fails otherwise; update id-count assertions. Commit.

### Task 20: README §30 + close-out
- [ ] README §30 "Life signals — the state desk": doctrine (deviation-shaped terms, house-side seat, ungated variance claim, state prior, identity on the fixture), formulas with the constants, VOI. Finalize spec doc Verification with real numbers.
- [ ] Full verification: `npm test` all green · `npm run gate` clean · `npm run gen:table` byte-identical to pre-feature baseline · `npm run build` (tsc) clean. Commit.

## Existing tests at risk

| Test | Why | Handled in |
|---|---|---|
| `wire.test.ts` + compile | `satisfies` locks on Subject/Upcoming | T2 (fields), T13 (sections) |
| `io.test.ts` / `storage.test.ts` | version bump, envelope shape | T2 |
| `ledger.test.ts` | section count | T14 |
| `App.boot.test.tsx` / palette | TABS 6 → 7 | T15 |
| `derive.book.test.ts` | dead-id check, id counts | T19 |
| gate / `baseline.json` / `mark.book.test.ts` / §21 | must NOT move — engine untouched, identity proven | T9 |

## Verification (end-to-end)

1. `npm test` — full suite green at every task boundary.
2. `npm run gate` — walk-forward CRPS identical to `baseline.json` (fixture carries no signal data).
3. `npm run gen:table` — output byte-identical to pre-feature; §21 untouched.
4. `npm run build` — tsc clean (proves the `satisfies` locks are satisfied).
5. Manual smoke via `npm run dev`: log a study session + a sleep night on the demo book → SIGNALS view shows terms and a `w·adj` quote; toggle `signalWeighting` off → pooled numbers revert; Wire BUILD prompt now documents the five new sections.
