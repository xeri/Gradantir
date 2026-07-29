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
import type { AppData, Upcoming } from "../../types";

/**
 * A render smoke test for the D5 scorecard: it drives the eval backtest, the
 * elicitation board and every behavioural panel on the real fixture book, so a
 * crash in any of that surfaces here rather than white-screening the terminal.
 */

const TODAY = "2026-07-21";
const ROUND_FC = "2026-T3";
const raw = JSON.parse(readFileSync("src/lib/__fixtures__/book.json", "utf8"));
// The stored fixture predates the depth settings the engine now expects; the app
// fills them via sanitizeSettings on load, so mirror that here.
const base: AppData = { ...raw.data, settings: sanitizeSettings(raw.data.settings) };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; });

async function render(data: AppData, onRecordDuel: (a: string, b: string, w: string) => void = () => {}): Promise<HTMLElement> {
  const stats = computeStats(data.subjects, data.entries, data.settings);
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
        roundKey="2026-T2"
        selfFit={IDENTITY_POOL}
        selfOn
        onSetSelfWeighting={() => {}}
        onAddSitting={() => {}}
        onEditSitting={() => {}}
        onDeleteSitting={() => {}}
        onRecordDuel={onRecordDuel}
        onResetDuels={() => {}}
        onSaveAllocation={() => {}}
        onSetEffortWeighting={() => {}}
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
  return host;
}

describe("Scoreboard renders on the real book", () => {
  it("surfaces the skill, calibration and ablation panels without throwing", async () => {
    const host = await render(base);
    expect(host.textContent).toContain("WHERE THE SKILL IS");
    expect(host.textContent).toContain("YOU VS THE DESK");
    expect(host.textContent).toContain("EARNS ITS PLACE");
    expect(host.textContent).toContain("FORWARD CALENDAR");
  });

  it("lists a scheduled sitting with its own call", async () => {
    const sitting: Upcoming = {
      id: "u-test", subjectId: base.subjects[0].id, date: "2026-11-01", type: "Exam", title: "Finals",
      selfPred: { point: 78 }, teacherPred: 80, syllabusCoverage: 70, chips: [0, 0, 1, 4, 4, 1],
    };
    const host = await render({ ...base, upcoming: [sitting] });
    expect(host.textContent).toContain(base.subjects[0].ticker);
    expect(host.textContent).toContain("YOU 78");
  });

  it("records a duel through the arena, start to confirm", async () => {
    let recorded: [string, string, string] | null = null;
    const host = await render(base, (a, b, w) => { recorded = [a, b, w]; });

    // Everything the arena offers lives inside the READINESS panel.
    const inPanel = (re: RegExp) =>
      [...host.querySelectorAll("button")].find(
        (b) => b.closest("section")?.textContent?.includes("READINESS DUELS") && re.test(b.textContent ?? ""),
      );
    const press = async (el: Element | undefined) => {
      expect(el, "expected the control to be on screen").toBeTruthy();
      await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    };

    await press(inPanel(/start duels/i));
    await press(inPanel(/begin round/i));
    const block = [...host.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("More ready for"),
    );
    await press(block);
    expect(recorded).toBeNull(); // a pick alone writes nothing
    await press(inPanel(/confirm/i));
    expect(recorded).not.toBeNull();
  });
});
