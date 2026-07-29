import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AggregateBand } from "./AggregateBand";
import { SubjectCard } from "./SubjectCard";
import { computeStats } from "../lib/stats";
import { listedAsOf } from "../lib/listing";
import { aggregateForecast, examAggregate, examAggregateHistory } from "../lib/quant/aggregate";
import { buildRounds, pendingRound } from "../lib/rounds";
import { freshSettings } from "../constants";
import type { AppData } from "../types";

/**
 * The board the bug was visible on. Delisting is a math rule, but the thing a
 * user sees is the denominator under the headline — so assert on the markup.
 */
const raw = JSON.parse(
  readFileSync(fileURLToPath(new URL("../lib/__fixtures__/book.json", import.meta.url)), "utf8"),
) as { data: Pick<AppData, "subjects" | "entries"> & { settings: Partial<AppData["settings"]> } };

const TODAY = "2026-07-22";
const { subjects, entries } = raw.data;
const settings = { ...freshSettings(), ...raw.data.settings };

const stats = computeStats(subjects, entries, settings, TODAY);
const booked = listedAsOf(stats, TODAY, settings.calendar);
const agg = examAggregate(booked);
const html = renderToStaticMarkup(
  <AggregateBand
    agg={agg}
    forecast={aggregateForecast(booked, agg)}
    history={examAggregateHistory(subjects, entries, TODAY, settings.calendar)}
    pending={pendingRound(buildRounds(entries, settings.calendar), TODAY, settings.calendar)}
    onOpenSubject={() => {}}
  />,
);

describe("AggregateBand on the real book", () => {
  it("prices today out of the six desks still trading", () => {
    expect(html).toContain("/ 600");
    expect(html).toContain("6 OF 6 DESKS REPORTED");
  });
  it("dates the headline to the April round, not to today", () => {
    expect(html).toContain("AS OF 8 APR 26");
  });
  it("names the round it is forecasting instead of an anonymous NEXT", () => {
    expect(html).toContain("MID 26");
    expect(html).toContain("T2 2026");
  });
  it("never quotes a closed desk in the live round", () => {
    for (const tk of ["LAT", "SPA", "GRA"]) expect(html).not.toContain(`Open ${tk}`);
  });
  it("emits no NaN or undefined", () => {
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });
});

describe("SubjectCard for a closed desk", () => {
  const closed = stats.find((s) => s.sub.ticker === "LAT")!;
  const card = renderToStaticMarkup(<SubjectCard stat={closed} onOpen={() => {}} />);

  it("stamps it delisted with the date it closed", () => {
    expect(card).toContain("DELISTED");
    expect(card).toContain("5 Dec 24");
  });
  it("forecasts no exam it will never sit and publishes no target", () => {
    expect(card).not.toContain("NXT EXAM");
    expect(card).toContain("CLOSED");
    expect(card).not.toContain("PT ");
  });
  it("still carries its real prints — the history is not thrown away", () => {
    expect(closed.entries).toHaveLength(5);
    expect(closed.quant).not.toBeNull();
  });
  it("keeps a live desk untouched", () => {
    const live = renderToStaticMarkup(
      <SubjectCard stat={stats.find((s) => s.sub.ticker === "MATH")!} onOpen={() => {}} />,
    );
    expect(live).toContain("NXT EXAM");
    expect(live).not.toContain("DELISTED");
  });
});
