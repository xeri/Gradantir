// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Scorecard } from ".";
import { computeStats } from "../../lib/stats";
import { advise } from "../../lib/quant/advisor";
import { sanitizeSettings } from "../../lib/io";
import { IDENTITY_POOL } from "../../lib/quant/pool";
import { renormalize, type AllocationDraft } from "../../lib/allocate";
import type { Allocation, AppData } from "../../types";

/**
 * The EFFORT BUDGET card's controls (§15b): the model-recommended reset, the
 * escape hatch out of the actual ring, and the switch that takes the whole
 * section out of the pricing.
 */

const TODAY = "2026-07-21";
const ROUND = "2026-T2";
const ROUND_FC = "2026-T3";
const raw = JSON.parse(readFileSync("src/lib/__fixtures__/book.json", "utf8"));
const base: AppData = { ...raw.data, settings: sanitizeSettings(raw.data.settings) };

const evenPlan = (): Record<string, number> => {
  const live = base.subjects.filter((s) => !s.archived);
  return Object.fromEntries(live.map((s) => [s.id, Math.round(100 / live.length)]));
};
const filed = (over: Partial<Allocation> = {}): Allocation => ({
  id: "a-test", roundKey: ROUND, total: 100, hoursPerWeek: 14,
  planned: evenPlan(), createdAt: "2026-05-01", ...over,
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; });

interface Spy {
  saved: AllocationDraft | null;
  effortSwitched: boolean | null;
}

async function render(data: AppData): Promise<{ host: HTMLElement; spy: Spy; deskIds: string[] }> {
  const spy: Spy = { saved: null, effortSwitched: null };
  const stats = computeStats(data.subjects, data.entries, data.settings, TODAY, undefined, { allocations: data.allocations });
  const signals = advise(
    stats.filter((s) => s.quant).map((s) => ({ sub: s.sub, quant: s.quant!, entries: s.entries })),
    TODAY,
    data.settings.calendar,
  );
  const host = document.createElement("div");
  await act(async () => {
    root = createRoot(host);
    root.render(
      <Scorecard
        data={data}
        stats={stats}
        rawStats={stats}
        signals={signals}
        todayIso={TODAY}
        roundKey={ROUND}
        selfFit={IDENTITY_POOL}
        selfOn
        onSetSelfWeighting={() => {}}
        onAddSitting={() => {}}
        onEditSitting={() => {}}
        onDeleteSitting={() => {}}
        onRecordDuel={() => {}}
        onResetDuels={() => {}}
        onSaveAllocation={(_rk, draft) => { spy.saved = draft; }}
        onSetEffortWeighting={(on) => { spy.effortSwitched = on; }}
        onSaveMeanCall={() => {}}
        onRemoveMeanCall={() => {}}
        onRemoveDuel={() => {}}
        onSetReadinessWeighting={() => {}}
        onSetAggregateCallWeighting={() => {}}
        forecastRoundKey={ROUND_FC}
        deskForecast={null}
        onOpenSubject={() => {}}
      />,
    );
  });
  // The spider's axes are the ADVISED desks, not the live subject list, so the
  // card renormalizes any filed plan across them before it draws anything —
  // in TICKER order, which is also the order largest-remainder rounding hands
  // the leftover token out in.
  const tickerOf = new Map(stats.map((s) => [s.sub.id, s.sub.ticker]));
  const deskIds = signals
    .map((s) => s.id)
    .sort((a, b) => (tickerOf.get(a)! < tickerOf.get(b)! ? -1 : tickerOf.get(a)! > tickerOf.get(b)! ? 1 : 0));
  return { host, spy, deskIds };
}

/** The effort card's own section, so no other panel's copy can answer for it. */
const card = (host: HTMLElement): HTMLElement => {
  const el = [...host.querySelectorAll("section")].find((s) =>
    s.textContent?.includes("EFFORT BUDGET"),
  );
  expect(el, "expected the EFFORT BUDGET card on screen").toBeTruthy();
  return el as HTMLElement;
};

const button = (root: HTMLElement, re: RegExp): HTMLButtonElement | undefined =>
  [...root.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""));

const press = async (el: Element | undefined) => {
  expect(el, "expected the control to be on screen").toBeTruthy();
  await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

describe("the effort card's controls", () => {
  it("names the reset for what it restores — the model's recommendation", async () => {
    const { host } = await render({ ...base, allocations: [filed()] });
    expect(button(card(host), /reset to model recommended/i)).toBeTruthy();
  });

  it("offers to ADOPT the recommendation before anything has been filed", async () => {
    const { host } = await render(base);
    const c = card(host);
    expect(button(c, /adopt model recommended/i)).toBeTruthy();
    expect(button(c, /reset to model recommended/i)).toBeUndefined();
  });

  it("hides the clear-actual button until an actual ring exists", async () => {
    const { host } = await render({ ...base, allocations: [filed()] });
    expect(button(card(host), /clear actual hours/i)).toBeUndefined();
  });

  it("files an allocation with no actual ring at all when actual is cleared", async () => {
    const plan = filed();
    const { host, spy, deskIds } = await render({ ...base, allocations: [{ ...plan, actual: plan.planned }] });
    await press(button(card(host), /clear actual hours/i));
    expect(spy.saved).not.toBeNull();
    expect(spy.saved!.actual).toBeNull();
    // The plan and the weekly budget are deliberately untouched by the wipe —
    // it files exactly the plan the card was already showing.
    expect(spy.saved!.hoursPerWeek).toBe(14);
    expect(spy.saved!.planned).toEqual(renormalize(plan.planned, deskIds, 100));
    expect(Object.values(spy.saved!.planned).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("warns that actual hours are priced hard, and that planned hours are priced too", async () => {
    const plan = filed();
    const { host } = await render({ ...base, allocations: [{ ...plan, actual: plan.planned }] });
    const text = card(host).textContent ?? "";
    expect(text).toContain("ACTUAL HOURS SKEW THE MARK HEAVILY");
    expect(text).toContain("PLANNED HOURS SKEW IT TOO");
    expect(text).toMatch(/CLEAR ACTUAL/);
  });

  it("switches effort out of the pricing, and says the board no longer moves with it", async () => {
    const { host, spy } = await render({ ...base, allocations: [filed()] });
    const sw = card(host).querySelector('[role="switch"]');
    expect(sw?.getAttribute("aria-checked")).toBe("true");
    await press(sw ?? undefined);
    expect(spy.effortSwitched).toBe(false);

    const off = await render({
      ...base,
      settings: { ...base.settings, effortWeighting: false },
      allocations: [filed()],
    });
    const c = card(off.host);
    expect(c.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    expect(c.textContent).toContain("EFFORT IS OUT OF THE PRICING");
  });
});
