import { describe, expect, it } from "vitest";
import { buildOhlc } from "./ohlc";
import type { GradeEntry } from "../types";

let n = 0;
const entry = (date: string, score: number): GradeEntry =>
  ({ id: "e" + n++, subjectId: "a", date, type: "Test", score, title: "" });

describe("buildOhlc", () => {
  it("computes open/high/low/close per term in date order", () => {
    const rows = buildOhlc(
      [entry("2026-05-20", 90), entry("2026-04-02", 70), entry("2026-06-25", 78), entry("2026-05-01", 62)],
      "term",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "2026-T2", open: 70, high: 90, low: 62, close: 78, count: 4, range: [62, 90] });
  });
  it("collapses a single-result period to a doji", () => {
    const rows = buildOhlc([entry("2026-02-10", 81)], "term");
    expect(rows[0]).toMatchObject({ open: 81, high: 81, low: 81, close: 81, count: 1 });
  });
  it("sorts periods chronologically", () => {
    const rows = buildOhlc([entry("2026-05-01", 70), entry("2025-11-01", 60), entry("2026-02-01", 65)], "term");
    expect(rows.map((r) => r.key)).toEqual(["2025-T4", "2026-T1", "2026-T2"]);
  });
});
