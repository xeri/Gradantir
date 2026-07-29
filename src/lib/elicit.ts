import { tCdf, type StudentT } from "./quant/bayes";
import { scoreT } from "./quant/eval/scoring";
import type { ResolvedUpcoming } from "./upcoming";
import type { SelfPrediction } from "../types";

/**
 * Scoring the student's own calls against the desk — the calibration instrument
 * the post-mortem asked for. Self-predictions, a teacher's forecast and a
 * chip-staked distribution are each scored by a PROPER rule and set beside the
 * model's score on the very same outcome, so the headline is "you vs the desk",
 * not "did you comply". Pure and deterministic.
 */

/** Ten chips laid across six grade bands — the staking board (D3). */
export const STAKE_CHIPS = 10;
export const STAKE_BANDS: readonly [number, number][] = [
  [0, 50], [50, 60], [60, 70], [70, 80], [80, 90], [90, 100],
];

/** 90% half-width in σ units — a self-range is read as a ~90% interval. */
const Z90 = 1.6448536269514722;
/** A normal-ish df: a stated range carries no tail information of its own. */
const SELF_DF = 30;

/** The band a realized score lands in; the top band is closed at 100. */
export function bandOf(score: number): number {
  for (let i = 0; i < STAKE_BANDS.length; i++) {
    const [lo, hi] = STAKE_BANDS[i];
    if (score >= lo && (score < hi || (i === STAKE_BANDS.length - 1 && score <= hi))) return i;
  }
  return score < STAKE_BANDS[0][0] ? 0 : STAKE_BANDS.length - 1;
}

export interface SelfScore {
  point: number;
  /** point − realized: a persistent positive mean is optimism. */
  error: number;
  absError: number;
  /** 1 inside the stated range, 0 outside; null when no range was given. */
  covered: number | null;
  /** CRPS of the stated range read as a ~90% interval; null without a range. */
  crps: number | null;
}

/** Score one self-prediction: point error always, coverage + CRPS if ranged. */
export function scoreSelfPred(sp: SelfPrediction, realized: number): SelfScore {
  const error = sp.point - realized;
  const hasRange = sp.lo != null && sp.hi != null && sp.hi > sp.lo;
  let covered: number | null = null;
  let crps: number | null = null;
  if (hasRange) {
    const lo = sp.lo!, hi = sp.hi!;
    covered = realized >= lo && realized <= hi ? 1 : 0;
    const scale = Math.max((hi - lo) / (2 * Z90), 0.5);
    crps = scoreT({ mean: sp.point, scale, df: SELF_DF }, realized).crps;
  }
  return { point: sp.point, error, absError: Math.abs(error), covered, crps };
}

export interface ChipScore {
  /** Quadratic (Brier) score of the staked pmf, 0 best, 2 worst. */
  brier: number;
  /** Logarithmic score −ln p(realized band), floored so a zero stake is finite. */
  logScore: number;
}

/** Brier + log score of a chip stake, or null if it is empty / mis-sized. */
export function scoreChips(chips: number[], realized: number): ChipScore | null {
  if (chips.length !== STAKE_BANDS.length) return null;
  const total = chips.reduce((a, c) => a + c, 0);
  if (total <= 0) return null;
  const p = chips.map((c) => c / total);
  const k = bandOf(realized);
  const brier = p.reduce((a, pj, j) => a + (pj - (j === k ? 1 : 0)) ** 2, 0);
  const logScore = -Math.log(Math.max(p[k], 1e-6));
  return { brier, logScore };
}

/** The model's predictive discretized over the bands, truncated to [0,100]. */
export function modelBandPmf(t: StudentT): number[] {
  const F = (x: number) => tCdf((x - t.mean) / t.scale, t.df);
  const F0 = F(0), F100 = F(100);
  const mass = Math.max(F100 - F0, 1e-9);
  return STAKE_BANDS.map(([lo, hi]) => (F(hi) - F(lo)) / mass);
}

export interface VsModel {
  n: number;
  youMae: number | null;
  modelMae: number | null;
  youCrps: number | null;
  modelCrps: number | null;
  coverage: number | null;
}

export interface ElicitScoreboard {
  self: VsModel;
  teacher: VsModel;
  /** The wire's AI forecasts (§29), scored like the teacher's: point error only. */
  ai: VsModel;
  chips: { n: number; youBrier: number | null; modelBrier: number | null };
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Roll a set of resolved sittings into the "you vs the desk" board. `modelFor`
 * hands back the desk's uncontaminated predictive for each sitting (from the
 * forecast register, ideally) so both sides are scored on the same realized
 * mark; return null when the desk had no call to make.
 */
export function elicitationScoreboard(
  resolved: ResolvedUpcoming[],
  modelFor: (r: ResolvedUpcoming) => StudentT | null,
): ElicitScoreboard {
  const selfYouMae: number[] = [], selfModelMae: number[] = [];
  const selfYouCrps: number[] = [], selfModelCrps: number[] = [], selfCover: number[] = [];
  const teachYouMae: number[] = [], teachModelMae: number[] = [];
  const aiYouMae: number[] = [], aiModelMae: number[] = [];
  const chipYou: number[] = [], chipModel: number[] = [];

  for (const r of resolved) {
    const y = r.realized.score;
    const model = modelFor(r);
    const sp = r.upcoming.selfPred;
    if (sp) {
      const s = scoreSelfPred(sp, y);
      selfYouMae.push(s.absError);
      if (s.covered != null) selfCover.push(s.covered);
      if (s.crps != null) selfYouCrps.push(s.crps);
      if (model) {
        selfModelMae.push(Math.abs(model.mean - y));
        selfModelCrps.push(scoreT(model, y).crps);
      }
    }
    if (r.upcoming.teacherPred != null) {
      teachYouMae.push(Math.abs(r.upcoming.teacherPred - y));
      if (model) teachModelMae.push(Math.abs(model.mean - y));
    }
    const ap = r.upcoming.aiPred;
    if (ap) {
      aiYouMae.push(Math.abs(ap.point - y));
      if (model) aiModelMae.push(Math.abs(model.mean - y));
    }
    const chips = r.upcoming.chips;
    if (chips) {
      const cs = scoreChips(chips, y);
      if (cs) {
        chipYou.push(cs.brier);
        if (model) {
          const p = modelBandPmf(model);
          const k = bandOf(y);
          chipModel.push(p.reduce((a, pj, j) => a + (pj - (j === k ? 1 : 0)) ** 2, 0));
        }
      }
    }
  }

  return {
    self: {
      n: selfYouMae.length,
      youMae: mean(selfYouMae), modelMae: mean(selfModelMae),
      youCrps: mean(selfYouCrps), modelCrps: mean(selfModelCrps),
      coverage: mean(selfCover),
    },
    teacher: {
      n: teachYouMae.length,
      youMae: mean(teachYouMae), modelMae: mean(teachModelMae),
      youCrps: null, modelCrps: null, coverage: null,
    },
    ai: {
      n: aiYouMae.length,
      youMae: mean(aiYouMae), modelMae: mean(aiModelMae),
      youCrps: null, modelCrps: null, coverage: null,
    },
    chips: { n: chipYou.length, youBrier: mean(chipYou), modelBrier: mean(chipModel) },
  };
}
