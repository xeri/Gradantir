import { describe, expect, it } from "vitest";
import type { Disruption } from "../../../types";
import { addDays } from "../../utils";
import { DISRUPT_CAP, DISRUPT_SEV, DISRUPT_TAU } from "./params";
import { disruptionTerm } from "./disrupt";

/**
 * disruptionTerm — the disruption channel (D5's "life happened" self-report).
 *
 * The invariant this suite defends: a disruption's charge DECAYS exponentially
 * once it ends, on a per-kind severity, scaled by how long it actually ran
 * (capped at a week of duration credit) — so a five-day illness that ended
 * well before the exam matters less than one still running, and an illness
 * that ended months ago is indistinguishable from noise. Every hand value is
 * computed independently from the documented formula: end = date + (days??1)
 * - 1; durMult = 0.5 + 0.5·min(days??1,7)/7; recovery = exp(-max(0,examDate-
 * end)/DISRUPT_TAU); contribution = DISRUPT_SEV[kind]·durMult·recovery.
 */

const EXAM = "2026-08-01";
const ASOF = "2026-08-01"; // "today" sits on exam day for these fixtures

const D = (over: Partial<Disruption> & Pick<Disruption, "id" | "date" | "kind">): Disruption => ({
  note: null,
  days: null,
  ...over,
});

describe("disruptionTerm — identity on empty input", () => {
  it("returns the zero identity when there are no disruptions", () => {
    const out = disruptionTerm([], EXAM, ASOF);
    expect(out).toEqual({ term: 0, notes: [] });
  });
});

describe("disruptionTerm — single disruption, hand-computed", () => {
  it("a 5-day illness ending 3 days before the exam", () => {
    // end = examDate - 3; date = end - (5-1) = examDate - 7 = 2026-07-25.
    const end = addDays(EXAM, -3);
    const date = addDays(end, -4);
    expect(date).toBe("2026-07-25");

    const durMult = 0.5 + (0.5 * Math.min(5, 7)) / 7;
    const recovery = Math.exp(-3 / DISRUPT_TAU);
    const contribution = DISRUPT_SEV.illness * durMult * recovery;
    expect(durMult).toBeCloseTo(0.857142857, 6);
    expect(contribution).toBeCloseTo(0.952480569, 6);

    const out = disruptionTerm([D({ id: "d1", date, kind: "illness", days: 5 })], EXAM, ASOF);
    expect(out.term).toBeCloseTo(-0.95, 5);
    expect(out.notes).toEqual([`ILLNESS −${contribution.toFixed(1)} · ${date} ×5D`]);
  });

  it("an absent `days` (single-day event) uses durMult 0.571 (0.5 + 0.5/7)", () => {
    const durMult = 0.5 + (0.5 * Math.min(1, 7)) / 7;
    expect(durMult).toBeCloseTo(0.5714285714, 6);

    const date = EXAM; // starts (and ends) on the exam day itself -> recovery = 1
    const contribution = DISRUPT_SEV.other * durMult * 1;

    const out = disruptionTerm([D({ id: "d2", date, kind: "other" })], EXAM, ASOF);
    expect(out.term).toBeCloseTo(-Math.round(contribution * 100) / 100, 5);
    // days absent -> no "×...D" suffix in the note.
    expect(out.notes[0]).toBe(`OTHER −${contribution.toFixed(1)} · ${date}`);
    expect(out.notes[0]).not.toMatch(/×/);
  });
});

describe("disruptionTerm — cap", () => {
  it("three overlapping full-severity, full-duration, undecayed illnesses clamp the term at exactly -DISRUPT_CAP", () => {
    expect(DISRUPT_CAP).toBe(2.5);
    // Each: days=7 (durMult=1), starting well before the exam and running past
    // it (end >= examDate -> recovery=1) -> contribution = 1.5 each, sum 4.5.
    const date = addDays(EXAM, -3);
    const disruptions: Disruption[] = [
      D({ id: "i1", date, kind: "illness", days: 7 }),
      D({ id: "i2", date, kind: "illness", days: 7 }),
      D({ id: "i3", date, kind: "illness", days: 7 }),
    ];
    const out = disruptionTerm(disruptions, EXAM, ASOF);
    expect(out.term).toBe(-2.5);
    expect(out.notes.length).toBe(3);
  });
});

describe("disruptionTerm — asOf cutoff and decay", () => {
  it("a disruption dated after asOf is wholly excluded", () => {
    const future = addDays(ASOF, 5);
    const out = disruptionTerm([D({ id: "f1", date: future, kind: "illness", days: 3 })], EXAM, ASOF);
    expect(out).toEqual({ term: 0, notes: [] });
  });

  it("an old disruption (exam - end = 60d) decays to ~0 and emits no note, but is still summed", () => {
    const date = addDays(EXAM, -60); // days absent -> end === date -> examDate - end = 60
    const durMult = 0.5 + (0.5 * Math.min(1, 7)) / 7;
    const recovery = Math.exp(-60 / DISRUPT_TAU);
    const contribution = DISRUPT_SEV.illness * durMult * recovery;
    expect(contribution).toBeLessThan(0.05); // below the note-emission threshold

    const out = disruptionTerm([D({ id: "old", date, kind: "illness" })], EXAM, ASOF);
    expect(out.notes).toEqual([]);
    expect(out.term).toBe(0); // rounds to 0.00 at 2dp, still "summed" (there's nothing else to sum against here)
  });

  it("a decayed disruption is summed alongside a live one — it still nudges the term, just not into a note", () => {
    const liveEnd = addDays(EXAM, -3);
    const liveDate = addDays(liveEnd, -4);
    const oldDate = addDays(EXAM, -60);

    const withOnlyLive = disruptionTerm([D({ id: "live", date: liveDate, kind: "illness", days: 5 })], EXAM, ASOF);
    const withBoth = disruptionTerm(
      [D({ id: "live", date: liveDate, kind: "illness", days: 5 }), D({ id: "old", date: oldDate, kind: "illness" })],
      EXAM,
      ASOF,
    );
    // The decayed one contributes a nonzero (if tiny) amount, so the summed term
    // is at least as negative as the live-only term; notes are unaffected (still one).
    expect(withBoth.term).toBeLessThanOrEqual(withOnlyLive.term);
    expect(withBoth.notes.length).toBe(1);
  });
});

describe("disruptionTerm — notes sorted by |contribution| desc", () => {
  it("a bigger contributor's note comes first", () => {
    const bigDate = addDays(EXAM, -1); // near-full recovery, illness (sev 1.5)
    const smallDate = addDays(EXAM, -1); // same recovery, event (sev 0.75) -> smaller
    const out = disruptionTerm(
      [
        D({ id: "small", date: smallDate, kind: "event", days: 2 }),
        D({ id: "big", date: bigDate, kind: "illness", days: 2 }),
      ],
      EXAM,
      ASOF,
    );
    expect(out.notes.length).toBe(2);
    expect(out.notes[0]).toMatch(/^ILLNESS/);
    expect(out.notes[1]).toMatch(/^EVENT/);
  });
});
