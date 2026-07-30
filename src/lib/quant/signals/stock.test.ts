import { describe, expect, it } from "vitest";
import type { RestLog, StudySession, SubjectMix } from "../../../types";
import { addDays, round1 } from "../../utils";
import {
  ENCODING_PENALTY, QUALITY, SHORT_SLEEP_H, SPACING_RECENT, SPACING_SAME_DAY, SPACING_STALE,
  STOCK_W, halfLifeOf,
} from "./params";
import { studyStock } from "./stock";

/**
 * studyStock — the effective-study-stock read (D5's "hours logged" channel).
 *
 * The invariant this suite defends: k14 (a decayed, quality/spacing/encoding
 * -weighted trailing-14-day stock) must track its own 42-day baseline rate
 * closely enough that CONSTANT logging prices as roughly flat, while genuine
 * departures from that rate — a surge or a drought — are what move the term.
 * Every multiplier (QUALITY, spacing, encoding, decay) is checked against a
 * hand-computed expectation built independently from the documented formula,
 * never by re-deriving the implementation's own arithmetic.
 */

const ASOF = "2026-06-30";
const H_DEFAULT = halfLifeOf(null);
const decay = (d: number, H: number) => Math.exp((-Math.LN2 * d) / H);

const S = (over: Partial<StudySession>): StudySession => ({
  id: over.id ?? "s-" + Math.random().toString(36).slice(2),
  subjectId: "sub-1",
  date: ASOF,
  minutes: 60,
  kind: "reading",
  ...over,
});

const R = (date: string, hours: number): RestLog => ({ id: "r-" + date, date, hours });

describe("studyStock — identity on empty input", () => {
  it("returns the zero/null identity when there are no sessions", () => {
    const out = studyStock([], [], null, ASOF);
    expect(out).toEqual({ k14: 0, baseline: null, term: 0, recallRatio: null, hoursPerWeek: null });
  });
});

describe("studyStock — QUALITY multiplier by hand-value", () => {
  it("a same-day recall session and a same-day reading session split exactly QUALITY.recall/QUALITY.reading", () => {
    const recall = studyStock([S({ kind: "recall", minutes: 60, date: ASOF })], [], null, ASOF);
    const reading = studyStock([S({ kind: "reading", minutes: 60, date: ASOF })], [], null, ASOF);
    const expRecall = round1(60 * QUALITY.recall * SPACING_STALE);
    const expReading = round1(60 * QUALITY.reading * SPACING_STALE);
    expect(recall.k14).toBeCloseTo(expRecall, 5);
    expect(reading.k14).toBeCloseTo(expReading, 5);
    expect(recall.k14 / reading.k14).toBeCloseTo(QUALITY.recall / QUALITY.reading, 5);
  });
});

describe("studyStock — spacing multiplier by hand-value", () => {
  it("very first session ever (no previous) is charged SPACING_STALE", () => {
    const out = studyStock([S({ kind: "recall", minutes: 100, date: ASOF })], [], null, ASOF);
    expect(out.k14).toBeCloseTo(round1(100 * QUALITY.recall * SPACING_STALE), 5);
  });

  it("a same-day pair — first session STALE, second SAME_DAY, both sharing the same decay", () => {
    const date = addDays(ASOF, -13);
    const a = S({ id: "a", kind: "reading", minutes: 100, date });
    const b = S({ id: "b", kind: "reading", minutes: 100, date });
    const out = studyStock([a, b], [], null, ASOF);
    const effA = 100 * QUALITY.reading * SPACING_STALE;
    const effB = 100 * QUALITY.reading * SPACING_SAME_DAY;
    const expected = round1((effA + effB) * decay(13, H_DEFAULT));
    expect(out.k14).toBeCloseTo(expected, 5);
  });

  it("a 3-day gap charges the later session SPACING_RECENT", () => {
    const prev = S({ id: "prev", kind: "reading", minutes: 100, date: addDays(ASOF, -3) });
    const cur = S({ id: "cur", kind: "reading", minutes: 100, date: ASOF });
    const out = studyStock([prev, cur], [], null, ASOF);
    const effPrev = 100 * QUALITY.reading * SPACING_STALE; // prev has no earlier session of its own
    const effCur = 100 * QUALITY.reading * SPACING_RECENT; // gap to prev = 3d
    const expected = round1(effPrev * decay(3, H_DEFAULT) + effCur * decay(0, H_DEFAULT));
    expect(out.k14).toBeCloseTo(expected, 5);
  });

  it("a 10-day gap charges the later session SPACING_STALE (beyond the recent window)", () => {
    const prev = S({ id: "prev", kind: "reading", minutes: 100, date: addDays(ASOF, -10) });
    const cur = S({ id: "cur", kind: "reading", minutes: 100, date: ASOF });
    const out = studyStock([prev, cur], [], null, ASOF);
    const effPrev = 100 * QUALITY.reading * SPACING_STALE;
    const effCur = 100 * QUALITY.reading * SPACING_STALE; // gap to prev = 10d > 7
    const expected = round1(effPrev * decay(10, H_DEFAULT) + effCur * decay(0, H_DEFAULT));
    expect(out.k14).toBeCloseTo(expected, 5);
  });
});

describe("studyStock — encoding multiplier by hand-value", () => {
  /* A2 review finding: the sleep that impairs encoding on study-day D is the
   * night ENDING the morning of D — logged, per RestLog's own convention
   * (types.ts, rest.ts's module doc comment) and rest.ts's own acuteTerm
   * lookup (`examDate - 1`), under date D-1, never under D itself. The old
   * same-date fixture below locked in the wrong (forward-looking) lookup. */
  it("a session encodes at ENCODING_PENALTY when the NIGHT BEFORE the study date ran short", () => {
    const date = ASOF;
    const nightBefore = addDays(date, -1);
    const out = studyStock([S({ kind: "practice", minutes: 100, date })], [R(nightBefore, 5.0)], null, ASOF);
    const expected = round1(100 * QUALITY.practice * SPACING_STALE * ENCODING_PENALTY);
    expect(out.k14).toBeCloseTo(expected, 5);
  });

  it("negative control: a short night dated the SAME as the study date does NOT dock — that row is for the night AFTER, not before", () => {
    const date = ASOF;
    const out = studyStock([S({ kind: "practice", minutes: 100, date })], [R(date, 5.0)], null, ASOF);
    const expected = round1(100 * QUALITY.practice * SPACING_STALE * 1);
    expect(out.k14).toBeCloseTo(expected, 5);
  });

  it("a night-before logged at or above SHORT_SLEEP_H encodes at full credit", () => {
    const date = ASOF;
    const nightBefore = addDays(date, -1);
    const out = studyStock([S({ kind: "practice", minutes: 100, date })], [R(nightBefore, 6.5)], null, ASOF);
    const expected = round1(100 * QUALITY.practice * SPACING_STALE * 1);
    expect(out.k14).toBeCloseTo(expected, 5);
    expect(SHORT_SLEEP_H).toBeLessThanOrEqual(6.5);
  });

  it("no rest row logged for the night before encodes at full credit", () => {
    const date = ASOF;
    const out = studyStock([S({ kind: "practice", minutes: 100, date })], [], null, ASOF);
    const expected = round1(100 * QUALITY.practice * SPACING_STALE * 1);
    expect(out.k14).toBeCloseTo(expected, 5);
  });
});

describe("studyStock — half-life from the subject's mix", () => {
  it("an all-knowledge mix (14d half-life) decays a dated session set more than an all-skill mix (120d)", () => {
    const sessions = [
      S({ id: "s1", minutes: 60, date: addDays(ASOF, -10) }),
      S({ id: "s2", minutes: 60, date: addDays(ASOF, -5) }),
      S({ id: "s3", minutes: 60, date: ASOF }),
    ];
    const knowledge: SubjectMix = { knowledge: 1, procedure: 0, skill: 0 };
    const skill: SubjectMix = { knowledge: 0, procedure: 0, skill: 1 };
    const kOut = studyStock(sessions, [], knowledge, ASOF);
    const sOut = studyStock(sessions, [], skill, ASOF);
    expect(kOut.k14).toBeLessThan(sOut.k14);
  });
});

describe("studyStock — baseline gating", () => {
  it("a session history spanning under 28 days ⇒ baseline null, term 0", () => {
    const sessions = [
      S({ id: "s1", minutes: 40, date: addDays(ASOF, -19) }),
      S({ id: "s2", minutes: 40, date: addDays(ASOF, -15) }),
      S({ id: "s3", minutes: 40, date: addDays(ASOF, -10) }),
      S({ id: "s4", minutes: 40, date: ASOF }),
    ];
    const out = studyStock(sessions, [], null, ASOF);
    expect(out.baseline).toBeNull();
    expect(out.term).toBe(0);
  });

  it("fewer than 3 sessions in the 15-56d baseline window ⇒ null even with a long enough span", () => {
    const sessions = [
      S({ id: "s1", minutes: 40, date: addDays(ASOF, -45) }),
      S({ id: "s2", minutes: 40, date: addDays(ASOF, -40) }),
    ];
    const out = studyStock(sessions, [], null, ASOF);
    expect(out.baseline).toBeNull();
    expect(out.term).toBe(0);
  });
});

describe("studyStock — deviation property", () => {
  it.each<[string, SubjectMix | null]>([
    ["knowledge (H=14)", { knowledge: 1, procedure: 0, skill: 0 }],
    ["default mix (H=45, null)", null],
    ["skill (H=120)", { knowledge: 0, procedure: 0, skill: 1 }],
  ])("identical daily 60-min recall logging prices as flat under %s: |term| < 0.01", (_label, mix) => {
    const sessions: StudySession[] = [];
    for (let i = 0; i < 70; i++) {
      sessions.push(S({ id: "d" + i, kind: "recall", minutes: 60, date: addDays(ASOF, -i) }));
    }
    const out = studyStock(sessions, [], mix, ASOF);
    expect(out.baseline).not.toBeNull();
    // baseline is now projected into k14's own decayed-window units (×D(H), not a flat ×14),
    // so a truly steady daily habit sits at steady state regardless of half-life.
    expect(Math.abs(out.term)).toBeLessThan(0.01);
  });

  /* A1 review finding: `baseline` accumulated only over days PRESENT in the
   * 14-55d window but always divided by a flat 42 — so whenever history is
   * shorter than the full 42-day baseline span (anywhere from the 28d gate up
   * to full coverage at 56d+), the per-day rate is diluted and a perfectly
   * steady habit reads k14 as running spuriously hot. `covered` (the actual
   * number of days present in the window, clamped to [1,42]) must stand in
   * for the flat 42 so the property holds at every span, not only once the
   * window happens to be fully observable. */
  it.each([28, 35, 42, 49, 56])(
    "identical daily 60-min recall logging prices as flat even when the 14-55d baseline window is only PARTIALLY observable (history span=%id)",
    (span) => {
      const sessions: StudySession[] = [];
      for (let i = 0; i <= span; i++) {
        sessions.push(S({ id: "d" + i, kind: "recall", minutes: 60, date: addDays(ASOF, -i) }));
      }
      const out = studyStock(sessions, [], null, ASOF);
      expect(out.baseline).not.toBeNull();
      // A tiny residual (~0.01) survives even after the fix: the very OLDEST
      // session in a finite history has no "previous" of its own, so it is
      // charged SPACING_STALE rather than SPACING_RECENT like every other day
      // — a real, tiny edge effect of a history that started somewhere,
      // unrelated to the A1 bug. Before the fix this residual was swamped by
      // a spurious +0.33 to +1.89 (see the finding); after it, the covered
      // baseline tracks k14 to within rounding.
      expect(Math.abs(out.term)).toBeLessThanOrEqual(0.01);
    },
  );
});

describe("studyStock — k14 window boundary", () => {
  it("a lone session at exactly Δ=14 days contributes nothing to k14 (the excluded edge)", () => {
    const out = studyStock([S({ kind: "recall", minutes: 60, date: addDays(ASOF, -14) })], [], null, ASOF);
    expect(out.k14).toBe(0);
  });

  it("a lone session at exactly Δ=13 days IS inside k14 (the included edge)", () => {
    const out = studyStock([S({ kind: "recall", minutes: 60, date: addDays(ASOF, -13) })], [], null, ASOF);
    expect(out.k14).toBeGreaterThan(0);
  });
});

describe("studyStock — tanh cap", () => {
  it("a massive recent surge over a sparse baseline saturates near STOCK_W, never past it", () => {
    const sessions: StudySession[] = [
      S({ id: "old1", kind: "reading", minutes: 10, date: addDays(ASOF, -50) }),
      S({ id: "old2", kind: "reading", minutes: 10, date: addDays(ASOF, -40) }),
      S({ id: "old3", kind: "reading", minutes: 10, date: addDays(ASOF, -30) }),
    ];
    for (let i = 0; i <= 13; i++) {
      sessions.push(S({ id: "surge" + i, kind: "recall", minutes: 600, date: addDays(ASOF, -i) }));
    }
    const out = studyStock(sessions, [], null, ASOF);
    expect(out.baseline).not.toBeNull();
    expect(out.term).toBeLessThanOrEqual(STOCK_W + 1e-9);
    expect(out.term).toBeGreaterThan(1.5);
  });
});

describe("studyStock — asOf cutoff", () => {
  it("a session dated after asOf contributes nothing, as if it did not exist", () => {
    const out = studyStock([S({ date: addDays(ASOF, 5) })], [], null, ASOF);
    expect(out).toEqual({ k14: 0, baseline: null, term: 0, recallRatio: null, hoursPerWeek: null });
  });

  it("a future session does not change the read for sessions that are in range", () => {
    const inRange = S({ id: "in", kind: "recall", minutes: 60, date: ASOF });
    const future = S({ id: "future", kind: "recall", minutes: 9999, date: addDays(ASOF, 1) });
    const withFuture = studyStock([inRange, future], [], null, ASOF);
    const withoutFuture = studyStock([inRange], [], null, ASOF);
    expect(withFuture).toEqual(withoutFuture);
  });
});

describe("studyStock — recallRatio and hoursPerWeek over the trailing 56d", () => {
  it("are null when no sessions fall in the trailing 56d window", () => {
    const out = studyStock([S({ date: addDays(ASOF, -100) })], [], null, ASOF);
    expect(out.recallRatio).toBeNull();
    expect(out.hoursPerWeek).toBeNull();
  });

  it("recallRatio is the effective-minute share from recall; hoursPerWeek is raw minutes/60/8", () => {
    const recall = S({ id: "r1", kind: "recall", minutes: 60, date: ASOF });
    const reading = S({ id: "r2", kind: "reading", minutes: 60, date: addDays(ASOF, -1) });
    const out = studyStock([recall, reading], [], null, ASOF);
    // sorted ascending: reading (earlier date, no previous ⇒ STALE), then recall (1d gap ⇒ RECENT).
    const effReading = 60 * QUALITY.reading * SPACING_STALE;
    const effRecall = 60 * QUALITY.recall * SPACING_RECENT;
    const expectedRatio = round1(effRecall / (effRecall + effReading));
    expect(out.recallRatio).toBeCloseTo(expectedRatio, 5);
    expect(out.hoursPerWeek).toBeCloseTo(round1((60 + 60) / 60 / 8), 5);
  });
});
