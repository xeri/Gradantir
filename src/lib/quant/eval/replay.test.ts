import { describe, expect, it } from "vitest";
import { freshSettings } from "../../../constants";
import { DEFAULT_CALENDAR } from "../../calendar";
import { entryTermKey } from "../../periods";
import { replayRegister } from "./replay";
import type { GradeEntry, Subject, Settings } from "../../../types";

const SETTINGS: Settings = freshSettings();

const sub = (id: string, ticker: string): Subject => ({
  id, name: ticker, ticker, color: "#4D7CFE", target: null,
});

let seq = 0;
const entry = (subjectId: string, date: string, score: number, type: GradeEntry["type"] = "Test"): GradeEntry => ({
  id: `e${++seq}`, subjectId, date, type, score, title: "",
});

/** A desk with enough coursework to price from, then two exam rounds. */
function book(): { subjects: Subject[]; entries: GradeEntry[] } {
  const s = [sub("s-a", "AAA"), sub("s-b", "BBB")];
  const e: GradeEntry[] = [];
  for (const id of ["s-a", "s-b"]) {
    e.push(entry(id, "2025-02-10", 70));
    e.push(entry(id, "2025-03-10", 72));
    e.push(entry(id, "2025-04-01", 68, "Exam"));   // 2025-T1
    e.push(entry(id, "2025-06-10", 74));
    e.push(entry(id, "2025-07-01", 76, "Exam"));   // 2025-T2
  }
  return { subjects: s, entries: e };
}

describe("replayRegister", () => {
  it("is empty on an empty book", () => {
    expect(replayRegister([], [], SETTINGS, "2026-01-01")).toEqual([]);
  });

  it("logs one resolved forecast per desk per exam round it can price", () => {
    const { subjects, entries } = book();
    const logs = replayRegister(subjects, entries, SETTINGS, "2025-08-01");
    const resolved = logs.filter((l) => l.resolvedAt != null);
    // Both desks, both exam rounds — the first exam round has two prior prints,
    // which is the least the ensemble will forecast from.
    expect(resolved.map((l) => `${l.subjectId}|${l.roundKey}`).sort()).toEqual([
      "s-a|2025-T1", "s-a|2025-T2", "s-b|2025-T1", "s-b|2025-T2",
    ]);
    for (const l of resolved) {
      expect(l.realized).toBe(l.roundKey === "2025-T1" ? 68 : 76);
      expect(l.error).toBeCloseTo(l.point - l.realized!, 10);
      expect(l.crps).toBeGreaterThan(0);
    }
  });

  it("never lets a forecast see its own outcome, or anything after it", () => {
    const { subjects, entries } = book();
    const base = replayRegister(subjects, entries, SETTINGS, "2025-08-01");
    const t1 = base.find((l) => l.subjectId === "s-a" && l.roundKey === "2025-T1")!;

    // Rewrite everything from the T1 exam onward — the T1 forecast must not move.
    const tampered = entries.map((e) =>
      e.subjectId === "s-a" && e.date >= "2025-04-01" ? { ...e, score: 5 } : e,
    );
    const after = replayRegister(subjects, tampered, SETTINGS, "2025-08-01");
    const t1b = after.find((l) => l.subjectId === "s-a" && l.roundKey === "2025-T1")!;

    expect(t1b.point).toBe(t1.point);
    expect(t1b.sd).toBe(t1.sd);
    expect(t1b.createdAt).toBe(t1.createdAt);
    // Only the realized side moves, because only the outcome changed.
    expect(t1b.realized).toBe(5);
  });

  it("dates each forecast at the last print it could have seen", () => {
    const { subjects, entries } = book();
    const logs = replayRegister(subjects, entries, SETTINGS, "2025-08-01");
    const t2 = logs.find((l) => l.subjectId === "s-a" && l.roundKey === "2025-T2")!;
    expect(t2.createdAt).toBe("2025-06-10");
    expect(t2.createdAt < "2025-07-01").toBe(true);
  });

  it("is deterministic and idempotent", () => {
    const { subjects, entries } = book();
    const a = replayRegister(subjects, entries, SETTINGS, "2025-08-01");
    const b = replayRegister(subjects, [...entries].reverse(), SETTINGS, "2025-08-01");
    expect(b).toEqual(a);
  });

  it("keys logs the way the live register did, so nothing multiplies", () => {
    const { subjects, entries } = book();
    const logs = replayRegister(subjects, entries, SETTINGS, "2025-08-01");
    const ids = logs.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of logs) expect(l.id).toBe(`${l.subjectId}|${l.roundKey}|exam|${l.modelVersion}`);
  });

  it("carries one live unresolved call for the round still ahead", () => {
    const { subjects, entries } = book();
    const logs = replayRegister(subjects, entries, SETTINGS, "2025-08-20");
    const live = logs.filter((l) => l.resolvedAt == null);
    expect(live.length).toBeGreaterThan(0);
    for (const l of live) {
      expect(l.createdAt).toBe("2025-08-20");
      expect(l.realized).toBeUndefined();
      // A live call is for a round no exam has printed in yet.
      const printed = entries.some(
        (e) => e.subjectId === l.subjectId && e.type === "Exam" && entryTermKey(e, DEFAULT_CALENDAR) === l.roundKey,
      );
      expect(printed).toBe(false);
    }
  });

  it("does not forecast a sitting a delisted desk will never take", () => {
    const { subjects, entries } = book();
    const closed = subjects.map((s) => (s.id === "s-b" ? { ...s, archived: true } : s));
    const logs = replayRegister(closed, entries, SETTINGS, "2025-08-20");
    expect(logs.some((l) => l.subjectId === "s-b" && l.resolvedAt == null)).toBe(false);
    // Its resolved history is still evidence, though — a closed desk's past
    // forecasts measured the same model.
    expect(logs.some((l) => l.subjectId === "s-b" && l.resolvedAt != null)).toBe(true);
  });

  it("declines to forecast a round it has too little tape to price", () => {
    const subjects = [sub("s-a", "AAA")];
    const entries = [entry("s-a", "2025-04-01", 68, "Exam")];
    expect(replayRegister(subjects, entries, SETTINGS, "2025-05-01").filter((l) => l.resolvedAt != null)).toEqual([]);
  });
});
