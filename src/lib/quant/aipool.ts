import { clamp, round1 } from "../utils";
import { predictiveInterval, type StudentT } from "./bayes";
import { scoreT } from "./eval/scoring";
import { earnedWeight, NO_WEIGHT, type EarnedWeight } from "./earned";
import { AI_POOL_CAP, AI_POOL_KAPPA, POOL_CEIL } from "./params";
import {
  poolNextExam, selfPredictive, stakedSittings, type SelfWeightModel,
} from "./pool";
import type { ResolvedUpcoming } from "../upcoming";
import type {
  AiPrediction, GradeEntry, Interval, NextExamForecast, SelfPrediction, SubjectStat, Upcoming,
} from "../../types";

/**
 * The wire's pool — an OUTSIDE desk versus this one (§29).
 *
 * The intake prompt lets any external AI file forecasts for pending sittings.
 * §27's argument for pricing the student's own call applies here with one term
 * changed: the wire may hold information the tape cannot (it has read the
 * report cards, and a strong model reasons about them), but it is even less
 * auditable than the student — the engine cannot see its model, its inputs or
 * its failure modes. So the wire obeys the SAME credibility rule as every other
 * unaudited channel (`earned.ts`), on harsher terms:
 *
 * · Its weight starts at ZERO and shrinks toward zero — an outside desk with no
 *   record moves nothing, and the whole channel is opt-in (`aiWeighting`,
 *   absent ⇒ OFF) besides.
 * · Its cap is LOWER than the student's (0.35 vs 0.45).
 * · The two outside channels are JOINTLY ceilinged: w_you + w_wire ≤ 0.6,
 *   scaled proportionally when they overflow, so the house model always keeps
 *   at least 40% of every call — however good both records look.
 *
 * Scored against the RAW board, like every channel that scores the engine: a
 * forecaster cannot grade a paper it half-wrote. And because `aiPred` lives on
 * `upcoming`, filing one never re-runs the register replay — the wire cannot
 * touch the record it is judged by. Exactly the identity on an empty record,
 * so the fixture, §21 and the gate are untouched.
 */

export interface AiWeightModel extends EarnedWeight {
  /** The wire's realized point-error rms — the σ for a range-less call. */
  aiSd: number | null;
}

export const IDENTITY_AI_POOL: AiWeightModel = { ...NO_WEIGHT, aiSd: null };

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The wire's call as a predictive — same reading rules as the student's. */
export function aiPredictive(ap: AiPrediction, sd: number): StudentT {
  return selfPredictive(ap, sd);
}

/**
 * Fit the weight the wire's record has earned, from the resolved sittings it
 * called. Same matched scoring as `fitSelfWeight`: CRPS against CRPS when it
 * stated a range, location against location when it stated only a point.
 * `modelFor` must hand back the desk's UNCONTAMINATED predictive.
 */
export function fitAiWeight(
  resolved: ResolvedUpcoming[],
  modelFor: (r: ResolvedUpcoming) => StudentT | null,
): AiWeightModel {
  const aiScores: number[] = [];
  const modelScores: number[] = [];
  const errors: number[] = [];

  for (const r of resolved) {
    const ap = r.upcoming.aiPred;
    const model = modelFor(r);
    if (!ap || !model) continue;
    const y = r.realized.score;
    errors.push(ap.point - y);

    const ranged = ap.lo != null && ap.hi != null && ap.hi > ap.lo;
    if (ranged) {
      aiScores.push(scoreT(aiPredictive(ap, 0), y).crps);
      modelScores.push(scoreT(model, y).crps);
    } else {
      aiScores.push(Math.abs(ap.point - y));
      modelScores.push(Math.abs(model.mean - y));
    }
  }

  if (!aiScores.length) return { ...IDENTITY_AI_POOL };

  const fit = earnedWeight(aiScores, modelScores, { kappa: AI_POOL_KAPPA, cap: AI_POOL_CAP });
  const aiSd = Math.sqrt(mean(errors.map((e) => e * e)));

  return { ...fit, aiSd: aiSd > 0 ? aiSd : null };
}

/**
 * The joint ceiling: each outside weight is earned independently, but their sum
 * may not exceed POOL_CEIL. An overflow is scaled proportionally, so the two
 * channels keep their relative standing and the house model keeps ≥ 1 − ceil.
 */
export function jointOutsideWeights(wSelf: number, wAi: number): { wSelf: number; wAi: number } {
  const sum = wSelf + wAi;
  if (sum <= POOL_CEIL) return { wSelf, wAi };
  const k = POOL_CEIL / sum;
  return { wSelf: wSelf * k, wAi: wAi * k };
}

const roundIv = (iv: Interval): Interval => ({ lo: round1(iv.lo), hi: round1(iv.hi) });

/**
 * Pool the desk's next-exam call with the student's and the wire's — a
 * three-component moment-matched mixture:
 *
 *   μ  = Σ wᵢ μᵢ        σ² = Σ wᵢ (σᵢ² + (μᵢ − μ)²)
 *
 * With one outside channel live this DELEGATES to `poolNextExam`, by
 * construction rather than by algebra: the two-way and three-way mixtures must
 * never be allowed to drift apart. The between-component terms carry §27's
 * safety argument unchanged — any forecaster who contradicts the pool widens
 * the band.
 */
export function poolNextExamJoint(
  model: NextExamForecast,
  df: number,
  sp: SelfPrediction | null | undefined,
  selfFit: SelfWeightModel,
  ap: AiPrediction | null | undefined,
  aiFit: AiWeightModel,
): NextExamForecast {
  const selfLive = !!sp && selfFit.w > 0;
  const aiLive = !!ap && aiFit.w > 0;
  if (!(model.sd > 0)) return model;
  if (!aiLive) return selfLive ? poolNextExam(model, df, sp, selfFit) : model;
  if (!selfLive) {
    // The wire alone: the same two-way pool, fed the wire's call and spread.
    return poolNextExam(model, df, ap, { ...aiFit, selfSd: aiFit.aiSd });
  }

  const { wSelf: ws, wAi: wa } = jointOutsideWeights(selfFit.w, aiFit.w);
  const wm = 1 - ws - wa;
  const you = selfPredictive(sp!, selfFit.selfSd ?? model.sd);
  const wire = aiPredictive(ap!, aiFit.aiSd ?? model.sd);

  const mu = wm * model.mean + ws * you.mean + wa * wire.mean;
  const variance =
    wm * (model.sd ** 2 + (model.mean - mu) ** 2) +
    ws * (you.scale ** 2 + (you.mean - mu) ** 2) +
    wa * (wire.scale ** 2 + (wire.mean - mu) ** 2);
  const sd = Math.sqrt(Math.max(variance, 1e-9));
  // The desk's df is kept, as in the two-way pool: locations were added, tail
  // information was not.
  const t: StudentT = { mean: clamp(mu, 0, 100), scale: sd, df };

  return {
    mean: round1(t.mean),
    sd: round1(sd),
    ci50: roundIv(predictiveInterval(t, 0.5)),
    ci90: roundIv(predictiveInterval(t, 0.9)),
  };
}

/**
 * Pool every desk's next-exam call with whatever is staked on its soonest live
 * sitting — the student's call, the wire's, or both. One sitting, one paper,
 * one pool: only the channels staked on THAT sitting join. Returns the SAME
 * array when nothing moves, exactly like `poolBoard`.
 */
export function poolBoardJoint<T extends SubjectStat>(
  stats: T[],
  upcoming: Upcoming[],
  entries: GradeEntry[],
  todayIso: string,
  selfFit: SelfWeightModel,
  aiFit: AiWeightModel,
): T[] {
  const selfOn = selfFit.w > 0;
  const aiOn = aiFit.w > 0;
  if (!selfOn && !aiOn) return stats;
  // Only a LIVE channel nominates a sitting: with the wire off (or unearned)
  // this predicate is exactly poolBoard's, so the boards cannot drift.
  const staked = stakedSittings(upcoming, entries, todayIso, (u) =>
    (selfOn && !!u.selfPred) || (aiOn && !!u.aiPred));
  if (!staked.size) return stats;
  let moved = false;
  const out = stats.map((s) => {
    const u = staked.get(s.sub.id);
    if (!u || !s.quant) return s;
    const nextExam = poolNextExamJoint(s.quant.nextExam, s.quant.df, u.selfPred, selfFit, u.aiPred, aiFit);
    if (nextExam === s.quant.nextExam) return s;
    moved = true;
    return { ...s, quant: { ...s.quant, nextExam } };
  });
  return moved ? out : stats;
}

/**
 * What the wire's channel is currently moving, in points — the MARGINAL effect
 * of the AI weight against the same board with the wire silenced. This is what
 * the card quotes, so the charge is measured, never asserted.
 */
export function aiChargePts(
  stats: SubjectStat[],
  upcoming: Upcoming[],
  entries: GradeEntry[],
  todayIso: string,
  selfFit: SelfWeightModel,
  aiFit: AiWeightModel,
): { desks: number; maxAbsMove: number } {
  const withWire = poolBoardJoint(stats, upcoming, entries, todayIso, selfFit, aiFit);
  const without = poolBoardJoint(stats, upcoming, entries, todayIso, selfFit, IDENTITY_AI_POOL);
  let desks = 0;
  let maxAbsMove = 0;
  for (let i = 0; i < stats.length; i++) {
    const a = withWire[i]?.quant?.nextExam;
    const b = without[i]?.quant?.nextExam;
    if (!a || !b) continue;
    const move = Math.abs(a.mean - b.mean);
    if (move > 0) {
      desks++;
      maxAbsMove = Math.max(maxAbsMove, move);
    }
  }
  return { desks, maxAbsMove: round1(maxAbsMove) };
}
