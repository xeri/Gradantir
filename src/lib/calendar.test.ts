import { describe, expect, it } from "vitest";
import {
  freshCalendar, inSession, PUBLISHED_TERMS, parseTermKey, reportCloses, reportOpens,
  reportingTermOf, sessionDaysBetween, spanOf, stepTerm, teachingTermOf, termKey, termsOf,
} from "./calendar";

const CAL = freshCalendar();

describe("published term dates", () => {
  it("reads a year straight off the table", () => {
    expect(spanOf({ year: 2026, term: 1 }, CAL)).toEqual({ start: "2026-01-20", end: "2026-04-02" });
    expect(spanOf({ year: 2026, term: 3 }, CAL)).toEqual({ start: "2026-07-20", end: "2026-09-25" });
    expect(spanOf({ year: 2024, term: 4 }, CAL)).toEqual({ start: "2024-10-14", end: "2024-12-05" });
  });
  it("never lets a published year overlap itself", () => {
    for (const [year, spans] of Object.entries(PUBLISHED_TERMS)) {
      for (let i = 0; i < 4; i++) {
        expect(spans[i].start <= spans[i].end, `${year} T${i + 1}`).toBe(true);
        if (i) expect(spans[i - 1].end < spans[i].start, `${year} T${i}→T${i + 1}`).toBe(true);
      }
    }
  });
});

describe("projecting a year the school has not published", () => {
  const spans = termsOf(2028, CAL);
  it("lands each term within a fortnight of the nearest published year", () => {
    const ref = termsOf(2027, CAL);
    for (let i = 0; i < 4; i++) {
      const drift = Math.abs(
        new Date(spans[i].start).getTime() - new Date(ref[i].start.replace("2027", "2028")).getTime(),
      );
      expect(drift / 86400000, `T${i + 1}`).toBeLessThanOrEqual(14);
    }
  });
  it("keeps school opening on a weekday", () => {
    for (const s of spans) {
      const day = new Date(s.start + "T00:00:00").getDay();
      expect(day, s.start).toBeGreaterThanOrEqual(1);
      expect(day, s.start).toBeLessThanOrEqual(5);
    }
  });
  it("still runs the four terms in order", () => {
    for (let i = 1; i < 4; i++) expect(spans[i - 1].end < spans[i].start).toBe(true);
  });
});

describe("the reporting grid — which term a result reports on", () => {
  const key = (d: string) => termKey(reportingTermOf(d, CAL));

  it("files a paper handed back in the holidays against the term that set it", () => {
    expect(key("2026-04-08")).toBe("2026-T1"); // T1 closed 2 Apr, T2 opens 20 Apr
    expect(key("2024-04-19")).toBe("2024-T1");
  });
  it("files a paper handed back in the opening days of the next term the same way", () => {
    expect(key("2025-04-30")).toBe("2025-T1"); // two days into T2 2025
    expect(key("2025-08-01")).toBe("2025-T2"); // the mid-year round, sat T2, marked into T3
    expect(key("2024-08-09")).toBe("2024-T2");
  });
  it("keeps the same round in the same term across years — the whole point", () => {
    expect([key("2024-04-19"), key("2025-04-30"), key("2026-04-08")]).toEqual(["2024-T1", "2025-T1", "2026-T1"]);
    expect([key("2024-08-09"), key("2025-08-01")]).toEqual(["2024-T2", "2025-T2"]);
  });
  it("files the end-of-year round against T4, and the summer that follows with it", () => {
    expect(key("2024-12-05")).toBe("2024-T4");
    expect(key("2025-12-03")).toBe("2025-T4");
    expect(key("2026-01-15")).toBe("2025-T4"); // mid-summer: last year's business
  });
  it("hands mid-term work to the term it was sat in", () => {
    expect(key("2026-06-10")).toBe("2026-T2");
    expect(key("2026-09-01")).toBe("2026-T3");
  });
  it("opens and closes each window back to back — no date falls between terms", () => {
    const t2 = { year: 2026, term: 2 as const };
    expect(reportOpens(t2, CAL)).toBe("2026-05-18");
    expect(reportCloses(t2, CAL)).toBe("2026-08-16");
    expect(reportOpens({ year: 2026, term: 3 }, CAL)).toBe("2026-08-17");
  });
  it("moves with the settlement window", () => {
    const tight = { ...CAL, settleDays: 0 };
    expect(termKey(reportingTermOf("2025-04-30", tight))).toBe("2025-T2"); // no settlement, no re-filing
    expect(termKey(reportingTermOf("2025-04-30", CAL))).toBe("2025-T1");
  });
});

describe("the teaching clock", () => {
  it("knows which week of which term today is", () => {
    const pos = teachingTermOf("2026-07-22", CAL); // T3 opened Monday 20 July
    expect(termKey(pos.ref)).toBe("2026-T3");
    expect(pos.week).toBe(1);
    expect(pos.inSession).toBe(true);
  });
  it("reports the break as the term that just ended", () => {
    const pos = teachingTermOf("2026-04-08", CAL);
    expect(termKey(pos.ref)).toBe("2026-T1");
    expect(pos.inSession).toBe(false);
    expect(pos.week).toBeNull();
  });
  it("disagrees with the filing clock in the opening weeks, and that is the point", () => {
    expect(termKey(teachingTermOf("2026-07-22", CAL).ref)).toBe("2026-T3");
    expect(termKey(reportingTermOf("2026-07-22", CAL))).toBe("2026-T2");
  });
  it("closes the school at weekends", () => {
    expect(inSession("2026-07-22", CAL)).toBe(true);
    expect(inSession("2026-07-25", CAL)).toBe(false); // Saturday
    expect(inSession("2026-12-25", CAL)).toBe(false); // summer
  });
});

describe("session days — the clock staleness runs on", () => {
  it("counts only days school was open", () => {
    // 8 Apr → 22 Jul 2026 is 105 calendar days, but T1 had already closed and
    // T2 ran 20 Apr – 3 Jul: eleven teaching weeks plus three days of T3.
    const calDays = 105;
    const school = sessionDaysBetween("2026-04-08", "2026-07-22", CAL);
    expect(school).toBeLessThan(calDays);
    expect(school).toBeGreaterThan(50);
  });
  it("refuses to age anyone over the summer", () => {
    expect(sessionDaysBetween("2025-12-03", "2026-01-15", CAL)).toBe(0);
  });
  it("is zero backwards and zero for the same day", () => {
    expect(sessionDaysBetween("2026-07-22", "2026-07-22", CAL)).toBe(0);
    expect(sessionDaysBetween("2026-07-22", "2026-04-08", CAL)).toBe(0);
  });
});

describe("term arithmetic", () => {
  it("rolls the year", () => {
    expect(stepTerm({ year: 2026, term: 4 }, 1)).toEqual({ year: 2027, term: 1 });
    expect(stepTerm({ year: 2026, term: 1 }, -1)).toEqual({ year: 2025, term: 4 });
    expect(stepTerm({ year: 2026, term: 2 }, -6)).toEqual({ year: 2024, term: 4 });
  });
  it("round-trips a key", () => {
    expect(parseTermKey("2026-T3")).toEqual({ year: 2026, term: 3 });
    expect(parseTermKey("2026-T5")).toBeNull();
    expect(parseTermKey("nonsense")).toBeNull();
  });
  it("sorts keys chronologically as plain strings", () => {
    expect(["2026-T1", "2025-T4", "2026-T2"].sort()).toEqual(["2025-T4", "2026-T1", "2026-T2"]);
  });
});
