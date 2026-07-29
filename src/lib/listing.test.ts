import { describe, expect, it } from "vitest";
import { closeTerms, listedAsOf, listedAt } from "./listing";
import { freshCalendar } from "./calendar";
import type { GradeEntry, Subject } from "../types";

const CAL = freshCalendar();

const sub = (id: string, extra: Partial<Subject> = {}): Subject => ({
  id, name: id, ticker: id.toUpperCase(), color: "#4D7CFE", target: null, ...extra,
});
let eid = 0;
const ge = (subjectId: string, date: string): GradeEntry => ({
  id: `e${eid++}`, subjectId, date, type: "Exam", score: 70, title: "",
});

describe("closeTerms", () => {
  it("closes an archived desk in the term its last print reports on", () => {
    const subs = [sub("live"), sub("lat", { archived: true })];
    const entries = [ge("live", "2026-04-08"), ge("lat", "2024-04-19"), ge("lat", "2024-12-05")];
    expect(closeTerms(subs, entries, CAL).get("lat")).toBe("2024-T4");
  });
  it("honors a hand-filed term", () => {
    const subs = [sub("lat", { archived: true })];
    const entries = [{ ...ge("lat", "2024-12-05"), term: "2024-T3" }];
    expect(closeTerms(subs, entries, CAL).get("lat")).toBe("2024-T3");
  });
});

describe("listedAt", () => {
  it("keeps a live desk on the book at any date", () => {
    expect(listedAt(undefined, "2099-01-01")).toBe(true);
  });
  it("carries a closed desk through the whole term its last print reports on", () => {
    // Latin's final exam printed on 2024-12-05, which files against T4 2024.
    // It counts for that whole term — including the summer that files into it.
    expect(listedAt("2024-T4", "2024-11-20", CAL)).toBe(true);
    expect(listedAt("2024-T4", "2025-01-20", CAL)).toBe(true);
    expect(listedAt("2024-T4", "2025-04-30", CAL)).toBe(false); // T1 2025 filing
    expect(listedAt("2024-T4", "2026-07-22", CAL)).toBe(false);
  });
  it("never lists a desk archived with nothing on the tape", () => {
    expect(listedAt(null, "2024-01-01")).toBe(false);
  });
});

describe("listedAsOf", () => {
  const rows = [
    { sub: sub("math"), entries: [ge("math", "2026-04-08")] },
    { sub: sub("lat", { archived: true }), entries: [ge("lat", "2024-12-05")] },
  ];
  it("holds the closed desk in the book while its term stands", () => {
    expect(listedAsOf(rows, "2024-11-20", CAL).map((r) => r.sub.id)).toEqual(["math", "lat"]);
  });
  it("drops it once the term rolls", () => {
    expect(listedAsOf(rows, "2026-07-22", CAL).map((r) => r.sub.id)).toEqual(["math"]);
  });
});
