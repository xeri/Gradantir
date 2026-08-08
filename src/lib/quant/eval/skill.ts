import type { SchoolCalendar } from "../../calendar";
import { clamp, stdev } from "../../utils";
import { buildRounds, examRounds } from "../../rounds";
import { groupByLineage, inheritedEntries } from "../../lineage";
import { poolableScores, poolStats } from "../shrinkage";
import { ensemble } from "../ensemble";
import { correlatedSumSd } from "../aggregate";
import { scoreT, type Scores } from "./scoring";
import type { GradeEntry, Subject } from "../../../types";

/**
 * The mean-target backtest. The analysis' central finding is that the
 * all-subject MEAN is forecastable (MAE ~3.5) while per-subject movement is
 * near-irreducible noise. This walks the exam rounds and, at each one, forecasts
 * every subject's exam from its strictly-earlier prints, then scores the mean of
 * those forecasts against the realized mean — beside a local-level naive (the
 * previous round's realized mean). Demonstrable skill at the mean lives here.
 *
 * The aggregate carries a PREDICTIVE, not just a point. It had only ever been
 * measured by MAE, which is a point-forecast statistic and rewards
 * overconfidence; scoring it by the same proper rule as everything else is what
 * makes the target comparable to the per-subject one, and is how the engine's
 * own scoreboard came to say plainly that this aggregate loses to its own naive.
 */

export interface MeanPoint {
  roundKey: string;
  date: string;
  forecast: number;
  /** Predictive scale of the aggregate MEAN, points. */
  sd: number;
  realized: number;
  naive: number;
  s: Scores;
  naiveScores: Scores;
}

export interface MeanSkill {
  points: MeanPoint[];
  /** MAE of the aggregate-mean forecast. */
  mae: number;
  /** MAE of the local-level (previous realized mean) naive. */
  naiveMae: number;
  /** CRPS of the aggregate predictive, points. */
  crps: number;
  /** CRPS of the probabilistic naive, points. */
  crpsNaive: number;
  /** 1 − crps/crpsNaive. NEGATIVE means the naive wins — see README §26. */
  skill: number;
  /** Realized coverage of the aggregate 90% band. */
  cover90: number;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Floor on the naive's spread, points. Matches backtest.ts's NAIVE_SD_FLOOR so
 * the two naives are the same kind of benchmark on the two targets.
 */
const NAIVE_SD_FLOOR = 3;

export function meanSkill(subjects: Subject[], entries: GradeEntry[], cal: SchoolCalendar): MeanSkill {
  const rounds = examRounds(buildRounds(entries, cal));
  const points: MeanPoint[] = [];
  let prevRealized: number | null = null;
  const realizedHistory: number[] = [];

  for (const round of rounds) {
    const realizedScores: number[] = [];
    const forecasts: number[] = [];
    const sds: number[] = [];
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
      // A desk the ensemble declined to price contributes the pool's own
      // spread rather than a zero, which would assert certainty it does not have.
      sds.push(ens ? ens.sd : NAIVE_SD_FLOOR);
    }
    if (!realizedScores.length) continue;
    const realized = mean(realizedScores);
    if (prevRealized != null && forecasts.length) {
      const S = forecasts.length;
      /* The aggregate is a MEAN of S desks, so its scale is the correlated sum's
         scale divided by S. rho = 0 here — quadrature — because the harness
         must score the engine as it currently ships (App.tsx reads
         settings.subjectCorr, default 0). When Phase C fits rho, this call is
         the single place that changes, and the change is then visible as a
         movement in cover90 rather than hidden inside a display setting. */
      const sd = correlatedSumSd(sds, 0) / S;
      const df = 3 + points.length + 1;
      const pred = { mean: mean(forecasts), scale: sd, df };
      const naiveSd = Math.max(NAIVE_SD_FLOOR, stdev(realizedHistory));
      const naivePred = { mean: prevRealized, scale: naiveSd, df };
      points.push({
        roundKey: round.key,
        date: round.date,
        forecast: pred.mean,
        sd,
        realized,
        naive: prevRealized,
        s: scoreT(pred, realized),
        naiveScores: scoreT(naivePred, realized),
      });
    }
    prevRealized = realized;
    realizedHistory.push(realized);
  }

  const crps = mean(points.map((p) => p.s.crps));
  const crpsNaive = mean(points.map((p) => p.naiveScores.crps));
  return {
    points,
    mae: mean(points.map((p) => Math.abs(p.forecast - p.realized))),
    naiveMae: mean(points.map((p) => Math.abs(p.naive - p.realized))),
    crps,
    crpsNaive,
    skill: crpsNaive > 0 ? 1 - crps / crpsNaive : 0,
    cover90: mean(points.map((p) => p.s.cover90)),
  };
}
