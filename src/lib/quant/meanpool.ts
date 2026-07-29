import { clamp, round1 } from "../utils";
import { entryTermKey } from "../periods";
import { scoreMeanCall } from "../meancall";
import { earnedWeight, type EarnedWeight } from "./earned";
import { SELF_POOL_CAP, SELF_POOL_KAPPA } from "./params";
import type { SchoolCalendar } from "../calendar";
import type { AggregateForecast, ForecastLog, GradeEntry, MeanCall } from "../../types";

/**
 * The aggregate pool — your call on the BOOK, against the desk's (D4 → §28).
 *
 * §26 is explicit that the aggregate is the level this engine can genuinely
 * forecast: per-desk calls are noisy, the sum of them is not. That cuts both
 * ways, and this module is the other edge of it. If the overall average is where
 * the model has skill, it is also where a student's own read is worth the most —
 * one number about the whole term, elicited once, instead of six point forecasts
 * nobody can calibrate.
 *
 * So the forward AGGREGATE becomes a performance-weighted pool of the desk's and
 * yours, by the same moment-matched mixture as the per-desk pool (§27):
 *
 *   μ  = (1−w)μ_m + w μ_y
 *   σ² = (1−w)σ_m² + w σ_y² + w(1−w)(μ_y − μ_m)²
 *
 * Three deliberate limits:
 *
 * · It touches the BOOK-LEVEL forecast and never a per-desk mark. Your call is
 *   about the average; allocating it back across the desks would invent per-desk
 *   opinions you never stated, and the forced ranking is the wrong instrument to
 *   do it with — a ranking has no scale.
 * · The RANKING half of the call is scored and shown but weighs nothing here.
 *   Level and ordering are separate claims. The ordering channel is the duel pile
 *   (§15c), which is built for it; letting the ranking also tilt the marks would
 *   charge the same opinion twice.
 * · A call is only ever scored against a round it was made BEFORE. A call logged
 *   after the marks landed is a memory, not a forecast, and would earn weight it
 *   has not got.
 */

export interface MeanPoolModel extends EarnedWeight {
  /** Rms of your realized aggregate errors — the σ for your call. */
  selfSd: number | null;
  /** Mean Spearman ρ of your forced rankings, quoted by the card. Scores nothing. */
  rankCorr: number | null;
}

export const IDENTITY_MEAN_POOL: MeanPoolModel = {
  w: 0, n: 0, youScore: null, modelScore: null, rawShare: 0, selfSd: null, rankCorr: null,
};

/** A wide default σ for a call from someone with no scored record yet. */
const UNSCORED_SELF_SD = 8;

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 90% half-width in σ units, matching the rest of the aggregate desk. */
const Z90 = 1.6448536269514722;

/**
 * Your standing call for a round: the NEWEST one logged for it. Every call is
 * kept — the card lists them and the register scores them — but only the latest
 * is your current opinion, because a revision is what you think now.
 */
export function latestCallFor(calls: MeanCall[], roundKey: string): MeanCall | null {
  let best: MeanCall | null = null;
  for (const c of calls) {
    if (c.roundKey !== roundKey) continue;
    if (!best || c.createdAt > best.createdAt || (c.createdAt === best.createdAt && c.id > best.id)) best = c;
  }
  return best;
}

/**
 * Fit the weight your aggregate calls have earned.
 *
 * For each round whose exams have landed, your standing call as of BEFORE the
 * round is scored on absolute error against the realized average of the desks
 * you ranked, and the register's as-of forecast is scored the same way over the
 * same desks. A round the register never called is skipped rather than handed a
 * free win — the comparison must be like for like or the ratio means nothing.
 */
export function meanCallSkill(
  calls: MeanCall[],
  entries: GradeEntry[],
  register: ForecastLog[],
  cal: SchoolCalendar,
): MeanPoolModel {
  /* Exam marks by round, and the day each round's first paper was sat. */
  const rounds = new Map<string, { date: string; realized: Record<string, number> }>();
  for (const e of entries) {
    if (e.type !== "Exam") continue;
    const key = entryTermKey(e, cal);
    const slot = rounds.get(key) ?? { date: e.date, realized: {} };
    if (e.date < slot.date) slot.date = e.date;
    if (slot.realized[e.subjectId] == null) slot.realized[e.subjectId] = e.score;
    rounds.set(key, slot);
  }

  const youAbs: number[] = [];
  const modelAbs: number[] = [];
  const errors: number[] = [];
  const rhos: number[] = [];

  for (const [key, round] of [...rounds.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    // Only calls made before the first paper of the round — see the header.
    const priors = calls.filter((c) => c.roundKey === key && c.createdAt < round.date);
    const standing = latestCallFor(priors, key);
    if (!standing) continue;

    const score = scoreMeanCall(standing, round.realized);
    if (score.realizedAvg == null || score.absError == null) continue;

    /* The desk's as-of aggregate over the very same desks you ranked. */
    const called = standing.ranking.filter((id) => round.realized[id] != null);
    const points: number[] = [];
    for (const id of called) {
      const l = register.find((x) => x.roundKey === key && x.subjectId === id);
      if (l) points.push(l.point);
    }
    if (points.length !== called.length || !points.length) continue;

    youAbs.push(score.absError);
    modelAbs.push(Math.abs(mean(points) - score.realizedAvg));
    errors.push(score.error!);
    if (score.rankCorr != null) rhos.push(score.rankCorr);
  }

  if (!youAbs.length) return { ...IDENTITY_MEAN_POOL };
  const fit = earnedWeight(youAbs, modelAbs, { kappa: SELF_POOL_KAPPA, cap: SELF_POOL_CAP });
  const selfSd = Math.sqrt(mean(errors.map((e) => e * e)));
  return {
    ...fit,
    selfSd: selfSd > 0 ? selfSd : null,
    rankCorr: rhos.length ? mean(rhos) : null,
  };
}

/**
 * Pool your standing call into the desk's forward aggregate.
 *
 * Returns the SAME object when nothing moves, so "the pool is off" and "the pool
 * is on but has earned nothing" stay one code path rather than two that could
 * drift apart. The band can only widen: the between-component term is what makes
 * a contested aggregate an uncertain one rather than a confident disagreement.
 */
export function poolAggregate(
  model: AggregateForecast | null,
  call: MeanCall | null,
  fit: MeanPoolModel,
): AggregateForecast | null {
  const w = fit.w;
  if (!model || !call || !(w > 0) || !(model.outOf > 0)) return model;

  /* Everything below works in PERCENT — the scale the call is stated on — and
     is rescaled to the sum at the end. */
  const scale = model.outOf / 100;
  const muM = model.pct;
  const sdM = model.sd / scale;
  const muY = clamp(call.predAvg, 0, 100);
  const sdY = Math.max(fit.selfSd ?? UNSCORED_SELF_SD, 0.5);

  const mu = (1 - w) * muM + w * muY;
  const variance = (1 - w) * sdM ** 2 + w * sdY ** 2 + w * (1 - w) * (muY - muM) ** 2;
  const sd = Math.sqrt(Math.max(variance, 1e-9));

  const pct = clamp(mu, 0, 100);
  const sum = pct * scale;
  const sdSum = sd * scale;
  return {
    ...model,
    sum: round1(sum),
    pct: round1(pct),
    sd: round1(sdSum),
    ci90: {
      lo: round1(clamp(sum - Z90 * sdSum, 0, model.outOf)),
      hi: round1(clamp(sum + Z90 * sdSum, 0, model.outOf)),
    },
    // The expected move is a statement about the level, so it moves with it.
    vsLast: model.vsLast == null ? null : round1(model.vsLast + (pct - muM)),
  };
}

/**
 * Pick the call the aggregate should read: your standing one for the round being
 * forecast, and only when aggregate-call weighting is switched on.
 */
export function aggregateCallFor(
  calls: MeanCall[] | undefined,
  roundKey: string | null,
  enabled: boolean,
): MeanCall | null {
  if (!enabled || !calls?.length || !roundKey) return null;
  return latestCallFor(calls, roundKey);
}
