import { clamp, round1 } from "../utils";
import { predictiveInterval, type StudentT } from "./bayes";
import { scoreT } from "./eval/scoring";
import { NO_WEIGHT, earnedWeight, type EarnedWeight } from "./earned";
import { SELF_POOL_CAP, SELF_POOL_KAPPA } from "./params";
import { resolveUpcoming, type ResolvedUpcoming } from "../upcoming";
import type {
  GradeEntry, Interval, NextExamForecast, SelfPrediction, SubjectStat, Upcoming,
} from "../../types";

/**
 * The credibility pool — the desk versus the person sitting at it (§27).
 *
 * Everything upstream of here estimates ability from PRINTS. Prints are the only
 * thing the book can audit, and §1 is blunt that they are few. But the student
 * knows things the tape cannot: which fortnight they actually worked, whether
 * the topic finally landed, that this paper is the one they have been dreading.
 * When the engine is persistently off — §23 lists several reasons it might be,
 * and a term-to-term swing in effort is a plausible one — that private knowledge
 * is the only new information available, and refusing to price it is a choice,
 * not neutrality.
 *
 * So the next-exam call becomes a PERFORMANCE-WEIGHTED LINEAR POOL of the desk's
 * predictive and the student's own, with the weight fitted from how the two have
 * actually scored against each other on resolved sittings:
 *
 *   share = S_model / (S_model + S_you),      w = share · n/(n+κ),  capped
 *
 * Three properties make this safe to ship rather than a licence to overrule the
 * engine with a wish:
 *
 * · It is EARNED, never assumed. The weight shrinks toward zero — the desk's own
 *   call — so a student with no track record changes nothing, and one who has
 *   been worse than the desk stays under 50% of the share their record implies.
 * · It is SCORED BY A PROPER RULE, matched within each sitting: CRPS against
 *   CRPS when a range was stated, absolute error against absolute error when
 *   only a point was. Both sides are always judged by the same rule on the same
 *   outcome, and only the RATIO is used, so a mixed record is still fair.
 * · DISAGREEMENT WIDENS THE BAND. The pooled variance carries the mixture's
 *   between-component term w(1−w)(μ_you − μ_model)², so a student who confidently
 *   contradicts the desk does not get a confident forecast — they get a wide one.
 *   Being pulled toward a contested mean while pretending to the old precision
 *   would be the one genuinely dangerous version of this feature.
 *
 * Exactly the identity on an empty record, so the fixture, §21 and the gate are
 * untouched. The register that scores the desk is fed the desk's RAW call, never
 * this pool — a forecaster cannot be allowed to grade a paper it half-wrote.
 */

/** 90% half-width in σ units — a stated range is read as a ~90% interval. */
const Z90 = 1.6448536269514722;
/** A stated range carries no tail information of its own. */
const SELF_DF = 30;

export interface SelfWeightModel extends EarnedWeight {
  /** Your realized point-error rms, the σ for a call you gave no range for. */
  selfSd: number | null;
}

export const IDENTITY_POOL: SelfWeightModel = { ...NO_WEIGHT, selfSd: null };

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Your call as a predictive: your stated range if you gave one, else `sd`.
 *
 * The point is clamped to the board. A stored call outside [0,100] is corrupt
 * input rather than a bold forecast, and left alone it would pin the pooled mean
 * against a boundary and blow the band out with a squared disagreement term.
 */
export function selfPredictive(sp: SelfPrediction, sd: number): StudentT {
  const point = clamp(sp.point, 0, 100);
  const ranged = sp.lo != null && sp.hi != null && sp.hi > sp.lo;
  return ranged
    ? { mean: point, scale: Math.max((sp.hi! - sp.lo!) / (2 * Z90), 0.5), df: SELF_DF }
    : { mean: point, scale: Math.max(sd, 0.5), df: SELF_DF };
}

/**
 * Fit the weight your call carries, from the sittings you and the desk both
 * called. `modelFor` must hand back the desk's UNCONTAMINATED predictive — the
 * raw board or the forecast register, never a pool this function produced.
 */
export function fitSelfWeight(
  resolved: ResolvedUpcoming[],
  modelFor: (r: ResolvedUpcoming) => StudentT | null,
): SelfWeightModel {
  const youScores: number[] = [];
  const modelScores: number[] = [];
  const errors: number[] = [];

  for (const r of resolved) {
    const sp = r.upcoming.selfPred;
    const model = modelFor(r);
    if (!sp || !model) continue;
    const y = r.realized.score;
    errors.push(sp.point - y);

    const ranged = sp.lo != null && sp.hi != null && sp.hi > sp.lo;
    if (ranged) {
      // Both sides are full predictives: score both by CRPS.
      youScores.push(scoreT(selfPredictive(sp, 0), y).crps);
      modelScores.push(scoreT(model, y).crps);
    } else {
      // You stated a location and no spread. Charging you the CRPS of a
      // degenerate predictive would bill you for uncertainty you never claimed,
      // so BOTH sides are judged on their location alone for this sitting.
      youScores.push(Math.abs(sp.point - y));
      modelScores.push(Math.abs(model.mean - y));
    }
  }

  if (!youScores.length) return { ...IDENTITY_POOL };

  // The credibility rule itself lives in `earned.ts` — this channel is one of
  // three that obey it, and they must not be allowed to drift apart.
  const fit = earnedWeight(youScores, modelScores, { kappa: SELF_POOL_KAPPA, cap: SELF_POOL_CAP });
  const selfSd = Math.sqrt(mean(errors.map((e) => e * e)));

  return { ...fit, selfSd: selfSd > 0 ? selfSd : null };
}

const roundIv = (iv: Interval): Interval => ({ lo: round1(iv.lo), hi: round1(iv.hi) });

/**
 * Pool the desk's next-exam call with yours, by moment-matching the mixture.
 *
 *   μ = (1−w)μ_m + w μ_y
 *   σ² = (1−w)σ_m² + w σ_y² + w(1−w)(μ_y − μ_m)²
 *
 * The last term is the whole safety argument: the further your call sits from
 * the desk's, the wider the pooled band, so a contested forecast is an uncertain
 * one. Returns the model's own forecast untouched at w = 0.
 */
export function poolNextExam(
  model: NextExamForecast,
  df: number,
  sp: SelfPrediction | null | undefined,
  fit: SelfWeightModel,
): NextExamForecast {
  const w = fit.w;
  if (!sp || !(w > 0) || !(model.sd > 0)) return model;

  const you = selfPredictive(sp, fit.selfSd ?? model.sd);
  const mu = (1 - w) * model.mean + w * you.mean;
  const spread = (you.mean - model.mean) ** 2;
  const variance = (1 - w) * model.sd ** 2 + w * you.scale ** 2 + w * (1 - w) * spread;
  const sd = Math.sqrt(Math.max(variance, 1e-9));
  // The desk's df is kept: pooling in a stated range adds a location, not tail
  // information, and the heavier of the two tails is the honest one to quote.
  const t: StudentT = { mean: clamp(mu, 0, 100), scale: sd, df };

  return {
    mean: round1(t.mean),
    sd: round1(sd),
    ci50: roundIv(predictiveInterval(t, 0.5)),
    ci90: roundIv(predictiveInterval(t, 0.9)),
  };
}

/**
 * The call that gets pooled into a desk's next-exam forecast: the one staked
 * on the SOONEST exam still ahead of you for that desk — the paper `nextExam` is
 * actually about. A sitting whose date has passed without a mark landing is a
 * calendar entry nobody cleaned up, not a live opinion, so it is skipped.
 * `has` names the channel being pooled; the default is your own call, and the
 * wire's pool (aipool.ts) passes its own predicate rather than re-deriving the
 * soonest-live-sitting rule.
 */
export function stakedSittings(
  upcoming: Upcoming[],
  entries: GradeEntry[],
  todayIso: string,
  has: (u: Upcoming) => boolean = (u) => !!u.selfPred,
): Map<string, Upcoming> {
  const out = new Map<string, Upcoming>();
  const byDate = [...upcoming].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const u of byDate) {
    if (u.type !== "Exam" || !has(u) || u.date < todayIso) continue;
    if (out.has(u.subjectId) || resolveUpcoming(u, entries)) continue;
    out.set(u.subjectId, u);
  }
  return out;
}

/**
 * Pool every desk's next-exam call with the student's own, where one is staked.
 *
 * Returns the SAME array when nothing moves, so the boards downstream keep their
 * memoization — and, more importantly, so "the pool is off" and "the pool is on
 * but has earned nothing" are one code path rather than two that could drift.
 */
export function poolBoard<T extends SubjectStat>(
  stats: T[],
  upcoming: Upcoming[],
  entries: GradeEntry[],
  todayIso: string,
  fit: SelfWeightModel,
): T[] {
  if (!(fit.w > 0)) return stats;
  const staked = stakedSittings(upcoming, entries, todayIso);
  if (!staked.size) return stats;
  let moved = false;
  const out = stats.map((s) => {
    const u = staked.get(s.sub.id);
    if (!u || !s.quant) return s;
    const nextExam = poolNextExam(s.quant.nextExam, s.quant.df, u.selfPred, fit);
    if (nextExam === s.quant.nextExam) return s;
    moved = true;
    return { ...s, quant: { ...s.quant, nextExam } };
  });
  return moved ? out : stats;
}
