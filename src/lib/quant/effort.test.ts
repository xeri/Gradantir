import { describe, expect, it } from "vitest";
import { effortFor, effortPressure } from "./effort";
import type { Allocation } from "../../types";

const alloc = (over: Partial<Allocation> = {}): Allocation => ({
  id: "a1",
  roundKey: "2026-T2",
  total: 100,
  hoursPerWeek: 14,
  planned: { s1: 25, s2: 25, s3: 25, s4: 25 },
  createdAt: "2026-05-01",
  ...over,
});

describe("effortPressure", () => {
  it("reads an even split as exactly a fair share on every desk", () => {
    const p = effortPressure(alloc());
    expect([...p.values()].map((e) => e.planRatio)).toEqual([1, 1, 1, 1]);
    expect([...p.values()].every((e) => e.actualRatio === null)).toBe(true);
  });

  it("scales the ratio by the desk count, so half an even share reads 0.5", () => {
    // 4 desks, 100 tokens: an even share is 25. s1 gets 12.5 ⇒ ρ = 0.5.
    const p = effortPressure(alloc({ planned: { s1: 12.5, s2: 29.17, s3: 29.17, s4: 29.16 } }));
    expect(p.get("s1")!.planRatio).toBeCloseTo(0.5, 6);
    expect(p.get("s2")!.planRatio).toBeCloseTo(1.1668, 4);
  });

  it("quotes hours off the week the plan was filed against", () => {
    const p = effortPressure(alloc());
    expect(p.get("s1")!.planHours).toBeCloseTo(3.5, 6);
    // A plan filed before the budget was expressed in hours quotes none.
    expect(effortPressure(alloc({ hoursPerWeek: undefined })).get("s1")!.planHours).toBeNull();
  });

  it("divides the ACTUAL ring by the PLANNED total — an under-run starves everyone", () => {
    // Meant to do 100 tokens of week, actually did 50, evenly split.
    const p = effortPressure(alloc({ actual: { s1: 12.5, s2: 12.5, s3: 12.5, s4: 12.5 } }));
    for (const e of p.values()) {
      expect(e.planRatio).toBe(1);
      expect(e.actualRatio).toBeCloseTo(0.5, 6);
    }
  });

  it("lets the actual ring over-run past a fair share", () => {
    const p = effortPressure(alloc({ actual: { s1: 50, s2: 25, s3: 25, s4: 25 } }));
    expect(p.get("s1")!.actualRatio).toBeCloseTo(2, 6);
    expect(p.get("s1")!.actualHours).toBeCloseTo(7, 6);
  });

  it("gives a desk missing from the plan no read at all — unbudgeted is not starved", () => {
    const p = effortPressure(alloc());
    expect(p.has("s-new")).toBe(false);
  });

  it("gives a desk missing from the actual record a null actual, not a zero", () => {
    const p = effortPressure(alloc({ actual: { s1: 25, s2: 25, s3: 25 } }));
    expect(p.get("s4")!.actualRatio).toBeNull();
    expect(p.get("s1")!.actualRatio).toBe(1);
  });

  it("declines to read a missing, empty or zero-budget allocation", () => {
    expect(effortPressure(null).size).toBe(0);
    expect(effortPressure(undefined).size).toBe(0);
    expect(effortPressure(alloc({ total: 0 })).size).toBe(0);
    expect(effortPressure(alloc({ planned: {} })).size).toBe(0);
  });

  it("never emits a negative ratio from a corrupt negative holding", () => {
    const p = effortPressure(alloc({ planned: { s1: -40, s2: 50, s3: 50, s4: 40 } }));
    expect(p.get("s1")!.planRatio).toBe(0);
  });
});

describe("effortFor", () => {
  const book = [alloc(), alloc({ id: "a2", roundKey: "2026-T1" })];

  it("picks the budget filed for the round being priced", () => {
    expect(effortFor(book, "2026-T1", true)!.id).toBe("a2");
    expect(effortFor(book, "2026-T3", true)).toBeNull();
  });

  it("is the identity when the switch is off, whatever is filed", () => {
    expect(effortFor(book, "2026-T2", false)).toBeNull();
  });

  it("survives a book that has never filed one", () => {
    expect(effortFor(undefined, "2026-T2", true)).toBeNull();
    expect(effortFor([], "2026-T2", true)).toBeNull();
  });
});
