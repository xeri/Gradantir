import { describe, expect, it } from "vitest";
import type { ForecastLog, GradeEntry, Subject, Topic, TopicMark } from "../../../types";
import { addDays } from "../../utils";
import { scoreT } from "../eval/scoring";
import { SIGNAL_CAP, SIGNAL_PRIOR } from "../params";
import { emptySignalBook, type SignalBook } from "./signalread";
import { NO_SIGNAL_SKILL, signalSkill } from "./signalskill";

/**
 * signalSkill — the walk-forward scorer that earns the life-signals channel
 * its weight.
 *
 * The invariant this suite defends: a book with no signal data logged
 * contributes NO scored rounds (every round's read collapses to the adj-0/
 * sdMult-1 identity and is skipped as "not evidence"), so on the committed
 * fixture (no signal data at all) `rounds` stays 0 and `earnedWeight`'s own
 * n=0 path returns exactly `w = SIGNAL_PRIOR` — never asserted here, just
 * what the shared credibility rule already does at zero evidence. That is
 * what keeps the fixture byte-identical through this channel. `enabled:
 * false` is a harder, different floor: `w = 0` exactly.
 */

const CUTOFF = "2026-04-01";

const SUB = (over: Partial<Subject> = {}): Subject => ({
  id: "s1",
  name: "Subject",
  ticker: "SUB",
  color: "#4D7CFE",
  target: null,
  ...over,
});

const ENTRY = (over: Partial<GradeEntry> = {}): GradeEntry => ({
  id: over.id ?? "e-" + Math.random().toString(36).slice(2),
  subjectId: "s1",
  date: CUTOFF,
  type: "Exam",
  score: 80,
  title: "t",
  ...over,
});

const LOG = (over: Partial<ForecastLog> = {}): ForecastLog => ({
  id: "log-1",
  subjectId: "s1",
  roundKey: "2026-T1",
  target: "exam",
  createdAt: "2026-03-01",
  modelVersion: "gx-test",
  point: 70,
  sd: 5,
  df: 8,
  ci90: { lo: 60, hi: 80 },
  resolvedAt: CUTOFF,
  realized: 75,
  crps: 3,
  ...over,
});

describe("signalSkill — enabled: false", () => {
  it("returns the identity object, w = 0 and rounds = 0, regardless of the book", () => {
    const sub = SUB({ attendancePct: 85 });
    const log = LOG();
    const skill = signalSkill([log], emptySignalBook, [sub], [], false);
    expect(skill).toEqual(NO_SIGNAL_SKILL);
    expect(skill.w).toBe(0);
    expect(skill.rounds).toBe(0);
  });
});

describe("signalSkill — zero scored rounds", () => {
  it("an empty book scores no rounds and w lands at SIGNAL_PRIOR", () => {
    const sub = SUB(); // no attendancePct/traits/mix/belief -> identity read
    const log = LOG();
    const skill = signalSkill([log], emptySignalBook, [sub], [], true);
    expect(skill.rounds).toBe(0);
    expect(skill.n).toBe(0);
    expect(skill.w).toBe(SIGNAL_PRIOR);
  });

  it("adj-0 rounds are skipped even when mixed with a scored round from another desk", () => {
    const flat = SUB({ id: "flat" }); // no signal data -> identity, skipped
    const lit = SUB({ id: "lit", attendancePct: 85 }); // attendance fires -> scored
    const flatLog = LOG({ id: "log-flat", subjectId: "flat" });
    const litLog = LOG({ id: "log-lit", subjectId: "lit" });
    const skill = signalSkill([flatLog, litLog], emptySignalBook, [flat, lit], [], true);
    expect(skill.rounds).toBe(1);
  });
});

describe("signalSkill — CRPS pairing, same rule both sides", () => {
  it("you[i] is scoreT of the signal-adjusted mean/scale; model[i] is the stored log.crps", () => {
    const sub = SUB({ attendancePct: 85 }); // deterministic -0.5 attendance term
    const modelT = { mean: 80.3, scale: 3, df: 8 };
    const rawCrps = scoreT(modelT, 80).crps;
    const log = LOG({ resolvedAt: CUTOFF, realized: 80, point: 80.3, sd: 3, df: 8, crps: rawCrps });

    const skill = signalSkill([log], emptySignalBook, [sub], [], true);

    expect(skill.rounds).toBe(1);
    const expectedYou = scoreT({ mean: 80.3 - 0.5, scale: 3, df: 8 }, 80).crps;
    expect(skill.youScore).toBeCloseTo(expectedYou, 10);
    expect(skill.modelScore).toBeCloseTo(rawCrps, 10);
    // The pairing must be a genuine improvement for the "w rises" suite below
    // to mean anything.
    expect(expectedYou).toBeLessThan(rawCrps);
  });
});

describe("signalSkill — w rises when the adjusted CRPS beats the raw", () => {
  it("a desk whose signal-adjusted call is closer to the realized mark earns above SIGNAL_PRIOR", () => {
    const sub = SUB({ attendancePct: 85 });
    const log = LOG({ resolvedAt: CUTOFF, realized: 80, point: 80.3, sd: 3, df: 8, crps: scoreT({ mean: 80.3, scale: 3, df: 8 }, 80).crps });
    const skill = signalSkill([log], emptySignalBook, [sub], [], true);
    expect(skill.rawShare).toBeGreaterThan(0.5);
    expect(skill.w).toBeGreaterThan(SIGNAL_PRIOR);
    // SIGNAL_CAP (0.35) sits only 0.05 above SIGNAL_PRIOR (0.3) with a small
    // SIGNAL_KAPPA, so in practice a genuine win saturates the cap even at
    // n=1 (see earned.ts's shrinkage) — this suite's job is the direction
    // (above prior), not proving daylight under the cap; the cap itself is
    // the next suite's job.
    expect(skill.w).toBeLessThanOrEqual(SIGNAL_CAP);
  });
});

describe("signalSkill — cap at 0.35", () => {
  it("never exceeds SIGNAL_CAP, even for a record where the signal-adjusted call clearly beats the raw one", () => {
    // attendancePct 70 -> the attendance term's maximum magnitude, -1.0.
    // point 81, realized 80: the adjustment (81 - 1 = 80) lands the you-side
    // call EXACTLY on the realized mark, the lowest CRPS a call at this
    // scale/df can ever score — about as lopsided a win as this channel can
    // earn in one round. Because SIGNAL_CAP sits only 0.05 above SIGNAL_PRIOR
    // and SIGNAL_KAPPA is small, earnedWeight's shrinkage saturates the cap
    // on essentially any real win (see the "rises" suite above) — this test
    // fixes that ceiling explicitly, independent of how lopsided the win is.
    const sub = SUB({ attendancePct: 70 });
    const modelT = { mean: 81, scale: 3, df: 8 };
    const rawCrps = scoreT(modelT, 80).crps;
    const youCrps = scoreT({ mean: 80, scale: 3, df: 8 }, 80).crps;
    expect(youCrps).toBeLessThan(rawCrps); // sanity: this really is a win, not just a saturating tie
    const log = LOG({ resolvedAt: CUTOFF, realized: 80, point: 81, sd: 3, df: 8, crps: rawCrps });
    const skill = signalSkill([log], emptySignalBook, [sub], [], true);
    expect(skill.w).toBeLessThanOrEqual(SIGNAL_CAP);
    expect(skill.w).toBe(SIGNAL_CAP);
  });
});

describe("signalSkill — as-of cutoff", () => {
  // A trailing 42-day baseline of "reading" sessions (all strictly before
  // CUTOFF) establishes a nonzero stock term (running cold vs its own norm),
  // so the round is scored in every variant below and any change from
  // including/excluding one more session is directly visible in the result.
  const baseline = [
    { id: "b1", subjectId: "s1", date: addDays(CUTOFF, -20), minutes: 30, kind: "reading" as const },
    { id: "b2", subjectId: "s1", date: addDays(CUTOFF, -30), minutes: 30, kind: "reading" as const },
    { id: "b3", subjectId: "s1", date: addDays(CUTOFF, -40), minutes: 30, kind: "reading" as const },
  ];
  const sub = SUB();
  const log = LOG({ resolvedAt: CUTOFF });

  it("a session dated on/after resolvedAt is excluded — identical result to omitting it entirely", () => {
    const bookNone: SignalBook = { ...emptySignalBook, sessions: baseline };
    const bookEdge: SignalBook = {
      ...emptySignalBook,
      sessions: [...baseline, { id: "edge", subjectId: "s1", date: CUTOFF, minutes: 200, kind: "recall" as const }],
    };
    const skillNone = signalSkill([log], bookNone, [sub], [], true);
    const skillEdge = signalSkill([log], bookEdge, [sub], [], true);
    expect(skillNone.rounds).toBe(1); // baseline alone already fires the stock term
    expect(skillEdge).toEqual(skillNone);
  });

  it("a session dated strictly before resolvedAt IS picked up, changing the read", () => {
    const bookNone: SignalBook = { ...emptySignalBook, sessions: baseline };
    const bookPrior: SignalBook = {
      ...emptySignalBook,
      sessions: [...baseline, { id: "prior", subjectId: "s1", date: addDays(CUTOFF, -1), minutes: 200, kind: "recall" as const }],
    };
    const skillNone = signalSkill([log], bookNone, [sub], [], true);
    const skillPrior = signalSkill([log], bookPrior, [sub], [], true);
    expect(skillPrior).not.toEqual(skillNone);
  });
});

describe("signalSkill — topicMarks filtered by their entry's date", () => {
  it("a mark whose entry lands on/after cutoff is excluded; the same mark before cutoff is not", () => {
    const topics: Topic[] = [
      { id: "t1", subjectId: "s1", name: "T1" },
      { id: "t2", subjectId: "s1", name: "T2" },
      { id: "t3", subjectId: "s1", name: "T3" },
    ];
    const marks: TopicMark[] = [
      { id: "m1", entryId: "e1", topicId: "t1", scorePct: 95 },
      { id: "m2", entryId: "e2", topicId: "t2", scorePct: 40 },
      { id: "m3", entryId: "e3", topicId: "t3", scorePct: 70 },
    ];
    const sub = SUB();
    const log = LOG({ resolvedAt: CUTOFF, point: 60 });

    const entriesBefore = [
      ENTRY({ id: "e1", date: addDays(CUTOFF, -10) }),
      ENTRY({ id: "e2", date: addDays(CUTOFF, -10) }),
      ENTRY({ id: "e3", date: addDays(CUTOFF, -10) }),
    ];
    const entriesOneLate = [
      ENTRY({ id: "e1", date: addDays(CUTOFF, -10) }),
      ENTRY({ id: "e2", date: addDays(CUTOFF, -10) }),
      ENTRY({ id: "e3", date: CUTOFF }), // on cutoff -> its mark excluded, dropping below MASTERY_MIN_MARKS
    ];
    const book: SignalBook = { ...emptySignalBook, topics, topicMarks: marks };

    const skillAllBefore = signalSkill([log], book, [sub], entriesBefore, true);
    const skillOneLate = signalSkill([log], book, [sub], entriesOneLate, true);
    expect(skillAllBefore).not.toEqual(skillOneLate);
  });
});
