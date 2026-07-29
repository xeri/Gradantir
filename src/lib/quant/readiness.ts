import { clamp } from "../utils";
import { eloRank } from "../duel";
import { entryTermKey } from "../periods";
import { earnedWeight, type EarnedWeight } from "./earned";
import { READINESS_DUEL_KAPPA, READINESS_KAPPA, READINESS_PRIOR } from "./params";
import type { SchoolCalendar } from "../calendar";
import type { Duel, ForecastLog, GradeEntry } from "../../types";

/**
 * The readiness read the marking desk charges against (D2 → §15c).
 *
 * The duel arena asks one question — "which are you more ready to sit?" — and
 * a pile of those answers fits an Elo rating. What that pile contains is
 * ORDINAL information: it says this desk is readier than that one, and it says
 * nothing whatsoever about level. Two facts follow, and the module is built
 * around both.
 *
 * · The rating is read as BRADLEY-TERRY LOG-STRENGTH, which is what Elo is
 *   actually estimating. A rating difference of 400 points is 10 : 1 odds by
 *   construction, so dividing the centred rating by 400/ln 10 ≈ 173.7 gives a
 *   log-odds you can interpret: λ = 0.4 means you would pick this desk over an
 *   average one about 60% of the time, λ = 1 about 73%. The premium charges on
 *   that number directly rather than on a z-score of the sample, which would
 *   make three duels and thirty look identical.
 *
 * · λ is CENTRED across the cross-section, so Σλ = 0. A readiness pile can
 *   therefore retilt the desks against each other but cannot systematically
 *   move the book's level in either direction. The one exception is deliberate
 *   and stated in §15c: because credits are damped like every other credit on
 *   the sheet, an UNEVENLY prepared book nets a small charge that an evenly
 *   prepared one does not. Dispersion in readiness is itself a risk, and the
 *   loss-averse desk prices it.
 *
 * The multiplier on all of it is earned. `readinessSkill` scores the ordering
 * the pile implied BEFORE each exam round against the ordering that round
 * printed, and against the desk's own as-of ordering from the register, so the
 * pile is credited exactly insofar as it has out-predicted the model. Unlike the
 * §27 pool it shrinks toward a PRIOR rather than toward zero: readiness is a
 * self-reported state, like a difficulty tag or a plan, and the engine charges
 * those the moment they exist. The record then moves the charge up or down.
 */

/** Elo points per unit of Bradley-Terry log-strength: 400 / ln 10. */
export const ELO_PER_LOGIT = 400 / Math.LN10;

export interface ReadinessPressure {
  /** Centred Bradley-Terry log-strength. >0 readier than the book's middle. */
  lambda: number;
  /** Elo rating behind it. */
  rating: number;
  wins: number;
  losses: number;
  /** What the charge is scaled by: duel-count credibility × earned skill. */
  credibility: number;
}

/** The desks a pile actually rates, keyed by subject id. Empty ⇒ no charge. */
export type ReadinessBook = Map<string, ReadinessPressure>;

export const EMPTY_READINESS: ReadinessBook = new Map();

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Fit the per-desk readiness pressure from a duel pile.
 *
 * `skill` is the earned multiplier from `readinessSkill` — passed in rather than
 * fitted here, because scoring the pile needs the tape and the register and this
 * function must stay a pure read of the duels alone.
 */
export function readinessBook(duels: Duel[], subjectIds: string[], skill: number): ReadinessBook {
  if (!duels.length || subjectIds.length < 2) return EMPTY_READINESS;
  const listed = new Set(subjectIds);
  // A duel over a desk the book no longer lists says nothing about live desks.
  const live = duels.filter((d) => listed.has(d.aId) && listed.has(d.bId));
  if (!live.length) return EMPTY_READINESS;

  const rows = eloRank(live, subjectIds);
  const centre = mean(rows.map((r) => r.rating));
  // Thin piles are held back: five duels buys a third of the charge, and a
  // single answer barely registers.
  const credibility = (live.length / (live.length + READINESS_DUEL_KAPPA)) * skill;

  const out: ReadinessBook = new Map();
  for (const r of rows) {
    out.set(r.id, {
      lambda: (r.rating - centre) / ELO_PER_LOGIT,
      rating: r.rating,
      wins: r.wins,
      losses: r.losses,
      credibility,
    });
  }
  return out;
}

/* ── What the pile has earned ─────────────────────────────────────── */

/** Fraction of separated pairs an ordering got right, or null when none are. */
function hitRate(pairs: [string, string][], strength: Map<string, number>): number | null {
  let hits = 0;
  let n = 0;
  for (const [hi, lo] of pairs) {
    const a = strength.get(hi);
    const b = strength.get(lo);
    if (a == null || b == null || a === b) continue;
    n++;
    if (a > b) hits++;
  }
  return n ? hits / n : null;
}

export interface ReadinessSkill extends EarnedWeight {
  /** Your mean pairwise hit-rate over the scored rounds, for the card to quote. */
  hitRate: number | null;
  /** The desk's own, on the same pairs. */
  modelHitRate: number | null;
}

/**
 * Score the pile against what the exams actually printed.
 *
 * For every round in which two or more desks sat an exam, the pile as it stood
 * BEFORE that round (duels dated strictly earlier — a duel recorded afterwards
 * knows the answer) is asked to order every pair, and so is the register's as-of
 * forecast for the same round. Both are scored by pairwise hit-rate, turned into
 * a loss (1 − h) so lower is better, and handed to the shared credibility rule.
 */
export function readinessSkill(
  duels: Duel[],
  entries: GradeEntry[],
  register: ForecastLog[],
  cal: SchoolCalendar,
): ReadinessSkill {
  /* Rounds, each with the exam marks that printed in it. */
  const rounds = new Map<string, { date: string; realized: Map<string, number> }>();
  for (const e of entries) {
    if (e.type !== "Exam") continue;
    const key = entryTermKey(e, cal);
    const slot = rounds.get(key) ?? { date: e.date, realized: new Map<string, number>() };
    // The round is scored as of its FIRST exam: by the second, some of the
    // answer is already on the tape.
    if (e.date < slot.date) slot.date = e.date;
    if (!slot.realized.has(e.subjectId)) slot.realized.set(e.subjectId, e.score);
    rounds.set(key, slot);
  }

  const youLoss: number[] = [];
  const modelLoss: number[] = [];
  const youHits: number[] = [];
  const modelHits: number[] = [];

  for (const [key, round] of [...rounds.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const ids = [...round.realized.keys()];
    if (ids.length < 2) continue;
    const past = duels.filter((d) => d.createdAt < round.date);
    if (!past.length) continue;

    /* Realized order, best first — the pairs both forecasters are graded on. */
    const ordered = [...ids].sort((a, b) => round.realized.get(b)! - round.realized.get(a)!);
    const pairs: [string, string][] = [];
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        // A tie in the realized marks separates nobody, so it grades nobody.
        if (round.realized.get(ordered[i])! !== round.realized.get(ordered[j])!) {
          pairs.push([ordered[i], ordered[j]]);
        }
      }
    }
    if (!pairs.length) continue;

    const elo = new Map(eloRank(past, ids).map((r) => [r.id, r.rating]));
    const you = hitRate(pairs, elo);
    if (you == null) continue;

    /* The desk's as-of call for the same round — a higher forecast is a
       readier desk. A round the register never called grades the pile against
       a coin, which is the honest baseline for "no opinion on file". */
    const model = new Map<string, number>();
    for (const l of register) {
      if (l.roundKey === key && ids.includes(l.subjectId) && !model.has(l.subjectId)) {
        model.set(l.subjectId, l.point);
      }
    }
    const modelRate = hitRate(pairs, model) ?? 0.5;

    youHits.push(you);
    modelHits.push(modelRate);
    youLoss.push(1 - you);
    modelLoss.push(1 - modelRate);
  }

  const fit = earnedWeight(youLoss, modelLoss, {
    kappa: READINESS_KAPPA,
    cap: 1,
    toward: READINESS_PRIOR,
  });
  return {
    ...fit,
    hitRate: youHits.length ? mean(youHits) : null,
    modelHitRate: modelHits.length ? mean(modelHits) : null,
  };
}

/**
 * Pick the readiness read the mark should use: the live pile, and only when
 * readiness weighting is switched on. Returns an empty book — an exact identity
 * at the marking desk — for an off switch or a book that has never duelled.
 */
export function readinessFor(
  duels: Duel[] | undefined,
  subjectIds: string[],
  skill: number,
  enabled: boolean,
): ReadinessBook {
  if (!enabled || !duels?.length) return EMPTY_READINESS;
  return readinessBook(duels, subjectIds, clamp(skill, 0, 1));
}
