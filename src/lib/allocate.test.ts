import { describe, expect, it } from "vitest";
import {
  allocationGap, axisMaxFor, hoursToTokens, rebalance, renormalize, suggestAllocation, tokensToHours,
} from "./allocate";
import type { Allocation } from "../types";

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("suggestAllocation", () => {
  it("splits a budget evenly when every desk is equally pressing", () => {
    const a = suggestAllocation([{ id: "s1", priority: 30 }, { id: "s2", priority: 30 }, { id: "s3", priority: 30 }], 90);
    expect(a).toEqual({ s1: 30, s2: 30, s3: 30 });
  });
  it("gives the more pressing desk more, and always spends the whole budget", () => {
    const a = suggestAllocation([{ id: "s1", priority: 60 }, { id: "s2", priority: 20 }], 100);
    expect(a.s1).toBeGreaterThan(a.s2);
    expect(sum(a)).toBe(100);
  });
  it("starves a desk with no pressure at all (concave water-filling)", () => {
    const a = suggestAllocation([{ id: "s1", priority: 0 }, { id: "s2", priority: 40 }, { id: "s3", priority: 40 }], 100);
    expect(a.s1).toBe(0);
    expect(a.s2).toBe(50);
    expect(a.s3).toBe(50);
  });
  it("falls back to an even split when nothing is pressing", () => {
    const a = suggestAllocation([{ id: "s1", priority: 0 }, { id: "s2", priority: 0 }], 100);
    expect(a).toEqual({ s1: 50, s2: 50 });
  });
  it("spends nothing when the budget is zero", () => {
    expect(suggestAllocation([{ id: "s1", priority: 50 }], 0)).toEqual({ s1: 0 });
  });
});

describe("rebalance", () => {
  it("pulls the other desks down pro-rata when one is dragged out", () => {
    expect(rebalance({ a: 50, b: 30, c: 20 }, "a", 60, { total: 100 }))
      .toEqual({ a: 60, b: 24, c: 16 });
  });

  it("hands the slack back pro-rata when one is dragged in", () => {
    expect(rebalance({ a: 60, b: 24, c: 16 }, "a", 40, { total: 100 }))
      .toEqual({ a: 40, b: 36, c: 24 });
  });

  it("holds a pinned desk still and makes the rest absorb the whole move", () => {
    expect(rebalance({ a: 50, b: 30, c: 20 }, "a", 60, { total: 100, pinned: ["b"] }))
      .toEqual({ a: 60, b: 30, c: 10 });
  });

  it("clamps the drag at the room the unpinned desks can actually give up", () => {
    expect(rebalance({ a: 50, b: 30, c: 20 }, "a", 100, { total: 100, pinned: ["b"] }))
      .toEqual({ a: 70, b: 30, c: 0 });
  });

  it("is a no-op when every other desk is pinned", () => {
    expect(rebalance({ a: 50, b: 50 }, "a", 70, { total: 100, pinned: ["b"] }))
      .toEqual({ a: 50, b: 50 });
  });

  it("clamps a drag below zero", () => {
    expect(rebalance({ a: 50, b: 30, c: 20 }, "a", -20, { total: 100 }))
      .toEqual({ a: 0, b: 60, c: 40 });
  });

  it("splits the slack evenly when every free desk sits at zero", () => {
    expect(rebalance({ a: 100, b: 0, c: 0 }, "a", 60, { total: 100 }))
      .toEqual({ a: 60, b: 20, c: 20 });
  });

  it("leaves a starved desk starved while the others still share pro-rata", () => {
    expect(rebalance({ a: 60, b: 40, c: 0 }, "a", 40, { total: 100 }))
      .toEqual({ a: 40, b: 60, c: 0 });
  });

  it("still spends the whole budget in whole tokens when the split does not divide", () => {
    const r = rebalance({ a: 33, b: 33, c: 34 }, "a", 50, { total: 100 });
    expect(Object.values(r).reduce((x, y) => x + y, 0)).toBe(100);
    expect(Object.values(r).every(Number.isInteger)).toBe(true);
    expect(r.a).toBe(50);
  });

  it("rounds a fractional drag to whole tokens", () => {
    expect(rebalance({ a: 50, b: 50 }, "a", 60.4, { total: 100 })).toEqual({ a: 60, b: 40 });
  });

  it("moves the dragged desk even when it is itself pinned", () => {
    expect(rebalance({ a: 50, b: 50 }, "a", 60, { total: 100, pinned: ["a"] }))
      .toEqual({ a: 60, b: 40 });
  });
});

describe("renormalize", () => {
  it("re-spends the whole budget when a desk is archived out of the plan", () => {
    expect(renormalize({ a: 50, b: 30, c: 20 }, ["a", "b"], 100)).toEqual({ a: 63, b: 37 });
  });

  it("is the identity on a plan that already fits its desks", () => {
    expect(renormalize({ a: 60, b: 40 }, ["a", "b"], 100)).toEqual({ a: 60, b: 40 });
  });

  it("falls back to an even split when there is no plan to preserve", () => {
    expect(renormalize({}, ["a", "b", "c", "d"], 100)).toEqual({ a: 25, b: 25, c: 25, d: 25 });
  });

  it("seats a newly listed desk at zero rather than reshaping the plan around it", () => {
    expect(renormalize({ a: 60, b: 40 }, ["a", "b", "c"], 100)).toEqual({ a: 60, b: 40, c: 0 });
  });
});

describe("axisMaxFor", () => {
  it("opens the whole budget up when there are only three desks", () => {
    expect(axisMaxFor(100, 3)).toBe(100);
  });

  it("tightens the ring as desks are added, on round gridline steps", () => {
    expect(axisMaxFor(100, 6)).toBe(50);
    expect(axisMaxFor(100, 8)).toBe(40);
  });

  it("never scales past the whole budget", () => {
    expect(axisMaxFor(100, 1)).toBe(100);
    expect(axisMaxFor(100, 2)).toBe(100);
  });

  it("always leaves room to drag a desk past twice its even share", () => {
    for (let n = 3; n <= 12; n++) expect(axisMaxFor(100, n)).toBeGreaterThanOrEqual((2 * 100) / n);
  });

  it("draws no ring at all for an empty budget", () => {
    expect(axisMaxFor(0, 5)).toBe(0);
    expect(axisMaxFor(100, 0)).toBe(0);
  });
});

describe("tokens ↔ hours", () => {
  it("reads a token share off as its slice of the weekly budget", () => {
    expect(tokensToHours(25, 100, 14)).toBeCloseTo(3.5);
  });

  it("converts a typed hour figure back to tokens", () => {
    expect(hoursToTokens(3.5, 100, 14)).toBeCloseTo(25);
  });

  it("round-trips a drag through hours without drift", () => {
    expect(hoursToTokens(tokensToHours(37, 100, 12.5), 100, 12.5)).toBeCloseTo(37);
  });

  it("reads nothing off a zero-hour week rather than dividing by it", () => {
    expect(tokensToHours(50, 100, 0)).toBe(0);
    expect(hoursToTokens(4, 100, 0)).toBe(0);
  });
});

describe("allocationGap", () => {
  it("is null until the actual split is filled in", () => {
    const a: Allocation = { id: "a1", roundKey: "2026-T2", total: 100, planned: { s1: 60, s2: 40 }, createdAt: "2026-05-01" };
    expect(allocationGap(a)).toBeNull();
  });
  it("reports the planned−actual gap per desk and its total size", () => {
    const a: Allocation = {
      id: "a1", roundKey: "2026-T2", total: 100,
      planned: { s1: 60, s2: 40 }, actual: { s1: 40, s2: 60 }, createdAt: "2026-05-01",
    };
    const g = allocationGap(a)!;
    expect(g.byId).toEqual({ s1: 20, s2: -20 });
    expect(g.totalAbs).toBe(40);
  });
});
