import { describe, expect, it } from "vitest";
import { freshSettings } from "../constants";
import { bookLedger, clearSection, isRemovable, removeFromBook } from "./ledger";
import type { AppData } from "../types";

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
});

const ticker = (id: string) => ({ "s-a": "MATH", "s-b": "PHYS" }[id] ?? id);
const section = (d: AppData, key: string) => bookLedger(d, ticker).find((s) => s.key === key)!;

describe("bookLedger", () => {
  it("reports every section, empty ones included — the shape never changes", () => {
    const bare: AppData = { subjects: [], entries: [], settings: freshSettings(), sample: false };
    const keys = bookLedger(bare, ticker).map((s) => s.key);
    expect(keys).toEqual(["upcoming", "allocations", "duels", "meanCalls", "subjects", "entries"]);
    for (const s of bookLedger(bare, ticker)) expect(s.rows).toEqual([]);
  });

  it("quotes each row in tickers, not ids", () => {
    const d = data();
    expect(section(d, "duels").rows[0].primary).toBe("MATH ▸");
    expect(section(d, "duels").rows[0].secondary).toContain("MATH VS PHYS");
    expect(section(d, "meanCalls").rows[0].secondary).toContain("MATH > PHYS");
  });

  it("says what each elicited row is holding", () => {
    const d = data();
    expect(section(d, "upcoming").rows[0].secondary).toContain("YOU 78");
    expect(section(d, "allocations").rows[0].secondary).toContain("12.0 H/WK");
    expect(section(d, "allocations").rows[0].secondary).toContain("PLAN ONLY");
  });

  it("marks the roster and the tape unremovable — they cascade elsewhere", () => {
    const d = data();
    for (const key of ["upcoming", "allocations", "duels", "meanCalls"] as const) {
      expect(section(d, key).removable).toBe(true);
      expect(isRemovable(key)).toBe(true);
    }
    for (const key of ["subjects", "entries"] as const) {
      expect(section(d, key).removable).toBe(false);
      expect(isRemovable(key)).toBe(false);
    }
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
});
