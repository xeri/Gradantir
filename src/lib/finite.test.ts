import { describe, expect, it } from "vitest";
import { computeStats } from "./stats";
import { replayRegister } from "./quant/eval/replay";
import { examAggregate, aggregateForecast, compositeIndex, pricesAsOf } from "./quant/aggregate";
import { freshSettings, TYPES } from "../constants";
import { listedAsOf } from "./listing";
import type { GradeEntry, Subject } from "../types";

/**
 * NOTHING NON-FINITE REACHES THE BOARD.
 *
 * The engine divides by counts, spreads, cohort sizes and fitted variances all
 * the way down, and a school book is full of the exact shapes that make those
 * zero: one print, two identical prints, a whole tape of 100s, a cohort of one,
 * a desk that never sat an exam. A NaN does not throw — it propagates silently,
 * prints as "NaN%" on a card, and quietly poisons every sum it enters.
 *
 * The example-based suites cover the shapes somebody thought of. This sweeps a
 * few hundred randomised books biased HARD toward the degenerate ones, and
 * fails with the seed, so any counterexample is reproducible.
 */

/** Deterministic PRNG so a failure is reproducible from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Walk any structure and report the path of the first non-finite number. */
function findBadNumber(v: unknown, path = "$", depth = 0): string | null {
  if (depth > 12) return null;
  if (typeof v === "number") return Number.isFinite(v) ? null : `${path} = ${v}`;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findBadNumber(v[i], `${path}[${i}]`, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "sub" || k === "entries" || k === "own" || k === "latest") continue;
      const r = findBadNumber(x, `${path}.${k}`, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function randomBook(seed: number) {
  const r = rng(seed);
  const nSubs = 1 + Math.floor(r() * 5);
  const subjects: Subject[] = [];
  const entries: GradeEntry[] = [];
  for (let i = 0; i < nSubs; i++) {
    const archived = r() < 0.25;
    subjects.push({
      id: `s${i}`, name: `SUB${i}`, ticker: `S${i}`, color: "#4ea3ff",
      target: r() < 0.5 ? Math.round(r() * 100) : null,
      courseworkPct: r() < 0.4 ? Math.round(r() * 100) : null,
      ...(archived ? { archived: true } : {}),
    });
    const nEnt = Math.floor(r() * 9); // 0..8 — including the empty tape
    for (let j = 0; j < nEnt; j++) {
      const year = 2023 + Math.floor(r() * 4);
      const month = 1 + Math.floor(r() * 12);
      const day = 1 + Math.floor(r() * 28);
      // Deliberately degenerate: exact 0s and 100s, equal scores, extreme ranks.
      const roll = r();
      const score = roll < 0.15 ? 0 : roll < 0.3 ? 100 : roll < 0.45 ? 70 : Math.round(r() * 100);
      const cohortN = r() < 0.5 ? 1 + Math.floor(r() * 300) : null;
      entries.push({
        id: `e${i}-${j}`, subjectId: `s${i}`,
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        type: TYPES[Math.floor(r() * TYPES.length)],
        score, title: "",
        classAvg: r() < 0.5 ? Math.round(r() * 100) : null,
        yearAvg: r() < 0.5 ? Math.round(r() * 100) : null,
        cohortN,
        rank: cohortN != null && r() < 0.7 ? 1 + Math.floor(r() * cohortN) : null,
        worthPct: r() < 0.4 ? Math.round(r() * 100) || 1 : null,
        ...(r() < 0.1 ? { censored: true as const } : {}),
        ...(r() < 0.1 ? { regimeBreak: true as const } : {}),
        ...(r() < 0.15 ? { difficulty: (r() < 0.5 ? "easy" : "hard") as "easy" | "hard" } : {}),
      });
    }
  }
  return { subjects, entries };
}

describe("no non-finite number ever reaches the board", () => {
  const settings = freshSettings();
  const TODAY = "2026-07-27";

  it("across 250 randomised books", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 250; seed++) {
      const { subjects, entries } = randomBook(seed);
      let stats;
      try {
        stats = computeStats(subjects, entries, settings, TODAY);
      } catch (e) {
        failures.push(`seed ${seed}: computeStats threw — ${String(e)}`);
        continue;
      }
      const bad = findBadNumber(stats.map((s) => ({ q: s.quant, sd: s.sd, alpha: s.alpha, pct: s.percentile, gp: s.gradeProj, pd: s.priceDelta, fc: s.forecast, depth: s.depth })));
      if (bad) failures.push(`seed ${seed}: stats ${bad}`);

      try {
        const booked = listedAsOf(stats, TODAY, settings.calendar);
        const agg = examAggregate(booked);
        const b1 = findBadNumber(agg);
        if (b1) failures.push(`seed ${seed}: examAggregate ${b1}`);
        const fc = aggregateForecast(booked, agg, 0.3);
        const b2 = findBadNumber(fc);
        if (b2) failures.push(`seed ${seed}: aggregateForecast ${b2}`);
        const idx = compositeIndex(booked, pricesAsOf(subjects, entries, settings, "2025-06-01"), 0.3);
        const b3 = findBadNumber(idx);
        if (b3) failures.push(`seed ${seed}: compositeIndex ${b3}`);
      } catch (e) {
        failures.push(`seed ${seed}: aggregates threw — ${String(e)}`);
      }

      try {
        const logs = replayRegister(subjects, entries, settings, TODAY);
        const b4 = findBadNumber(logs);
        if (b4) failures.push(`seed ${seed}: replay ${b4}`);
      } catch (e) {
        failures.push(`seed ${seed}: replay threw — ${String(e)}`);
      }
    }
    expect(failures.slice(0, 25)).toEqual([]);
    // Explicit budget: this sweep prices a few hundred books, and the default
    // 5s is close enough to its solo runtime that worker contention alone can
    // fail it. A timeout that trips on a busy machine is not a signal.
  }, 60_000);
});
