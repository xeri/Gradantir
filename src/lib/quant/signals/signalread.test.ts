import { describe, expect, it } from "vitest";
import type { Disruption, GradeEntry, RestLog, Subject, SubjectTraits, StudySession, Topic, TopicMark, Upcoming } from "../../../types";
import { addDays } from "../../utils";
import { masteryRead, topicMastery } from "./mastery";
import { ANX_W, CHRONO_W, SIGNAL_ADJ_CAP } from "./params";
import { emptySignalBook, signalBoard, signalRead, type SignalBook } from "./signalread";
import { studyStock } from "./stock";
import { traitSdMult } from "./traits";

/**
 * signalRead — the per-desk life-signals combiner.
 *
 * The invariant this suite defends first: on an EMPTY book and a subject
 * with no traits/mix/belief/attendance, EVERY path — including one with a
 * live upcoming sitting — collapses to the identity (adj 0, sdMult 1, terms
 * []). Everything after that exercises one channel's wiring at a time
 * (never re-deriving a channel's own formula — those are each other
 * modules' own test suites) plus the shared assembly rules: the ±4 cap, the
 * harshest-first sort, the {drop} ablation seam, and determinism.
 */

const ASOF = "2026-06-30";
const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const SUB = (over: Partial<Subject> = {}): Subject => ({
  id: "s1",
  name: "Subject",
  ticker: "SUB",
  color: "#4D7CFE",
  target: null,
  ...over,
});

const E = (over: Partial<GradeEntry> = {}): GradeEntry => ({
  id: over.id ?? "e-" + Math.random().toString(36).slice(2),
  subjectId: "s1",
  date: ASOF,
  type: "Exam",
  score: 80,
  title: "t",
  ...over,
});

const T = (over: Partial<Topic> = {}): Topic => ({
  id: over.id ?? "t-" + Math.random().toString(36).slice(2),
  subjectId: "s1",
  name: "Topic",
  ...over,
});

const MK = (over: Partial<TopicMark> = {}): TopicMark => ({
  id: over.id ?? "mk-" + Math.random().toString(36).slice(2),
  entryId: "e-1",
  topicId: "t-1",
  scorePct: 80,
  ...over,
});

const SESS = (over: Partial<StudySession> = {}): StudySession => ({
  id: over.id ?? "sess-" + Math.random().toString(36).slice(2),
  subjectId: "s1",
  date: ASOF,
  minutes: 30,
  kind: "practice",
  ...over,
});

const R = (date: string, hours: number, bedtime?: string | null): RestLog => ({
  id: "r-" + date,
  date,
  hours,
  ...(bedtime !== undefined ? { bedtime } : {}),
});

const DIS = (over: Partial<Disruption> = {}): Disruption => ({
  id: over.id ?? "d-" + Math.random().toString(36).slice(2),
  date: ASOF,
  kind: "illness",
  ...over,
});

const U = (over: Partial<Upcoming> = {}): Upcoming => ({
  id: over.id ?? "u-" + Math.random().toString(36).slice(2),
  subjectId: "s1",
  date: ASOF,
  type: "Exam",
  title: "Exam",
  ...over,
});

const TR = (over: Partial<SubjectTraits> = {}): SubjectTraits => ({
  cumulativeness: 0.5,
  determinism: 0.5,
  breadth: 0.5,
  ...over,
});

describe("signalRead — empty-book identity", () => {
  it("adj 0, sdMult 1, terms [] with no data at all", () => {
    const out = signalRead(SUB(), emptySignalBook, [], null, null, ASOF);
    expect(out).toEqual({ subjectId: "s1", adj: 0, sdMult: 1, terms: [], reasons: [] });
  });

  it("holds even with a live upcoming sitting present", () => {
    const next = { date: addDays(ASOF, 5), hour: 10, weight: 40 };
    const out = signalRead(SUB(), emptySignalBook, [], next, null, ASOF);
    expect(out).toEqual({ subjectId: "s1", adj: 0, sdMult: 1, terms: [], reasons: [] });
  });

  it("holds with a modelMean supplied and no signal data", () => {
    const out = signalRead(SUB(), emptySignalBook, [], null, 65, ASOF);
    expect(out).toEqual({ subjectId: "s1", adj: 0, sdMult: 1, terms: [], reasons: [] });
  });
});

describe("signalRead — term assembly (stock + mastery)", () => {
  it("adj equals the clamped, rounded sum of the fired terms, sorted harshest first", () => {
    const sessions: StudySession[] = [
      SESS({ date: addDays(ASOF, -20), minutes: 30, kind: "reading" }),
      SESS({ date: addDays(ASOF, -27), minutes: 30, kind: "reading" }),
      SESS({ date: addDays(ASOF, -34), minutes: 30, kind: "reading" }),
      SESS({ date: addDays(ASOF, -1), minutes: 150, kind: "recall" }),
      SESS({ date: ASOF, minutes: 150, kind: "recall" }),
    ];
    const topics = [T({ id: "t1" }), T({ id: "t2" }), T({ id: "t3" })];
    const entries = [E({ id: "e1" }), E({ id: "e2" }), E({ id: "e3" })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "t1", scorePct: 95 }),
      MK({ id: "m2", entryId: "e2", topicId: "t2", scorePct: 95 }),
      MK({ id: "m3", entryId: "e3", topicId: "t3", scorePct: 95 }),
    ];
    const book: SignalBook = { ...emptySignalBook, topics, topicMarks: marks, sessions };
    const modelMean = 60;

    const stock = studyStock(sessions, [], null, ASOF);
    const masteries = topicMastery(topics, marks, sessions, entries, null, null, ASOF);
    const mRead = masteryRead(topics, masteries, modelMean, null, ASOF);
    expect(Math.abs(stock.term)).toBeGreaterThanOrEqual(0.05);
    expect(Math.abs(mRead.term)).toBeGreaterThanOrEqual(0.05);

    const out = signalRead(SUB(), book, entries, null, modelMean, ASOF);

    const expectedAdj = round2(clamp(stock.term + mRead.term, -SIGNAL_ADJ_CAP, SIGNAL_ADJ_CAP));
    expect(out.adj).toBeCloseTo(expectedAdj, 5);
    expect(out.terms.map((t) => t.key).sort()).toEqual(["mastery", "stock"]);

    const expectedOrder = stock.term >= mRead.term ? ["stock", "mastery"] : ["mastery", "stock"];
    expect(out.terms.map((t) => t.key)).toEqual(expectedOrder);
    expect(out.reasons).toEqual(out.terms.map((t) => t.note));
  });
});

describe("signalRead — ±4 clamp", () => {
  it("clamps a large combined negative charge (rest + disruption + anxiety) to exactly -4", () => {
    const examDate = addDays(ASOF, 1); // night-before = ASOF, kept inside restRead's `live` filter
    const baseline = Array.from({ length: 14 }, (_, i) => R(addDays(ASOF, -(14 + i)), 8, i % 2 ? "21:00" : "03:00"));
    const recent = [
      R(ASOF, 3.5, "21:00"), // acute short-night-before-exam row, doubles as a recent night
      ...Array.from({ length: 6 }, (_, i) => R(addDays(ASOF, -(i + 1)), 5.5, i % 2 ? "21:00" : "03:00")),
    ];
    const rest = [...baseline, ...recent];
    const disruptions = [
      DIS({ id: "d1", date: addDays(ASOF, -5), kind: "illness", days: 7 }),
      DIS({ id: "d2", date: addDays(ASOF, -5), kind: "family", days: 7 }),
    ];
    const book: SignalBook = {
      ...emptySignalBook,
      rest,
      disruptions,
      profile: { testAnxiety: 5, chronotype: null },
    };
    const entries = [E({ id: "past-exam", date: addDays(ASOF, -30), type: "Exam", worthPct: 10 })];
    const next = { date: examDate, hour: null, weight: 100 };

    const out = signalRead(SUB(), book, entries, next, null, ASOF);
    expect(out.adj).toBe(-SIGNAL_ADJ_CAP);
  });
});

describe("signalRead — anxiety", () => {
  const book = (testAnxiety: number | null): SignalBook => ({ ...emptySignalBook, profile: { testAnxiety, chronotype: null } });

  it("anx 5, next.weight 40, typical 20 -> -1.5", () => {
    const entries = [E({ type: "Exam", worthPct: 20 })];
    const out = signalRead(SUB(), book(5), entries, { date: addDays(ASOF, 3), hour: null, weight: 40 }, null, ASOF);
    expect(out.adj).toBeCloseTo(-ANX_W, 5);
    expect(out.terms).toEqual([{ key: "anxiety", pts: -ANX_W, note: `ANXIETY ${(-ANX_W).toFixed(1)} · HEAVY PAPER` }]);
  });

  it("weight equal to typical -> 0", () => {
    const entries = [E({ type: "Exam", worthPct: 20 })];
    const out = signalRead(SUB(), book(5), entries, { date: addDays(ASOF, 3), hour: null, weight: 20 }, null, ASOF);
    expect(out.adj).toBe(0);
    expect(out.terms).toEqual([]);
  });

  it("no past exam worths -> 0", () => {
    const out = signalRead(SUB(), book(5), [], { date: addDays(ASOF, 3), hour: null, weight: 40 }, null, ASOF);
    expect(out.adj).toBe(0);
    expect(out.terms).toEqual([]);
  });

  it("anx 3 -> 0 regardless of weight", () => {
    const entries = [E({ type: "Exam", worthPct: 20 })];
    const out = signalRead(SUB(), book(3), entries, { date: addDays(ASOF, 3), hour: null, weight: 90 }, null, ASOF);
    expect(out.adj).toBe(0);
    expect(out.terms).toEqual([]);
  });
});

describe("signalRead — chronotype", () => {
  const book = (chronotype: "lark" | "owl" | null): SignalBook => ({ ...emptySignalBook, profile: { testAnxiety: null, chronotype } });

  it("owl + hour 8 -> -0.75", () => {
    const out = signalRead(SUB(), book("owl"), [], { date: addDays(ASOF, 1), hour: 8, weight: null }, null, ASOF);
    expect(out.adj).toBeCloseTo(-CHRONO_W, 5);
  });

  it("owl + hour 10 -> 0", () => {
    const out = signalRead(SUB(), book("owl"), [], { date: addDays(ASOF, 1), hour: 10, weight: null }, null, ASOF);
    expect(out.adj).toBe(0);
  });

  it("lark + hour 16 -> -CHRONO_W/2, rounded 2dp away from zero (-0.38)", () => {
    const out = signalRead(SUB(), book("lark"), [], { date: addDays(ASOF, 1), hour: 16, weight: null }, null, ASOF);
    expect(-CHRONO_W / 2).toBeCloseTo(-0.375, 5);
    expect(out.adj).toBe(-0.38);
  });

  it("profile null -> 0", () => {
    const out = signalRead(SUB(), emptySignalBook, [], { date: addDays(ASOF, 1), hour: 8, weight: null }, null, ASOF);
    expect(out.adj).toBe(0);
  });

  it("hour null -> 0", () => {
    const out = signalRead(SUB(), book("owl"), [], { date: addDays(ASOF, 1), hour: null, weight: null }, null, ASOF);
    expect(out.adj).toBe(0);
  });
});

describe("signalRead — attendance", () => {
  it("no topics, attendancePct 85 -> -0.5", () => {
    const out = signalRead(SUB({ attendancePct: 85 }), emptySignalBook, [], null, null, ASOF);
    expect(out.adj).toBeCloseTo(-0.5, 5);
    expect(out.terms).toEqual([{ key: "attendance", pts: -0.5, note: "ATTENDANCE -0.5 · 85% ATTENDED" }]);
  });

  it("with topics present, the standalone attendance term is absent (masteryRead handles it)", () => {
    const topics = [T({ id: "t1" })];
    const book: SignalBook = { ...emptySignalBook, topics };
    const out = signalRead(SUB({ attendancePct: 85 }), book, [], null, null, ASOF);
    expect(out.terms.find((t) => t.key === "attendance")).toBeUndefined();
  });
});

describe("signalRead — {drop} ablation seam", () => {
  it("dropping mastery removes exactly that term from adj and zeroes its unevenness contribution to sdMult", () => {
    const traits = TR({ determinism: 0.2, breadth: 0.3 });
    const topics = [T({ id: "t1" }), T({ id: "t2" }), T({ id: "t3" })];
    const entries = [E({ id: "e1" }), E({ id: "e2" }), E({ id: "e3" })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "t1", scorePct: 95 }),
      MK({ id: "m2", entryId: "e2", topicId: "t2", scorePct: 40 }),
      MK({ id: "m3", entryId: "e3", topicId: "t3", scorePct: 70 }),
    ];
    const book: SignalBook = { ...emptySignalBook, topics, topicMarks: marks };
    const sub = SUB({ traits });
    const modelMean = 60;

    const masteries = topicMastery(topics, marks, [], entries, traits, null, ASOF);
    const mRead = masteryRead(topics, masteries, modelMean, null, ASOF);
    expect(Math.abs(mRead.term)).toBeGreaterThanOrEqual(0.05);
    expect(mRead.unevenness).toBeGreaterThan(0);

    const withMastery = signalRead(sub, book, entries, null, modelMean, ASOF);
    const dropped = signalRead(sub, book, entries, null, modelMean, ASOF, { drop: new Set(["mastery"]) });

    expect(withMastery.terms.some((t) => t.key === "mastery")).toBe(true);
    expect(dropped.terms.some((t) => t.key === "mastery")).toBe(false);
    expect(dropped.adj).toBe(0);

    const expectedDroppedSdMult = traitSdMult(traits, 0, 0, null);
    expect(dropped.sdMult).toBe(expectedDroppedSdMult);
    expect(dropped.sdMult).toBeLessThan(withMastery.sdMult);
  });

  it("dropping every key zeroes adj but leaves sdMult >= 1 (traits still widen the variance claim)", () => {
    const traits = TR({ determinism: 0.1, breadth: 0.1 });
    const topics = [T({ id: "t1" }), T({ id: "t2" })];
    const entries = [E({ id: "e1" }), E({ id: "e2" })];
    const marks = [
      MK({ id: "m1", entryId: "e1", topicId: "t1", scorePct: 95 }),
      MK({ id: "m2", entryId: "e2", topicId: "t2", scorePct: 40 }),
    ];
    const rest: RestLog[] = Array.from({ length: 21 }, (_, i) => R(addDays(ASOF, -i), i < 7 ? 4 : 8));
    const book: SignalBook = {
      ...emptySignalBook,
      topics,
      topicMarks: marks,
      rest,
      profile: { testAnxiety: 5, chronotype: "owl" },
    };
    const sub = SUB({ traits, attendancePct: 80 });
    const next = { date: addDays(ASOF, 1), hour: 8, weight: 50 };

    const allKeys: import("./signalread").SignalTermKey[] = [
      "stock",
      "mastery",
      "rest",
      "disruption",
      "anxiety",
      "chronotype",
      "attendance",
    ];
    const out = signalRead(sub, book, entries, next, 60, ASOF, { drop: new Set(allKeys) });
    expect(out.adj).toBe(0);
    expect(out.terms).toEqual([]);
    expect(out.sdMult).toBeGreaterThan(1);
  });
});

describe("signalBoard", () => {
  it("keys reads by subject id, resolves each desk's own soonest live Exam, ignores non-Exam and past sittings, keeps archived desks", () => {
    const s1 = SUB({ id: "s1" });
    const s2 = SUB({ id: "s2" });
    const s3 = SUB({ id: "s3", archived: true });

    const upcoming: Upcoming[] = [
      U({ id: "u-s1-far", subjectId: "s1", date: addDays(ASOF, 30), type: "Exam", hour: 10 }),
      U({ id: "u-s1-near", subjectId: "s1", date: addDays(ASOF, 5), type: "Exam", hour: 8 }),
      U({ id: "u-s1-quiz", subjectId: "s1", date: addDays(ASOF, 1), type: "Quiz" }), // ignored: not an Exam
      U({ id: "u-s1-past", subjectId: "s1", date: addDays(ASOF, -1), type: "Exam" }), // ignored: past
      U({ id: "u-s2-only", subjectId: "s2", date: addDays(ASOF, 10), type: "Exam" }),
    ];
    const modelMeans = new Map<string, number | null>([
      ["s1", 60],
      ["s2", 65],
    ]);
    const book: SignalBook = { ...emptySignalBook, profile: { testAnxiety: null, chronotype: "owl" } };

    const board = signalBoard([s1, s2, s3], book, [], upcoming, modelMeans, ASOF);

    expect([...board.keys()].sort()).toEqual(["s1", "s2", "s3"]);
    expect(board.get("s1")!.subjectId).toBe("s1");
    expect(board.get("s3")).toBeDefined(); // archived desk still present

    // s1's soonest live Exam is the +5d one, hour 8 -> owl + hour<=9 fires chronotype.
    expect(board.get("s1")!.terms.some((t) => t.key === "chronotype")).toBe(true);
    // s2's only Exam carries no hour -> chronotype cannot fire.
    expect(board.get("s2")!.terms.some((t) => t.key === "chronotype")).toBe(false);
    // s3 has no upcoming at all -> identity.
    expect(board.get("s3")).toEqual({ subjectId: "s3", adj: 0, sdMult: 1, terms: [], reasons: [] });
  });
});

describe("signalRead — determinism", () => {
  it("identical inputs produce deepEqual results across two calls", () => {
    const traits = TR({ determinism: 0.4 });
    const topics = [T({ id: "t1" })];
    const entries = [E({ id: "e1" })];
    const marks = [MK({ id: "m1", entryId: "e1", topicId: "t1", scorePct: 70 })];
    const sessions = [SESS({ date: ASOF, minutes: 45, kind: "recall" })];
    const book: SignalBook = { ...emptySignalBook, topics, topicMarks: marks, sessions, profile: { testAnxiety: 4, chronotype: "lark" } };
    const sub = SUB({ traits, belief: 2 });
    const next = { date: addDays(ASOF, 2), hour: 16, weight: 30 };

    const out1 = signalRead(sub, book, entries, next, 55, ASOF);
    const out2 = signalRead(sub, book, entries, next, 55, ASOF);
    expect(out2).toEqual(out1);
  });
});
