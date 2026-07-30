import { describe, expect, it } from "vitest";
import {
  ancestorsOf, applySplit, detectSplits, inheritedEntries, lineageRootOf,
  assertRoster, rosterAt, splitTopicMarkLoss,
} from "./lineage";
import { DEFAULT_CALENDAR } from "./calendar";
import type { GradeEntry, Subject, TopicMark } from "../types";

const sub = (id: string, over: Partial<Subject> = {}): Subject => ({
  id, name: id.toUpperCase(), ticker: id.toUpperCase(), color: "#fff",
  target: null, courseworkPct: null, ...over,
});

let n = 0;
const ex = (subjectId: string, date: string, score: number): GradeEntry => ({
  id: `e${++n}`, subjectId, date, type: "Exam", score, title: "Exam",
});

const CAL = DEFAULT_CALENDAR;

/* ── the chain ─────────────────────────────────────────────────────── */

describe("ancestorsOf", () => {
  const bea = sub("bea", { archived: true });
  const econ = sub("econ", { formerly: "bea" });
  const bus = sub("bus", { formerly: "bea" });
  const all = [bea, econ, bus];

  it("walks one step back to the desk a successor descends from", () => {
    expect(ancestorsOf(econ, all).map((s) => s.id)).toEqual(["bea"]);
    expect(ancestorsOf(bus, all).map((s) => s.id)).toEqual(["bea"]);
  });

  it("gives an ancestor no ancestors of its own", () => {
    expect(ancestorsOf(bea, all)).toEqual([]);
  });

  it("walks a multi-step chain oldest-last", () => {
    const sci = sub("sci", { archived: true });
    const phys = sub("phys", { formerly: "sci" });
    const adv = sub("adv", { formerly: "phys" });
    expect(ancestorsOf(adv, [sci, phys, adv]).map((s) => s.id)).toEqual(["phys", "sci"]);
  });

  it("survives a cycle rather than hanging", () => {
    const a = sub("a", { formerly: "b" });
    const b = sub("b", { formerly: "a" });
    expect(ancestorsOf(a, [a, b]).map((s) => s.id)).toEqual(["b"]);
  });

  it("ignores a pointer to a desk that is not in the book", () => {
    expect(ancestorsOf(sub("x", { formerly: "ghost" }), [])).toEqual([]);
  });

  it("names the oldest ancestor as the lineage identity", () => {
    expect(lineageRootOf(econ, all).id).toBe("bea");
    expect(lineageRootOf(bus, all).id).toBe("bea");
    expect(lineageRootOf(bea, all).id).toBe("bea");
    // Two successors of one ancestor share a lineage identity — that is what
    // lets an aggregate count them once.
    expect(lineageRootOf(econ, all).id).toBe(lineageRootOf(bus, all).id);
  });
});

/* ── read-through ──────────────────────────────────────────────────── */

describe("inheritedEntries", () => {
  const bea = sub("bea", { archived: true });
  const econ = sub("econ", { formerly: "bea" });
  const all = [bea, econ];
  const entries = [
    ex("bea", "2025-04-30", 82),
    ex("bea", "2025-12-03", 76),
    ex("econ", "2026-04-08", 64),
  ];

  it("prefixes the ancestor's prints so a fresh split still has a tape", () => {
    expect(inheritedEntries(econ, all, entries).map((e) => e.score)).toEqual([82, 76, 64]);
  });

  it("returns the ancestor's own prints unchanged", () => {
    expect(inheritedEntries(bea, all, entries).map((e) => e.score)).toEqual([82, 76]);
  });

  it("keeps the tape in date order across the join", () => {
    const dates = inheritedEntries(econ, all, entries).map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("never mutates or duplicates — each print appears once", () => {
    const ids = inheritedEntries(econ, all, entries).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ── the single membership rule ────────────────────────────────────── */

describe("rosterAt", () => {
  const math = sub("math");
  const bea = sub("bea", { archived: true });
  const econ = sub("econ", { formerly: "bea" });
  const bus = sub("bus", { formerly: "bea" });
  const all = [math, bea, econ, bus];
  const entries = [
    ex("math", "2025-04-30", 62), ex("math", "2026-04-08", 65),
    ex("bea", "2025-04-30", 82),
    ex("econ", "2026-04-08", 64),
    ex("bus", "2026-04-08", 82),
  ];
  const idsAt = (d: string) => rosterAt(all, entries, d, CAL).map((r) => r.sub.id).sort();

  it("seats the ancestor in the term it printed and neither successor", () => {
    expect(idsAt("2025-04-30")).toEqual(["bea", "math"]);
  });

  it("seats the successors once the split has happened and drops the ancestor", () => {
    expect(idsAt("2026-04-08")).toEqual(["bus", "econ", "math"]);
  });

  it("never seats a desk and its ancestor in the same round", () => {
    for (const d of ["2025-04-30", "2025-12-03", "2026-04-08", "2026-07-22"]) {
      const ids = new Set(rosterAt(all, entries, d, CAL).map((r) => r.sub.id));
      expect(ids.has("bea") && (ids.has("econ") || ids.has("bus"))).toBe(false);
    }
  });

  it("excludes a desk that has not printed yet", () => {
    expect(idsAt("2025-04-30")).not.toContain("econ");
  });

  it("hands back the desk's own prints, not its inherited ones", () => {
    // The aggregate must never see BEA's prints under ECON's name, or the
    // ancestor is counted twice again by a different route.
    const econRow = rosterAt(all, entries, "2026-04-08", CAL).find((r) => r.sub.id === "econ")!;
    expect(econRow.entries.map((e) => e.score)).toEqual([64]);
  });
});

describe("assertRoster", () => {
  const bea = sub("bea", { archived: true });
  const econ = sub("econ", { formerly: "bea" });
  const all = [bea, econ];

  it("passes a roster with no ancestor/successor overlap", () => {
    expect(() => assertRoster([{ sub: econ, entries: [] }], all)).not.toThrow();
  });

  it("throws when a desk and its ancestor are both seated", () => {
    expect(() =>
      assertRoster([{ sub: bea, entries: [] }, { sub: econ, entries: [] }], all),
    ).toThrow(/lineage/i);
  });
});

/* ── detection ─────────────────────────────────────────────────────── */

describe("detectSplits", () => {
  it("flags two desks whose whole early tape is identical", () => {
    const econ = sub("econ"), bus = sub("bus");
    const entries = [
      ex("econ", "2025-04-30", 82), ex("bus", "2025-04-30", 82),
      ex("econ", "2025-08-01", 52), ex("bus", "2025-08-01", 52),
      ex("econ", "2025-12-03", 76), ex("bus", "2025-12-03", 76),
      ex("econ", "2026-04-08", 64), ex("bus", "2026-04-08", 82),
    ];
    const found = detectSplits([econ, bus], entries);
    expect(found).toHaveLength(1);
    expect(found[0].members.map((s) => s.ticker).sort()).toEqual(["BUS", "ECON"]);
    expect(found[0].shared).toHaveLength(3);
    expect(found[0].divergesAt).toBe("2026-04-08");
  });

  it("does NOT flag desks that merely scored alike once or twice", () => {
    const a = sub("a"), b = sub("b");
    const entries = [
      ex("a", "2025-04-30", 74), ex("b", "2025-04-30", 74),
      ex("a", "2025-08-01", 61), ex("b", "2025-08-01", 61),
      ex("a", "2025-12-03", 70), ex("b", "2025-12-03", 55),
    ];
    expect(detectSplits([a, b], entries)).toEqual([]);
  });

  it("does not flag desks that never overlap in time", () => {
    const a = sub("a"), b = sub("b");
    const entries = [
      ex("a", "2024-04-19", 80), ex("a", "2024-08-09", 80), ex("a", "2024-12-05", 80),
      ex("b", "2025-04-30", 80), ex("b", "2025-08-01", 80), ex("b", "2025-12-03", 80),
    ];
    expect(detectSplits([a, b], entries)).toEqual([]);
  });

  it("does not re-flag a lineage that is already declared", () => {
    const bea = sub("bea", { archived: true });
    const econ = sub("econ", { formerly: "bea" });
    const bus = sub("bus", { formerly: "bea" });
    const entries = [
      ex("bea", "2025-04-30", 82), ex("bea", "2025-08-01", 52), ex("bea", "2025-12-03", 76),
      ex("econ", "2026-04-08", 64), ex("bus", "2026-04-08", 82),
    ];
    expect(detectSplits([bea, econ, bus], entries)).toEqual([]);
  });

  it("respects a dismissal so the prompt never returns", () => {
    const econ = sub("econ"), bus = sub("bus");
    const entries = [
      ex("econ", "2025-04-30", 82), ex("bus", "2025-04-30", 82),
      ex("econ", "2025-08-01", 52), ex("bus", "2025-08-01", 52),
      ex("econ", "2025-12-03", 76), ex("bus", "2025-12-03", 76),
    ];
    const [found] = detectSplits([econ, bus], entries);
    expect(detectSplits([econ, bus], entries, [found.key])).toEqual([]);
  });
});

/* ── the merge ─────────────────────────────────────────────────────── */

/* Shared history ends where the desks diverge. Without that bound, `shared` is
   a whole-tape signature intersection with no sense of time, and the merge
   collapses a coincidental later collision — permanently deleting a real
   print off a live desk. */
describe("split detection is bounded by the divergence", () => {
  const subs = [sub("bus"), sub("eco")];
  // Genuine shared history through 2024, then they split, then in 2026 both
  // desks happen to print the same mark on the same day.
  const shared2024 = [
    ...[["bus", "2024-06-10", 70], ["eco", "2024-06-10", 70]],
    ...[["bus", "2024-09-10", 62], ["eco", "2024-09-10", 62]],
    ...[["bus", "2024-11-10", 75], ["eco", "2024-11-10", 75]],
  ].map(([s, d, v]) => ex(s as string, d as string, v as number));
  const afterSplit = [
    ex("bus", "2025-06-10", 80), ex("eco", "2025-06-10", 55),
    ex("bus", "2026-06-10", 68), ex("eco", "2026-06-10", 68), // coincidence
  ];
  const entries = [...shared2024, ...afterSplit];

  it("excludes a coincidental collision dated after the divergence", () => {
    const [plan] = detectSplits(subs, entries, []);
    expect(plan).toBeTruthy();
    expect(plan.divergesAt).toBe("2025-06-10");
    expect(plan.shared.map((e) => e.date)).toEqual(["2024-06-10", "2024-09-10", "2024-11-10"]);
  });

  it("merging keeps both 2026 prints on their own live desks", () => {
    const [plan] = detectSplits(subs, entries, []);
    const out = applySplit({ subjects: subs, entries }, plan, "BUSE");
    const in2026 = out.entries.filter((e) => e.date === "2026-06-10");
    expect(in2026).toHaveLength(2);
    expect(in2026.map((e) => e.subjectId).sort()).toEqual(["bus", "eco"]);
    // The genuine shared history collapsed to exactly one copy on the ancestor.
    const ancestor = out.subjects.find((s) => s.archived)!;
    expect(out.entries.filter((e) => e.subjectId === ancestor.id)).toHaveLength(3);
  });

  it("does not delete a desk's legitimate repeat inside the shared window", () => {
    // The eldest genuinely sat two papers on one day for the same mark.
    const dupes = [...entries, ex("bus", "2024-06-10", 70)];
    const [plan] = detectSplits(subs, dupes, []);
    const out = applySplit({ subjects: subs, entries: dupes }, plan, "BUSE");
    const ancestor = out.subjects.find((s) => s.archived)!;
    const onDay = out.entries.filter((e) => e.subjectId === ancestor.id && e.date === "2024-06-10");
    expect(onDay).toHaveLength(2);
  });
});

describe("applySplit", () => {
  const econ = sub("econ"), bus = sub("bus");
  const entries = [
    ex("econ", "2025-04-30", 82), ex("bus", "2025-04-30", 82),
    ex("econ", "2025-08-01", 52), ex("bus", "2025-08-01", 52),
    ex("econ", "2025-12-03", 76), ex("bus", "2025-12-03", 76),
    ex("econ", "2026-04-08", 64), ex("bus", "2026-04-08", 82),
  ];
  const [plan] = detectSplits([econ, bus], entries);
  const out = applySplit({ subjects: [econ, bus], entries }, plan, "BEA");

  it("creates the ancestor as an archived desk", () => {
    const bea = out.subjects.find((s) => s.ticker === "BEA")!;
    expect(bea).toBeDefined();
    expect(bea.archived).toBe(true);
  });

  it("points both successors at it", () => {
    const bea = out.subjects.find((s) => s.ticker === "BEA")!;
    for (const tk of ["ECON", "BUS"]) {
      expect(out.subjects.find((s) => s.ticker === tk)!.formerly).toBe(bea.id);
    }
  });

  it("moves the shared prints to the ancestor and keeps exactly one copy", () => {
    const bea = out.subjects.find((s) => s.ticker === "BEA")!;
    const beaPrints = out.entries.filter((e) => e.subjectId === bea.id);
    expect(beaPrints.map((e) => e.score).sort((a, b) => a - b)).toEqual([52, 76, 82]);
    // 3 shared (once) + ECON's own + BUS's own = 5, down from 8.
    expect(out.entries).toHaveLength(5);
  });

  it("leaves each successor only its own post-split prints", () => {
    const econOut = out.subjects.find((s) => s.ticker === "ECON")!;
    expect(out.entries.filter((e) => e.subjectId === econOut.id).map((e) => e.score)).toEqual([64]);
  });

  it("is idempotent — a merged book detects nothing further", () => {
    expect(detectSplits(out.subjects, out.entries)).toEqual([]);
  });
});

/* A3 review finding: applySplit moves a shared entry to the ancestor desk
   keeping the entry's own id, but the entry's TOPIC MARKS stay filed under
   the dual FK (entryId, topicId) — and a mark's topicId still points at the
   MEMBER desk (topics never move). After the merge, entrySubjectOf(entryId)
   reads the ancestor while topicSubjectOf(topicId) still reads the member,
   so io.ts's sanitizeTopicMark drops the row on the very next load — the
   student is never told. applySplit must drop those marks itself, explicitly
   and visibly, and `splitTopicMarkLoss` must let a caller preview the count
   BEFORE the merge is applied (SplitBanner's copy, per the review). */
describe("applySplit and topic marks (A3 review finding)", () => {
  const econ = sub("econ"), bus = sub("bus");
  const entries = [
    ex("econ", "2025-04-30", 82), ex("bus", "2025-04-30", 82),
    ex("econ", "2025-08-01", 52), ex("bus", "2025-08-01", 52),
    ex("econ", "2025-12-03", 76), ex("bus", "2025-12-03", 76),
    ex("econ", "2026-04-08", 64), ex("bus", "2026-04-08", 82),
  ];
  const [plan] = detectSplits([econ, bus], entries);
  // econ is the eldest (first candidate) — its shared prints are the ones
  // that survive under the ancestor's id after the merge.
  const reassigned = entries.find((e) => e.subjectId === "econ" && e.date === "2025-04-30")!;
  const untouched = entries.find((e) => e.subjectId === "econ" && e.date === "2026-04-08")!; // econ's own post-split print
  const topicMarks: TopicMark[] = [
    { id: "tm-shared", entryId: reassigned.id, topicId: "t-econ", scorePct: 80 },
    { id: "tm-own", entryId: untouched.id, topicId: "t-econ", scorePct: 90 },
  ];

  it("previews the count of topic marks the merge would drop, before it is applied", () => {
    expect(splitTopicMarkLoss(plan, entries, topicMarks)).toBe(1);
  });

  it("previews zero when there are no topic marks at all", () => {
    expect(splitTopicMarkLoss(plan, entries, undefined)).toBe(0);
    expect(splitTopicMarkLoss(plan, entries, [])).toBe(0);
  });

  it("drops exactly the topic marks whose entry gets reassigned to the ancestor, keeping every other mark", () => {
    const out = applySplit({ subjects: [econ, bus], entries, topicMarks }, plan, "BEA");
    expect(out.topicMarks).toEqual([topicMarks[1]]);
  });

  it("leaves topicMarks untouched (undefined) when the book carries none", () => {
    const out = applySplit<{ subjects: Subject[]; entries: GradeEntry[]; topicMarks?: TopicMark[] }>(
      { subjects: [econ, bus], entries },
      plan,
      "BEA",
    );
    expect(out.topicMarks).toBeUndefined();
  });
});
