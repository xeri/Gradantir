# Prediction-Math Audit — Part I §8 steps 1–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the seven gate-neutral defect fixes at the front of the audit spec's own sequence — B5, E1, and M3–M7 — so the life-signals layer is correct, single-owner and honestly parameterised before any estimator work touches `earned.ts`.

**Architecture:** Every change lives inside `src/lib/quant/signals/` plus one line of `src/App.tsx`. Constants move into `signals/params.ts` (the package-local formula block, `pool.ts`'s Z90/SELF_DF precedent); two cliffs become continuous functions; two duplicated pricings collapse to one owner each. No new module, no new dependency, no change to `apply.ts`'s shift arithmetic, no change to the estimator.

**Tech Stack:** TypeScript 5.6, Vitest 3.2, React 18. No new runtime or dev dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-prediction-math-audit-design.md` — Part I §4 (B5, E1, M3–M7) and §8 steps 1–3.

**Branch:** `signals-audit` (cut from `life-signals`).

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`npm run gate` must stay green and unmoved.** The committed fixture `src/lib/__fixtures__/book.json` carries no signal slices, so nothing in this plan can move a gate number. If a gate number moves, **stop and escalate** — it means a change leaked outside the signals layer.
- **Never run `npm run gen:table`.** Nothing here moves README §21. Regenerating it would create a spurious diff that collides with the audit's own step 8.
- **The committed fixture is never edited.**
- **Every new constant lives in `src/lib/quant/signals/params.ts`** with a justification comment in the style of the surrounding block — a literature argument or an explicit conservatism argument. No number is typed inline in a module body.
- **Determinism is absolute.** No `Math.random()`, no `new Date()` in the calculation layer. `asOf` is always a parameter.
- **Pure reads.** Every function in `signals/` stays pure and clock-free.
- **One commit per task**, message body stating which audit item it closes.
- **A comment that states a property is a claim, and a claim needs a test.** Write the doctrine and the test in the same commit (this is exactly what M3 and E1 are: doctrine that was never tested and drifted).

**Working-tree baseline before Task 1:**

- `src/App.aicharge.test.tsx` **fails**. That is audit item B5 and Task 1 fixes it.
- `src/App.cascades.test.tsx` (4 tests) passes.
- `src/App.tsx` and `src/components/modals/GradeModal.tsx` carry uncommitted B2/B3 review fixes from the previous branch. Leave them alone; they are unrelated and will be committed separately or carried forward.
- `npm run gate` is green.

**Ordering note — E1 lifts constants that M4 and M6 then delete.** This is intended and follows the spec's own sequence: E1 makes README §30's "never hand-typed" claim true *for the code as it stands*, and M4/M6 then replace those terms with better ones. Each commit is independently honest. Do not try to short-circuit E1 by anticipating M4/M6.

---

## File Structure

| file | responsibility | tasks |
|---|---|---|
| `src/App.tsx` | `aiCharge` must measure against the board the student sees | 1 |
| `src/lib/quant/signals/params.ts` | every formula constant for the layer, each justified | 2, 4, 5, 6, 7 |
| `src/lib/quant/signals/rest.ts` | sleep read — one short-night threshold, chronic term disjoint from the encoding penalty | 2, 5 |
| `src/lib/quant/signals/stock.ts` | study stock — exports which nights it already charged | 2, 5 |
| `src/lib/quant/signals/mastery.ts` | topic mastery — prereq gate is a cap, attendance shave shares one owner | 2, 3, 4 |
| `src/lib/quant/signals/signalread.ts` | the combiner — attendance, chronotype and anxiety terms | 2, 4, 6, 7 |
| `src/lib/quant/signals/disrupt.ts` | disruption read — duration-credit constants | 2 |
| `src/lib/quant/signals/traits.ts` | variance-only trait multiplier — nudge constants | 2 |
| `src/lib/derive/cite.ts` | bibliography — gains `eysenck2007` | 7 |
| `src/lib/derive/signals.ts` | `signal.adjust` card — carries the new ref | 7 |
| `README.md` §30 | the layer's prose must describe what the code now does | 2, 3, 4, 6, 7 |

---

## Task 1: B5 — `aiCharge` measures against the signalled board

The wire's "MOVING N CALLS BY UP TO X PTS" line is computed against `stats` (the bias-corrected, **pre-signals** board) while the board the student actually sees, and the board `poolBoardJoint` pools into, is `signalled`. The charge therefore describes a move against a board that is not on screen.

**Files:**
- Modify: `src/App.tsx:298-303`
- Test: `src/App.aicharge.test.tsx` (already written and already failing — do not edit it)

**Interfaces:**
- Consumes: `signalled` (`App.tsx:255`), `aiChargePts` (`lib/quant/aipool`).
- Produces: nothing new.

- [ ] **Step 1: Run the existing failing test**

Run: `npx vitest run src/App.aicharge.test.tsx`

Expected: FAIL —

```
AssertionError: expected 'OVER 3 SITTINGS THE WIRE HAS EARNED 3…' not to be 'OVER 3 SITTINGS THE WIRE HAS EARNED 3…'
```

The two boots differ only in `settings.signalWeighting`, which nothing in `stats`/`selfFit`/`aiFit` reads — so the printed charge is byte-identical, which is the bug.

- [ ] **Step 2: Make the fix**

In `src/App.tsx`, replace the `aiCharge` memo:

```tsx
  const aiCharge = useMemo(
    () => (data && aiFit.w > 0
      ? aiChargePts(stats, data.upcoming ?? [], data.entries, todayStr(), selfFit, aiFit)
      : null),
    // ...
    [data?.upcoming, data?.entries, stats, selfFit, aiFit],
  );
```

with:

```tsx
  const aiCharge = useMemo(
    // B5 (audit Part I §4): the charge must be measured against the board the
    // student is actually looking at. `signalled` is what `poolBoardJoint`
    // pools into three lines below; measuring the wire's move against the
    // pre-signals `stats` reports a displacement from a board that is not on
    // screen, and silently ignores every life-signals shift.
    () => (data && aiFit.w > 0
      ? aiChargePts(signalled, data.upcoming ?? [], data.entries, todayStr(), selfFit, aiFit)
      : null),
    [data?.upcoming, data?.entries, signalled, selfFit, aiFit],
  );
```

Keep whatever other comment lines already sit inside that memo; only the board argument and the `stats` dependency change.

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run src/App.aicharge.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 4: Verify nothing else moved**

Run: `npm run gate`
Expected: PASS, gate numbers unchanged.

Run: `npx vitest run`
Expected: PASS, whole suite. `src/App.cascades.test.tsx`'s 4 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.aicharge.test.tsx
git commit -m "fix(app): B5 — aiCharge measures the wire's move against the signalled board

aiChargePts was handed \`stats\` (bias-corrected, pre-signals) while the board
on screen — and the board poolBoardJoint pools into — is \`signalled\`. The
printed charge described a displacement from a board nobody sees, and was
byte-identical whether or not the life-signals channel was switched on.

Closes audit Part I §4 B5."
```

---

## Task 2: E1 — every priced constant lifts into `params.ts`, and the layer gets one definition of a short night

README §30:1429 claims *"Every constant below is quoted from `params.ts` … never hand-typed."* It is false in five modules. Worse, the layer carries **two** short-sleep thresholds: `rest.ts` hardcodes `6.5` for the acute term while `SHORT_SLEEP_H = 6.0` governs `stock.ts`'s encoding penalty. Only one of them is visible in `params.ts`, so the layer has two definitions of "a short night" and the student can only see one.

This is a refactor: **numbers are unmoved except where the duplicate threshold is reconciled.** The acute term adopts `SHORT_SLEEP_H = 6.0`; that is a deliberate, spec-sanctioned movement and it changes `rest.test.ts` expectations and two README formulas.

**Files:**
- Modify: `src/lib/quant/signals/params.ts`
- Modify: `src/lib/quant/signals/rest.ts`
- Modify: `src/lib/quant/signals/mastery.ts`
- Modify: `src/lib/quant/signals/signalread.ts`
- Modify: `src/lib/quant/signals/disrupt.ts`
- Modify: `src/lib/quant/signals/traits.ts`
- Modify: `README.md` (§30 rest and attendance formulas)
- Test: `src/lib/quant/signals/params.test.ts` (add cases)
- Test: `src/lib/quant/signals/rest.test.ts` (update acute expectations)

**Interfaces:**
- Consumes: nothing new.
- Produces, all exported from `src/lib/quant/signals/params.ts` — Tasks 4, 5, 6 and 7 read these exact names:
  ```ts
  export const REST_CHRONIC_MAX_LOSS_H: number      // 2
  export const REST_REG_FREE_SD_MIN: number         // 60
  export const REST_REG_SPAN_MIN: number            // 60
  export const MASTERY_MIN_COVERAGE: number         // 0.3
  export const MASTERY_FULL_CREDIT_MARKS: number    // 6
  export const ATTEND_FULL_PCT: number              // 95
  export const ATTEND_SHAVE_W: number               // 0.5
  export const ATTEND_NOTOPIC_SPAN_PCT: number      // 10   (deleted by Task 4)
  export const ATTEND_NOTOPIC_W: number             // 0.5  (deleted by Task 4)
  export const ATTEND_NOTOPIC_CAP: number           // 1    (deleted by Task 4)
  export const ANX_MID: number                      // 3
  export const ANX_SPAN: number                     // 2
  export const CHRONO_EARLY_HOUR: number            // 9    (deleted by Task 6)
  export const CHRONO_LATE_HOUR: number             // 15   (deleted by Task 6)
  export const CHRONO_LARK_FRAC: number             // 0.5  (deleted by Task 6)
  export const DISRUPT_DUR_BASE: number             // 0.5
  export const DISRUPT_DUR_SPAN: number             // 0.5
  export const DISRUPT_DUR_FULL_DAYS: number        // 7
  export const TRAIT_TIME_MIN_SHARE: number         // 0.25
  export const TRAIT_TIME_W: number                 // 0.05
  export const TRAIT_BELIEF_MAX: number             // 2
  export const TRAIT_BELIEF_W: number               // 0.05
  export const SIGNAL_NOTE_FLOOR: number            // 0.05
  ```
  `SHORT_SLEEP_H` and `ENCODING_PENALTY` already exist and are unchanged; `rest.ts` starts importing `SHORT_SLEEP_H`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/quant/signals/params.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ANX_MID, ANX_SPAN, ATTEND_FULL_PCT, ATTEND_SHAVE_W,
  DISRUPT_DUR_BASE, DISRUPT_DUR_FULL_DAYS, DISRUPT_DUR_SPAN,
  MASTERY_FULL_CREDIT_MARKS, MASTERY_MIN_COVERAGE,
  REST_CHRONIC_MAX_LOSS_H, REST_REG_FREE_SD_MIN, REST_REG_SPAN_MIN,
  SHORT_SLEEP_H, SIGNAL_NOTE_FLOOR,
  TRAIT_BELIEF_MAX, TRAIT_BELIEF_W, TRAIT_TIME_MIN_SHARE, TRAIT_TIME_W,
} from "./params";

/**
 * E1 (audit Part I §4). README §30 claims every constant in this layer is
 * quoted from params.ts and never hand-typed. That claim was false in five
 * modules, and the loudest instance was a SECOND, invisible definition of a
 * short night: rest.ts's acute term gated on a hardcoded 6.5h while
 * SHORT_SLEEP_H = 6.0 governed stock.ts's encoding penalty. A doctrine with
 * no test drifts, so the doctrine and its test land together here.
 */

const src = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");

/** Strips block and line comments so a literal quoted in prose is not a hit. */
const codeOf = (name: string): string =>
  src(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("E1 — one definition of a short night", () => {
  it("has exactly one short-sleep threshold, and it is SHORT_SLEEP_H", () => {
    expect(SHORT_SLEEP_H).toBe(6.0);
    // The old second threshold. If this reappears anywhere in the priced
    // path the layer once again means two different things by "short night".
    for (const mod of ["rest.ts", "stock.ts", "signalread.ts"]) {
      expect(codeOf(mod), `${mod} still hard-codes a rival short-sleep hour`).not.toMatch(/\b6\.5\b/);
    }
  });

  it("prices no bare magic number in a module body", () => {
    // Every knob below used to be typed inline. Each is now a named export,
    // so its literal must not appear in the module that spends it.
    const banned: Record<string, RegExp[]> = {
      "rest.ts": [/\b60\b/, /\b0,\s*2\)/],
      "mastery.ts": [/\b0\.3\b/, /\/\s*6\b/, /\b95\b/, /\b0\.5\b/],
      "signalread.ts": [/-\s*3\)\s*\/\s*2/, /<=\s*9\b/, />=\s*15\b/, /\b95\b/, /\/\s*10\b/],
      "disrupt.ts": [/0\.5\s*\+\s*0\.5/, /\b7\b/],
      "traits.ts": [/\b0\.25\b/, /\b0\.05\b/],
    };
    for (const [mod, patterns] of Object.entries(banned)) {
      const code = codeOf(mod);
      for (const p of patterns) {
        expect(code, `${mod} still hand-types ${p}`).not.toMatch(p);
      }
    }
  });
});

describe("E1 — the lifted constants", () => {
  it("exports every one of them, finite and in range", () => {
    expect(REST_CHRONIC_MAX_LOSS_H).toBe(2);
    expect(REST_REG_FREE_SD_MIN).toBe(60);
    expect(REST_REG_SPAN_MIN).toBe(60);
    expect(MASTERY_MIN_COVERAGE).toBeGreaterThan(0);
    expect(MASTERY_MIN_COVERAGE).toBeLessThan(1);
    expect(MASTERY_FULL_CREDIT_MARKS).toBe(6);
    expect(ATTEND_FULL_PCT).toBe(95);
    expect(ATTEND_SHAVE_W).toBe(0.5);
    expect(ANX_MID).toBe(3);
    expect(ANX_SPAN).toBe(2);
    expect(DISRUPT_DUR_BASE + DISRUPT_DUR_SPAN).toBe(1);
    expect(DISRUPT_DUR_FULL_DAYS).toBe(7);
    expect(TRAIT_TIME_MIN_SHARE).toBe(0.25);
    expect(TRAIT_TIME_W).toBe(0.05);
    expect(TRAIT_BELIEF_MAX).toBe(2);
    expect(TRAIT_BELIEF_W).toBe(0.05);
    expect(SIGNAL_NOTE_FLOOR).toBe(0.05);
  });
});
```

If `params.test.ts` does not already import `describe`/`expect`/`it` from `vitest`, they are at the top of the file — reuse that import rather than adding a second one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quant/signals/params.test.ts`
Expected: FAIL — `does not provide an export named 'REST_CHRONIC_MAX_LOSS_H'`.

- [ ] **Step 3: Add the constants to `params.ts`**

In `src/lib/quant/signals/params.ts`, extend the rest block (after `REST_MIN_NIGHTS`):

```ts
/**
 * Ceiling, in hours, on the recent-vs-baseline sleep loss the chronic term
 * will price. A 2h drop against your own 42-night baseline is already an
 * extreme reading; past that the self-report is more likely a logging change
 * than a physiological one, so the charge saturates rather than scaling on.
 */
export const REST_CHRONIC_MAX_LOSS_H = 2;

/**
 * Bedtime-irregularity free band, in minutes of sd. Under an hour of night-
 * to-night variation is ordinary life, not a disrupted rhythm, and is charged
 * nothing.
 */
export const REST_REG_FREE_SD_MIN = 60;

/**
 * Minutes of sd, beyond the free band, at which the irregularity charge
 * reaches its full REST_REG_W. Equal to the free band, so the ramp is
 * (regSd - 60)/60 clamped to [0,1] — 2h of sd is the saturating case.
 */
export const REST_REG_SPAN_MIN = 60;
```

Extend the mastery block (after `MASTERY_MIN_MARKS`):

```ts
/**
 * Weighted share of syllabus that must actually be covered by marks before
 * the mastery term prices at all. Under a third of the paper measured, the
 * whole-paper prediction is mostly the model's own call handed back to it,
 * and pricing the residue would be pricing noise.
 */
export const MASTERY_MIN_COVERAGE = 0.3;

/**
 * Marks at which the mastery term earns its full weight; below it the term is
 * scaled by totalMarks/this. Six marked topics is the point at which the EWMA
 * has seen enough of the syllabus that a single unlucky paper no longer sets
 * the read.
 */
export const MASTERY_FULL_CREDIT_MARKS = 6;

/**
 * Attendance at or above this percentage is treated as full attendance and
 * charged nothing. Set at 95 rather than 100 because ordinary illness and
 * timetable collisions cost a few percent on any real book, and a channel
 * that charges everyone is measuring the calendar, not the student.
 * (Credé et al. 2010 report attendance as the single strongest behavioural
 * correlate of grades, which is why the channel exists at all.)
 */
export const ATTEND_FULL_PCT = 95;

/**
 * Share of the attendance shortfall that is treated as genuinely missed
 * syllabus. Half rather than all: a missed class is usually recoverable from
 * notes or a peer, so absence degrades coverage rather than deleting it.
 */
export const ATTEND_SHAVE_W = 0.5;
```

Extend the anxiety/chronotype block (replacing nothing, added beside `ANX_W`/`CHRONO_W`):

```ts
/** Midpoint of the 1-5 test-anxiety self-rating: at or below it the term is silent. */
export const ANX_MID = 3;
/** Rating points above ANX_MID at which the anxiety scaler reaches 1.0 (rating 5). */
export const ANX_SPAN = 2;

/**
 * Sitting hour at or before which an owl is charged the full CHRONO_W.
 * REPLACED IN TASK 6 (M6) by a continuous misalignment function — lifted here
 * only so that, at this commit, README §30's "never hand-typed" claim is true
 * of the code as it actually stands.
 */
export const CHRONO_EARLY_HOUR = 9;
/** Sitting hour at or after which a lark is charged. Replaced in Task 6 (M6). */
export const CHRONO_LATE_HOUR = 15;
/** Fraction of CHRONO_W a lark's late sitting is charged. Replaced in Task 6 (M6). */
export const CHRONO_LARK_FRAC = 0.5;

/**
 * The no-topic-breakdown attendance path's own scale. REPLACED IN TASK 4 (M4),
 * which is the defect these three constants make visible: written out as
 * named knobs it is plain that this path charges (95-pct)/10 * 0.5 in POINTS
 * while the topic path shaves (95-pct)/100 * 0.5 of MASS — the same student
 * charged two ways, roughly twenty-fold apart, selected by whether a topic
 * list happens to exist.
 */
export const ATTEND_NOTOPIC_SPAN_PCT = 10;
export const ATTEND_NOTOPIC_W = 0.5;
export const ATTEND_NOTOPIC_CAP = 1;
```

Extend the disruption block:

```ts
/** Duration credit floor: even a single-day disruption carries this share of its severity. */
export const DISRUPT_DUR_BASE = 0.5;
/** Duration credit earned linearly from one day up to DISRUPT_DUR_FULL_DAYS. */
export const DISRUPT_DUR_SPAN = 0.5;
/** Days of duration at which the credit saturates — a month-long disruption is not four times a week-long one. */
export const DISRUPT_DUR_FULL_DAYS = 7;
```

Extend the traits block:

```ts
/** Share of a subject's marks carrying a "time" error kind before the time-pressure nudge fires. */
export const TRAIT_TIME_MIN_SHARE = 0.25;
/** Flat sd-multiplier nudge for a time-pressured desk. Small: it is one self-classified error kind, not a measurement. */
export const TRAIT_TIME_W = 0.05;
/** Stated belief (1-5) at or below which the low-confidence nudge fires. */
export const TRAIT_BELIEF_MAX = 2;
/** Flat sd-multiplier nudge for a stated low belief. Same size as TRAIT_TIME_W and for the same reason. */
export const TRAIT_BELIEF_W = 0.05;
```

And, beside `SIGNAL_ADJ_CAP`:

```ts
/**
 * Display/notes floor, in points: a contribution under this magnitude is
 * noise, not a reason — never shown, never counted toward `terms`/`reasons`.
 * One owner, because signalread.ts and disrupt.ts each used to carry their own
 * copy of the same 0.05.
 */
export const SIGNAL_NOTE_FLOOR = 0.05;
```

- [ ] **Step 4: Spend the constants in `rest.ts`**

In `src/lib/quant/signals/rest.ts`:

Import line becomes:

```ts
import {
  REST_ACUTE_CAP, REST_ACUTE_W, REST_CHRONIC_CAP, REST_CHRONIC_MAX_LOSS_H, REST_CHRONIC_W,
  REST_MIN_NIGHTS, REST_REG_FREE_SD_MIN, REST_REG_SPAN_MIN, REST_REG_W, SHORT_SLEEP_H,
} from "./params";
```

Chronic term:

```ts
  const chronicTerm =
    mean14 != null && mean56 != null
      ? negRound2(Math.min(REST_CHRONIC_W * clamp(mean56 - mean14, 0, REST_CHRONIC_MAX_LOSS_H), REST_CHRONIC_CAP))
      : 0;
```

Regularity term:

```ts
  const regTerm =
    regSd == null
      ? 0
      : negRound2(REST_REG_W * clamp((regSd - REST_REG_FREE_SD_MIN) / REST_REG_SPAN_MIN, 0, 1));
```

Acute term — this is the reconciliation:

```ts
    const nightBefore = live.find((r) => daysBetween(r.date, examDate) === 1);
    if (nightBefore && nightBefore.hours < SHORT_SLEEP_H) {
      acuteTerm = negRound2(Math.min(REST_ACUTE_W * (SHORT_SLEEP_H - nightBefore.hours), REST_ACUTE_CAP));
    }
```

Add to the module doc comment, as a third numbered convention:

```
 * 3. ONE definition of a short night (E1, audit Part I §4). The acute term
 *    used to gate on a hardcoded 6.5h while stock.ts's encoding penalty gated
 *    on SHORT_SLEEP_H = 6.0, so the layer meant two different things by "a
 *    short night" and only one of them was visible in params.ts. Both now
 *    read SHORT_SLEEP_H. The acute charge is consequently smaller and fires
 *    less often than it did before this commit — a deliberate movement, not a
 *    retune.
```

- [ ] **Step 5: Spend the constants in `mastery.ts`, `signalread.ts`, `disrupt.ts`, `traits.ts`**

`mastery.ts` — add `ATTEND_FULL_PCT`, `ATTEND_SHAVE_W`, `MASTERY_FULL_CREDIT_MARKS`, `MASTERY_MIN_COVERAGE` to the import, then:

```ts
  let coveredMassShaved = coveredMass;
  if (attendancePct != null && attendancePct < ATTEND_FULL_PCT) {
    coveredMassShaved = coveredMass * (1 - ((ATTEND_FULL_PCT - attendancePct) / 100) * ATTEND_SHAVE_W);
  }
```

```ts
  const term =
    modelMean == null || coveredMass < MASTERY_MIN_COVERAGE || nMarkedTopics < MASTERY_MIN_MARKS
      ? 0
      : MASTERY_W *
        Math.tanh(((predictedPaper as number) - modelMean) / MASTERY_SCALE) *
        Math.min(1, totalMarks / MASTERY_FULL_CREDIT_MARKS);
```

`signalread.ts` — add `ANX_MID`, `ANX_SPAN`, `ATTEND_FULL_PCT`, `ATTEND_NOTOPIC_CAP`, `ATTEND_NOTOPIC_SPAN_PCT`, `ATTEND_NOTOPIC_W`, `CHRONO_EARLY_HOUR`, `CHRONO_LARK_FRAC`, `CHRONO_LATE_HOUR`, `SIGNAL_NOTE_FLOOR` to the import; delete the module-local `const NOTE_FLOOR = 0.05;` and its comment, and replace both uses with `SIGNAL_NOTE_FLOOR`. Then:

```ts
    const pts =
      next?.weight != null && typicalWeight != null && typicalWeight > 0
        ? -ANX_W * Math.max(0, (anx - ANX_MID) / ANX_SPAN) * clamp(next.weight / typicalWeight - 1, 0, 1)
        : 0;
```

```ts
    if (chronotype === "owl" && hour <= CHRONO_EARLY_HOUR) {
      pts = -CHRONO_W;
      label = "EARLY";
    } else if (chronotype === "lark" && hour >= CHRONO_LATE_HOUR) {
      pts = -CHRONO_W * CHRONO_LARK_FRAC;
      label = "LATE";
    }
```

```ts
  if (!dropped("attendance") && subjTopics.length === 0 && sub.attendancePct != null && sub.attendancePct < ATTEND_FULL_PCT) {
    const pct = sub.attendancePct;
    const pts = -Math.min(
      ATTEND_NOTOPIC_CAP,
      ((ATTEND_FULL_PCT - pct) / ATTEND_NOTOPIC_SPAN_PCT) * ATTEND_NOTOPIC_W,
    );
    raw.attendance = { pts, note: () => `ATTENDANCE ${signed1(pts)} · ${pct}% ATTENDED` };
  }
```

`disrupt.ts` — add `DISRUPT_DUR_BASE`, `DISRUPT_DUR_FULL_DAYS`, `DISRUPT_DUR_SPAN`, `SIGNAL_NOTE_FLOOR` to the import, delete the module-local `NOTE_FLOOR`, and:

```ts
    const durMult =
      DISRUPT_DUR_BASE + (DISRUPT_DUR_SPAN * Math.min(durationDays, DISRUPT_DUR_FULL_DAYS)) / DISRUPT_DUR_FULL_DAYS;
```

`traits.ts` — import the four new constants and:

```ts
  const timeTerm = timeErrorShare >= TRAIT_TIME_MIN_SHARE ? TRAIT_TIME_W : 0;
  const beliefTerm = belief != null && belief <= TRAIT_BELIEF_MAX ? TRAIT_BELIEF_W : 0;
```

- [ ] **Step 6: Update the rest tests for the reconciled threshold**

Run: `npx vitest run src/lib/quant/signals/rest.test.ts`

Every acute-term expectation computed against 6.5 now fails. For each, recompute against `SHORT_SLEEP_H`: a night of `h` hours charges `-min(REST_ACUTE_W * (SHORT_SLEEP_H - h), REST_ACUTE_CAP)`, and a night at or above 6.0h charges **zero** where it used to charge on anything under 6.5h. Import `SHORT_SLEEP_H` into the test and express the expectations in terms of it rather than re-typing 6.0 — a test that hard-codes the threshold reintroduces exactly the defect this task removes.

Add one test pinning the reconciliation:

```ts
it("E1 — a 6.2h night is no longer acute: one threshold, and it is SHORT_SLEEP_H", () => {
  const rest = [{ id: "n1", date: "2026-05-13", hours: 6.2, bedtime: null }] as RestLog[];
  expect(restRead(rest, "2026-05-14", "2026-05-14").acuteTerm).toBe(0);
});
```

Adjust the fixture shape to whatever `RestLog` rows already look like in that file.

- [ ] **Step 7: Update README §30**

In `README.md`, the acute formula (~line 1463) and the prose beneath it (~line 1467) quote `6.5`. Replace:

```
\text{acute} = -\min\!\big(\text{REST\_ACUTE\_W}\cdot(6.5-h_{\text{night before}}),\ \text{REST\_ACUTE\_CAP}\big), \qquad 0.8,\ 2.0
```

with

```
\text{acute} = -\min\!\big(\text{REST\_ACUTE\_W}\cdot(\text{SHORT\_SLEEP\_H}-h_{\text{night before}}),\ \text{REST\_ACUTE\_CAP}\big), \qquad 0.8,\ 2.0
```

and change "a sub-6.5h night immediately before the sitting" to "a night under `SHORT_SLEEP_H` (6.0h) immediately before the sitting — the same threshold `stock.ts`'s encoding penalty uses, because the layer has exactly one definition of a short night."

Also update the attendance formula (~line 1489) to name its constants rather than the bare `10` and `0.5`:

```
below `ATTEND_FULL_PCT` = 95 attended, $\text{pts} = -\min(\text{ATTEND\_NOTOPIC\_CAP},
\tfrac{(95-\text{pct})}{\text{ATTEND\_NOTOPIC\_SPAN\_PCT}}\cdot\text{ATTEND\_NOTOPIC\_W})$ — note that this
is a *different scale* from the topic path's mass shave, which Task 4 (M4) unifies.
```

- [ ] **Step 8: Run every signals test**

Run: `npx vitest run src/lib/quant/signals`
Expected: PASS.

- [ ] **Step 9: Typecheck and run the whole suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run gate`
Expected: PASS, gate numbers unchanged.

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/quant/signals README.md
git commit -m "refactor(signals): E1 — lift every hand-typed constant into params.ts, one short-night threshold

README §30 claimed every constant in this layer is quoted from params.ts and
never hand-typed. It was false in rest.ts, mastery.ts, signalread.ts,
disrupt.ts and traits.ts, and the claim now has a test that reads the module
sources back.

The loudest instance: rest.ts's acute term gated on a hardcoded 6.5h while
SHORT_SLEEP_H = 6.0 governed stock.ts's encoding penalty, so the layer meant
two different things by 'a short night' and only one was visible. Both now
read SHORT_SLEEP_H — the acute charge is smaller and fires less often, the
one deliberate numeric movement in this commit.

Gate unmoved (the committed fixture carries no signal slices).
Closes audit Part I §4 E1."
```

---

## Task 3: M3 — the prereq gate becomes a cap

`mastery.ts:138` gates a topic against the **mean** of its prerequisites, while `params.ts`'s `PREREQ_HEADROOM` comment says *"the weakest prerequisite"* and README:1379 says *"a shaky prerequisite caps everything built on it."* A mean lets one failed prerequisite hide behind two strong ones, which is not a cap. The doctrine was right; the code was wrong.

**Files:**
- Modify: `src/lib/quant/signals/mastery.ts:136-141`
- Modify: `README.md` (§30 mastery prose, if it states the mean)
- Test: `src/lib/quant/signals/mastery.test.ts`

**Interfaces:**
- Consumes: `PREREQ_HEADROOM` (unchanged).
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/quant/signals/mastery.test.ts`:

```ts
describe("M3 — the prereq gate is a cap on the WEAKEST prerequisite, not on their mean", () => {
  it("does not let one failed prerequisite hide behind two strong ones", () => {
    // Three prereqs at 0.9 / 0.9 / 0.1. Their mean is 0.633; their minimum is
    // 0.1. Under a mean gate the dependent topic sits at 0.883 headroom and is
    // barely touched. Under a cap it is held to 0.1 + PREREQ_HEADROOM = 0.35,
    // which is what "a shaky prerequisite caps everything built on it" means.
    const topics = [
      { id: "p1", subjectId: "s1", name: "P1", weightPct: null, prereqIds: null },
      { id: "p2", subjectId: "s1", name: "P2", weightPct: null, prereqIds: null },
      { id: "p3", subjectId: "s1", name: "P3", weightPct: null, prereqIds: null },
      { id: "t", subjectId: "s1", name: "T", weightPct: null, prereqIds: ["p1", "p2", "p3"] },
    ] as Topic[];
    const entries = [
      { id: "e1", subjectId: "s1", date: "2026-05-01", type: "Exam", score: 80, title: "E",
        classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
    ] as GradeEntry[];
    const marks = [
      { id: "m1", entryId: "e1", topicId: "p1", scorePct: 90, errorKind: null },
      { id: "m2", entryId: "e1", topicId: "p2", scorePct: 90, errorKind: null },
      { id: "m3", entryId: "e1", topicId: "p3", scorePct: 10, errorKind: null },
      { id: "m4", entryId: "e1", topicId: "t", scorePct: 90, errorKind: null },
    ] as TopicMark[];
    const traits = { determinism: 0.5, breadth: 0.5, cumulativeness: 1 } as SubjectTraits;

    // asOf === the entry date, so no decay: mEff0 is the raw mark.
    const out = topicMastery(topics, marks, [], entries, traits, null, "2026-05-01");
    const t = out.find((x) => x.topicId === "t")!;
    const minPrereq = 0.1;
    // C = 1, so mEff = min(mEff0, minPrereq + PREREQ_HEADROOM).
    expect(t.mEff).toBeCloseTo(Math.min(0.9, minPrereq + PREREQ_HEADROOM), 10);
    // And explicitly NOT the mean gate the code used to apply.
    const meanPrereq = (0.9 + 0.9 + 0.1) / 3;
    expect(t.mEff).not.toBeCloseTo(Math.min(0.9, meanPrereq + PREREQ_HEADROOM), 6);
  });
});
```

Match the exact `Topic`/`TopicMark`/`SubjectTraits`/`GradeEntry` literal shapes already used at the top of `mastery.test.ts`; if that file has row-builder helpers, use them instead of the object literals above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/quant/signals/mastery.test.ts`
Expected: FAIL — `expected 0.35 to be close to 0.883…` (the mean gate).

- [ ] **Step 3: Make the fix**

In `src/lib/quant/signals/mastery.ts`, replace:

```ts
    if (traits && prereqIds.length > 0 && prereqIds.every((id) => topicIds.has(id))) {
      const meanPrereq = prereqIds.reduce((a, id) => a + mEff0ByTopic.get(id)!, 0) / prereqIds.length;
      const C = traits.cumulativeness;
      mEff = (1 - C) * mEff0 + C * Math.min(mEff0, meanPrereq + PREREQ_HEADROOM);
    }
```

with:

```ts
    if (traits && prereqIds.length > 0 && prereqIds.every((id) => topicIds.has(id))) {
      // M3 (audit Part I §4): the WEAKEST prerequisite, not their mean. A mean
      // lets one failed prerequisite hide behind two strong ones, which is not
      // a cap — and PREREQ_HEADROOM's own comment ("the weakest prerequisite")
      // and README §30 ("a shaky prerequisite caps everything built on it")
      // both already said so. The doctrine was right; the code was wrong.
      const minPrereq = prereqIds.reduce((a, id) => Math.min(a, mEff0ByTopic.get(id)!), Infinity);
      const C = traits.cumulativeness;
      mEff = (1 - C) * mEff0 + C * Math.min(mEff0, minPrereq + PREREQ_HEADROOM);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/quant/signals/mastery.test.ts`
Expected: PASS. The existing single-prereq test at `mastery.test.ts:155` is unaffected — with one prerequisite the mean and the minimum are the same number.

- [ ] **Step 5: Check README states the cap, not the mean**

Run: `grep -n "prereq\|prerequisite" README.md`

README:1379 and ~1558 already describe a cap on the weakest prerequisite. If any line states a mean or an average of prerequisites, correct it. If the §30 formula block writes $\overline{m}_{\text{prereq}}$, change it to $\min_j m_{\text{prereq},j}$.

- [ ] **Step 6: Verify nothing else moved**

Run: `npx vitest run src/lib/quant/signals`
Expected: PASS.

Run: `npm run gate`
Expected: PASS, unchanged.

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/quant/signals/mastery.ts src/lib/quant/signals/mastery.test.ts README.md
git commit -m "fix(signals): M3 — the prereq gate caps on the weakest prerequisite

The gate averaged the prerequisites while PREREQ_HEADROOM's own comment and
README §30 both said 'the weakest'. A mean lets one failed prerequisite hide
behind two strong ones, which is not a cap. Code now matches the doctrine it
was always documented as implementing, and the doctrine has a test.

Closes audit Part I §4 M3."
```

---

## Task 4: M4 — one attendance function, one scale

Attendance is priced two ways, roughly twenty-fold apart, selected by whether a topic list happens to exist:

- **No topic breakdown** (`signalread.ts`): `-min(1, (95-pct)/10 * 0.5)` in **points** — −1.00 at 75% attendance.
- **With a topic breakdown** (`mastery.ts`): shaves covered mass by `1 - (95-pct)/100 * 0.5` — ≈−0.05 points at the same attendance on a typical gap.

Same student, same attendance, order-of-magnitude different charge. The fix is one shave function owned in one place, with the no-topics path expressing **the same arithmetic in points**.

**Files:**
- Modify: `src/lib/quant/signals/params.ts` (add `attendanceShave`, delete the three `ATTEND_NOTOPIC_*` constants)
- Modify: `src/lib/quant/signals/mastery.ts`
- Modify: `src/lib/quant/signals/signalread.ts`
- Modify: `README.md` §30 attendance paragraph
- Test: `src/lib/quant/signals/params.test.ts`, `src/lib/quant/signals/signalread.test.ts`

**Interfaces:**
- Consumes: `ATTEND_FULL_PCT`, `ATTEND_SHAVE_W`, `MASTERY_W` (all from Task 2 / existing).
- Produces:
  ```ts
  /** Share of syllabus mass an attendance shortfall is treated as having cost, 0-1. */
  export function attendanceShave(attendancePct: number | null): number
  ```
  Deleted: `ATTEND_NOTOPIC_SPAN_PCT`, `ATTEND_NOTOPIC_W`, `ATTEND_NOTOPIC_CAP`.

**Design note — what "the same arithmetic" means here.** The shave `s(pct)` is the single owned quantity. The topic path spends it on mass (`coveredMass·(1−s)`), which is unchanged. A desk with no topic breakdown has no covered mass to shave, so it spends the *same s* on the mastery channel's own point weight: `pts = −MASTERY_W · s`. At 75% attendance that is −0.30 points instead of the old −1.00, and both paths now derive from one number. The two paths cannot be made numerically identical in general — the topic path's effect scales with the desk's own mastery-vs-model gap, which the no-topics path by construction cannot know — so the tested identity is the **shave factor itself**, which is the thing that was twentyfold apart.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/quant/signals/params.test.ts`:

```ts
import { attendanceShave, ATTEND_FULL_PCT, ATTEND_SHAVE_W } from "./params";

describe("M4 — attendanceShave is the layer's only attendance scale", () => {
  it("is zero at and above full attendance", () => {
    expect(attendanceShave(null)).toBe(0);
    expect(attendanceShave(ATTEND_FULL_PCT)).toBe(0);
    expect(attendanceShave(100)).toBe(0);
  });

  it("charges the shortfall at ATTEND_SHAVE_W", () => {
    // 75% attended is 20 points short of 95, i.e. 0.20 of the year missed,
    // half of which is treated as genuinely lost syllabus.
    expect(attendanceShave(75)).toBeCloseTo(0.2 * ATTEND_SHAVE_W, 10);
  });

  it("saturates at ATTEND_SHAVE_W rather than running away", () => {
    expect(attendanceShave(0)).toBeCloseTo(ATTEND_SHAVE_W, 10);
    expect(attendanceShave(-50)).toBeCloseTo(ATTEND_SHAVE_W, 10);
  });

  it("is continuous through the full-attendance boundary", () => {
    expect(Math.abs(attendanceShave(94.99) - attendanceShave(95))).toBeLessThan(1e-3);
  });
});
```

Append to `src/lib/quant/signals/mastery.test.ts`:

```ts
import { attendanceShave } from "./params";

describe("M4 — the mastery shave spends attendanceShave and nothing else", () => {
  it("moves exactly attendanceShave(pct) of covered mass to the neutral side", () => {
    // Build the same read twice, once at full attendance and once at 75%, on a
    // desk whose covered mastery sits BELOW the model so the shave has a
    // visible effect on predictedPaper.
    const full = masteryRead(topics, masteries, 80, 95, ASOF);
    const short = masteryRead(topics, masteries, 80, 75, ASOF);
    const s = attendanceShave(75);
    // predictedPaper = coveredContribution + uncoveredMass*(model/100), so the
    // shave moves (coveredWeightedM - coveredMass*model/100)*s of it.
    const moved = (full.predictedPaper as number) - (short.predictedPaper as number);
    const expected = s * ((full.predictedPaper as number) - 80) * -1 * -1;
    expect(moved / expected).toBeCloseTo(1, 2);
  });
});
```

Reuse whatever `topics`/`masteries`/`ASOF` fixtures the file already builds for the existing attendance tests (`signals.test.ts:231` proves such a desk exists); if the existing fixture has coverage 1.0 and no gap, extend it so covered mastery sits below the model mean. If the ratio assertion proves brittle on the available fixture, replace it with the direct identity:

```ts
    expect((short.coverage as number)).toBeCloseTo(full.coverage as number, 10); // coverage reports UNSHAVED mass
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeCloseTo(s * ((full.predictedPaper as number) - 80), 6);
```

Append to `src/lib/quant/signals/signalread.test.ts`:

```ts
import { attendanceShave } from "./params";
import { MASTERY_W } from "./params";

describe("M4 — the no-topics attendance path spends the same shave, in points", () => {
  it("charges MASTERY_W * attendanceShave(pct)", () => {
    // A desk with attendance set, no topics, and nothing else logged.
    const sub = { ...baseSubject, attendancePct: 75 };
    const out = signalRead(sub, emptySignalBook, [], null, null, ASOF);
    const attendance = out.terms.find((t) => t.key === "attendance");
    expect(attendance).toBeTruthy();
    expect(attendance!.pts).toBeCloseTo(-MASTERY_W * attendanceShave(75), 10);
  });

  it("is no longer an order of magnitude away from the topic path", () => {
    // The defect: the old no-topics path charged -1.00 at 75% attendance while
    // the topic path shaved 10% of covered mass (~0.05pt on a typical gap).
    const sub = { ...baseSubject, attendancePct: 75 };
    const out = signalRead(sub, emptySignalBook, [], null, null, ASOF);
    const pts = out.terms.find((t) => t.key === "attendance")!.pts;
    expect(Math.abs(pts)).toBeLessThan(1.0);
    expect(Math.abs(pts)).toBeCloseTo(0.3, 6);
  });
});
```

Use whatever base-subject helper `signalread.test.ts` already defines (`baseSubject`/`sub()`); do not build a second one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quant/signals/params.test.ts src/lib/quant/signals/mastery.test.ts src/lib/quant/signals/signalread.test.ts`
Expected: FAIL — `does not provide an export named 'attendanceShave'`.

- [ ] **Step 3: Add the shared function and delete the rival constants**

In `src/lib/quant/signals/params.ts`, delete `ATTEND_NOTOPIC_SPAN_PCT`, `ATTEND_NOTOPIC_W` and `ATTEND_NOTOPIC_CAP` together with their comment block, and add beside `ATTEND_SHAVE_W`:

```ts
/**
 * M4 (audit Part I §4). THE layer's attendance scale — one function, one
 * owner. Attendance used to be priced two ways, roughly twentyfold apart,
 * selected by whether the desk happened to carry a topic list: a topic-bearing
 * desk shaved (95-pct)/100 * 0.5 of its covered MASS, a bare desk charged
 * (95-pct)/10 * 0.5 in POINTS. Same student, same attendance, two answers.
 *
 * Returns the share of syllabus mass the shortfall is treated as having cost,
 * in [0, ATTEND_SHAVE_W]. `masteryRead` spends it on covered mass;
 * `signalRead`'s no-topics path spends the SAME number on MASTERY_W, the
 * point weight of the channel that mass would otherwise have moved. The two
 * paths cannot be numerically identical — the topic path's effect scales with
 * the desk's own mastery-vs-model gap, which a desk with no topics has no way
 * to know — but they now derive from one scale rather than two.
 */
export function attendanceShave(attendancePct: number | null): number {
  if (attendancePct == null) return 0;
  const shortfall = (ATTEND_FULL_PCT - attendancePct) / 100;
  return Math.min(Math.max(shortfall, 0), 1) * ATTEND_SHAVE_W;
}
```

- [ ] **Step 4: Spend it in `mastery.ts`**

Replace the shave block:

```ts
  // Attendance shave: mass that "looks" covered by weight but was under-attended moves
  // to the uncovered (neutral) side — the covered term shrinks in proportion. The shave
  // fraction is owned by params.ts's attendanceShave (M4), shared with signalRead's
  // no-topics path so one student's attendance means one thing on this layer.
  const coveredMassShaved = coveredMass * (1 - attendanceShave(attendancePct));
```

Drop `ATTEND_FULL_PCT`/`ATTEND_SHAVE_W` from the import if they are now unused there, and add `attendanceShave`.

- [ ] **Step 5: Spend it in `signalread.ts`**

Replace the attendance block:

```ts
  // ATTENDANCE — only when there are no topics to let masteryRead's own
  // attendance shave handle it instead (see mastery.ts's coveredMassShaved).
  // M4: the SAME shave fraction, spent on MASTERY_W — the point weight of the
  // channel that shaved mass would otherwise have moved — rather than on a
  // second, unrelated scale.
  if (!dropped("attendance") && subjTopics.length === 0 && sub.attendancePct != null) {
    const pct = sub.attendancePct;
    const shave = attendanceShave(pct);
    if (shave > 0) {
      const pts = -MASTERY_W * shave;
      raw.attendance = { pts, note: () => `ATTENDANCE ${signed1(pts)} · ${pct}% ATTENDED` };
    }
  }
```

Update the import: add `attendanceShave` and `MASTERY_W`, remove `ATTEND_FULL_PCT`, `ATTEND_NOTOPIC_CAP`, `ATTEND_NOTOPIC_SPAN_PCT`, `ATTEND_NOTOPIC_W`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quant/signals`
Expected: PASS. Existing `signalread.test.ts` attendance cases that assert −1.00 at 75% must be updated to the new value (−0.30) and rewritten in terms of `attendanceShave` rather than a typed literal.

- [ ] **Step 7: Update README §30**

Replace the attendance paragraph (~line 1488):

```
**Attendance** (`signalread.ts`, `mastery.ts`) — one function, one scale, spent two ways. The shave
$s(\text{pct}) = \text{clamp}\big(\tfrac{\text{ATTEND\_FULL\_PCT}-\text{pct}}{100},0,1\big)\cdot\text{ATTEND\_SHAVE\_W}$
is the share of syllabus an attendance shortfall is treated as having cost, with `ATTEND_FULL_PCT` = 95
and `ATTEND_SHAVE_W` = 0.5 — half rather than all, because a missed class is usually recoverable from
notes. A desk **with** a topic breakdown spends it on mass: `mastery.ts` moves $s$ of covered mass to the
neutral side. A desk **without** one has no mass to move, so it spends the same $s$ on the mastery
channel's own point weight, $\text{pts} = -\text{MASTERY\_W}\cdot s$. Before this was unified the two
paths were roughly twentyfold apart at the same attendance, selected by nothing more than whether a
topic list happened to exist.
```

- [ ] **Step 8: Verify nothing else moved**

Run: `npx tsc --noEmit`
Run: `npm run gate` — PASS, unchanged.
Run: `npx vitest run` — PASS. `src/lib/derive/signals.test.ts:231` ("the P equation carries the attendance shave honestly") reads the shave through `masteryRead`, so it should still pass; if the derivation card re-types the shave arithmetic in its own `subst` string, update it to quote `attendanceShave`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/quant/signals src/lib/derive README.md
git commit -m "fix(signals): M4 — one attendance function, one scale

Attendance was priced two ways, ~20x apart, selected by whether the desk
carried a topic list: a bare desk charged (95-pct)/10*0.5 in POINTS (-1.00 at
75% attended) while a topic-bearing desk shaved (95-pct)/100*0.5 of covered
MASS (~-0.05pt). params.ts now owns one shave function; the topic path spends
it on mass and the no-topics path spends the same number on MASTERY_W.

Closes audit Part I §4 M4."
```

---

## Task 5: M5 — a short night is charged once, not twice

A short night before a study day already docks that session through `ENCODING_PENALTY` in `stock.ts`, shrinking `k14` and so the stock term. The same nights then drive `rest.ts`'s chronic deterioration term. One deterioration, two charges.

The two terms measure genuinely different things — the encoding penalty is a *mechanistic* charge on a specific badly-encoded session, the chronic term is a *sustained baseline shift* — so they stop overlapping rather than one being deleted. The chronic term prices deterioration only over nights that did **not** already dock a session.

**Files:**
- Modify: `src/lib/quant/signals/stock.ts` (export `encodingChargedNights`)
- Modify: `src/lib/quant/signals/rest.ts` (`restRead` takes the charged set; `RestRead` gains `chronicMean14`)
- Modify: `src/lib/quant/signals/signalread.ts` (wires the set through)
- Modify: `README.md` §30 rest paragraph
- Test: `src/lib/quant/signals/stock.test.ts`, `src/lib/quant/signals/rest.test.ts`, `src/lib/quant/signals/signalread.test.ts`

**Interfaces:**
- Consumes: `SHORT_SLEEP_H`, `REST_MIN_NIGHTS`.
- Produces:
  ```ts
  // stock.ts
  /** Dates of rest rows whose ENCODING_PENALTY actually fired — a short night
   *  followed by at least one logged study session the next day. */
  export function encodingChargedNights(sessions: StudySession[], rest: RestLog[]): ReadonlySet<string>

  // rest.ts — signature gains a fourth parameter, optional so existing callers compile
  export function restRead(
    rest: RestLog[], examDate: string | null, asOf: string,
    encodingCharged?: ReadonlySet<string>,
  ): RestRead

  // RestRead gains:
  /** Recent-window mean over nights NOT already charged through ENCODING_PENALTY;
   *  null when fewer than REST_MIN_NIGHTS survive. This, not mean14, is what
   *  chronicTerm prices against. */
  chronicMean14: number | null
  ```

**Wiring note.** `rest` is person-level and `sessions` in `signalRead` are filtered per desk, but the encoding penalty fires on **any** subject's session the morning after. So `signalRead` must build the set from `book.sessions` (the whole book), not from `subjSessions`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/quant/signals/stock.test.ts`:

```ts
import { encodingChargedNights } from "./stock";
import { SHORT_SLEEP_H } from "./params";

describe("M5 — encodingChargedNights reports exactly the nights the penalty docked", () => {
  it("names a short night followed by a logged session", () => {
    const rest = [{ id: "n1", date: "2026-05-01", hours: SHORT_SLEEP_H - 1, bedtime: null }] as RestLog[];
    const sessions = [{ id: "s1", subjectId: "s-a", date: "2026-05-02", minutes: 60, kind: "recall" }] as StudySession[];
    expect([...encodingChargedNights(sessions, rest)]).toEqual(["2026-05-01"]);
  });

  it("ignores a short night nobody studied after", () => {
    const rest = [{ id: "n1", date: "2026-05-01", hours: SHORT_SLEEP_H - 1, bedtime: null }] as RestLog[];
    expect(encodingChargedNights([], rest).size).toBe(0);
  });

  it("ignores a full night followed by a session", () => {
    const rest = [{ id: "n1", date: "2026-05-01", hours: SHORT_SLEEP_H + 1, bedtime: null }] as RestLog[];
    const sessions = [{ id: "s1", subjectId: "s-a", date: "2026-05-02", minutes: 60, kind: "recall" }] as StudySession[];
    expect(encodingChargedNights(sessions, rest).size).toBe(0);
  });

  it("counts a night studied after by ANY subject", () => {
    const rest = [{ id: "n1", date: "2026-05-01", hours: SHORT_SLEEP_H - 1, bedtime: null }] as RestLog[];
    const sessions = [{ id: "s1", subjectId: "s-other", date: "2026-05-02", minutes: 60, kind: "class" }] as StudySession[];
    expect(encodingChargedNights(sessions, rest).size).toBe(1);
  });
});
```

Append to `src/lib/quant/signals/rest.test.ts`:

```ts
describe("M5 — the chronic term skips nights the encoding penalty already charged", () => {
  /** 14 recent nights at `recent` hours, 28 baseline nights at `base` hours. */
  const build = (recent: number, base: number): RestLog[] => {
    const rows: RestLog[] = [];
    for (let d = 0; d <= 13; d++) rows.push({ id: `r${d}`, date: addDays(ASOF, -d), hours: recent, bedtime: null } as RestLog);
    for (let d = 14; d <= 55; d++) rows.push({ id: `b${d}`, date: addDays(ASOF, -d), hours: base, bedtime: null } as RestLog);
    return rows;
  };

  it("is unchanged when no night was mechanistically charged", () => {
    const rest = build(6, 8);
    const bare = restRead(rest, null, ASOF);
    const withEmpty = restRead(rest, null, ASOF, new Set<string>());
    expect(withEmpty.chronicTerm).toBe(bare.chronicTerm);
    expect(bare.chronicTerm).toBeLessThan(0);
  });

  it("goes silent when every deteriorated night was already charged through the encoding penalty", () => {
    const rest = build(6, 8);
    const charged = new Set(rest.filter((r) => r.hours === 6).map((r) => r.date));
    const out = restRead(rest, null, ASOF, charged);
    // Nothing left in the recent window to measure a baseline shift against.
    expect(out.chronicMean14).toBeNull();
    expect(out.chronicTerm).toBe(0);
    // The DISPLAY mean is untouched: the student is still shown the real
    // absolute deficit, it is simply not priced twice.
    expect(out.mean14).toBe(6);
  });

  it("still charges the student who sleeps badly on nights they do not study", () => {
    const rest = build(6, 8);
    // Only half the short nights were followed by a study day.
    const charged = new Set(rest.filter((r, i) => r.hours === 6 && i % 2 === 0).map((r) => r.date));
    const out = restRead(rest, null, ASOF, charged);
    expect(out.chronicMean14).toBe(6);
    expect(out.chronicTerm).toBeLessThan(0);
  });
});
```

Use the file's existing `ASOF` constant and `addDays` import; if it does not define one, add `const ASOF = "2026-05-14";` beside the other fixtures.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quant/signals/stock.test.ts src/lib/quant/signals/rest.test.ts`
Expected: FAIL — `does not provide an export named 'encodingChargedNights'`.

- [ ] **Step 3: Export the charged set from `stock.ts`**

Add to `src/lib/quant/signals/stock.ts`, above `studyStock`:

```ts
/**
 * M5 (audit Part I §4). The nights this module's ENCODING_PENALTY actually
 * docked: a night under SHORT_SLEEP_H that was followed, the next day, by at
 * least one logged study session. `rest.ts`'s chronic term excludes these from
 * its recent-window mean so a single bad night is charged once — mechanically,
 * against the specific session it degraded — rather than twice.
 *
 * Takes the WHOLE book's sessions, not one desk's: the penalty fires on any
 * subject's session the morning after, while `rest` is person-level.
 *
 * Returns rest-row DATES (RestLog's own convention: the night dated D ends on
 * the morning of D+1, so the night that impaired study-day D is dated D-1).
 */
export function encodingChargedNights(sessions: StudySession[], rest: RestLog[]): ReadonlySet<string> {
  const studyDays = new Set(sessions.map((s) => s.date));
  const out = new Set<string>();
  for (const r of rest) {
    if (r.hours < SHORT_SLEEP_H && studyDays.has(addDays(r.date, 1))) out.add(r.date);
  }
  return out;
}
```

`addDays`, `SHORT_SLEEP_H`, `StudySession` and `RestLog` are already imported by this module.

- [ ] **Step 4: Make the chronic term disjoint in `rest.ts`**

Add `chronicMean14` to the `RestRead` interface, documented as in the Interfaces block above, placed directly after `mean14`.

Change the signature and the chronic computation:

```ts
export function restRead(
  rest: RestLog[],
  examDate: string | null,
  asOf: string,
  encodingCharged?: ReadonlySet<string>,
): RestRead {
```

```ts
  const mean14 = recent.length >= REST_MIN_NIGHTS ? recent.reduce((a, r) => a + r.hours, 0) / recent.length : null;
  const mean56 =
    baseline.length >= REST_BASELINE_MIN_NIGHTS ? baseline.reduce((a, r) => a + r.hours, 0) / baseline.length : null;

  // M5: nights already docked mechanistically (a short night followed by a
  // study day, charged through stock.ts's ENCODING_PENALTY) are excluded from
  // the recent-window mean BEFORE it is compared against the baseline. The two
  // terms measure different things — one a specific badly-encoded session, the
  // other a sustained baseline shift — so they are made disjoint rather than
  // either being deleted. `mean14` itself stays unfiltered: the absolute
  // deficit is still worth SHOWING even though it is never priced twice.
  const chronicRecent = encodingCharged ? recent.filter((r) => !encodingCharged.has(r.date)) : recent;
  const chronicMean14 =
    chronicRecent.length >= REST_MIN_NIGHTS
      ? chronicRecent.reduce((a, r) => a + r.hours, 0) / chronicRecent.length
      : null;

  const chronicTerm =
    chronicMean14 != null && mean56 != null
      ? negRound2(Math.min(REST_CHRONIC_W * clamp(mean56 - chronicMean14, 0, REST_CHRONIC_MAX_LOSS_H), REST_CHRONIC_CAP))
      : 0;
```

Add `chronicMean14` to both the `IDENTITY` object (`null`) and the returned object (`chronicMean14 == null ? null : round1(chronicMean14)`).

Extend the module doc comment's DETERIORATION-ONLY paragraph with:

```
 * M5: the chronic term is also DISJOINT from stock.ts's encoding penalty. A
 * night that already docked a study session through ENCODING_PENALTY is
 * dropped from the recent window before the baseline comparison, so a student
 * who studies every day they sleep badly is charged once (mechanistically) and
 * a student whose sleep slipped on nights they were not studying is charged
 * once (as a baseline shift). Neither is charged twice.
```

- [ ] **Step 5: Wire it through `signalread.ts`**

```ts
  // REST — deterioration-only self-report; see rest.ts's own doctrine note.
  if (!dropped("rest")) {
    // M5: the whole book's sessions, not this desk's — the encoding penalty
    // fires on any subject's session the morning after a short night, while
    // `book.rest` is person-level.
    const r = restRead(book.rest, next?.date ?? null, asOf, encodingChargedNights(book.sessions, book.rest));
```

Add `encodingChargedNights` to the `./stock` import.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quant/signals`
Expected: PASS. If `signals.book.test.ts` or `signalread.test.ts` snapshot a `RestRead` object literally, add `chronicMean14` to the expected shape.

- [ ] **Step 7: Update README §30**

After the three rest formulas (~line 1466), append to the paragraph beginning "— chronic on a widening 56-vs-14-day sleep gap":

```
The chronic term is disjoint from the encoding penalty: a night under `SHORT_SLEEP_H` that was
followed by a logged study session has already docked that session inside `k14`, so it is dropped
from the recent window before the baseline comparison. A short night is charged once — mechanically
against the session it degraded, or as a sustained baseline shift, never both.
```

- [ ] **Step 8: Verify nothing else moved**

Run: `npx tsc --noEmit` — no errors.
Run: `npm run gate` — PASS, unchanged.
Run: `npx vitest run` — PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/quant/signals README.md
git commit -m "fix(signals): M5 — a short night is charged once, not twice

A short night before a study day already docks that session through
ENCODING_PENALTY, shrinking k14 and the stock term; the same nights then drove
rest.ts's chronic deterioration term. The two terms measure different things —
a specific badly-encoded session vs a sustained baseline shift — so they are
now disjoint: stock.ts exports which nights its penalty actually fired on, and
the chronic term drops them from the recent window before comparing against
the 56-day baseline. mean14 stays unfiltered for display.

Closes audit Part I §4 M5."
```

---

## Task 6: M6 — chronotype stops being a cliff on an integer hour

`owl && hour <= 9 ⇒ −CHRONO_W`; `hour = 10 ⇒ 0`. A 9am and a 10am sitting differ by the entire channel. Replace with a continuous function of sitting hour.

**Two spec sub-requirements and what happens to each:**

- *"scaled by the strength of the self-report"* — **not applicable, and stated as such.** `Profile.chronotype` is `"lark" | "owl"`, a bare category with no strength field (`types.ts:25`). Introducing one would be a data-model change well outside this tranche. The comment says so explicitly rather than leaving a reader to wonder.
- *"the owl-full / lark-half asymmetry is either given a cited argument or dropped"* — **dropped.** No cited argument supports charging larks half; the synchrony literature (Goldstein et al. 2007; Preckel et al. 2011) reports the effect in both directions. Each chronotype now carries the same weight at the same misalignment from its own peak.

**Files:**
- Modify: `src/lib/quant/signals/params.ts` (add `CHRONO_PEAK_HOUR`, `CHRONO_TAPER_H`; delete `CHRONO_EARLY_HOUR`, `CHRONO_LATE_HOUR`, `CHRONO_LARK_FRAC`)
- Modify: `src/lib/quant/signals/signalread.ts`
- Modify: `README.md` §30 chronotype sentence
- Test: `src/lib/quant/signals/signalread.test.ts`, `src/lib/quant/signals/params.test.ts`

**Interfaces:**
- Consumes: `Chronotype` from `../../../types`, `CHRONO_W`.
- Produces:
  ```ts
  export const CHRONO_PEAK_HOUR: Record<Chronotype, number>  // { lark: 9, owl: 16 }
  export const CHRONO_TAPER_H: number                        // 6
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/quant/signals/signalread.test.ts`:

```ts
import { CHRONO_PEAK_HOUR, CHRONO_TAPER_H, CHRONO_W } from "./params";

/** signalRead's chronotype term for a bare desk sitting at `hour`. */
const chronoPts = (chronotype: "owl" | "lark", hour: number): number => {
  const book = { ...emptySignalBook, profile: { chronotype, testAnxiety: null } };
  const out = signalRead(baseSubject, book, [], { date: NEXT_DATE, hour, weight: null }, null, ASOF);
  return out.terms.find((t) => t.key === "chronotype")?.pts ?? 0;
};

describe("M6 — chronotype is continuous in the sitting hour", () => {
  it("no longer swings the whole channel between 9am and 10am", () => {
    // The defect: owl at 9 charged -CHRONO_W in full, owl at 10 charged zero.
    const step = Math.abs(chronoPts("owl", 9) - chronoPts("owl", 10));
    expect(step).toBeLessThan(CHRONO_W / 5);
  });

  it("has no step anywhere on the sitting day", () => {
    for (const c of ["owl", "lark"] as const) {
      for (let h = 6; h < 21; h++) {
        expect(Math.abs(chronoPts(c, h) - chronoPts(c, h + 1)), `${c} ${h}->${h + 1}`)
          .toBeLessThan(CHRONO_W / 5);
      }
    }
  });

  it("is silent at each chronotype's own peak", () => {
    expect(chronoPts("owl", CHRONO_PEAK_HOUR.owl)).toBe(0);
    expect(chronoPts("lark", CHRONO_PEAK_HOUR.lark)).toBe(0);
  });

  it("grows monotonically with misalignment and never exceeds CHRONO_W", () => {
    for (const c of ["owl", "lark"] as const) {
      const peak = CHRONO_PEAK_HOUR[c];
      let prev = 0;
      for (let d = 0; d <= 10; d++) {
        const pts = Math.abs(chronoPts(c, Math.min(23, peak + d)));
        expect(pts).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(pts).toBeLessThanOrEqual(CHRONO_W + 1e-9);
        prev = pts;
      }
    }
  });

  it("charges both chronotypes alike at equal misalignment — the asymmetry is dropped", () => {
    const owlOff = Math.abs(chronoPts("owl", CHRONO_PEAK_HOUR.owl - 5));
    const larkOff = Math.abs(chronoPts("lark", CHRONO_PEAK_HOUR.lark + 5));
    expect(owlOff).toBeCloseTo(larkOff, 10);
  });

  it("still charges an owl more for an early sitting than a late one", () => {
    expect(Math.abs(chronoPts("owl", 8))).toBeGreaterThan(Math.abs(chronoPts("owl", 17)));
    expect(Math.abs(chronoPts("lark", 19))).toBeGreaterThan(Math.abs(chronoPts("lark", 10)));
  });
});
```

Use the file's existing `baseSubject`, `ASOF` and a future `NEXT_DATE`; the existing chronotype tests at `signalread.test.ts:217-227` already build such a sitting — reuse their helper if there is one.

Append to `src/lib/quant/signals/params.test.ts`:

```ts
import { CHRONO_PEAK_HOUR, CHRONO_TAPER_H } from "./params";

describe("M6 — the chronotype peaks", () => {
  it("puts the lark's peak in the morning and the owl's in the afternoon", () => {
    expect(CHRONO_PEAK_HOUR.lark).toBeLessThan(CHRONO_PEAK_HOUR.owl);
    expect(CHRONO_PEAK_HOUR.lark).toBeGreaterThanOrEqual(0);
    expect(CHRONO_PEAK_HOUR.owl).toBeLessThanOrEqual(23);
  });
  it("tapers over a plausible number of hours", () => {
    expect(CHRONO_TAPER_H).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quant/signals/signalread.test.ts src/lib/quant/signals/params.test.ts`
Expected: FAIL — `does not provide an export named 'CHRONO_PEAK_HOUR'`.

- [ ] **Step 3: Add the new constants**

In `src/lib/quant/signals/params.ts`, delete `CHRONO_EARLY_HOUR`, `CHRONO_LATE_HOUR` and `CHRONO_LARK_FRAC` with their comments, and add beside `CHRONO_W`:

```ts
/**
 * M6 (audit Part I §4). Peak hour of day by self-reported chronotype — the
 * hour at which the synchrony effect is nil and the charge is zero. Larks peak
 * mid-morning, owls mid-to-late afternoon; the charge grows smoothly with
 * distance from that hour in either direction, since the synchrony literature
 * (Goldstein et al. 2007; Preckel et al. 2011) reports off-peak testing
 * costing performance whichever side of the peak it falls.
 *
 * This replaces a CLIFF: the term used to charge an owl the full CHRONO_W for
 * a sitting at or before 9am and exactly nothing at 10am, so a one-hour
 * timetable change swung an entire channel.
 *
 * The old owl-full / lark-half asymmetry is DROPPED rather than kept: no cited
 * argument supported charging larks half, and the same literature reports the
 * effect in both directions. Note also that `Profile.chronotype` is a bare
 * category with no strength field, so the charge cannot be scaled by how
 * strongly the student holds the self-report — only by how far the sitting
 * sits from the peak.
 */
export const CHRONO_PEAK_HOUR: Record<Chronotype, number> = {
  lark: 9,
  owl: 16,
};

/**
 * Hours of misalignment at which the chronotype charge reaches tanh(1) =
 * 0.76 of CHRONO_W. Six hours is roughly half a school day: a sitting half a
 * day away from your own peak is as mistimed as a school timetable can make
 * it, and the tanh saturates rather than running on past that.
 */
export const CHRONO_TAPER_H = 6;
```

Add `Chronotype` to the file's type import from `../../../types`.

- [ ] **Step 4: Make the term continuous**

In `src/lib/quant/signals/signalread.ts`, replace the chronotype block:

```ts
  // CHRONOTYPE — sitting-time synchrony vs the self-reported chronotype.
  // M6: continuous in the sitting hour. This used to be a cliff — an owl at
  // 9am was charged the full CHRONO_W and an owl at 10am nothing at all — so a
  // one-hour timetable change swung the whole channel. The charge now grows
  // smoothly with distance from the chronotype's own peak hour, in either
  // direction, and both chronotypes are charged alike at equal misalignment.
  const chronotype = book.profile?.chronotype ?? null;
  if (!dropped("chronotype") && chronotype != null && next?.hour != null) {
    const hour = next.hour;
    const offPeak = hour - CHRONO_PEAK_HOUR[chronotype];
    const pts = -CHRONO_W * Math.tanh(Math.abs(offPeak) / CHRONO_TAPER_H);
    if (pts !== 0) {
      const label = offPeak < 0 ? "EARLY" : "LATE";
      raw.chronotype = {
        pts,
        note: () => `CHRONOTYPE ${signed1(pts)} · ${Math.abs(offPeak)}H ${label} OF PEAK`,
      };
    }
  }
```

Update the import: add `CHRONO_PEAK_HOUR`, `CHRONO_TAPER_H`; remove `CHRONO_EARLY_HOUR`, `CHRONO_LARK_FRAC`, `CHRONO_LATE_HOUR`.

The `SIGNAL_NOTE_FLOOR` filter downstream already suppresses a sub-0.05pt row, so a sitting an hour off peak is computed but never printed — which is the intended behaviour and is what makes the function safe to make continuous.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quant/signals`
Expected: PASS. The existing tests at `signalread.test.ts:217` (`owl -> -CHRONO_W`) and `:225` (`lark + hour 16 -> -CHRONO_W/2`) assert the cliff and **must be replaced**, not weakened — delete them and let the new suite above stand in their place. Note in the commit message that they were the cliff's own pins.

- [ ] **Step 6: Update README §30**

Replace the chronotype sentence (~lines 1484-1486):

```
Chronotype prices sitting-time synchrony against a self-reported owl/lark as a *continuous* function of
the sitting hour: $\text{pts} = -\text{CHRONO\_W}\cdot\tanh\!\big(|h - \text{CHRONO\_PEAK\_HOUR}[c]| /
\text{CHRONO\_TAPER\_H}\big)$, with larks peaking at 9 and owls at 16, `CHRONO_W` = 0.75 and
`CHRONO_TAPER_H` = 6. Both chronotypes are charged alike at equal misalignment — the earlier
owl-full/lark-half asymmetry carried no cited argument and was dropped — and the term is zero at the
peak, so no one-hour timetable change can swing the channel. Measured effects here run well under a
point, so the weight stays small.
```

- [ ] **Step 7: Verify nothing else moved**

Run: `npx tsc --noEmit` — no errors.
Run: `npm run gate` — PASS, unchanged.
Run: `npx vitest run` — PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/quant/signals README.md
git commit -m "fix(signals): M6 — chronotype is continuous in the sitting hour

An owl sitting at 9am was charged the full CHRONO_W and an owl at 10am nothing
at all, so a one-hour timetable change swung an entire channel. The charge is
now -CHRONO_W*tanh(|hour - peak| / CHRONO_TAPER_H), zero at the chronotype's
own peak and saturating past half a school day out.

The owl-full / lark-half asymmetry is dropped: no cited argument supported it,
and the synchrony literature reports the effect in both directions. Profile
carries no self-report strength, so the charge scales on misalignment only —
stated in the constant's own comment rather than left implicit.

The two old tests asserting -CHRONO_W at hour 9 and -CHRONO_W/2 at hour 16
were the cliff's own pins and are replaced by continuity, monotonicity and
symmetry tests.

Closes audit Part I §4 M6."
```

---

## Task 7: M7 — the anxiety term is named and cited for what it computes

The term computes trait anxiety × **stakes** (`worthPct` is grade weight, not cognitive load). That is the attentional-control / processing-efficiency account (Eysenck, Derakshan, Santos & Calvo 2007), not the Yerkes–Dodson arousal inverted-U that the code comment, the constant's comment and README §30 all claim.

**Files:**
- Modify: `src/lib/quant/signals/params.ts` (`ANX_W` comment)
- Modify: `src/lib/quant/signals/signalread.ts` (comment + note text)
- Modify: `src/lib/derive/cite.ts` (add `eysenck2007`)
- Modify: `src/lib/derive/signals.ts` (`signal.adjust` refs)
- Modify: `README.md` §30 anxiety sentence
- Test: `src/lib/quant/signals/signalread.test.ts`

**Interfaces:**
- Consumes: `ANX_W`, `ANX_MID`, `ANX_SPAN` (unchanged; the arithmetic does not move).
- Produces: new `CiteKey` `"eysenck2007"`.

**Scope note.** `yerkes1908` is **not** added here. `derive.book.test.ts:629` asserts every citation is referenced by some derivation, and the card that would honestly carry Yerkes–Dodson as a historical antecedent — `signal.anxiety` — does not exist until spec §5.4 (step 7). Adding an orphan now would fail that test. `eysenck2007` is added and referenced from `signal.adjust`, the card that sums the term.

**Verification note.** `cite.ts`'s own header is binding: an entry that is wrong is wrong forever and silently. Copy the exact field set of an existing entry (`gneiting2007` is a good model). Do **not** add a DOI or URL — identifier fields and `citeUrl()` are spec §5.3's work and require a lookup this task does not perform.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/quant/signals/signalread.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("M7 — the anxiety term is named for what it computes", () => {
  it("prints a stakes note, not an arousal one", () => {
    const book = { ...emptySignalBook, profile: { chronotype: null, testAnxiety: 5 } };
    const entries = [
      { id: "e1", subjectId: baseSubject.id, date: "2026-04-01", type: "Exam", score: 70, title: "E",
        classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: 20 },
    ] as GradeEntry[];
    const out = signalRead(baseSubject, book, entries, { date: NEXT_DATE, hour: null, weight: 40 }, null, ASOF);
    const anx = out.terms.find((t) => t.key === "anxiety")!;
    expect(anx.note).toContain("HIGH STAKES");
    expect(anx.note).not.toContain("HEAVY PAPER");
  });

  it("no longer claims Yerkes-Dodson anywhere in the priced path", () => {
    for (const p of ["./params.ts", "./signalread.ts"]) {
      const src = readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
      expect(src, `${p} still attributes the term to Yerkes-Dodson`).not.toMatch(/Yerkes/i);
    }
  });
});
```

Append to `src/lib/derive/cite.test.ts` (or, if no such file exists, to `src/lib/derive/derive.book.test.ts` beside the existing bibliography tests):

```ts
it("M7 — carries the attentional-control source the anxiety term actually derives from", () => {
  expect(CITATIONS.eysenck2007).toBeTruthy();
  expect(CITATIONS.eysenck2007.year).toBe(2007);
  expect(CITATIONS.eysenck2007.authors).toMatch(/Eysenck/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quant/signals/signalread.test.ts src/lib/derive`
Expected: FAIL — the note still reads `HEAVY PAPER`, `Yerkes` is still in both sources, and `CITATIONS.eysenck2007` is `undefined`.

- [ ] **Step 3: Add the citation**

In `src/lib/derive/cite.ts`, add to `CITATIONS`, keeping the exact field set and ordering used by neighbouring entries:

```ts
  eysenck2007: {
    short: "Eysenck et al. 2007",
    authors: "M. W. Eysenck, N. Derakshan, R. Santos, M. G. Calvo",
    year: 2007,
    title: "Anxiety and cognitive performance: Attentional control theory",
    venue: "Emotion 7(2), 336-353",
  },
```

If `Citation` carries fields beyond `short`/`authors`/`year`/`title`/`venue`, fill them the way `gneiting2007` does. Add no identifier field.

- [ ] **Step 4: Reference it**

In `src/lib/derive/signals.ts`, the `signal.adjust` derivation's `refs` (line ~132):

```ts
    refs: ["buhlmann1967", "eysenck2007"],
```

- [ ] **Step 5: Rename and re-derive**

In `src/lib/quant/signals/params.ts`, replace the `ANX_W` comment:

```ts
/**
 * Points weight on the anxiety term. M7 (audit Part I §4): this is the
 * ATTENTIONAL-CONTROL / processing-efficiency account (Eysenck, Derakshan,
 * Santos & Calvo 2007), not the Yerkes-Dodson arousal inverted-U the comment
 * here used to claim. The term multiplies trait anxiety by relative STAKES —
 * `worthPct` is a paper's share of the grade, not its cognitive load — and
 * attentional control theory is precisely the account under which evaluative
 * pressure, not arousal per se, consumes the working-memory resources a hard
 * paper needs. One-sided: a heavier-than-typical paper charges an anxious
 * student, an easier one never credits them, because worry impairs efficiency
 * without a symmetric facilitation on the low-stakes side.
 */
export const ANX_W = 1.5;
```

In `src/lib/quant/signals/signalread.ts`:

```ts
  // ANXIETY — trait anxiety against relative STAKES, one-sided. Attentional
  // control theory (Eysenck et al. 2007), NOT Yerkes-Dodson: worthPct is a
  // paper's share of the grade, not its cognitive load, so what this prices is
  // evaluative pressure consuming working-memory resources — not an arousal
  // inverted-U, which would have to credit the low-stakes side and does not.
```

and the note:

```ts
    raw.anxiety = { pts, note: () => `ANXIETY ${signed1(pts)} · HIGH STAKES` };
```

- [ ] **Step 6: Update README §30**

Replace the anxiety sentence (~lines 1481-1484):

```
Anxiety prices trait anxiety against relative *stakes*, one-sided — a heavier-than-typical paper charges
a self-reported anxious student, an easy one never credits them:
$\text{pts} = -\text{ANX\_W}\cdot\max(0,\tfrac{\text{anx}-\text{ANX\_MID}}{\text{ANX\_SPAN}})\cdot\text{clamp}(\tfrac{\text{weight}}{\text{typicalWeight}}-1,\,0,\,1)$,
`ANX_W` = 1.5. This is attentional control theory (Eysenck et al. 2007) — evaluative pressure consuming
the working-memory resources a hard paper needs — and **not** the Yerkes–Dodson arousal inverted-U this
section used to claim: `worthPct` is a paper's share of the grade, not its cognitive load, and an
arousal account would have to credit the low-stakes side, which this term deliberately does not.
```

If README §30 mentions Yerkes–Dodson anywhere else, correct it there too: `grep -n "Yerkes" README.md`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quant/signals src/lib/derive`
Expected: PASS, including `derive.book.test.ts`'s "every citation is referenced by something" orphan test.

- [ ] **Step 8: Verify nothing else moved**

Run: `npx tsc --noEmit` — no errors.
Run: `npm run gate` — PASS, unchanged.
Run: `npx vitest run` — PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/quant/signals src/lib/derive README.md
git commit -m "fix(signals): M7 — the anxiety term is named and cited for what it computes

The term multiplies trait anxiety by relative STAKES (worthPct is grade
weight, not cognitive load), which is the attentional-control / processing-
efficiency account — Eysenck, Derakshan, Santos & Calvo 2007 — and not the
Yerkes-Dodson arousal inverted-U the code comment, the constant's comment and
README §30 all claimed. An arousal account would have to credit the low-stakes
side; this term deliberately does not.

cite.ts gains eysenck2007, referenced from signal.adjust. yerkes1908 is NOT
added yet: derive.book.test.ts asserts every citation has a referrer, and the
card that would honestly carry it as a historical antecedent (signal.anxiety)
arrives with spec §5.4.

No arithmetic moved. Closes audit Part I §4 M7."
```

---

## Close-out

- [ ] **Run the full verification one final time**

```bash
npx tsc --noEmit
npm run gate
npx vitest run
```

All three must be clean, and the gate's skill number must be **identical** to the value it had before Task 1. If it moved, something in this tranche escaped the signals layer — bisect the seven commits and escalate.

- [ ] **Confirm the tranche's own claims**

```bash
grep -rn "6\.5" src/lib/quant/signals/    # must find nothing
grep -rn "Yerkes" src/lib/quant/ README.md  # only the README's explicit "not Yerkes-Dodson" correction
git log --oneline life-signals..HEAD      # seven commits, one per audit item
```

- [ ] **Report what is next**

The remaining audit work in Part I §8 is step 4 (`shapley.ts` + `rawTerms` + the SIGNALS table + the README caveat deletion) onward. Part II §21 step 1 (`eval/oracle.ts`) is still the prerequisite for any `earned.ts` work and still collides with the unstarted `accuracy-program-phase-a` plan's `baseline.json` restructure — that conflict must be resolved before either lands.

---

## Spec coverage

| spec item | task |
|---|---|
| §4 B5 — `aiCharge` reads `signalled` | 1 |
| §4 E1 — hand-typed constants lift; duplicate short-sleep threshold killed | 2 |
| §4 M3 — prereq gate `mean` → `min` | 3 |
| §4 M4 — attendance priced two ways, ~20× apart | 4 |
| §4 M5 — sleep charged twice | 5 |
| §4 M6 — chronotype cliff on an integer hour | 6 |
| §4 M7 — anxiety mislabelled and miscited | 7 |
| §7 — one test per M-number; M4's cross-path agreement test | 3–7 |
| §8 steps 1–3 sequencing | task order |
| §8 "steps 1–7 cannot move `npm run gate`" | every task's verify step + close-out |

**Deliberately out of this plan** (spec sequences them later): M8 (common-mode aggregation) and M9 (VOI by real ablation) are §8 step 6; `shapley.ts` is step 4; `channels.ts` is step 5; the bibliography expansion, the five new derivation cards and `Citation.url` are step 7; `fit.ts`/`earned.ts` are step 8; all of Part II is its own §21 sequence.
