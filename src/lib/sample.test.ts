import { describe, expect, it } from "vitest";
import { makeSample } from "./sample";
import { pDate } from "./utils";

describe("makeSample", () => {
  const end = new Date(2026, 6, 18);
  const data = makeSample(end);

  it("lists five subjects with unique tickers", () => {
    expect(data.subjects).toHaveLength(5);
    expect(new Set(data.subjects.map((s) => s.ticker)).size).toBe(5);
    expect(data.sample).toBe(true);
  });
  it("produces only valid entries", () => {
    const ids = new Set(data.subjects.map((s) => s.id));
    for (const e of data.entries) {
      expect(ids.has(e.subjectId)).toBe(true);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.score).toBeGreaterThanOrEqual(0);
      expect(e.score).toBeLessThanOrEqual(100);
      expect(pDate(e.date).getTime()).toBeLessThanOrEqual(end.getTime());
    }
  });
  it("skips the December–January break", () => {
    for (const e of data.entries) {
      const m = pDate(e.date).getMonth();
      expect(m === 11 || m === 0).toBe(false);
    }
  });
  it("gives every subject a recent result and enough history to chart", () => {
    for (const s of data.subjects) {
      const es = data.entries.filter((e) => e.subjectId === s.id).sort((a, b) => (a.date < b.date ? -1 : 1));
      expect(es.length).toBeGreaterThanOrEqual(10);
      const last = pDate(es[es.length - 1].date).getTime();
      expect(end.getTime() - last).toBeLessThanOrEqual(16 * 864e5);
    }
  });
  it("carries class averages on a healthy share of entries", () => {
    const withClass = data.entries.filter((e) => e.classAvg != null);
    expect(withClass.length / data.entries.length).toBeGreaterThan(0.4);
    expect(withClass.length / data.entries.length).toBeLessThan(0.8);
  });
  it("is deterministic for a fixed end date", () => {
    const again = makeSample(end);
    expect(again.entries.map((e) => e.score)).toEqual(data.entries.map((e) => e.score));
    expect(again.entries.map((e) => e.date)).toEqual(data.entries.map((e) => e.date));
  });
});
