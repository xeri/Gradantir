import { describe, expect, it } from "vitest";
import { fmtCountdown, sessionInfo } from "./session";

// 2026-07-20 is a Monday, 2026-07-24 a Friday, 2026-07-25 a Saturday.
const mon = (h: number, m: number) => new Date(2026, 6, 20, h, m);

describe("sessionInfo phases", () => {
  it("walks every boundary minute of a trading day", () => {
    expect(sessionInfo(mon(7, 59)).phase).toBe("closed");
    expect(sessionInfo(mon(8, 0)).phase).toBe("pre");
    expect(sessionInfo(mon(8, 59)).phase).toBe("pre");
    expect(sessionInfo(mon(9, 0)).phase).toBe("open");
    expect(sessionInfo(mon(14, 59)).phase).toBe("open");
    expect(sessionInfo(mon(15, 0)).phase).toBe("post");
    expect(sessionInfo(mon(15, 59)).phase).toBe("post");
    expect(sessionInfo(mon(16, 0)).phase).toBe("closed");
  });
  it("labels each phase for the tape", () => {
    expect(sessionInfo(mon(8, 30)).label).toBe("PRE-MARKET");
    expect(sessionInfo(mon(11, 0)).label).toBe("MARKET OPEN");
    expect(sessionInfo(mon(15, 30)).label).toBe("AFTER HOURS");
    expect(sessionInfo(mon(20, 0)).label).toBe("MARKET CLOSED");
  });
  it("weekends are fully closed", () => {
    expect(sessionInfo(new Date(2026, 6, 25, 11, 0)).phase).toBe("closed");
    expect(sessionInfo(new Date(2026, 6, 26, 11, 0)).phase).toBe("closed");
  });
});

describe("sessionInfo countdown", () => {
  it("counts down to the next boundary within the day", () => {
    const pre = sessionInfo(mon(8, 0));
    expect(pre.nextLabel).toBe("OPENS 09:00");
    expect(pre.msToNext).toBe(60 * 60000);
    const open = sessionInfo(mon(14, 30));
    expect(open.nextLabel).toBe("CLOSES 15:00");
    expect(open.msToNext).toBe(30 * 60000);
    expect(sessionInfo(mon(15, 30)).nextLabel).toBe("ENDS 16:00");
  });
  it("early weekday morning points at today's pre-market", () => {
    const s = sessionInfo(mon(6, 0));
    expect(s.nextLabel).toBe("OPENS 08:00");
    expect(s.msToNext).toBe(2 * 60 * 60000);
  });
  it("Friday close counts across the weekend to Monday", () => {
    const s = sessionInfo(new Date(2026, 6, 24, 16, 1));
    expect(s.nextLabel).toBe("OPENS MON 08:00");
    expect(s.msToNext).toBe(((24 - 16) * 60 - 1 + 2 * 24 * 60 + 8 * 60) * 60000);
  });
  it("Saturday points at Monday", () => {
    expect(sessionInfo(new Date(2026, 6, 25, 11, 0)).nextLabel).toBe("OPENS MON 08:00");
  });
});

describe("fmtCountdown", () => {
  it("formats hours, minutes, and the final minute", () => {
    expect(fmtCountdown(2 * 3600000 + 14 * 60000)).toBe("2H 14M");
    expect(fmtCountdown(38 * 60000)).toBe("38M");
    expect(fmtCountdown(30000)).toBe("<1M");
  });
});
