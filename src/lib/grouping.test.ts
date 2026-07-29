import { describe, expect, it } from "vitest";
import { addForecast, addMovingAvg, buildAssessmentRows, buildGroupedRows } from "./grouping";
import type { GradeEntry } from "../types";

let n = 0;
const entry = (subjectId: string, date: string, score: number, type: GradeEntry["type"] = "Test"): GradeEntry =>
  ({ id: "e" + n++, subjectId, date, type, score, title: "" });

describe("buildGroupedRows", () => {
  it("averages per subject per period, sorted by key", () => {
    const rows = buildGroupedRows(
      [entry("a", "2026-06-01", 70), entry("a", "2026-07-01", 80), entry("a", "2026-03-01", 60), entry("b", "2026-06-10", 90)],
      "term", "all",
    );
    expect(rows.map((r) => r.key)).toEqual(["2026-T1", "2026-T2"]);
    expect(rows[0].a).toBe(60);
    expect(rows[1].a).toBe(75);
    expect(rows[1].b).toBe(90);
  });
  it("files a hand-pinned result against the term its owner chose", () => {
    const rows = buildGroupedRows(
      [{ ...entry("a", "2026-06-01", 70), term: "2026-T1" }, entry("a", "2026-06-02", 90)],
      "term", "all",
    );
    expect(rows.map((r) => r.key)).toEqual(["2026-T1", "2026-T2"]);
    expect(rows[0].a).toBe(70);
    expect(rows[1].a).toBe(90);
  });
  it("filters by assessment type", () => {
    const rows = buildGroupedRows([entry("a", "2026-05-01", 70, "Exam"), entry("a", "2026-05-02", 90, "Quiz")], "term", "Exam");
    expect(rows[0].a).toBe(70);
  });
  it("applies weights", () => {
    const rows = buildGroupedRows(
      [entry("a", "2026-05-01", 100, "Exam"), entry("a", "2026-05-02", 60, "Quiz")],
      "term", "all",
      (e) => (e.type === "Exam" ? 3 : 1),
    );
    expect(rows[0].a).toBe(90); // (300 + 60) / 4
  });
});

describe("buildAssessmentRows", () => {
  it("averages same-day results per subject", () => {
    const rows = buildAssessmentRows([entry("a", "2026-05-01", 70), entry("a", "2026-05-01", 90), entry("a", "2026-05-08", 80)], "all");
    expect(rows).toHaveLength(2);
    expect(rows[0].a).toBe(80);
    expect(rows[1].a).toBe(80);
    expect(rows[0].t).toBeLessThan(rows[1].t as number);
  });
});

describe("addMovingAvg", () => {
  it("adds a 3-window rolling series", () => {
    const rows = buildGroupedRows(
      [entry("a", "2026-01-05", 60), entry("a", "2026-02-05", 70), entry("a", "2026-03-05", 80), entry("a", "2026-04-05", 90)],
      "month", "all",
    );
    addMovingAvg(rows, ["a"]);
    expect(rows[0].a_ma).toBe(60);
    expect(rows[1].a_ma).toBe(65);
    expect(rows[2].a_ma).toBe(70);
    expect(rows[3].a_ma).toBe(80);
  });
});

describe("addForecast", () => {
  it("appends an estimate row for grouped modes with >= 3 points", () => {
    const rows = buildGroupedRows(
      [entry("a", "2026-01-05", 70), entry("a", "2026-02-05", 72), entry("a", "2026-03-05", 74)],
      "month", "all",
    );
    const out = addForecast(rows, ["a"], "month");
    expect(out).toHaveLength(4);
    expect(out[3].label).toBe("Next (est.)");
    expect(out[3].a_fc).toBeCloseTo(76);
    expect(out[2].a_fc).toBe(74); // dashed series anchors on the last real point
  });
  it("does nothing with fewer than 3 points", () => {
    const rows = buildGroupedRows([entry("a", "2026-01-05", 70), entry("a", "2026-02-05", 72)], "month", "all");
    expect(addForecast(rows, ["a"], "month")).toHaveLength(2);
  });
  it("projects along the time axis in assessment mode", () => {
    const rows = buildAssessmentRows(
      [entry("a", "2026-01-01", 70), entry("a", "2026-01-15", 72), entry("a", "2026-01-29", 74)],
      "all",
    );
    const out = addForecast(rows, ["a"], "assessment");
    expect(out).toHaveLength(4);
    const next = out[3];
    expect(next.t).toBe((out[2].t as number) + 14 * 864e5);
    expect(next.a_fc).toBeCloseTo(76);
  });
});
