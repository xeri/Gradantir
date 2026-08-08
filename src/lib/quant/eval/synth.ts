import { addDays, clamp, pDate, round1 } from "../../utils";
import { freshBook } from "../../defaults";
import { RELIABILITY_SD } from "../params";
import { makeRng } from "./rng";
import { TYPES } from "../../../constants";
import type { AppData, GradeEntry, Subject } from "../../../types";

/**
 * A generative book with known truth.
 *
 * The committed fixture is one book of ten desks; every number the scoreboard
 * reports is a property of it, and no amount of care changes that a sample of
 * one cannot separate an estimator's quality from a book's luck. This module
 * makes as many books as the question needs, from a process whose parameters
 * are known, so an estimator can be asked the two questions a single fixture
 * cannot answer: does it recover truth, and does it beat its rival more often
 * than not.
 *
 * THE RULE, and it is not negotiable: constants are never tuned here. Data
 * generated from the model's own assumptions rewards a fit to those
 * assumptions, which is a fit to nothing. Synthetic data decides STRUCTURE and
 * finds BUGS. The real book, through the gate, decides what ships.
 */

export interface SynthOpts {
  seed: number;
  subjects: number;
  printsPerSubject: number;
  /** Ability random-walk variance per day, pts²/day — the truth kalman.ts fits. */
  qPerDay: number;
  /** Sd of the per-sitting difficulty shock shared across desks, points. 0 = none. */
  tauDifficulty: number;
  /** Mean gap between sittings, days. */
  gapDays: number;
  /** Ceiling that censors a mark, or null for an uncensored book. */
  censorAt?: number | null;
}

export interface SynthTruth {
  qPerDay: number;
  tauDifficulty: number;
  /** The latent ability that produced each entry, by entry id. */
  abilityByEntryId: Record<string, number>;
}

const START = "2024-02-05";
const PRIOR_ABILITY_MEAN = 70;
const PRIOR_ABILITY_SD = 9;

/** Whole days between two ISO dates, both read as LOCAL dates like the rest of
 *  the engine — `new Date(iso)` would parse as UTC and disagree with `addDays`. */
const daysBetween = (from: string, to: string): number =>
  Math.round((pDate(to).getTime() - pDate(from).getTime()) / 86400000);

export function synthBook(opts: SynthOpts): { data: AppData; truth: SynthTruth } {
  const rng = makeRng(opts.seed);
  const ceiling = opts.censorAt ?? null;

  const subjects: Subject[] = Array.from({ length: opts.subjects }, (_, i) => ({
    id: `s-${i}`,
    name: `Synthetic ${i}`,
    ticker: `SY${i}`,
    color: "#4D7CFE",
    target: null,
  }));

  // One shared sitting calendar, so a difficulty shock is genuinely COMMON
  // across desks — that is the structure the aggregate work has to detect.
  const dates: string[] = [];
  let cursor = START;
  for (let k = 0; k < opts.printsPerSubject; k++) {
    dates.push(cursor);
    // Gaps vary, so the irregular-spacing property README §1 lists is real here.
    cursor = addDays(cursor, Math.max(7, Math.round(opts.gapDays * (0.5 + rng.next()))));
  }
  const difficulty = dates.map(() => (opts.tauDifficulty > 0 ? rng.gaussian() * opts.tauDifficulty : 0));

  const entries: GradeEntry[] = [];
  const abilityByEntryId: Record<string, number> = {};

  for (const sub of subjects) {
    let ability = PRIOR_ABILITY_MEAN + rng.gaussian() * PRIOR_ABILITY_SD;
    for (let k = 0; k < dates.length; k++) {
      const gap = k === 0 ? 0 : daysBetween(dates[k - 1], dates[k]);
      ability += rng.gaussian() * Math.sqrt(opts.qPerDay * gap);
      // Types cycle deterministically so every reliability tier is exercised.
      const type = TYPES[k % TYPES.length];
      const noise = rng.gaussian() * RELIABILITY_SD[type];
      const latent = ability + difficulty[k] + noise;
      const capped = ceiling == null ? latent : Math.min(latent, ceiling);
      const id = `e-${sub.id}-${dates[k]}`;
      const entry: GradeEntry = {
        id,
        subjectId: sub.id,
        date: dates[k],
        type,
        score: round1(clamp(capped, 0, 100)),
        title: `Synthetic ${type} ${k}`,
      };
      if (ceiling != null && latent > ceiling) entry.censored = true;
      entries.push(entry);
      abilityByEntryId[id] = ability;
    }
  }

  return {
    // `freshBook()` is the ONE source of default settings (`freshSettings` is
    // not exported). Never hand-write a settings literal here: a drifting
    // duplicate of the defaults is exactly the second-source-of-truth problem
    // lesson L2 names.
    data: { subjects, entries, settings: freshBook().settings, sample: false },
    truth: { qPerDay: opts.qPerDay, tauDifficulty: opts.tauDifficulty, abilityByEntryId },
  };
}
