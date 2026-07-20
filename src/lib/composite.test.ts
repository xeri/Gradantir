import { describe, expect, it } from "vitest";
import { addComposite, COMP_KEY, rowComposite } from "./composite";
import type { ChartRow } from "./grouping";

describe("rowComposite", () => {
  it("averages only the subjects present on the row", () => {
    const row: ChartRow = { label: "T1", a: 80, b: 60 };
    expect(rowComposite(row, ["a", "b", "c"])).toBe(70);
  });
  it("returns null when no subject has data", () => {
    expect(rowComposite({ label: "T1" }, ["a", "b"])).toBeNull();
  });
});

describe("addComposite", () => {
  it("adds the __comp series in place, skipping empty rows", () => {
    const rows: ChartRow[] = [
      { label: "T1", a: 80, b: 70 },
      { label: "Next (est.)", a_fc: 82 }, // forecast-only row has no plain values
    ];
    addComposite(rows, ["a", "b"]);
    expect(rows[0][COMP_KEY]).toBe(75);
    expect(rows[1][COMP_KEY]).toBeUndefined();
  });
});
