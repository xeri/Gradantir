import type { Disruption } from "../../../types";
import { addDays, pDate } from "../../utils";
import { DISRUPT_CAP, DISRUPT_SEV, DISRUPT_TAU } from "./params";

/**
 * The disruption read (D5's "life happened" channel): a self-report of an
 * illness, a family event, or another externally-caused break in study
 * capacity, priced as a DECAYING shock rather than a flat deduction. Each
 * disruption's charge is scaled by its kind's own severity (DISRUPT_SEV),
 * by how long it actually ran (capped at a week of duration credit — a
 * month-long disruption doesn't get four times the charge of a week-long
 * one), and by an exponential recovery curve once it has ended: a
 * disruption that ended long before the exam has mostly worn off by
 * DISRUPT_TAU's clock, while one still running (or that ends only just
 * before the exam) is charged near its full weight. The whole channel is
 * capped at DISRUPT_CAP, and any contributing disruption gets a note —
 * except one whose recovery has already decayed its own contribution below
 * the noise floor, which is still summed into the term but not surfaced.
 * Pure and clock-free — `asOf` is always passed in, never read off a live
 * clock.
 */

export interface DisruptRead {
  /** The priced disruption charge, <= 0, capped at -DISRUPT_CAP. */
  term: number;
  /** One line per contributing disruption (|contribution| >= 0.05), sorted by |contribution| desc. */
  notes: string[];
}

const DAY_MS = 86400000;
const daysBetween = (from: string, to: string): number => Math.round((pDate(to).getTime() - pDate(from).getTime()) / DAY_MS);
const round2 = (v: number) => Math.round(v * 100) / 100;

/** See rest.ts's negRound2: rounds a non-negative magnitude, then negates, so
 *  a half-cent penalty rounds to the nearest cent of CHARGE, not toward zero;
 *  also normalises -0 to 0. */
const negRound2 = (magnitude: number): number => {
  const r = round2(magnitude);
  return r === 0 ? 0 : -r;
};

/** Note-emission floor: a contribution below this is indistinguishable from noise. */
const NOTE_FLOOR = 0.05;

const IDENTITY: DisruptRead = { term: 0, notes: [] };

export function disruptionTerm(disruptions: Disruption[], examDate: string, asOf: string): DisruptRead {
  const live = disruptions.filter((d) => d.date <= asOf);
  if (!live.length) return IDENTITY;

  const rows = live.map((d) => {
    const durationDays = d.days ?? 1;
    const end = addDays(d.date, durationDays - 1);
    const durMult = 0.5 + (0.5 * Math.min(durationDays, 7)) / 7;
    const recovery = Math.exp(-Math.max(0, daysBetween(end, examDate)) / DISRUPT_TAU);
    const contribution = DISRUPT_SEV[d.kind] * durMult * recovery;
    return { d, contribution };
  });

  const total = rows.reduce((a, r) => a + r.contribution, 0);
  const term = negRound2(Math.min(total, DISRUPT_CAP));

  const notes = rows
    .filter((r) => r.contribution >= NOTE_FLOOR)
    .sort((a, b) => b.contribution - a.contribution)
    .map(({ d, contribution }) => {
      const suffix = d.days != null ? ` ×${d.days}D` : "";
      return `${d.kind.toUpperCase()} −${contribution.toFixed(1)} · ${d.date}${suffix}`;
    });

  return { term, notes };
}
