import { describe, expect, it } from "vitest";
import type { GradeEntry, StudySession, SubjectMix, SubjectTraits, Topic, TopicMark } from "../../../types";
import { addDays, round1 } from "../../utils";
import { MASTERY_MIN_MARKS, MASTERY_SCALE, MASTERY_W, PREREQ_HEADROOM } from "./params";
import { masteryRead, topicMastery } from "./mastery";

/**
 * mastery — the per-topic EWMA "crown jewel" read.
 *
 * Every hand-computed value below is derived independently from the
 * documented formula (params.ts constants plugged into the module doc's
 * arithmetic), never by re-deriving the implementation's own code path.
 */

const ASOF = "2026-06-30";
const round2 = (v: number) => Math.round(v * 100) / 100;
const decay = (d: number, H: number) => Math.exp((-Math.LN2 * d) / H);

const T = (over: Partial<Topic>): Topic => ({
  id: over.id ?? "t-" + Math.random().toString(36).slice(2),
  subjectId: "sub-1",
  name: "Topic",
  ...over,
});

const E = (over: Partial<GradeEntry>): GradeEntry => ({
  id: over.id ?? "e-" + Math.random().toString(36).slice(2),
  subjectId: "sub-1",
  date: ASOF,
  type: "Test",
  score: 80,
  title: "t",
  ...over,
});

const MK = (over: Partial<TopicMark>): TopicMark => ({
  id: over.id ?? "mk-" + Math.random().toString(36).slice(2),
  entryId: "e-1",
  topicId: "t-1",
  scorePct: 80,
  ...over,
});

const SESS = (over: Partial<StudySession>): StudySession => ({
  id: over.id ?? "s-" + Math.random().toString(36).slice(2),
  subjectId: "sub-1",
  date: ASOF,
  minutes: 30,
  kind: "practice",
  ...over,
});

const TR = (over: Partial<SubjectTraits>): SubjectTraits => ({
  cumulativeness: 0.5,
  determinism: 0.5,
  breadth: 0.5,
  ...over,
});

describe("topicMastery — identity on no topics", () => {
  it("returns an empty array", () => {
    expect(topicMastery([], [], [], [], null, null, ASOF)).toEqual([]);
  });
});

describe("masteryRead — identity on no topics", () => {
  it("returns the null/zero identity", () => {
    expect(masteryRead([], [], 70, null, ASOF)).toEqual({
      topics: [],
      coverage: null,
      predictedPaper: null,
      term: 0,
      unevenness: 0,
    });
  });
});

describe("topicMastery — EWMA fold order", () => {
  it("marks 40 then 80 (ascending entry date) fold to m = 0.4 + 0.4*(0.8-0.4) = 0.56", () => {
    const topic = T({ id: "a" });
    const entries = [E({ id: "e1", date: addDays(ASOF, -10) }), E({ id: "e2", date: addDays(ASOF, -1) })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 40 }),
      MK({ id: "m2", entryId: "e2", topicId: "a", scorePct: 80 }),
    ];
    const [result] = topicMastery([topic], marks, [], entries, null, null, ASOF);
    expect(result.m).toBeCloseTo(0.56, 5);
    expect(result.n).toBe(2);
  });

  it("marks 80 then 40 (reversed fold order) fold to m = 0.8 + 0.4*(0.4-0.8) = 0.64", () => {
    const topic = T({ id: "a" });
    const entries = [E({ id: "e1", date: addDays(ASOF, -10) }), E({ id: "e2", date: addDays(ASOF, -1) })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 80 }),
      MK({ id: "m2", entryId: "e2", topicId: "a", scorePct: 40 }),
    ];
    const [result] = topicMastery([topic], marks, [], entries, null, null, ASOF);
    expect(result.m).toBeCloseTo(0.64, 5);
  });
});

describe("topicMastery — careless credit", () => {
  it("scorePct 50 careless gives v' = 0.5 + 0.3*(1-0.5) = 0.65", () => {
    const topic = T({ id: "a" });
    const entry = E({ id: "e1" });
    const mark = MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 50, errorKind: "careless" });
    const [result] = topicMastery([topic], [mark], [], [entry], null, null, ASOF);
    expect(result.m).toBeCloseTo(0.65, 5);
  });
});

describe("topicMastery — decay by touch", () => {
  const mix: SubjectMix = { knowledge: 0, procedure: 1, skill: 0 }; // halfLifeOf => H = 45
  const H = 45;

  it("a mark 30 days old decays to mEff = m*(0.6 + 0.4*exp(-ln2*30/45)) with no refreshing session", () => {
    const topic = T({ id: "a" });
    const entry = E({ id: "e1", date: addDays(ASOF, -30) });
    const mark = MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 80 });
    const [result] = topicMastery([topic], [mark], [], [entry], null, mix, ASOF);
    const expected = 0.8 * (0.6 + 0.4 * decay(30, H));
    expect(result.m).toBeCloseTo(0.8, 5);
    expect(result.mEff).toBeCloseTo(expected, 5);
    expect(result.lastTouched).toBe(addDays(ASOF, -30));
  });

  it("a session touching the topic 5 days ago refreshes lastTouched, decaying less", () => {
    const topic = T({ id: "a" });
    const entry = E({ id: "e1", date: addDays(ASOF, -30) });
    const mark = MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 80 });
    const session = SESS({ id: "s1", date: addDays(ASOF, -5), topicIds: ["a"] });
    const [result] = topicMastery([topic], [mark], [session], [entry], null, mix, ASOF);
    const expected = 0.8 * (0.6 + 0.4 * decay(5, H));
    expect(result.lastTouched).toBe(addDays(ASOF, -5));
    expect(result.mEff).toBeCloseTo(expected, 5);
    expect(result.mEff).toBeGreaterThan(0.8 * (0.6 + 0.4 * decay(30, H)));
  });
});

describe("topicMastery — prereq gate", () => {
  it("C=0.9, prereq mEff0 0.3, topic mEff0 0.9 gates to 0.1*0.9 + 0.9*min(0.9, 0.3+0.25) = 0.585", () => {
    const prereq = T({ id: "p" });
    const topic = T({ id: "a", prereqIds: ["p"] });
    const entries = [E({ id: "e1" }), E({ id: "e2" })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "p", scorePct: 30 }),
      MK({ id: "m2", entryId: "e2", topicId: "a", scorePct: 90 }),
    ];
    const traits = TR({ cumulativeness: 0.9 });
    const results = topicMastery([prereq, topic], marks, [], entries, traits, null, ASOF);
    const p = results.find((r) => r.topicId === "p")!;
    const a = results.find((r) => r.topicId === "a")!;
    expect(p.mEff).toBeCloseTo(0.3, 5);
    const expectedGated = 0.1 * 0.9 + 0.9 * Math.min(0.9, 0.3 + PREREQ_HEADROOM);
    expect(a.mEff).toBeCloseTo(0.585, 5);
    expect(a.mEff).toBeCloseTo(expectedGated, 5);
  });

  it("C=0 leaves the topic ungated (mEff = mEff0)", () => {
    const prereq = T({ id: "p" });
    const topic = T({ id: "a", prereqIds: ["p"] });
    const entries = [E({ id: "e1" }), E({ id: "e2" })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "p", scorePct: 30 }),
      MK({ id: "m2", entryId: "e2", topicId: "a", scorePct: 90 }),
    ];
    const traits = TR({ cumulativeness: 0 });
    const results = topicMastery([prereq, topic], marks, [], entries, traits, null, ASOF);
    const a = results.find((r) => r.topicId === "a")!;
    expect(a.mEff).toBeCloseTo(0.9, 5);
  });
});

describe("topicMastery — n=0 topics and missing/late entries", () => {
  it("a topic with no marks keeps m=0, mEff=0, n=0", () => {
    const topic = T({ id: "a" });
    const [result] = topicMastery([topic], [], [], [], null, null, ASOF);
    expect(result.m).toBe(0);
    expect(result.mEff).toBe(0);
    expect(result.n).toBe(0);
    expect(result.lastTouched).toBeNull();
  });

  it("a mark whose entry is dated after asOf is ignored", () => {
    const topic = T({ id: "a" });
    const entry = E({ id: "e1", date: addDays(ASOF, 5) });
    const mark = MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 90 });
    const [result] = topicMastery([topic], [mark], [], [entry], null, null, ASOF);
    expect(result.n).toBe(0);
    expect(result.m).toBe(0);
  });

  it("a mark whose entryId is not found in entries is ignored", () => {
    const topic = T({ id: "a" });
    const mark = MK({ id: "m1", entryId: "missing", topicId: "a", scorePct: 90 });
    const [result] = topicMastery([topic], [mark], [], [], null, null, ASOF);
    expect(result.n).toBe(0);
  });
});

describe("masteryRead — uncovered-mass neutrality", () => {
  it("4 equal topics, nothing marked: predictedPaper equals modelMean exactly, coverage 0, term 0", () => {
    const topics = [T({ id: "a" }), T({ id: "b" }), T({ id: "c" }), T({ id: "d" })];
    const mast = topicMastery(topics, [], [], [], null, null, ASOF);
    const read = masteryRead(topics, mast, 65, null, ASOF);
    expect(read.coverage).toBe(0);
    expect(read.predictedPaper).toBe(65);
    expect(read.term).toBe(0);
  });
});

describe("masteryRead — evidence ramp: min(1, totalMarks/6)", () => {
  it("3 marked topics / totalMarks=3 prices at half the strength of totalMarks>=6", () => {
    const topics = [T({ id: "a" }), T({ id: "b" }), T({ id: "c" })];
    const modelMean = 50;

    const entries3 = [E({ id: "e1" }), E({ id: "e2" }), E({ id: "e3" })];
    const marks3 = [
      MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 100 }),
      MK({ id: "m2", entryId: "e2", topicId: "b", scorePct: 100 }),
      MK({ id: "m3", entryId: "e3", topicId: "c", scorePct: 100 }),
    ];
    const mast3 = topicMastery(topics, marks3, [], entries3, null, null, ASOF);
    const read3 = masteryRead(topics, mast3, modelMean, null, ASOF);

    const entries6 = [
      E({ id: "e1" }), E({ id: "e1b" }), E({ id: "e2" }), E({ id: "e2b" }), E({ id: "e3" }), E({ id: "e3b" }),
    ];
    const marks6 = [
      MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 100 }),
      MK({ id: "m1b", entryId: "e1b", topicId: "a", scorePct: 100 }),
      MK({ id: "m2", entryId: "e2", topicId: "b", scorePct: 100 }),
      MK({ id: "m2b", entryId: "e2b", topicId: "b", scorePct: 100 }),
      MK({ id: "m3", entryId: "e3", topicId: "c", scorePct: 100 }),
      MK({ id: "m3b", entryId: "e3b", topicId: "c", scorePct: 100 }),
    ];
    const mast6 = topicMastery(topics, marks6, [], entries6, null, null, ASOF);
    const read6 = masteryRead(topics, mast6, modelMean, null, ASOF);

    expect(read3.predictedPaper).toBe(100);
    const base = MASTERY_W * Math.tanh((100 - modelMean) / MASTERY_SCALE);
    expect(read3.term).toBeCloseTo(round2(base * 0.5), 2);
    expect(read6.term).toBeCloseTo(round2(base * 1), 2);
    expect(read6.term).toBeCloseTo(read3.term * 2, 1);
  });
});

describe("masteryRead — min-marks and coverage gates", () => {
  it("fewer than MASTERY_MIN_MARKS covered topics ⇒ term 0 even with ample coverage", () => {
    const topics = [T({ id: "a" }), T({ id: "b" }), T({ id: "c" })]; // equal weight, 1/3 each
    const entries = [E({ id: "e1" }), E({ id: "e2" })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 90 }),
      MK({ id: "m2", entryId: "e2", topicId: "b", scorePct: 90 }),
    ];
    const mast = topicMastery(topics, marks, [], entries, null, null, ASOF);
    const read = masteryRead(topics, mast, 50, null, ASOF);
    expect(read.coverage).toBeGreaterThanOrEqual(0.3);
    expect(mast.filter((m) => m.n >= 1).length).toBeLessThan(MASTERY_MIN_MARKS);
    expect(read.term).toBe(0);
  });

  it("coverage 0.25 ⇒ term 0 even with >= MASTERY_MIN_MARKS covered topics", () => {
    const topics = [
      T({ id: "a", weightPct: 10 }),
      T({ id: "b", weightPct: 10 }),
      T({ id: "c", weightPct: 5 }),
      T({ id: "d", weightPct: 75 }),
    ];
    const entries = [E({ id: "e1" }), E({ id: "e2" }), E({ id: "e3" })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 90 }),
      MK({ id: "m2", entryId: "e2", topicId: "b", scorePct: 90 }),
      MK({ id: "m3", entryId: "e3", topicId: "c", scorePct: 90 }),
    ];
    const mast = topicMastery(topics, marks, [], entries, null, null, ASOF);
    const read = masteryRead(topics, mast, 50, null, ASOF);
    expect(read.coverage).toBe(0.25);
    expect(read.term).toBe(0);
  });
});

describe("masteryRead — attendance shave", () => {
  it("attendancePct 85 shaves coveredMass by (1 - (95-85)/100*0.5) = 0.95 before pricing predictedPaper", () => {
    const topics = [T({ id: "a", weightPct: 50 }), T({ id: "b", weightPct: 50 })];
    const entry = E({ id: "e1" });
    const mark = MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 80 }); // mEff = 0.8, no decay
    const mast = topicMastery(topics, [mark], [], [entry], null, null, ASOF);
    const modelMean = 71;
    const read = masteryRead(topics, mast, modelMean, 85, ASOF);

    const coveredMass = 0.5;
    const coveredWeightedM = 0.5 * 0.8;
    const shaveFactor = 1 - ((95 - 85) / 100) * 0.5; // 0.95
    const coveredMassShaved = coveredMass * shaveFactor; // 0.475
    const uncoveredMassShaved = 1 - coveredMassShaved; // 0.525
    const coveredContribution = coveredWeightedM * (coveredMassShaved / coveredMass); // 0.38
    const P = coveredContribution + uncoveredMassShaved * (modelMean / 100);
    const expectedPredicted = round1(P * 100);

    expect(read.coverage).toBe(0.5); // reported coverage is the RAW (unshaved) covered mass
    expect(read.predictedPaper).toBeCloseTo(expectedPredicted, 5);
  });
});

describe("masteryRead — unevenness (weighted stdev of mEff over covered topics)", () => {
  it("two equally-weighted covered topics at mEff 0.2 and 0.8 give unevenness 0.3", () => {
    const topics = [T({ id: "a", weightPct: 50 }), T({ id: "b", weightPct: 50 })];
    const entries = [E({ id: "e1" }), E({ id: "e2" })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 20 }),
      MK({ id: "m2", entryId: "e2", topicId: "b", scorePct: 80 }),
    ];
    const mast = topicMastery(topics, marks, [], entries, null, null, ASOF);
    const read = masteryRead(topics, mast, 50, null, ASOF);
    expect(read.unevenness).toBeCloseTo(0.3, 5);
  });

  it("a single covered topic gives unevenness 0", () => {
    const topics = [T({ id: "a", weightPct: 50 }), T({ id: "b", weightPct: 50 })];
    const entries = [E({ id: "e1" })];
    const marks = [MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 20 })];
    const mast = topicMastery(topics, marks, [], entries, null, null, ASOF);
    const read = masteryRead(topics, mast, 50, null, ASOF);
    expect(read.unevenness).toBe(0);
  });
});

describe("masteryRead — weight normalisation", () => {
  it("stated weights {60, null, null} give each null topic 20 each", () => {
    const topics = [T({ id: "a", weightPct: 60 }), T({ id: "b", weightPct: null }), T({ id: "c", weightPct: null })];
    const entries = [E({ id: "e1" }), E({ id: "e2" })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "b", scorePct: 50 }),
      MK({ id: "m2", entryId: "e2", topicId: "c", scorePct: 50 }),
    ];
    const mast = topicMastery(topics, marks, [], entries, null, null, ASOF);
    const read = masteryRead(topics, mast, 50, null, ASOF);
    expect(read.coverage).toBeCloseTo(0.4, 5); // b's 20% + c's 20%
  });

  it("all-null weights split equally", () => {
    const topics = [T({ id: "a" }), T({ id: "b" }), T({ id: "c" }), T({ id: "d" })];
    const entries = [E({ id: "e1" })];
    const marks = [MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 50 })];
    const mast = topicMastery(topics, marks, [], entries, null, null, ASOF);
    const read = masteryRead(topics, mast, 50, null, ASOF);
    expect(read.coverage).toBeCloseTo(0.25, 5);
  });

  it("stated weights summing over 100 renormalise proportionally", () => {
    const topics = [T({ id: "a", weightPct: 80 }), T({ id: "b", weightPct: 40 })];
    const entries = [E({ id: "e1" }), E({ id: "e2" })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "a", scorePct: 50 }),
      MK({ id: "m2", entryId: "e2", topicId: "b", scorePct: 50 }),
    ];
    const mast = topicMastery(topics, marks, [], entries, null, null, ASOF);
    const read = masteryRead(topics, mast, 50, null, ASOF);
    // both covered, so coverage should be the full renormalised 100% = 1.0
    expect(read.coverage).toBeCloseTo(1, 5);
  });
});
