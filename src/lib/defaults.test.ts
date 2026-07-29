import { describe, expect, it } from "vitest";
import { DEFAULT_SUBJECT_DEFS, defaultSubjects, freshBook } from "./defaults";
import { DEFAULT_SETTINGS } from "../constants";

describe("default subjects", () => {
  it("lists the six desks in the canonical order", () => {
    expect(DEFAULT_SUBJECT_DEFS.map((d) => d.ticker)).toEqual(["MATH", "ENG", "PHYS", "ECON", "BUS", "GEO"]);
    expect(DEFAULT_SUBJECT_DEFS.map((d) => d.name)).toEqual([
      "Mathematics", "English", "Physics", "Economics", "Business", "Geography",
    ]);
  });
  it("assigns unique palette colors", () => {
    expect(new Set(DEFAULT_SUBJECT_DEFS.map((d) => d.color)).size).toBe(6);
  });
  it("defaultSubjects start clean: no target, coursework as signal only", () => {
    for (const s of defaultSubjects()) {
      expect(s.target).toBeNull();
      expect(s.courseworkPct).toBeNull();
      expect(s.archived).toBeUndefined();
    }
  });
  it("freshBook pre-lists the six with zero prints", () => {
    const book = freshBook();
    expect(book.subjects).toHaveLength(6);
    expect(book.entries).toHaveLength(0);
    expect(book.settings).toEqual(DEFAULT_SETTINGS);
    expect(book.sample).toBe(false);
  });
});
