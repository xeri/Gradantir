import { describe, expect, it } from "vitest";
import { periodInfo } from "./periods";

describe("periodInfo", () => {
  it("buckets months", () => {
    expect(periodInfo("2026-03-14", "month")).toEqual({ key: "2026-03", label: "Mar 26" });
  });
  it("buckets terms as calendar quarters", () => {
    expect(periodInfo("2026-01-01", "term").key).toBe("2026-T1");
    expect(periodInfo("2026-03-31", "term").key).toBe("2026-T1");
    expect(periodInfo("2026-04-01", "term").key).toBe("2026-T2");
    expect(periodInfo("2026-12-31", "term")).toEqual({ key: "2026-T4", label: "T4 2026" });
  });
  it("buckets semesters and years", () => {
    expect(periodInfo("2026-06-30", "semester").key).toBe("2026-S1");
    expect(periodInfo("2026-07-01", "semester").key).toBe("2026-S2");
    expect(periodInfo("2026-07-01", "year")).toEqual({ key: "2026", label: "2026" });
  });
  it("falls through to the raw date", () => {
    expect(periodInfo("2026-07-01", "assessment").key).toBe("2026-07-01");
  });
});
