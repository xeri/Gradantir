import { describe, expect, it } from "vitest";
import { classifyUpcoming, crowding, nextUpcoming, resolveUpcoming } from "./upcoming";
import type { GradeEntry, Upcoming } from "../types";

const up = (id: string, subjectId: string, date: string, type: Upcoming["type"] = "Exam"): Upcoming =>
  ({ id, subjectId, date, type, title: "" });

const entry = (id: string, subjectId: string, date: string, score: number, type: GradeEntry["type"] = "Exam"): GradeEntry =>
  ({ id, subjectId, date, type, score, title: "" });

describe("crowding", () => {
  const cal: Upcoming[] = [
    up("t", "s1", "2026-09-15"),
    up("a", "s2", "2026-09-10"), // 5 days before → crowds
    up("b", "s3", "2026-09-14"), // 1 day before → crowds
    up("c", "s4", "2026-09-15", "Test"), // same day → crowds
    up("d", "s5", "2026-08-20"), // 26 days before → outside 14d window
    up("e", "s6", "2026-09-18"), // after → never crowds
  ];
  it("counts other sittings in the fortnight up to and including the day", () => {
    expect(crowding(cal[0], cal, 14)).toBe(3);
  });
  it("is zero for the earliest paper — nothing before it, and it never counts itself", () => {
    // 'd' (2026-08-20) is the earliest sitting; the window before it is empty.
    expect(crowding(cal[4], cal, 14)).toBe(0);
    // And 't' does not crowd 't': its own count excludes it (3, not 4).
    expect(crowding(cal[0], cal, 60)).toBe(4); // now 'd' (26d) falls inside 60d, but not 't' itself
  });
  it("respects the window length", () => {
    expect(crowding(cal[0], cal, 2)).toBe(2); // only 'b' (1d) and 'c' (0d)
  });
});

describe("resolveUpcoming", () => {
  const entries = [
    entry("e1", "s1", "2026-09-16", 74), // 1 day after the sitting, same type
    entry("e2", "s1", "2026-09-15", 80, "Test"), // wrong type
    entry("e3", "s1", "2026-11-01", 60), // far outside the window
  ];
  it("matches the realized entry of the same subject and type nearest the date", () => {
    const r = resolveUpcoming(up("t", "s1", "2026-09-15"), entries, 21);
    expect(r?.id).toBe("e1");
  });
  it("returns null when nothing sat within the window", () => {
    expect(resolveUpcoming(up("t", "s1", "2026-09-15"), [entries[2]], 21)).toBeNull();
    expect(resolveUpcoming(up("t", "s9", "2026-09-15"), entries, 21)).toBeNull();
  });
});

describe("classifyUpcoming", () => {
  const cal = [up("u1", "s1", "2026-09-15"), up("u2", "s2", "2026-10-01")];
  const entries = [entry("e1", "s1", "2026-09-16", 74)];
  it("splits sittings into resolved (a real mark landed) and pending", () => {
    const { resolved, pending } = classifyUpcoming(cal, entries, "2026-09-20", 21);
    expect(resolved.map((r) => r.upcoming.id)).toEqual(["u1"]);
    expect(resolved[0].realized.score).toBe(74);
    expect(pending.map((u) => u.id)).toEqual(["u2"]);
  });
});

describe("nextUpcoming", () => {
  it("returns the soonest unresolved sitting on or after today", () => {
    const cal = [up("u2", "s2", "2026-10-01"), up("u1", "s1", "2026-09-15")];
    expect(nextUpcoming(cal, [], "2026-09-10")?.id).toBe("u1");
  });
  it("skips sittings already in the past with no realized mark", () => {
    const cal = [up("u1", "s1", "2026-09-15")];
    expect(nextUpcoming(cal, [], "2026-09-20")).toBeNull();
  });
});
