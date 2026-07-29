/**
 * The derivation registry.
 *
 * Every inspectable figure in the terminal maps to one id here. Builders are
 * pure and LAZY — nothing is constructed until a pointer actually rests on a
 * number — because the alternative is building thirty-five research notes per
 * desk on every render for the sake of the one a user might read.
 *
 * A builder returns null when the desk genuinely cannot support the figure.
 * Where a quantity is merely UNDEFINED (a gate that did not open, a factor
 * that declined to report) the builder should still return a derivation and
 * mark the gate failed — "why is there no number here" is the more useful
 * answer, and the one a scientific reading demands.
 */

import { bookComposite, bookForecast } from "./book";
import { chartComposite, chartMovingAvg, chartTrend } from "./chart";
import {
  depthClassZ, depthField, depthFit, depthLadder, depthPremium, depthSigma,
} from "./depth";
import { advisorPriority, ratingBenchmark, ratingConviction, ratingReturn, ratingScore, ratingTarget } from "./desk";
import {
  callScore, duelElo, earnAggregate, earnAi, earnReadiness, earnSelf, effortDrift, effortPlan, gapExam,
} from "./earned";
import { factorAlpha, factorMiss, factorRmssd, factorSemidev, factorShock } from "./factors";
import {
  elicitAi, elicitBrier, elicitCoverage, elicitCrps, elicitMae, elicitTeacher,
  skillAblation, skillBias, skillCoverage, skillCrps, skillMae,
} from "./skill";
import { markAttribution, markCusum, markDiscount, markPrice, markRegime, PREMIUM_KEYS, premium } from "./mark";
import {
  fvDetrend, fvEnsemble, fvEwma, fvInterval, fvKalman, fvP10, fvShrunk, fvTrend, fvValue,
  oracleCarry, oracleNext,
} from "./price";
import type { Derivation, DerivationBuilder, DeriveCtx } from "./types";

const BUILDERS: Record<string, DerivationBuilder> = {
  // Part I — fair value
  "fv.value": fvValue,
  "fv.ensemble": fvEnsemble,
  "fv.kalman": fvKalman,
  "fv.ewma": fvEwma,
  "fv.shrunk": fvShrunk,
  "fv.trend": fvTrend,
  "fv.interval": fvInterval,
  "fv.p10": fvP10,
  "fv.detrend": fvDetrend,
  "oracle.carry": oracleCarry,
  "oracle.next": oracleNext,

  // Part II — the mark
  "mark.price": markPrice,
  "mark.discount": markDiscount,
  "mark.attribution": markAttribution,
  "mark.regime": markRegime,
  "mark.cusum": markCusum,
  "factor.rmssd": factorRmssd,
  "factor.semidev": factorSemidev,
  "factor.shock": factorShock,
  "factor.alpha": factorAlpha,
  "factor.miss": factorMiss,

  // Part III — depth
  "depth.classz": depthClassZ,
  "depth.fit": depthFit,
  "depth.sigma": depthSigma,
  "depth.field": depthField,
  "depth.ladder": depthLadder,
  "depth.premium": depthPremium,

  // Part IV — direction and urgency
  "rating.score": ratingScore,
  "rating.return": ratingReturn,
  "rating.conviction": ratingConviction,
  "rating.benchmark": ratingBenchmark,
  "rating.target": ratingTarget,
  "advisor.priority": advisorPriority,

  // Book level
  "book.composite": bookComposite,
  "book.forecast": bookForecast,

  // Part V — D2's chart board. Only the drawn-not-printed series qualify.
  "chart.trend": chartTrend,
  "chart.ma": chartMovingAvg,
  "chart.composite": chartComposite,

  // Part VI — D5's scoreboard: the engine graded, and the student beside it.
  "skill.crps": skillCrps,
  "skill.mae": skillMae,
  "skill.bias": skillBias,
  "skill.coverage": skillCoverage,
  "skill.ablation": skillAblation,
  "elicit.mae": elicitMae,
  "elicit.crps": elicitCrps,
  "elicit.coverage": elicitCoverage,
  "elicit.brier": elicitBrier,
  "elicit.teacher": elicitTeacher,
  "elicit.ai": elicitAi,

  // Part VII — the priced elicitation channels and the planning instruments.
  "earn.self": earnSelf,
  "earn.ai": earnAi,
  "earn.readiness": earnReadiness,
  "earn.aggregate": earnAggregate,
  "call.score": callScore,
  "duel.elo": duelElo,
  "gap.exam": gapExam,
  "effort.plan": effortPlan,
  "effort.drift": effortDrift,
};

// The premium schedule is one builder parameterized by line key.
for (const key of PREMIUM_KEYS) {
  BUILDERS[`premium.${key}`] = (ctx) => premium(key, ctx);
}

/** Every registered id, sorted — the completeness tests iterate this. */
export const DERIVATION_IDS: string[] = Object.keys(BUILDERS).sort();

export const hasDerivation = (id: string): boolean => id in BUILDERS;

/**
 * Build one derivation, or null if the id is unknown or this desk cannot
 * support it. Never throws: a popover that crashes the board is worse than a
 * popover that says nothing.
 */
export function derivationFor(id: string, ctx: DeriveCtx): Derivation | null {
  const build = BUILDERS[id];
  if (!build) return null;
  try {
    return build(ctx);
  } catch {
    return null;
  }
}

export type { Derivation, DeriveCtx } from "./types";
export type { ChartFacts, EffortFacts, ScorecardFacts } from "./facts";
