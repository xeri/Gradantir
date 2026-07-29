import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AggregateBand } from "./AggregateBand";
import { StatusBar } from "./StatusBar";
import { GradeModal } from "./modals/GradeModal";
import { SettingsModal } from "./modals/SettingsModal";
import { computeStats } from "../lib/stats";
import { listedAsOf } from "../lib/listing";
import { buildRounds, pendingRound } from "../lib/rounds";
import { aggregateForecast, examAggregate, examAggregateHistory } from "../lib/quant/aggregate";
import { freshSettings } from "../constants";
import { pDate } from "../lib/utils";
import type { AppData, GradeEntry } from "../types";

/**
 * THE BUG, ON THE BOARD IT WAS REPORTED ON.
 *
 * On 22 July 2026 — Term 3, week 1, with the mid-year papers not yet handed
 * back — the terminal claimed the Term 1 round was Term 2, drew a Term 3 point
 * it had no results for by carrying April's exams forward under a later name,
 * and forecast an anonymous "next" round that read as Term 4. Every assertion
 * here is one of those symptoms, stated as the truth instead.
 */
const raw = JSON.parse(
  readFileSync(fileURLToPath(new URL("../lib/__fixtures__/book.json", import.meta.url)), "utf8"),
) as { data: Pick<AppData, "subjects" | "entries"> & { settings: Partial<AppData["settings"]> } };

const TODAY = "2026-07-22";
const { subjects, entries } = raw.data;
const settings = { ...freshSettings(), ...raw.data.settings };
const CAL = settings.calendar;

const stats = computeStats(subjects, entries, settings, TODAY);
const booked = listedAsOf(stats, TODAY, CAL);
const agg = examAggregate(booked);
const history = examAggregateHistory(subjects, entries, TODAY, CAL);
const pending = pendingRound(buildRounds(entries, CAL), TODAY, CAL);

const band = renderToStaticMarkup(
  <AggregateBand
    agg={agg}
    forecast={aggregateForecast(booked, agg)}
    history={history}
    pending={pending}
    onOpenSubject={() => {}}
  />,
);

describe("the April round is a Term 1 round", () => {
  it("files it as T1 and labels it T1 26 — never T2", () => {
    const last = history[history.length - 1];
    expect(last.key).toBe("2026-T1");
    expect(last.label).toBe("T1 26");
    expect(history.some((p) => p.key === "2026-T2")).toBe(false);
  });
  it("dates the headline to that round rather than to today", () => {
    // The plotted axis lives inside recharts, which needs a real viewport; the
    // panel chrome around it does not, and it is where the date claim is made.
    expect(band).toContain("AS OF 8 APR 26");
    expect(band).toContain("6 OF 6 DESKS REPORTED");
  });
});

describe("the terminal draws no round it has no results for", () => {
  it("plots seven rounds and stops at the last one that printed", () => {
    expect(history).toHaveLength(7);
    expect(history.map((p) => p.label)).toEqual(["T1 24", "MID 24", "EOY 24", "T1 25", "MID 25", "EOY 25", "T1 26"]);
  });
  it("never repeats a sum under a later name", () => {
    // The old tape emitted T2 = T3 = 373: the same six April exams, twice more.
    const sums = history.map((p) => `${p.key}:${p.sum}`);
    expect(new Set(sums).size).toBe(sums.length);
    expect(history.filter((p) => p.sum === 373)).toHaveLength(1);
  });
});

describe("the prediction names the round it is predicting", () => {
  it("targets the mid-year paper, which this book has not sat yet", () => {
    expect(pending).toMatchObject({ key: "2026-T2", label: "MID 26", termLabel: "T2 2026" });
  });
  it("prints that name where the board used to say NEXT", () => {
    expect(band).toContain("PREDICTION · MID 26 ROUND · T2 2026");
    expect(band).not.toContain(">NEXT<");
  });
});

describe("the two clocks are told apart", () => {
  it("the status strip reports where the school physically is", () => {
    // Term 3 opened Monday 20 July 2026; this is its first week.
    const html = renderToStaticMarkup(
      <StatusBar subjects={6} entries={71} weighted calendar={CAL} saveErr={false} now={pDate(TODAY)} />,
    );
    expect(html).toContain("T3 2026");
    expect(html).toContain("WK");
  });
  it("while the desks average against the term now taking results", () => {
    const math = stats.find((s) => s.sub.ticker === "MATH")!;
    expect(math.curLabel).toBe("T2 2026"); // open, and empty — the papers are not back
    expect(math.curAvg).toBeNull();
    expect(math.prevLabel).toBe("T1 2026");
    expect(math.prevAvg).toBe(65); // the April paper
  });
});

describe("logging a result files it for you, and lets you overrule", () => {
  const modal = (entry?: GradeEntry) =>
    renderToStaticMarkup(
      <GradeModal subjects={subjects} entry={entry} calendar={CAL} onSave={() => {}} onClose={() => {}} />,
    );

  it("auto-files an April paper against Term 1", () => {
    const april = entries.find((e) => e.date === "2026-04-08")!;
    const html = modal(april);
    expect(html).toContain("AUTO · T1 2026");
    expect(html).toContain("FILED BY THE CALENDAR");
    expect(html).toContain("T1 2026 RAN 20 JAN 26 – 2 APR 26");
  });
  it("shows a hand-filed paper as overruled, and what the date alone would have said", () => {
    const pinned: GradeEntry = { ...entries[0], date: "2026-07-30", term: "2026-T3", title: "Late paper" };
    const html = modal(pinned);
    expect(html).toContain("FILED BY HAND");
    expect(html).toContain("THE DATE ALONE WOULD SAY T2 2026");
  });
});

describe("the term dates are the user's to change", () => {
  const html = renderToStaticMarkup(
    <SettingsModal
      data={{ subjects, entries, settings, sample: false }}
      depth={null}
      onSaveSettings={() => {}}
      onReplace={() => {}}
      onMerge={() => {}}
      onClearAll={() => {}}
      onRestoreSubject={() => {}}
      onDeleteSubject={() => {}}
      onRemoveItem={() => {}}
      onClearSection={() => {}}
      onClose={() => {}}
      today={TODAY}
    />,
  );

  it("shows this year's published dates, editable, four terms deep", () => {
    expect(html).toContain("SCHOOL CALENDAR");
    for (const t of [1, 2, 3, 4]) expect(html).toContain(`Term ${t} 2026 opens`);
    expect(html).toContain('value="2026-01-20"'); // T1 opens
    expect(html).toContain('value="2026-09-25"'); // T3 closes
  });
  it("states both clocks and the settlement rule in plain words", () => {
    expect(html).toContain("T3 2026 WK 1");
    expect(html).toContain("T2 2026");
    expect(html).toContain("RESULTS SETTLE WITHIN");
  });
});

describe("holidays cannot age the book", () => {
  it("counts silence in school days, not calendar days", () => {
    // 8 April → 22 July is 105 calendar days, but school was shut for a
    // fortnight of it and nobody could have printed.
    expect(booked.length).toBeGreaterThan(0); // else the loop asserts nothing
    for (const s of booked) expect(s.staleDays).toBe(58);
  });
});
