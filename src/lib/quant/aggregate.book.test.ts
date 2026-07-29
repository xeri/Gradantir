import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aggregateHistory, examAggregate, examAggregateHistory } from "./aggregate";
import { listedAsOf } from "../listing";
import { successorsOf } from "../lineage";
import { buildRounds, pendingRound } from "../rounds";
import { computeStats } from "../stats";
import { freshSettings } from "../../constants";
import type { AppData } from "../../types";

/**
 * The delisting harness, on the committed fixture book (anonymised from the
 * real export — same structure, synthetic marks). Three desks closed —
 * LAT/SPA after the December 2024 round, GRA after December 2025 — and the
 * tape has to remember they were there. A 2024 round is out of 600, not 400.
 *
 * It is also the timing harness. This school sits three rounds a year: a Term
 * 1 paper handed back in the April holidays, a mid-year paper marked over the
 * July break and published a fortnight into Term 3, and an end-of-year paper
 * on the last day of Term 4. Every one of them files against the term it
 * EXAMINED, and Term 3 — which this school has never examined in — never
 * appears on the tape at all.
 */
const raw = JSON.parse(
  readFileSync(fileURLToPath(new URL("../__fixtures__/book.json", import.meta.url)), "utf8"),
) as { data: Pick<AppData, "subjects" | "entries"> & { settings: Partial<AppData["settings"]> } };

const TODAY = "2026-07-22"; // Term 3 week 1 — the mid-year round is not in yet
const { subjects, entries } = raw.data;
const settings = { ...freshSettings(), ...raw.data.settings };
const CAL = settings.calendar;
const rows = subjects.map((sub) => ({ sub, entries: entries.filter((e) => e.subjectId === sub.id) }));

describe("the book's own rounds", () => {
  const rounds = buildRounds(entries, CAL);

  it("files every round against the term that set it, named as the book named it", () => {
    expect(rounds.map((r) => `${r.key} ${r.label}`)).toEqual([
      "2024-T1 T1 24", "2024-T2 MID 24", "2024-T4 EOY 24",
      "2025-T1 T1 25", "2025-T2 MID 25", "2025-T4 EOY 25",
      "2026-T1 T1 26",
    ]);
  });
  it("puts the same round in the same term every year, however the dates drift", () => {
    // April rounds: in the holidays in 2024 and 2026, two days into Term 2 in
    // 2025. All three are Term 1 papers and all three file as T1.
    expect(rounds.filter((r) => r.name === "T1").map((r) => r.key)).toEqual(["2024-T1", "2025-T1", "2026-T1"]);
    // Mid-year rounds: published a fortnight into Term 3, both file as T2.
    expect(rounds.filter((r) => r.name === "MID").map((r) => r.key)).toEqual(["2024-T2", "2025-T2"]);
  });
  it("forecasts the mid-year round this book has not sat yet", () => {
    const p = pendingRound(rounds, TODAY, CAL)!;
    expect(p.key).toBe("2026-T2");
    expect(p.label).toBe("MID 26");
  });
});

describe("examAggregateHistory across a delisting", () => {
  const hist = examAggregateHistory(subjects, entries, TODAY, CAL);
  const at = (key: string) => hist.find((p) => p.key === key)!;

  it("counts the six desks that were actually sitting exams in 2024", () => {
    for (const key of ["2024-T1", "2024-T2", "2024-T4"]) expect(at(key).outOf).toBe(600);
    expect(at("2024-T1").sum).toBe(435);
    expect(at("2024-T2").sum).toBe(468);
    expect(at("2024-T4").sum).toBe(458);
  });
  it("drops LAT and SPA the term after their last print, not the day of it", () => {
    expect(at("2024-T4").outOf).toBe(600); // closed on the Dec 2024 round — still counts
    expect(at("2025-T1").outOf).toBe(600); // …and gone by the next one (BEA/GRA listed)
    expect(at("2025-T1").sum).toBe(428);
  });
  it("carries GRA through 2025 and retires it in 2026", () => {
    for (const key of ["2025-T1", "2025-T2", "2025-T4"]) expect(at(key).outOf).toBe(600);
    expect(at("2025-T2").sum).toBe(416);
    expect(at("2025-T4").sum).toBe(409);
    expect(at("2026-T1").outOf).toBe(600);
    expect(at("2026-T1").sum).toBe(373);
  });
  it("counts BEA once in 2025 and its two successors once in 2026", () => {
    // The regression this whole module exists to prevent: BEA's tape used to be
    // copied onto both ECON and BUS, so every 2025 round summed seven desks and
    // reported out of 700 — a book this student never sat.
    expect(hist.length).toBeGreaterThan(0); // else the loop guards nothing
    for (const p of hist) expect(p.outOf).toBe(600);
  });
  it("ends at the last round that printed — never at an empty open term", () => {
    const last = hist[hist.length - 1];
    expect(last.key).toBe("2026-T1"); // the April round, filed as T1 and labelled T1 26
    expect(last.label).toBe("T1 26");
    expect(last.date).toBe("2026-04-08");
    expect(last.sum).toBe(373);
    // The old tape carried April's exams forward and stamped a later term on
    // them. Nothing after T1 26 has printed, so nothing after it is drawn.
    expect(hist.some((p) => p.key === "2026-T2" || p.key === "2026-T3")).toBe(false);
  });
  it("draws one point per round and no repeats", () => {
    expect(hist).toHaveLength(7);
    expect(new Set(hist.map((p) => p.key)).size).toBe(7);
    for (let i = 1; i < hist.length; i++) expect(hist[i].date > hist[i - 1].date).toBe(true);
  });
  it("never lets a percentage exceed a full book", () => {
    expect(hist.length).toBeGreaterThan(0); // else the loop guards nothing
    for (const p of hist) expect(p.pct).toBeLessThanOrEqual(100);
  });
});

describe("today's headline", () => {
  it("counts the six live desks — a closed desk cannot report a stale exam", () => {
    const agg = examAggregate(listedAsOf(rows, TODAY, CAL))!;
    expect(agg.outOf).toBe(600);
    expect(agg.sum).toBe(373);
    expect(agg.asOf).toBe("2026-04-08");
    expect(agg.perSubject.map((p) => p.ticker).sort()).toEqual(["BUS", "ECON", "ENG", "GEO", "MATH", "PHYS"]);
  });
});

describe("what a delisted desk is allowed to change", () => {
  const withClosed = computeStats(subjects, entries, settings, TODAY);
  // Only desks that CLOSED are droppable. An ancestor is not a closed desk — it
  // is the first half of a live desk's tape, and removing it would not be
  // testing what a delisting changes, it would be deleting ECON and BUS's
  // history and measuring the wreckage.
  const closedOnly = subjects.filter((s) => !s.archived || successorsOf(s, subjects).length > 0);
  const liveOnly = computeStats(closedOnly, entries, settings, TODAY);
  const live = liveOnly.map((s) => s.sub.ticker);

  it("re-rates nobody — a closed desk has no forward return to set the bar with", () => {
    for (const tk of live) {
      const a = withClosed.find((s) => s.sub.ticker === tk)!;
      const b = liveOnly.find((s) => s.sub.ticker === tk)!;
      expect(`${tk} ${a.rating.rating}`).toBe(`${tk} ${b.rating.rating}`);
    }
  });
  it("still lends its prints to the pooled prior — evidence is evidence", () => {
    // Nine desks of history shrink the thin desks differently from six. The
    // move is small, but it must be real: a silent no-op would mean the closed
    // tapes never reached the engine at all.
    const moved = live.filter((tk) => {
      const a = withClosed.find((s) => s.sub.ticker === tk)!.quant?.price ?? 0;
      const b = liveOnly.find((s) => s.sub.ticker === tk)!.quant?.price ?? 0;
      return Math.abs(a - b) > 0.001;
    });
    expect(moved.length).toBeGreaterThan(0);
    for (const tk of live) {
      const a = withClosed.find((s) => s.sub.ticker === tk)!.quant!.price;
      const b = liveOnly.find((s) => s.sub.ticker === tk)!.quant!.price;
      expect(Math.abs(a - b)).toBeLessThan(2); // evidence, not upheaval
    }
  });
  it("keeps its own tape intact under the full book", () => {
    const lat = withClosed.find((s) => s.sub.ticker === "LAT")!;
    expect(lat.entries).toHaveLength(5);
    expect(lat.quant).not.toBeNull();
  });
});

describe("aggregateHistory across a delisting", () => {
  const hist = aggregateHistory(subjects, entries, settings, TODAY);
  it("re-marks the same book membership the exam tape reports", () => {
    const at = (key: string) => hist.find((p) => p.key === key)!;
    expect(at("2024-T4").outOf).toBe(600);
    expect(at("2025-T4").outOf).toBe(600);
    expect(at("2026-T1").outOf).toBe(600);
  });
  it("prices the same rounds, then one live mark for today", () => {
    expect(hist.slice(0, -1).map((p) => p.key)).toEqual(
      examAggregateHistory(subjects, entries, TODAY, CAL).map((p) => p.key),
    );
    const live = hist[hist.length - 1];
    expect(live.live).toBe(true);
    expect(live.date).toBe(TODAY);
    // The mark drifts between rounds — but only a little, because staleness is
    // charged on school days and the winter break aged nobody.
    expect(Math.abs(live.pct - hist[hist.length - 2].pct)).toBeLessThan(2);
  });
  it("keeps every point a real average", () => {
    for (const p of hist) {
      expect(p.pct).toBeGreaterThan(0);
      expect(p.pct).toBeLessThanOrEqual(100);
    }
  });
});
