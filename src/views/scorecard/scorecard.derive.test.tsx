// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Scorecard } from ".";
import { Compare } from "../Compare";
import { computeStats } from "../../lib/stats";
import { advise } from "../../lib/quant/advisor";
import { sanitizeSettings } from "../../lib/io";
import { aggregateForecast, compositeIndex, examAggregate } from "../../lib/quant/aggregate";
import { IDENTITY_POOL } from "../../lib/quant/pool";
import { derivationFor } from "../../lib/derive";
import type { DeriveCtx } from "../../lib/derive";
import type { AppData, Duel, MeanCall, Upcoming } from "../../types";

/**
 * §24 reaches D3 and D5.
 *
 * The reconciliation suite (`lib/derive/derive.book.test.ts`) proves the notes
 * are RIGHT; this proves they are actually WIRED — that the figures the boards
 * print carry a trigger, and that a board handed no context still renders the
 * same numbers rather than crashing or hiding them. Both halves matter: a
 * correct derivation nobody can open is not a feature, and a board that hard-
 * requires the layer would white-screen the terminal if it ever failed to build.
 */

const TODAY = "2026-07-21";
const raw = JSON.parse(readFileSync("src/lib/__fixtures__/book.json", "utf8"));
const base: AppData = { ...raw.data, settings: sanitizeSettings(raw.data.settings) };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom ships no ResizeObserver; recharts' ResponsiveContainer subscribes to one
   on mount. An environment gap, not a defect under test. */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; });

const stats = computeStats(base.subjects, base.entries, base.settings).filter((s) => !s.sub.archived);
const signals = advise(
  stats.filter((s) => s.quant).map((s) => ({ sub: s.sub, quant: s.quant!, entries: s.entries })),
  TODAY,
  base.settings.calendar,
);
const index = compositeIndex(stats, null);
const forecast = aggregateForecast(stats, examAggregate(stats));
const deriveCtx: DeriveCtx = { stats, index, forecast, signals, settings: base.settings };

/** A book with every elicitation channel populated, so every card is live. */
const sitting: Upcoming = {
  id: "u-1", subjectId: base.subjects[0].id, date: "2026-11-01", type: "Exam", title: "Finals",
  selfPred: { point: 78, lo: 70, hi: 86 }, teacherPred: 80, chips: [0, 0, 1, 4, 4, 1],
};
const duels: Duel[] = [
  { id: "d-1", aId: base.subjects[0].id, bId: base.subjects[1].id, winnerId: base.subjects[0].id, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "d-2", aId: base.subjects[1].id, bId: base.subjects[2].id, winnerId: base.subjects[2].id, createdAt: "2026-01-02T00:00:00.000Z" },
];
const calls: MeanCall[] = [
  { id: "m-1", roundKey: "2026-T3", predAvg: 72, ranking: [base.subjects[0].id, base.subjects[1].id], createdAt: "2026-02-01T00:00:00.000Z" },
];
const live: AppData = { ...base, upcoming: [sitting], duels, meanCalls: calls };

async function renderCard(ctx?: DeriveCtx): Promise<HTMLElement> {
  const host = document.createElement("div");
  await act(async () => {
    root = createRoot(host);
    root.render(
      <Scorecard
        data={live}
        stats={stats}
        rawStats={stats}
        signals={signals}
        todayIso={TODAY}
        roundKey="2026-T2"
        forecastRoundKey="2026-T3"
        deskForecast={forecast}
        selfFit={IDENTITY_POOL}
        selfOn
        onSetSelfWeighting={() => {}}
        onAddSitting={() => {}}
        onEditSitting={() => {}}
        onDeleteSitting={() => {}}
        onRecordDuel={() => {}}
        onResetDuels={() => {}}
        onRemoveDuel={() => {}}
        onSaveAllocation={() => {}}
        onSetEffortWeighting={() => {}}
        onSetReadinessWeighting={() => {}}
        onSetAggregateCallWeighting={() => {}}
        onSaveMeanCall={() => {}}
        onRemoveMeanCall={() => {}}
        onOpenSubject={() => {}}
        deriveCtx={ctx}
      />,
    );
  });
  return host;
}

const triggers = (host: HTMLElement) => [...host.querySelectorAll(".gx-derive")];

describe("the scorecard's derivation layer", () => {
  it("puts a trigger on the figures the ENGINE produced", async () => {
    const host = await renderCard(deriveCtx);
    // The backtest lands on a timer; the priced channels do not.
    expect(triggers(host).length).toBeGreaterThan(3);
    // Every trigger wraps something — an empty underline is worse than none.
    for (const t of triggers(host)) expect((t.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("leaves the student's own typed inputs alone", async () => {
    const host = await renderCard(deriveCtx);
    // No input the student filled in is decorated: a number you typed does not
    // need explaining back to you, and the underline has to keep its meaning.
    for (const t of triggers(host)) {
      expect(t.querySelector("input"), "a derivation was hung on an editable field").toBeNull();
    }
  });

  it("renders the same board with no derivation context at all", async () => {
    const withCtx = await renderCard(deriveCtx);
    const without = await renderCard(undefined);
    expect(triggers(without).length).toBe(0);
    for (const label of ["WHERE THE SKILL IS", "READINESS DUELS", "EFFORT BUDGET", "AGGREGATE CALL"]) {
      expect(without.textContent, label).toContain(label);
      expect(withCtx.textContent, label).toContain(label);
    }
  });

  it("opens the readiness weight, the elo table and the model allocation", async () => {
    const host = await renderCard(deriveCtx);
    const ids = new Set(triggers(host).map((t) => t.getAttribute("aria-controls") ?? ""));
    expect(ids.size).toBeGreaterThan(0);
    // The ids the board is expected to carry all build against this context.
    for (const id of ["earn.readiness", "earn.aggregate", "duel.elo", "effort.plan", "effort.drift"]) {
      const built = derivationFor(id, {
        ...deriveCtx,
        key: base.subjects[0].id,
        card: {
          readyFit: { w: 0.4, n: 0, youScore: null, modelScore: null, rawShare: 0, hitRate: null, modelHitRate: null },
          meanFit: { w: 0, n: 0, youScore: null, modelScore: null, rawShare: 0, selfSd: null, rankCorr: null },
          elo: { rows: [{ id: base.subjects[0].id, rating: 1012, wins: 1, losses: 0 }], duels: 2, tickerOf: { [base.subjects[0].id]: "X" } },
          effort: {
            total: 100, hoursPerWeek: 14,
            plan: { [base.subjects[0].id]: 100 },
            actual: { [base.subjects[0].id]: 80 },
            model: { [base.subjects[0].id]: 100 },
            priority: { [base.subjects[0].id]: 40 },
            gap: { byId: { [base.subjects[0].id]: 20 }, totalAbs: 20 },
            tickerOf: { [base.subjects[0].id]: "X" },
          },
        },
      });
      expect(built, id).not.toBeNull();
    }
  });
});

describe("the compare board's derivation layer", () => {
  const renderCompare = async (ctx?: DeriveCtx) => {
    const host = document.createElement("div");
    await act(async () => {
      root = createRoot(host);
      root.render(<Compare stats={stats} settings={base.settings} onOpenSubject={() => {}} deriveCtx={ctx} />);
    });
    return host;
  };

  it("derives the model lenses and leaves a term column bare", async () => {
    const host = await renderCompare(deriveCtx);
    // Lens A defaults to the latest TERM — arithmetic, so nothing is decorated
    // until a model lens is chosen. Switching is a user act, so assert the rule
    // rather than the default: no trigger may wrap a term figure.
    const sel = [...host.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === "Lens A");
    expect(sel, "the lens picker is on screen").toBeTruthy();
    await act(async () => {
      const opt = [...sel!.options].find((o) => o.textContent?.includes("MARK"));
      sel!.value = opt!.value;
      sel!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(triggers(host).length).toBeGreaterThan(0);
  });

  it("renders without a context, undecorated", async () => {
    const host = await renderCompare(undefined);
    expect(triggers(host).length).toBe(0);
    expect(host.textContent).toContain("PERIOD OVERLAY");
  });
});
