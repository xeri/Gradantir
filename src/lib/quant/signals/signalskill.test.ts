import { describe, expect, it } from "vitest";
import type { ForecastLog, GradeEntry, Subject, Topic, TopicMark } from "../../../types";
import { addDays } from "../../utils";
import { scoreT } from "../eval/scoring";
import { SIGNAL_CAP, SIGNAL_PRIOR } from "../params";
import { MASTERY_W, attendanceShave } from "./params";
import { emptySignalBook, type SignalBook, type SignalChannelWeights } from "./signalread";
import { NO_SIGNAL_SKILL, signalRounds, signalSkill } from "./signalskill";

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

let entrySeq = 0;
const ENTRY = (over: Partial<GradeEntry> = {}): GradeEntry => ({
  id: over.id ?? "e-" + ++entrySeq,
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

/**
 * The replay and the scoring are two functions now (audit Part I §2 needs the
 * rounds without the score share). Every case below still asks the same
 * question — "what does this register earn?" — so it asks it through one
 * helper rather than restating the split at each call site.
 */
const fit = (
  register: ForecastLog[],
  book: SignalBook,
  subjects: Subject[],
  entries: GradeEntry[],
  enabled = true,
  weights: SignalChannelWeights | null = null,
) => signalSkill(signalRounds(register, book, subjects, entries), weights, enabled);

describe("signalSkill — enabled: false", () => {
  it("returns the identity object, w = 0 and rounds = 0, regardless of the book", () => {
    const sub = SUB({ attendancePct: 85 });
    const log = LOG();
    const skill = fit([log], emptySignalBook, [sub], [], false);
    // Reference identity is the actual contract here (mirrors EMPTY_READINESS/
    // IDENTITY_POOL) — `toEqual` against the very constant signalSkill returns
    // would pass no matter what the implementation did, so assert `toBe`.
    expect(skill).toBe(NO_SIGNAL_SKILL);
    expect(skill.w).toBe(0);
    expect(skill.rounds).toBe(0);
  });
});

describe("signalSkill — zero scored rounds", () => {
  it("an empty book scores no rounds and w lands at SIGNAL_PRIOR", () => {
    const sub = SUB(); // no attendancePct/traits/mix/belief -> identity read
    const log = LOG();
    const skill = fit([log], emptySignalBook, [sub], [], true);
    expect(skill.rounds).toBe(0);
    expect(skill.n).toBe(0);
    expect(skill.w).toBe(SIGNAL_PRIOR);
  });

  it("adj-0 rounds are skipped even when mixed with a scored round from another desk", () => {
    const flat = SUB({ id: "flat" }); // no signal data -> identity, skipped
    const lit = SUB({ id: "lit", attendancePct: 85 }); // attendance fires -> scored
    const flatLog = LOG({ id: "log-flat", subjectId: "flat" });
    const litLog = LOG({ id: "log-lit", subjectId: "lit" });
    const skill = fit([flatLog, litLog], emptySignalBook, [flat, lit], [], true);
    expect(skill.rounds).toBe(1);
  });
});

describe("signalSkill — CRPS pairing, same rule both sides", () => {
  it("you[i] is scoreT of the signal-adjusted mean/scale; model[i] is the stored log.crps", () => {
    const sub = SUB({ attendancePct: 85 }); // deterministic attendance term
    // M4: the no-topics attendance charge is MASTERY_W · attendanceShave(pct),
    // the same shave mastery.ts spends on covered mass — quoted from the shared
    // owner rather than re-typed, so a change to the scale moves one place.
    const attendanceAdj = -MASTERY_W * attendanceShave(85);
    const modelT = { mean: 80.3, scale: 3, df: 8 };
    const rawCrps = scoreT(modelT, 80).crps;
    const log = LOG({ resolvedAt: CUTOFF, realized: 80, point: 80.3, sd: 3, df: 8, crps: rawCrps });

    const skill = fit([log], emptySignalBook, [sub], [], true);

    expect(skill.rounds).toBe(1);
    const expectedYou = scoreT({ mean: 80.3 + attendanceAdj, scale: 3, df: 8 }, 80).crps;
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
    const skill = fit([log], emptySignalBook, [sub], [], true);
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
    const skill = fit([log], emptySignalBook, [sub], [], true);
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
    const skillNone = fit([log], bookNone, [sub], [], true);
    const skillEdge = fit([log], bookEdge, [sub], [], true);
    expect(skillNone.rounds).toBe(1); // baseline alone already fires the stock term
    expect(skillEdge).toEqual(skillNone);
  });

  it("a session dated strictly before resolvedAt IS picked up, changing the read", () => {
    const bookNone: SignalBook = { ...emptySignalBook, sessions: baseline };
    const bookPrior: SignalBook = {
      ...emptySignalBook,
      sessions: [...baseline, { id: "prior", subjectId: "s1", date: addDays(CUTOFF, -1), minutes: 200, kind: "recall" as const }],
    };
    const skillNone = fit([log], bookNone, [sub], [], true);
    const skillPrior = fit([log], bookPrior, [sub], [], true);
    expect(skillPrior).not.toEqual(skillNone);
  });
});

describe("signalSkill — topicMarks filtered by their entry's date", () => {
  // One topic only: topicMastery's own nMarkedTopics gate (< MASTERY_MIN_MARKS
  // = 3) keeps the mastery term at 0 no matter how bookBefore's topicMarks
  // filter behaves, and no matter which entries topicMastery itself can see.
  // That isolates the observable effect to timeErrorShareOf(subjMarks), which
  // signalRead computes directly off whatever topicMarks it is handed — it
  // does no date filtering of its own — so a difference here can only come
  // from bookBefore's own entry-date-keyed mark filter, not from topicMastery
  // separately excluding a mark whose entry isn't in `entries` at all (which
  // is what confounded the previous version of this test: it varied the
  // `entries` argument between variants, and topicMastery's own `entries`
  // lookup would have produced the same exclusion even with no mark-level
  // filtering in bookBefore at all).
  const topics: Topic[] = [{ id: "t1", subjectId: "s1", name: "T1" }];
  const marks: TopicMark[] = [
    { id: "m1", entryId: "e1", topicId: "t1", scorePct: 80 },
    { id: "m2", entryId: "e2", topicId: "t1", scorePct: 80 },
    { id: "m3", entryId: "e3", topicId: "t1", scorePct: 80, errorKind: "time" },
  ];
  const sub = SUB();
  const log = LOG({ resolvedAt: CUTOFF, point: 60 });
  const bookAllMarks: SignalBook = { ...emptySignalBook, topics, topicMarks: marks };
  const bookWithoutM3: SignalBook = { ...emptySignalBook, topics, topicMarks: marks.filter((m) => m.id !== "m3") };

  it("a mark whose entry lands on/after cutoff is excluded — identical to removing it outright, the SAME entries list passed either way", () => {
    // e3 lands ON cutoff -> bookBefore must exclude m3. `entriesOneLate` is
    // passed unchanged to BOTH calls below, so only the topicMarks each book
    // carries can explain any difference in the result.
    const entriesOneLate = [
      ENTRY({ id: "e1", date: addDays(CUTOFF, -10) }),
      ENTRY({ id: "e2", date: addDays(CUTOFF, -10) }),
      ENTRY({ id: "e3", date: CUTOFF }),
    ];

    const skillWithM3 = fit([log], bookAllMarks, [sub], entriesOneLate, true);
    const skillWithoutM3 = fit([log], bookWithoutM3, [sub], entriesOneLate, true);
    expect(skillWithM3).toEqual(skillWithoutM3);
    // No "time" mark makes it through in either case -> timeErrorShare stays
    // 0, sdMult 1, adj 0 (mastery gated off by the single-topic setup above)
    // -> the round is skipped, not just coincidentally equal.
    expect(skillWithM3.rounds).toBe(0);
  });

  it("negative control: the same mark, entry strictly before cutoff, IS picked up and changes the read", () => {
    const entriesAllBefore = [
      ENTRY({ id: "e1", date: addDays(CUTOFF, -10) }),
      ENTRY({ id: "e2", date: addDays(CUTOFF, -10) }),
      ENTRY({ id: "e3", date: addDays(CUTOFF, -10) }),
    ];
    const skillAllBefore = fit([log], bookAllMarks, [sub], entriesAllBefore, true);
    // m3's "time" errorKind now clears timeErrorShareOf's 0.25 threshold
    // (1 of 3 marks) -> sdMult fires even though adj is still 0 -> scored.
    expect(skillAllBefore.rounds).toBe(1);
    const skillWithoutM3Before = fit([log], bookWithoutM3, [sub], entriesAllBefore, true);
    expect(skillAllBefore).not.toEqual(skillWithoutM3Before);
  });
});

describe("signalRounds — the replay, split from the scoring", () => {
  // attendancePct fires one candidate with no book data at all, so a round is
  // genuinely readable here without staging sessions/rest/topics.
  const LIT = SUB({ attendancePct: 85 });

  it("returns one round per resolved exam log it could read", () => {
    const rounds = signalRounds([LOG()], emptySignalBook, [LIT], []);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].cutoff).toBe(CUTOFF);
    expect(rounds[0].modelCrps).toBe(3);
    expect(rounds[0].rawTerms.map((t) => t.key)).toEqual(["attendance"]);
  });

  it("carries the UNWEIGHTED candidate reads, so one replay serves every weight vector", () => {
    const rounds = signalRounds([LOG()], emptySignalBook, [LIT], []);
    const bare = signalSkill(rounds, null, true);
    const half = signalSkill(rounds, { attendance: 0.5 }, true);
    // Same rounds object, two different fits — the replay is not re-run and
    // the reads it carries are not mutated by scoring them.
    expect(rounds).toEqual(signalRounds([LOG()], emptySignalBook, [LIT], []));
    expect(bare.rounds).toBe(1);
    expect(half.rounds).toBe(1);
    expect(half.youScore).not.toBeCloseTo(bare.youScore as number, 10);
  });

  it("skips a round the read cannot move, at the weights it is SCORED with", () => {
    // The channel measured all the way down to zero contributes no evidence:
    // adj is 0 and sdMult is 1, which is the identity, which is not a tie.
    const rounds = signalRounds([LOG()], emptySignalBook, [LIT], []);
    expect(signalSkill(rounds, { attendance: 0 }, true).rounds).toBe(0);
  });

  it("is empty of scored rounds on a book with no signal data, which keeps the fixture unmoved", () => {
    const rounds = signalRounds([LOG()], emptySignalBook, [SUB()], []);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].rawTerms).toEqual([]);
    expect(signalSkill(rounds, null, true).rounds).toBe(0);
  });
});
