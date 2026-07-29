import type { DisruptionKind, SessionKind, SubjectMix } from "../../../types";

/**
 * Formula constants for the life-signals layer (package-local, the pool.ts
 * Z90/SELF_DF precedent): every knob a session, a night's sleep, a disruption
 * or a topic-mastery sighting turns before it reaches the channel-credibility
 * seat in ../params.ts. Nothing here claims a mechanism the literature does
 * not support at roughly this size — each constant carries its own citation
 * or its own conservatism argument.
 */

/**
 * Per-minute retention multiplier by how a study block was spent. The testing
 * effect (retrieval practice vs rereading) runs g ≈ 0.5-0.7 in the meta-
 * analytic literature, which puts active recall at roughly 1.5-2x a passive
 * reread per minute logged; a supervised class sits at the passive baseline
 * because the material is paced by someone else, not chosen by the student.
 */
export const QUALITY: Record<SessionKind, number> = {
  recall: 2.0,
  practice: 1.6,
  tutoring: 1.5,
  class: 1.0,
  reading: 0.8,
};

/**
 * Retention half-life in days, by what the material actually is. Bare
 * knowledge decays on an Ebbinghaus-shaped curve inside two weeks; a
 * procedure that has been consolidated through repeated use survives far
 * longer; a slow-built skill (the kind that takes terms, not sessions) longer
 * still. Keyed to SubjectMix so a subject's own blend sets its own decay.
 */
export const HALF_LIFE: Record<keyof SubjectMix, number> = {
  knowledge: 14,
  procedure: 45,
  skill: 120,
};

/** Half-life used when a subject has never set a mix. */
export const DEFAULT_HALF_LIFE = 45;

/**
 * The mix-weighted half-life: a log-domain blend of HALF_LIFE by the
 * subject's own knowledge/procedure/skill shares, H = exp(k·ln14 + p·ln45 +
 * s·ln120). Log-domain rather than linear because half-lives compound
 * multiplicatively, not additively — a 50/50 knowledge/skill subject decays
 * like the geometric mean of the two timescales, not their average. Falls
 * back to DEFAULT_HALF_LIFE when there is no mix (or a degenerate all-zero
 * one) to blend.
 */
export function halfLifeOf(mix: SubjectMix | null): number {
  if (!mix) return DEFAULT_HALF_LIFE;
  const { knowledge, procedure, skill } = mix;
  const total = knowledge + procedure + skill;
  if (!(total > 0)) return DEFAULT_HALF_LIFE;
  const k = knowledge / total;
  const p = procedure / total;
  const s = skill / total;
  return Math.exp(
    k * Math.log(HALF_LIFE.knowledge) + p * Math.log(HALF_LIFE.procedure) + s * Math.log(HALF_LIFE.skill),
  );
}

/** Distributed-practice bump: the previous same-subject session landed 1-7d earlier. A conservative interior value — spacing effects run larger in the lab. */
export const SPACING_RECENT = 1.15;
/** No spacing signal either way — same-day repetition. */
export const SPACING_SAME_DAY = 1.0;
/** A gap over 7 days still credits a small bump over cramming cold, short of the true spacing premium. */
export const SPACING_STALE = 1.05;

/** Below this many hours of sleep, the following day's encoding is charged as impaired. */
export const SHORT_SLEEP_H = 6.0;
/** A session logged on a night under SHORT_SLEEP_H encodes at this fraction of full credit. */
export const ENCODING_PENALTY = 0.75;

/** tanh cap, in points, on the whole hours-logged channel. Raw hours correlate weakly with outcome (r ~ 0.2) — this is a small, saturating channel, never the main event. */
export const STOCK_W = 2.0;
/** Effective-minutes floor in the tanh denominator, so a thin week does not blow the ratio up. */
export const STOCK_FLOOR = 240;

/** EWMA weight on a repeat topic sighting, folding new marks into the running mastery estimate. */
export const MASTERY_ALPHA = 0.4;
/** Savings-effect floor: at least this fraction of demonstrated mastery survives disuse rather than decaying to zero. */
export const MASTERY_FLOOR_FRAC = 0.6;
/** A careless-flagged miss reveals more underlying mastery than its mark shows — but the same slip recurs under exam pressure, so only partial credit is given back. */
export const CARELESS_CREDIT = 0.3;
/** In a cumulative subject, a topic's mastery can't sit far above the topics it depends on — this is the ceiling headroom above the weakest prerequisite. */
export const PREREQ_HEADROOM = 0.25;

/** Points weight on the mastery term — the largest single term in the layer, because it is the only *measured* signal (marked topic performance) rather than a self-report. */
export const MASTERY_W = 3.0;
/** tanh scale, in points of (100·P − modelMean), converting a mastery-vs-model gap into the mastery term's charge. */
export const MASTERY_SCALE = 8;
/** Marked topics needed before the mastery term is allowed to price at all — below this the estimate is too thin to trust. */
export const MASTERY_MIN_MARKS = 3;

/** Points charged per lost hour of recent-vs-baseline sleep (chronic short-sleep), capped at REST_CHRONIC_CAP. */
export const REST_CHRONIC_W = 0.75;
export const REST_CHRONIC_CAP = 1.5;
/** Points charged per hour of bedtime irregularity beyond ±1h sd, capped at 0.5 (folded into the same tanh as the acute/chronic terms). */
export const REST_REG_W = 0.5;
/** Points charged per hour below 6.5h the night before an assessment (acute short-sleep), capped at REST_ACUTE_CAP. */
export const REST_ACUTE_W = 0.8;
export const REST_ACUTE_CAP = 2;
/** Nights of sleep data needed before the rest channel is allowed to price. */
export const REST_MIN_NIGHTS = 7;

/** Severity multiplier by disruption kind — illness and family loss hit study capacity hardest; a one-off event or an unclassified "other" disrupt less. */
export const DISRUPT_SEV: Record<DisruptionKind, number> = {
  illness: 1.5,
  family: 1.5,
  event: 0.75,
  other: 1.0,
};
/** Exponential recovery time constant, in days, for a disruption's charge to decay back to zero. */
export const DISRUPT_TAU = 10;
/** Points cap on the disruption charge. */
export const DISRUPT_CAP = 2.5;

/** Points weight on the high-arousal Yerkes-Dodson arm only — anxiety helping on an easy paper and hurting on an unusually heavy one is asymmetric, so only the "heavy paper, high arousal" side is priced. */
export const ANX_W = 1.5;
/** Points weight on chronotype/sitting-time synchrony. Measured effects run ~0.05-0.1 sd, under a point, so this stays small. */
export const CHRONO_W = 0.75;

/** Added to the outcome sd multiplier for a low-determinism subject — loose marker judgement (vs formula marking) adds roughly 15-25% to score sd. */
export const TRAIT_MARKER_W = 0.20;
/** Added to the outcome sd multiplier for a low-breadth subject with uneven mastery — a narrow-sampling paper is luckier to sit when mastery is patchy. */
export const TRAIT_SAMPLING_W = 0.15;
/** Ceiling on the combined trait sd multiplier — traits widen a forecast, they never explode it. */
export const TRAIT_SDMULT_CAP = 1.4;

/** Points cap on the WHOLE signal-adjustment layer before the channel-credibility gate (../params.ts) scales it down — set near EFFORT_ACTUAL_W, the layer's closest sibling. After the gate the realized max is roughly ±1.4. */
export const SIGNAL_ADJ_CAP = 4;

/**
 * VOI — the value-of-information ranker (voi.ts). Every constant below is a
 * UX-facing "how much would logging this buy back" estimate for a
 * DISPLAY-ONLY panel, not a fitted model term — each carries its own
 * conservatism argument rather than a literature citation, the same
 * dispensation pool.ts's Z90/SELF_DF precedent takes for its own display
 * math. None of these feed stats.ts/aggregate.ts/the register.
 */

/** No rest logs at all, book-wide: the rest channel (REST_*) is entirely silent. A flat, modest estimate — well under REST_CHRONIC_CAP + REST_ACUTE_CAP, since an unlogged channel is a smaller certainty than a logged-but-poor one. */
export const VOI_REST_GAIN = 1.5;
/** Enough nights to clear REST_MIN_NIGHTS, a few seconds each. */
export const VOI_REST_EFFORT = 10;

/** No study sessions logged for a desk at all: the stock channel (STOCK_W's whole tanh-capped channel) is silent. */
export const VOI_SESSIONS_GAIN = 2.0;
/** A week of session logging, a couple of minutes per entry. */
export const VOI_SESSIONS_EFFORT = 15;

/** Interval-width (sd) at/above which a desk's forecast is loose enough that a topic breakdown is worth asking for — below this the desk is already tight and a breakdown buys little. */
export const VOI_TOPICS_SD_MIN = 6;
/** Per-point-of-sd coefficient on the "no topic breakdown yet, on a wide desk" gain — a coarse, conservative share of the desk's own current 90% half-width (sd · VOI_Z90) recoverable by adding structure. */
export const VOI_TOPICS_GAIN_W = 0.15;
/** Minutes to sketch a topic breakdown for one desk. */
export const VOI_TOPICS_EFFORT = 10;

/** Per-point-of-sd coefficient on the "topics exist but under MASTERY_MIN_MARKS marked" gain, saturating at VOI_MARKS_SD_SAT — the mastery term (MASTERY_W) is the largest single measured channel, so an unpriced one is the most valuable single ask on the panel. */
export const VOI_MARKS_GAIN_W = 3.0;
/** sd at/above which the marks gain saturates at full weight — same order of magnitude as MASTERY_SCALE rather than a new invented scale. */
export const VOI_MARKS_SD_SAT = 8;
/** Minutes to mark one already-sat paper up against the syllabus topic list. */
export const VOI_MARKS_EFFORT_PER = 5;

/** Per-point-of-sd coefficient on the "traits unset" gain — smaller than VOI_TOPICS_GAIN_W because an unset trait only widens the INTERVAL (traitSdMult), it never moves the mean the way a priced topic breakdown's mastery term can. */
export const VOI_TRAITS_GAIN_W = 0.2;
/** A handful of self-rating sliders. */
export const VOI_TRAITS_EFFORT = 2;

/** No chronotype/anxiety profile at all, book-wide: a flat, small estimate — the profile-gated terms (ANX_W, CHRONO_W) are each capped small and only fire near a live sitting. */
export const VOI_PROFILE_GAIN = 0.75;
/** Two sliders. */
export const VOI_PROFILE_EFFORT = 1;

/** A coarse 90%-interval z-multiplier for this display-only ranker — NOT pool.ts's precise Z90 (1.6448536269514722): a VOI estimate is a rough "how much would this buy back" heuristic, not interval math that has to land exactly. */
export const VOI_Z90 = 1.64;

/** score = gainPts / (1 + effortMin / VOI_EFFORT_SCALE) — the ranking formula's own denominator (spec-literal, not fitted). */
export const VOI_EFFORT_SCALE = 30;

/** Only the top N asks are worth a single panel's attention. */
export const VOI_TOP_N = 8;
