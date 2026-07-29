import type { SchoolCalendar } from "../../calendar";
import { clamp } from "../../utils";
import { buildRounds, examRounds } from "../../rounds";
import { groupByLineage, inheritedEntries } from "../../lineage";
import { poolableScores, poolStats } from "../shrinkage";
import { ensemble } from "../ensemble";
import type { GradeEntry, Subject } from "../../../types";

/**
 * The mean-target backtest. The analysis' central finding is that the
 * all-subject MEAN is forecastable (MAE ~3.5) while per-subject movement is
 * near-irreducible noise. This walks the exam rounds and, at each one, forecasts
 * every subject's exam from its strictly-earlier prints, then scores the mean of
 * those forecasts against the realized mean — beside a local-level naive (the
 * previous round's realized mean). Demonstrable skill at the mean lives here.
 */

export interface MeanPoint {
  roundKey: string;
  date: string;
  forecast: number;
  realized: number;
  naive: number;
}

export interface MeanSkill {
  points: MeanPoint[];
  /** MAE of the aggregate-mean forecast. */
  mae: number;
  /** MAE of the local-level (previous realized mean) naive. */
  naiveMae: number;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function meanSkill(subjects: Subject[], entries: GradeEntry[], cal: SchoolCalendar): MeanSkill {
  const rounds = examRounds(buildRounds(entries, cal));
  const points: MeanPoint[] = [];
  let prevRealized: number | null = null;

  for (const round of rounds) {
    const realizedScores: number[] = [];
    const forecasts: number[] = [];
    for (const sub of subjects) {
      const tape = inheritedEntries(sub, subjects, entries)
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const examThisRound = tape.find((e) => e.type === "Exam" && e.date >= round.first && e.date <= round.date);
      if (!examThisRound) continue;
      const past = tape.filter((e) => e.date < round.first);
      if (!past.length) continue; // no history to forecast from
      realizedScores.push(examThisRound.score);
      const pool = poolStats(poolableScores(groupByLineage(subjects, entries.filter((e) => e.date < round.first))));
      const ens = ensemble(past, pool, round.date);
      forecasts.push(ens ? clamp(ens.mean, 0, 100) : mean(past.map((p) => p.score)));
    }
    if (!realizedScores.length) continue;
    const realized = mean(realizedScores);
    if (prevRealized != null && forecasts.length) {
      points.push({ roundKey: round.key, date: round.date, forecast: mean(forecasts), realized, naive: prevRealized });
    }
    prevRealized = realized;
  }

  return {
    points,
    mae: mean(points.map((p) => Math.abs(p.forecast - p.realized))),
    naiveMae: mean(points.map((p) => Math.abs(p.naive - p.realized))),
  };
}
