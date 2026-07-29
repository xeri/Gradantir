import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeStats } from "../stats";
import { sanitizeSettings } from "../io";
import { currentTermKey } from "../periods";
import type { Allocation, AppData } from "../../types";

/**
 * Effort weighting against the committed fixture (§15b).
 *
 * The point of these is the IDENTITY as much as the effect: the fixture files no
 * allocation, so every mark on it must be bit-for-bit what it was before the
 * feature existed — which is what leaves §21 and the walk-forward gate alone.
 */

const TODAY = "2026-07-21";
const raw = JSON.parse(readFileSync("src/lib/__fixtures__/book.json", "utf8"));
const base: AppData = { ...raw.data, settings: sanitizeSettings(raw.data.settings) };
const ROUND = currentTermKey(base.settings.calendar, TODAY).key;

const marksOf = (data: AppData) =>
  new Map(
    computeStats(data.subjects, data.entries, data.settings, TODAY, undefined, { allocations: data.allocations })
      .filter((s) => s.quant)
      .map((s) => [s.sub.ticker, s.quant!.price]),
  );

/** A budget over the live desks, with one desk optionally starved. */
const budget = (starve: string | null, over: Partial<Allocation> = {}): Allocation => {
  const live = base.subjects.filter((s) => !s.archived);
  const planned: Record<string, number> = {};
  const even = 100 / live.length;
  for (const s of live) planned[s.id] = even;
  if (starve) {
    const victim = live.find((s) => s.ticker === starve)!;
    const spare = planned[victim.id];
    planned[victim.id] = 0;
    for (const s of live) if (s.id !== victim.id) planned[s.id] += spare / (live.length - 1);
  }
  return { id: "a-test", roundKey: ROUND, total: 100, hoursPerWeek: 14, planned, createdAt: "2026-05-01", ...over };
};

describe("effort weighting on the fixture book", () => {
  const bare = marksOf(base);

  it("is an exact identity on a book that has never filed a budget", () => {
    const noArg = new Map(
      computeStats(base.subjects, base.entries, base.settings, TODAY)
        .filter((s) => s.quant)
        .map((s) => [s.sub.ticker, s.quant!.price]),
    );
    expect(bare).toEqual(noArg);
    expect(bare.size).toBeGreaterThan(3);
  });

  it("is an exact identity on an EVEN plan — a fair share owes nothing", () => {
    expect(marksOf({ ...base, allocations: [budget(null)] })).toEqual(bare);
  });

  it("marks down the desk the plan starves, and only that desk", () => {
    const victim = base.subjects.filter((s) => !s.archived)[0].ticker;
    const after = marksOf({ ...base, allocations: [budget(victim)] });
    expect(after.get(victim)!).toBeLessThan(bare.get(victim)!);
    for (const [ticker, price] of after) {
      // The others are FAVOURED, so they may earn a damped credit — but the
      // market never pays above fair value, so nobody can be marked up past
      // where they already stood on a book with no budget at all.
      if (ticker !== victim) expect(price).toBeGreaterThanOrEqual(bare.get(ticker)!);
    }
  });

  it("charges the same starvation far harder once it is recorded as ACTUAL", () => {
    const victim = base.subjects.filter((s) => !s.archived)[0].ticker;
    const plan = budget(victim);
    const measured = marksOf({ ...base, allocations: [{ ...plan, actual: plan.planned }] });
    const planned = marksOf({ ...base, allocations: [plan] });
    expect(measured.get(victim)!).toBeLessThan(planned.get(victim)!);
    // Clearing the actual ring gives back more than the plan line ever took.
    expect(planned.get(victim)! - measured.get(victim)!)
      .toBeGreaterThan(bare.get(victim)! - planned.get(victim)!);
  });

  it("returns every mark to its unweighted value when the switch is off", () => {
    const victim = base.subjects.filter((s) => !s.archived)[0].ticker;
    const plan = budget(victim);
    const off = marksOf({
      ...base,
      settings: { ...base.settings, effortWeighting: false },
      allocations: [{ ...plan, actual: plan.planned }],
    });
    expect(off).toEqual(bare);
  });

  it("ignores a budget filed for a round that is not being priced", () => {
    const victim = base.subjects.filter((s) => !s.archived)[0].ticker;
    const stale = { ...budget(victim), roundKey: "2019-T1" };
    expect(marksOf({ ...base, allocations: [stale] })).toEqual(bare);
  });
});
