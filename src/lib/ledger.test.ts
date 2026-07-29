import { describe, expect, it } from "vitest";
import { freshSettings } from "../constants";
import { bookLedger, clearSection, isRemovable, removeFromBook } from "./ledger";
import type { AppData } from "../types";

/**
 * EVERY STORED ROW IS REPORTED, REMOVABLE ONE AT A TIME, AND NEVER CASCADES
 * BY ITSELF.
 *
 * The five life-signal slices (topics, topicMarks, sessions, rest,
 * disruptions) are elicited inputs exactly like duels or allocations — the
 * ledger must report every row and let a student drop any one of them. The
 * one wrinkle is `topicMarks` and `sessions`, which carry a foreign key
 * (`topicId`) into `topics`: removing a topic here follows the SAME
 * no-cascade precedent `deleteEntry` already sets in App.tsx (dropping an
 * entry does not touch the topicMarks that reference it) — a removed row's
 * dependents are left pointing at a ghost until the next sanitize pass, not
 * silently swept by the ledger itself.
 */

const TODAY = "2026-07-28";

const data = (): AppData => ({
  subjects: [
    { id: "s-a", name: "Mathematics", ticker: "MATH", color: "#4D7CFE", target: null },
    { id: "s-b", name: "Physics", ticker: "PHYS", color: "#E8A33D", target: null, archived: true },
  ],
  entries: [{ id: "e1", subjectId: "s-a", date: "2026-03-01", type: "Test", score: 72, title: "Algebra" }],
  settings: freshSettings(),
  sample: false,
  upcoming: [{ id: "u1", subjectId: "s-a", date: "2026-09-01", type: "Exam", title: "Finals", selfPred: { point: 78 } }],
  allocations: [{ id: "al1", roundKey: "2026-T2", total: 100, hoursPerWeek: 12, planned: { "s-a": 60, "s-b": 40 }, createdAt: "2026-06-01" }],
  duels: [{ id: "d1", aId: "s-a", bId: "s-b", winnerId: "s-a", createdAt: "2026-06-02" }],
  meanCalls: [{ id: "m1", roundKey: "2026-T2", predAvg: 74, ranking: ["s-a", "s-b"], createdAt: "2026-06-03" }],
  topics: [
    { id: "tp1", subjectId: "s-a", name: "Algebra", weightPct: 30, prereqIds: ["tp0"] },
    { id: "tp2", subjectId: "s-b", name: "Mechanics" },
  ],
  topicMarks: [{ id: "tm1", entryId: "e1", topicId: "tp1", scorePct: 82, maxMarks: 20, errorKind: "careless" }],
  sessions: [{ id: "ss1", subjectId: "s-a", date: TODAY, minutes: 45, kind: "practice", topicIds: ["tp1"] }],
  rest: [
    { id: "r1", date: TODAY, hours: 6.5, bedtime: "23:40" },
    { id: "r2", date: "2026-07-27", hours: 8 },
  ],
  disruptions: [{ id: "di1", date: TODAY, days: 2, kind: "illness", note: "flu" }],
});

const ticker = (id: string) => ({ "s-a": "MATH", "s-b": "PHYS" }[id] ?? id);
const section = (d: AppData, key: string) => bookLedger(d, ticker).find((s) => s.key === key)!;

const ELICITED = ["upcoming", "allocations", "duels", "meanCalls", "topics", "topicMarks", "sessions", "rest", "disruptions"] as const;

describe("bookLedger", () => {
  it("reports every section, empty ones included — the shape never changes", () => {
    const bare: AppData = { subjects: [], entries: [], settings: freshSettings(), sample: false };
    const keys = bookLedger(bare, ticker).map((s) => s.key);
    expect(keys).toEqual([
      "upcoming", "allocations", "duels", "meanCalls",
      "topics", "topicMarks", "sessions", "rest", "disruptions",
      "subjects", "entries",
    ]);
    for (const s of bookLedger(bare, ticker)) expect(s.rows).toEqual([]);
  });

  it("quotes each row in tickers, not ids", () => {
    const d = data();
    expect(section(d, "duels").rows[0].primary).toBe("MATH ▸");
    expect(section(d, "duels").rows[0].secondary).toContain("MATH VS PHYS");
    expect(section(d, "meanCalls").rows[0].secondary).toContain("MATH > PHYS");
    expect(section(d, "topics").rows.find((r) => r.id === "tp1")!.primary).toBe("MATH");
    expect(section(d, "topicMarks").rows[0].primary).toBe("MATH");
    expect(section(d, "sessions").rows[0].primary).toBe("MATH");
  });

  it("says what each elicited row is holding", () => {
    const d = data();
    expect(section(d, "upcoming").rows[0].secondary).toContain("YOU 78");
    expect(section(d, "allocations").rows[0].secondary).toContain("12.0 H/WK");
    expect(section(d, "allocations").rows[0].secondary).toContain("PLAN ONLY");
  });

  it("marks every elicited section removable, the roster and the tape not", () => {
    const d = data();
    for (const key of ELICITED) {
      expect(section(d, key).removable).toBe(true);
      expect(isRemovable(key)).toBe(true);
    }
    for (const key of ["subjects", "entries"] as const) {
      expect(section(d, key).removable).toBe(false);
      expect(isRemovable(key)).toBe(false);
    }
  });

  describe("topics", () => {
    it("names the topic and its weight", () => {
      const d = data();
      const row = section(d, "topics").rows.find((r) => r.id === "tp1")!;
      expect(row.secondary).toContain("Algebra");
      expect(row.secondary).toContain("30%");
      expect(row.secondary).toContain("1 PREREQ");
    });

    it("marks equal weight when weightPct is absent", () => {
      const d = data();
      const row = section(d, "topics").rows.find((r) => r.id === "tp2")!;
      expect(row.secondary).toContain("EQUAL WEIGHT");
      expect(row.secondary).not.toContain("PREREQ");
    });
  });

  describe("topicMarks", () => {
    it("shows the entry's date, the topic's name, and the score", () => {
      const d = data();
      const row = section(d, "topicMarks").rows[0];
      expect(row.secondary).toContain("2026-03-01");
      expect(row.secondary).toContain("Algebra");
      expect(row.secondary).toContain("82%");
      expect(row.secondary).toContain("CARELESS");
    });
  });

  describe("sessions", () => {
    it("shows the date, minutes, and kind", () => {
      const d = data();
      const row = section(d, "sessions").rows[0];
      expect(row.secondary).toBe(`${TODAY} · 45MIN · PRACTICE · 1 TOPICS`);
    });
  });

  describe("rest", () => {
    it("reads exactly date, hours, and bedtime when bedtime is logged", () => {
      const d = data();
      const row = section(d, "rest").rows.find((r) => r.id === "r1")!;
      expect(row.secondary).toBe("2026-07-28 · 6.5H · BED 23:40");
    });

    it("omits the bedtime segment when bedtime is absent", () => {
      const d = data();
      const row = section(d, "rest").rows.find((r) => r.id === "r2")!;
      expect(row.secondary).toBe("2026-07-27 · 8H");
    });
  });

  describe("disruptions", () => {
    it("shows the date, kind, days, and note", () => {
      const d = data();
      const row = section(d, "disruptions").rows[0];
      expect(row.secondary).toBe(`${TODAY} · ILLNESS · 2D · flu`);
    });
  });
});

describe("removeFromBook", () => {
  it("drops exactly one elicited row and nothing else", () => {
    const next = removeFromBook(data(), "duels", "d1");
    expect(next.duels).toEqual([]);
    expect(next.meanCalls).toHaveLength(1);
    expect(next.entries).toHaveLength(1);
  });

  it("leaves the book alone for an unknown row", () => {
    const d = data();
    expect(removeFromBook(d, "duels", "nope").duels).toHaveLength(1);
  });

  it("refuses to cascade the roster or the tape", () => {
    const d = data();
    expect(removeFromBook(d, "subjects", "s-a")).toBe(d);
    expect(removeFromBook(d, "entries", "e1")).toBe(d);
  });

  for (const key of ["topics", "topicMarks", "sessions", "rest", "disruptions"] as const) {
    it(`drops one ${key} row and nothing else`, () => {
      const d = data();
      const before = (d[key] ?? []).length;
      const droppedId = (d[key] ?? [])[0].id;
      const next = removeFromBook(d, key, droppedId);
      expect(next[key]).toHaveLength(before - 1);
      expect(next.entries).toHaveLength(1);
    });
  }

  it("removing a topic does not cascade into topicMarks or sessions that still name it — same as dropping an entry leaves its topicMarks alone", () => {
    const next = removeFromBook(data(), "topics", "tp1");
    expect(next.topics!.find((t) => t.id === "tp1")).toBeUndefined();
    // The dependents are untouched — they still point at the now-missing topic.
    expect(next.topicMarks).toHaveLength(1);
    expect(next.topicMarks![0].topicId).toBe("tp1");
    expect(next.sessions![0].topicIds).toEqual(["tp1"]);
  });
});

describe("clearSection", () => {
  it("empties one elicited section", () => {
    const next = clearSection(data(), "meanCalls");
    expect(next.meanCalls).toEqual([]);
    expect(next.duels).toHaveLength(1);
  });

  it("refuses the roster and the tape", () => {
    const d = data();
    expect(clearSection(d, "subjects")).toBe(d);
  });

  for (const key of ["topics", "topicMarks", "sessions", "rest", "disruptions"] as const) {
    it(`empties the ${key} section and nothing else`, () => {
      const next = clearSection(data(), key);
      expect(next[key]).toEqual([]);
      expect(next.entries).toHaveLength(1);
    });
  }

  it("clearing topics does not cascade into topicMarks or sessions", () => {
    const next = clearSection(data(), "topics");
    expect(next.topics).toEqual([]);
    expect(next.topicMarks).toHaveLength(1);
    expect(next.sessions).toHaveLength(1);
  });
});
