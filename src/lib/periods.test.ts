import { describe, expect, it } from "vitest";
import { currentTermKey, entryPeriod, entryTermKey, periodInfo, prevTermKey } from "./periods";
import { freshCalendar } from "./calendar";
import type { GradeEntry } from "../types";

const CAL = freshCalendar();

const entry = (date: string, term?: string): GradeEntry => ({
  id: "e1", subjectId: "s1", date, type: "Exam", score: 70, title: "", term,
});

describe("periodInfo", () => {
  it("buckets months", () => {
    expect(periodInfo("2026-03-14", "month")).toEqual({ key: "2026-03", label: "Mar 26" });
  });
  it("buckets terms on the school calendar, not the calendar quarter", () => {
    // Q2 by the calendar; the term it reports on is T1, because T1 2026 closed
    // on 2 April and this is the paper it set.
    expect(periodInfo("2026-04-08", "term", CAL)).toEqual({ key: "2026-T1", label: "T1 2026" });
    expect(periodInfo("2026-06-10", "term", CAL).key).toBe("2026-T2");
    expect(periodInfo("2026-11-20", "term", CAL).key).toBe("2026-T4");
  });
  it("files the summer against the year that just ended", () => {
    expect(periodInfo("2026-01-10", "term", CAL).key).toBe("2025-T4");
    expect(periodInfo("2026-01-10", "year", CAL).key).toBe("2025");
  });
  it("buckets semesters off the same grid", () => {
    expect(periodInfo("2026-04-08", "semester", CAL).key).toBe("2026-S1");
    expect(periodInfo("2026-06-10", "semester", CAL).key).toBe("2026-S1");
    expect(periodInfo("2026-09-01", "semester", CAL)).toEqual({ key: "2026-S2", label: "S2 2026" });
  });
  it("falls through to the raw date", () => {
    expect(periodInfo("2026-07-01", "assessment").key).toBe("2026-07-01");
  });
});

describe("a hand-filed term", () => {
  it("wins over whatever the date would have said", () => {
    expect(entryTermKey(entry("2026-07-30"), CAL)).toBe("2026-T2");
    expect(entryTermKey(entry("2026-07-30", "2026-T3"), CAL)).toBe("2026-T3");
  });
  it("carries into every term-based bucket", () => {
    const pinned = entry("2026-07-30", "2026-T3");
    expect(entryPeriod(pinned, "term", CAL).label).toBe("T3 2026");
    expect(entryPeriod(pinned, "semester", CAL).key).toBe("2026-S2");
    expect(entryPeriod(pinned, "year", CAL).key).toBe("2026");
  });
  it("leaves date-based buckets alone — a month is a month", () => {
    expect(entryPeriod(entry("2026-07-30", "2026-T3"), "month", CAL).key).toBe("2026-07");
  });
  it("ignores a term key that is not one", () => {
    expect(entryTermKey(entry("2026-07-30", "banana"), CAL)).toBe("2026-T2");
  });
});

describe("where the book stands today", () => {
  it("names the term now taking results, and the one before it", () => {
    // 22 July 2026: teaching T3 week 1, but T2's papers are what is being filed.
    expect(currentTermKey(CAL, "2026-07-22")).toEqual({ key: "2026-T2", label: "T2 2026" });
    expect(prevTermKey(CAL, "2026-07-22")).toEqual({ key: "2026-T1", label: "T1 2026" });
  });
  it("rolls the year backwards at T1", () => {
    expect(prevTermKey(CAL, "2026-03-01").key).toBe("2025-T4");
  });
});
