import { describe, expect, it } from "vitest";
import type { Profile, RestLog, StudySession, Subject, Topic, TopicMark } from "../../../types";
import { MASTERY_MIN_MARKS, REST_MIN_NIGHTS, VOI_EFFORT_SCALE, VOI_TOP_N } from "./params";
import { emptySignalBook, type SignalBook } from "./signalread";
import { valueOfInformation } from "./voi";

/**
 * valueOfInformation — the VOI ranker: a pure, DISPLAY-ONLY heuristic over
 * the signal book that tells a student which missing input would buy the
 * most forecast precision per minute of logging effort. This suite defends:
 * determinism (same inputs, repeated calls, deep-equal output); that score
 * ordering (gainPts / (1 + effortMin/30), desc) is respected, including
 * under score ties (stable, push-order tie-break) and truncated to the top
 * VOI_TOP_N; that an entirely empty book still produces the book-wide and
 * per-desk bootstrap items it can compute without a known desk width; and
 * that a fully-instrumented desk (every channel logged) suppresses every
 * heuristic, returning an empty array. Every expected number below is
 * computed independently from the spec's own literal formulas, never by
 * calling back into voi.ts.
 */

const TODAY = "2026-07-29";

const sub = (id: string, over: Partial<Subject> = {}): Subject => ({
  id,
  name: id,
  ticker: id.toUpperCase(),
  color: "#333333",
  target: null,
  ...over,
});

const rest = (date: string, hours = 7): RestLog => ({ id: "r-" + date, date, hours });
const session = (subjectId: string, date: string): StudySession => ({
  id: "sess-" + subjectId + "-" + date,
  subjectId,
  date,
  minutes: 30,
  kind: "practice",
});
const topic = (id: string, subjectId: string): Topic => ({ id, subjectId, name: id });
const mark = (id: string, topicId: string): TopicMark => ({ id, entryId: "e-" + id, topicId, scorePct: 80 });

const PROFILE_SET: Profile = { chronotype: "lark", testAnxiety: 2 };

describe("valueOfInformation — determinism", () => {
  it("returns a deeply-equal result across repeated calls on the same inputs", () => {
    const subjects = [sub("s1"), sub("s2", { traits: { cumulativeness: 0.5, determinism: 0.5, breadth: 0.5 } })];
    const book: SignalBook = {
      ...emptySignalBook,
      rest: [rest("2026-07-01")],
      sessions: [session("s2", "2026-07-01")],
      topics: [topic("t1", "s2"), topic("t2", "s2"), topic("t3", "s2")],
      topicMarks: [mark("m1", "t1"), mark("m2", "t2"), mark("m3", "t3")],
    };
    const desks = new Map<string, number | null>([
      ["s1", 10],
      ["s2", 6],
    ]);
    const first = valueOfInformation(subjects, book, desks, TODAY);
    const second = valueOfInformation(subjects, book, desks, TODAY);
    expect(second).toEqual(first);
  });
});

describe("valueOfInformation — score ordering (strict, one varying parameter)", () => {
  it("ranks three traits-unset desks by their own sd, highest gain first", () => {
    // Isolate every other heuristic: rest logged, profile set, sessions logged
    // and >=3 marks on every desk — only "traits unset" can fire, once per desk.
    const ids = ["lo", "mid", "hi"];
    const sds = { lo: 5, mid: 10, hi: 20 };
    const subjects = ids.map((id) => sub(id));
    const book: SignalBook = {
      ...emptySignalBook,
      rest: [rest("2026-07-01")],
      profile: PROFILE_SET,
      sessions: ids.map((id) => session(id, "2026-07-01")),
      topics: ids.flatMap((id) => [topic(id + "-t1", id), topic(id + "-t2", id), topic(id + "-t3", id)]),
      topicMarks: ids.flatMap((id) => [
        mark(id + "-m1", id + "-t1"),
        mark(id + "-m2", id + "-t2"),
        mark(id + "-m3", id + "-t3"),
      ]),
    };
    const desks = new Map<string, number | null>(ids.map((id) => [id, sds[id as keyof typeof sds]]));

    const out = valueOfInformation(subjects, book, desks, TODAY);

    expect(out).toHaveLength(3);
    expect(out.every((it) => it.domain === "traits")).toBe(true);
    // Independent recomputation from the spec's own literal formula (0.2 * sd * 1.64).
    const expectedGain = (sd: number) => Math.round(0.2 * sd * 1.64 * 100) / 100;
    const expectedScore = (sd: number) => expectedGain(sd) / (1 + 2 / VOI_EFFORT_SCALE);
    expect(out.map((it) => it.subjectId)).toEqual(["hi", "mid", "lo"]);
    expect(out[0].gainPts).toBeCloseTo(expectedGain(sds.hi), 6);
    expect(out[1].gainPts).toBeCloseTo(expectedGain(sds.mid), 6);
    expect(out[2].gainPts).toBeCloseTo(expectedGain(sds.lo), 6);
    expect(out[0].score).toBeCloseTo(expectedScore(sds.hi), 6);
    expect(out[1].score).toBeCloseTo(expectedScore(sds.mid), 6);
    expect(out[2].score).toBeCloseTo(expectedScore(sds.lo), 6);
    // Score order is strictly descending.
    expect(out[0].score).toBeGreaterThan(out[1].score);
    expect(out[1].score).toBeGreaterThan(out[2].score);
  });
});

describe("valueOfInformation — top-8 truncation with score-tied groups", () => {
  it("keeps only the 8 highest-scoring items, ties broken by push order", () => {
    // 5 desks, each missing sessions AND traits (same sd everywhere so the two
    // per-desk heuristics tie across desks); rest logged; profile UNSET so it
    // does not compete (kept out of this scenario to keep the group count at
    // 2: sessions-tied-group and traits-tied-group, plus a rest singleton).
    const ids = ["s1", "s2", "s3", "s4", "s5"];
    const SD = 6;
    const subjects = ids.map((id) => sub(id));
    const book: SignalBook = {
      ...emptySignalBook,
      rest: [rest("2026-07-01")],
      profile: PROFILE_SET, // set, so it never competes with the tied groups
      // No sessions, no topics (so the topics-no-breakdown heuristic could
      // also fire) -- guard against that by giving each desk >=1 topic with
      // no marks removed: instead we leave topics empty and sd == VOI's
      // topics threshold so BOTH sessions and topics-no-breakdown would fire;
      // to keep this test to exactly two per-desk heuristics (sessions,
      // traits) topics are given with 3 marks each so mastery/topics is silent.
      topics: ids.flatMap((id) => [topic(id + "-t1", id), topic(id + "-t2", id), topic(id + "-t3", id)]),
      topicMarks: ids.flatMap((id) => [
        mark(id + "-m1", id + "-t1"),
        mark(id + "-m2", id + "-t2"),
        mark(id + "-m3", id + "-t3"),
      ]),
    };
    const desks = new Map<string, number | null>(ids.map((id) => [id, SD]));

    const out = valueOfInformation(subjects, book, desks, TODAY);

    expect(out).toHaveLength(VOI_TOP_N);

    const expectedTraitsGain = Math.round(0.2 * SD * 1.64 * 100) / 100;
    const expectedTraitsScore = expectedTraitsGain / (1 + 2 / VOI_EFFORT_SCALE);
    const expectedSessionsScore = 2.0 / (1 + 15 / VOI_EFFORT_SCALE);
    const expectedRestScore = 1.5 / (1 + 10 / VOI_EFFORT_SCALE);
    expect(expectedTraitsScore).toBeGreaterThan(expectedSessionsScore);
    expect(expectedSessionsScore).toBeGreaterThan(expectedRestScore);

    // All 5 traits items (tied, highest score) come first, in push (subject) order.
    for (let i = 0; i < 5; i++) {
      expect(out[i].domain).toBe("traits");
      expect(out[i].subjectId).toBe(ids[i]);
      expect(out[i].score).toBeCloseTo(expectedTraitsScore, 6);
    }
    // Then the first 3 (of 5) sessions items, in push order — the other 2
    // sessions items and the single rest item are truncated out.
    for (let i = 0; i < 3; i++) {
      expect(out[5 + i].domain).toBe("sessions");
      expect(out[5 + i].subjectId).toBe(ids[i]);
      expect(out[5 + i].score).toBeCloseTo(expectedSessionsScore, 6);
    }
  });
});

describe("valueOfInformation — empty book produces bootstrap items", () => {
  it("emits rest, profile and per-desk sessions/topics/traits when nothing has ever been logged", () => {
    const subjects = [sub("s1")];
    // A known desk width lets every sd-dependent heuristic (topics, traits) also fire.
    const desks = new Map<string, number | null>([["s1", 10]]);

    const out = valueOfInformation(subjects, emptySignalBook, desks, TODAY);

    const domains = out.map((it) => it.domain).sort();
    expect(domains).toEqual(["profile", "rest", "sessions", "topics", "traits"]);
    // Book-wide items carry no subject/ticker.
    const rest_ = out.find((it) => it.domain === "rest")!;
    const profile_ = out.find((it) => it.domain === "profile")!;
    expect(rest_.subjectId).toBeNull();
    expect(rest_.ticker).toBeNull();
    expect(profile_.subjectId).toBeNull();
    expect(profile_.ticker).toBeNull();
    // Per-desk items carry the desk's own id/ticker.
    for (const domain of ["sessions", "topics", "traits"]) {
      const it = out.find((i) => i.domain === domain)!;
      expect(it.subjectId).toBe("s1");
      expect(it.ticker).toBe("S1");
    }
    // Every item has a positive gain and a positive score.
    for (const it of out) {
      expect(it.gainPts).toBeGreaterThan(0);
      expect(it.score).toBeGreaterThan(0);
      expect(it.action.length).toBeGreaterThan(0);
    }
  });

  it("without a known desk width, only the width-independent bootstrap items fire", () => {
    const subjects = [sub("s1")];
    const out = valueOfInformation(subjects, emptySignalBook, new Map(), TODAY);
    const domains = out.map((it) => it.domain).sort();
    expect(domains).toEqual(["profile", "rest", "sessions"]);
  });
});

describe("valueOfInformation — the 'marks' heuristic (topics exist, under MASTERY_MIN_MARKS marked)", () => {
  it("fires with a gain and per-paper effort computed from the count still needed", () => {
    // traits set so the (independent) traits heuristic can't also fire here.
    const subjects = [sub("s1", { traits: { cumulativeness: 0.5, determinism: 0.5, breadth: 0.5 } })];
    const SD = 8; // saturates VOI_MARKS_SD_SAT exactly, so min(1, sd/8) === 1
    const book: SignalBook = {
      ...emptySignalBook,
      rest: [rest("2026-07-01")],
      profile: PROFILE_SET,
      sessions: [session("s1", "2026-07-01")],
      topics: [topic("t1", "s1"), topic("t2", "s1"), topic("t3", "s1")],
      topicMarks: [mark("m1", "t1")], // 1 marked, needs 2 more to clear MASTERY_MIN_MARKS
    };
    const desks = new Map<string, number | null>([["s1", SD]]);

    const out = valueOfInformation(subjects, book, desks, TODAY);

    expect(out).toHaveLength(1);
    const [it] = out;
    expect(it.domain).toBe("marks");
    expect(it.subjectId).toBe("s1");
    expect(it.ticker).toBe("S1");
    const needed = MASTERY_MIN_MARKS - 1;
    expect(it.effortMin).toBe(5 * needed); // spec literal, hardcoded so constant drift is caught
    const expectedGain = Math.round(3.0 * Math.min(1, SD / 8) * 100) / 100;
    expect(it.gainPts).toBeCloseTo(expectedGain, 6);
    expect(it.score).toBeCloseTo(expectedGain / (1 + it.effortMin / VOI_EFFORT_SCALE), 6);
  });

  it("does not fire once marks reach MASTERY_MIN_MARKS (mirrors the fully-instrumented case)", () => {
    const subjects = [sub("s1", { traits: { cumulativeness: 0.5, determinism: 0.5, breadth: 0.5 } })];
    const book: SignalBook = {
      ...emptySignalBook,
      rest: [rest("2026-07-01")],
      profile: PROFILE_SET,
      sessions: [session("s1", "2026-07-01")],
      topics: [topic("t1", "s1"), topic("t2", "s1"), topic("t3", "s1")],
      topicMarks: [mark("m1", "t1"), mark("m2", "t2"), mark("m3", "t3")],
    };
    const desks = new Map<string, number | null>([["s1", 8]]);
    expect(valueOfInformation(subjects, book, desks, TODAY)).toEqual([]);
  });

  it("a desk explicitly mapped to sd === 0 does not emit a zero-gain marks item", () => {
    const subjects = [sub("s1", { traits: { cumulativeness: 0.5, determinism: 0.5, breadth: 0.5 } })];
    const book: SignalBook = {
      ...emptySignalBook,
      rest: [rest("2026-07-01")],
      profile: PROFILE_SET,
      sessions: [session("s1", "2026-07-01")],
      topics: [topic("t1", "s1"), topic("t2", "s1"), topic("t3", "s1")],
      topicMarks: [mark("m1", "t1")], // < MASTERY_MIN_MARKS, would otherwise fire
    };
    const desks = new Map<string, number | null>([["s1", 0]]);
    expect(valueOfInformation(subjects, book, desks, TODAY)).toEqual([]);
  });
});

describe("valueOfInformation — a desk explicitly mapped to sd === 0 skips the traits heuristic too", () => {
  it("does not emit a zero-gain traits item", () => {
    const subjects = [sub("s1")]; // traits unset, would otherwise fire
    const book: SignalBook = {
      ...emptySignalBook,
      rest: [rest("2026-07-01")],
      profile: PROFILE_SET,
      sessions: [session("s1", "2026-07-01")],
      topics: [topic("t1", "s1"), topic("t2", "s1"), topic("t3", "s1")],
      topicMarks: [mark("m1", "t1"), mark("m2", "t2"), mark("m3", "t3")],
    };
    const desks = new Map<string, number | null>([["s1", 0]]);
    expect(valueOfInformation(subjects, book, desks, TODAY)).toEqual([]);
  });
});

describe("valueOfInformation — copy is generated from the computed gain, never hand-typed", () => {
  it("the rest action names REST_MIN_NIGHTS and the computed gain; the sessions action names the desk ticker and its own gain", () => {
    const subjects = [sub("s1")];
    const book: SignalBook = { ...emptySignalBook, profile: PROFILE_SET };
    const out = valueOfInformation(subjects, book, new Map(), TODAY);

    const rest_ = out.find((it) => it.domain === "rest")!;
    expect(rest_.action).toContain(String(REST_MIN_NIGHTS));
    expect(rest_.action).toContain(rest_.gainPts.toFixed(1));

    const sessions_ = out.find((it) => it.domain === "sessions")!;
    expect(sessions_.action).toContain("S1");
    expect(sessions_.action).toContain(sessions_.gainPts.toFixed(1));
  });
});

describe("valueOfInformation — fully-instrumented book produces no items", () => {
  it("returns an empty array when every channel already has evidence", () => {
    const subjects = [sub("s1", { traits: { cumulativeness: 0.5, determinism: 0.5, breadth: 0.5 } })];
    const book: SignalBook = {
      ...emptySignalBook,
      rest: [rest("2026-07-01")],
      sessions: [session("s1", "2026-07-01")],
      topics: [topic("t1", "s1"), topic("t2", "s1"), topic("t3", "s1")],
      topicMarks: [mark("m1", "t1"), mark("m2", "t2"), mark("m3", "t3")],
      profile: PROFILE_SET,
    };
    const desks = new Map<string, number | null>([["s1", 10]]);
    expect(valueOfInformation(subjects, book, desks, TODAY)).toEqual([]);
  });
});
