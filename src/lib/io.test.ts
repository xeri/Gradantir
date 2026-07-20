import { describe, expect, it } from "vitest";
import { mergeData, parseImport, replaceData, sanitizeSettings, serializeExport } from "./io";
import { DEFAULT_SETTINGS } from "../constants";
import type { AppData } from "../types";

const book: AppData = {
  subjects: [
    { id: "s1", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: 85 },
    { id: "s2", name: "English", ticker: "ENG", color: "#FF7A3D", target: null },
  ],
  entries: [
    { id: "e1", subjectId: "s1", date: "2026-05-01", type: "Exam", score: 82, title: "Mid-year", classAvg: 75 },
    { id: "e2", subjectId: "s2", date: "2026-05-08", type: "Quiz", score: 91, title: "", classAvg: null },
  ],
  settings: { weights: { Exam: 3, Test: 2, Assignment: 1.5, Quiz: 1 }, weighted: true },
  sample: false,
};

describe("export/import roundtrip", () => {
  it("survives serialize → parse unchanged", () => {
    const res = parseImport(serializeExport(book));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.subjects).toEqual(book.subjects);
    expect(res.payload.entries).toEqual(book.entries);
    expect(res.payload.settings).toEqual(book.settings);
    expect(res.payload.dropped).toBe(0);
  });
});

describe("parseImport validation", () => {
  it("rejects non-JSON", () => {
    const res = parseImport("nope{");
    expect(res.ok).toBe(false);
  });
  it("rejects JSON without subjects/entries", () => {
    expect(parseImport('{"foo": 1}').ok).toBe(false);
  });
  it("drops malformed entries and counts them", () => {
    const res = parseImport(JSON.stringify({
      subjects: [{ id: "s1", name: "Maths", ticker: "MATH" }],
      entries: [
        { id: "ok", subjectId: "s1", date: "2026-05-01", type: "Test", score: 70 },
        { id: "bad-date", subjectId: "s1", date: "May 1st", type: "Test", score: 70 },
        { id: "bad-subject", subjectId: "ghost", date: "2026-05-01", type: "Test", score: 70 },
        { id: "bad-score", subjectId: "s1", date: "2026-05-01", type: "Test", score: "A+" },
      ],
    }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.entries).toHaveLength(1);
    expect(res.payload.dropped).toBe(3);
  });
  it("clamps out-of-range scores", () => {
    const res = parseImport(JSON.stringify({
      subjects: [{ id: "s1", name: "Maths", ticker: "MATH" }],
      entries: [{ id: "e", subjectId: "s1", date: "2026-05-01", type: "Test", score: 250 }],
    }));
    expect(res.ok && res.payload.entries[0].score).toBe(100);
  });
});

describe("replace/merge", () => {
  const incoming = {
    subjects: [{ id: "s1", name: "Maths NCEA", ticker: "MATH", color: "#4D7CFE", target: 90 }],
    entries: [
      { id: "e1", subjectId: "s1", date: "2026-05-01", type: "Exam" as const, score: 85, title: "", classAvg: null },
      { id: "e9", subjectId: "s1", date: "2026-06-01", type: "Test" as const, score: 88, title: "", classAvg: null },
    ],
    settings: null,
    dropped: 0,
  };
  it("replace swaps the whole book and clears the sample flag", () => {
    const out = replaceData(incoming);
    expect(out.subjects).toHaveLength(1);
    expect(out.sample).toBe(false);
    expect(out.settings).toEqual(DEFAULT_SETTINGS);
  });
  it("merge dedupes by id with incoming rows winning", () => {
    const out = mergeData(book, incoming);
    expect(out.subjects).toHaveLength(2);
    expect(out.subjects.find((s) => s.id === "s1")?.target).toBe(90);
    expect(out.entries).toHaveLength(3);
    expect(out.entries.find((e) => e.id === "e1")?.score).toBe(85);
    expect(out.settings).toEqual(book.settings); // no incoming settings → keep current
  });
});

describe("sanitizeSettings", () => {
  it("fills defaults from garbage", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ weights: { Exam: -5, Test: "x" }, weighted: "yes" })).toEqual(DEFAULT_SETTINGS);
  });
  it("keeps valid overrides", () => {
    const s = sanitizeSettings({ weights: { Exam: 5 }, weighted: false });
    expect(s.weights.Exam).toBe(5);
    expect(s.weights.Quiz).toBe(DEFAULT_SETTINGS.weights.Quiz);
    expect(s.weighted).toBe(false);
  });
});
