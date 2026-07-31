import type { Chronotype, DisruptionKind, SessionKind, SubjectMix } from "../../../types";

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

/**
 * Weighted share of syllabus that must actually be covered by marks before the
 * mastery term prices at all. Under a third of the paper measured, the
 * whole-paper prediction is mostly the model's own call handed back to it, and
 * pricing the residue would be pricing noise.
 */
export const MASTERY_MIN_COVERAGE = 0.3;

/**
 * Marks at which the mastery term earns its full weight; below it the term is
 * scaled by totalMarks/this. Six marked topics is the point at which the EWMA
 * has seen enough of the syllabus that one unlucky paper no longer sets the
 * read.
 */
export const MASTERY_FULL_CREDIT_MARKS = 6;

/**
 * Attendance at or above this percentage is treated as full attendance and
 * charged nothing. 95 rather than 100 because ordinary illness and timetable
 * collisions cost a few percent on any real book, and a channel that charges
 * everyone is measuring the calendar, not the student. (Class attendance is
 * the strongest single behavioural correlate of grades in the meta-analytic
 * literature, which is why the channel exists at all.)
 */
export const ATTEND_FULL_PCT = 95;

/**
 * Share of the attendance shortfall treated as genuinely missed syllabus. Half
 * rather than all: a missed class is usually recoverable from notes or a peer,
 * so absence degrades coverage rather than deleting it.
 */
export const ATTEND_SHAVE_W = 0.5;

/**
 * M4 (audit Part I §4). THE layer's attendance scale — one function, one
 * owner. Attendance used to be priced two ways, roughly twentyfold apart,
 * selected by whether the desk happened to carry a topic list: a topic-bearing
 * desk shaved (95−pct)/100 · 0.5 of its covered MASS, a bare desk charged
 * (95−pct)/10 · 0.5 in POINTS. Same student, same attendance, two answers.
 *
 * Returns the share of syllabus mass the shortfall is treated as having cost,
 * in [0, ATTEND_SHAVE_W]. `masteryRead` spends it on covered mass;
 * `signalRead`'s no-topics path spends the SAME number on MASTERY_W, the point
 * weight of the channel that mass would otherwise have moved. The two paths
 * cannot be numerically identical — the topic path's effect scales with the
 * desk's own mastery-vs-model gap, which a desk with no topics has no way to
 * know — but they now derive from one scale rather than two.
 */
export function attendanceShave(attendancePct: number | null): number {
  if (attendancePct == null) return 0;
  const shortfall = (ATTEND_FULL_PCT - attendancePct) / 100;
  return Math.min(Math.max(shortfall, 0), 1) * ATTEND_SHAVE_W;
}

/**
 * Rounds the MAGNITUDE (plain Math.round, which ties toward +Infinity) and
 * reapplies the sign, rather than rounding the signed value directly — see
 * rest.ts's negRound2 for why: plain Math.round on a negative x.xx5 ties
 * toward +Infinity, which rounds a CHARGE down (e.g. -0.375 -> -0.37,
 * understating it) instead of to the nearest cent of magnitude. Also
 * normalises -0 to 0 so an untriggered sum never fails a strict `toBe(0)`.
 *
 * Owned here rather than in signalread.ts because shapley.ts rounds its
 * display cells with the SAME rule `adj` itself was rounded with — a residual
 * reallocated against a different rounding convention would not close.
 */
export const round2 = (v: number): number => {
  const r = Math.round(Math.abs(v) * 100) / 100;
  if (r === 0) return 0;
  return v < 0 ? -r : r;
};

/** Points charged per lost hour of recent-vs-baseline sleep (chronic short-sleep), capped at REST_CHRONIC_CAP. */
export const REST_CHRONIC_W = 0.75;
export const REST_CHRONIC_CAP = 1.5;
/** Points charged per hour of bedtime irregularity beyond ±1h sd, capped at 0.5 (folded into the same tanh as the acute/chronic terms). */
export const REST_REG_W = 0.5;
/** Points charged per hour below SHORT_SLEEP_H the night before an assessment (acute short-sleep), capped at REST_ACUTE_CAP. */
export const REST_ACUTE_W = 0.8;
export const REST_ACUTE_CAP = 2;
/** Nights of sleep data needed before the rest channel is allowed to price. */
export const REST_MIN_NIGHTS = 7;

/**
 * Ceiling, in hours, on the recent-vs-baseline sleep loss the chronic term
 * will price. A 2h drop against your own 42-night baseline is already an
 * extreme reading; past that the self-report is more likely a change in how
 * the student logs than a change in how they sleep, so the charge saturates
 * rather than scaling on.
 */
export const REST_CHRONIC_MAX_LOSS_H = 2;

/**
 * Bedtime-irregularity free band, in minutes of sd. Under an hour of
 * night-to-night variation is ordinary life, not a disrupted rhythm, and is
 * charged nothing.
 */
export const REST_REG_FREE_SD_MIN = 60;

/**
 * Minutes of sd beyond the free band at which the irregularity charge reaches
 * its full REST_REG_W. Equal to the free band, so the ramp is
 * (regSd − 60)/60 clamped to [0,1] and 2h of sd is the saturating case.
 */
export const REST_REG_SPAN_MIN = 60;

/** Severity multiplier by disruption kind — illness and family loss hit study capacity hardest; a one-off event or an unclassified "other" disrupt less. */
export const DISRUPT_SEV: Record<DisruptionKind, number> = {
  illness: 1.5,
  family: 1.5,
  event: 0.75,
  other: 1.0,
};
/** Duration credit floor: even a single-day disruption carries this share of its kind's severity. */
export const DISRUPT_DUR_BASE = 0.5;
/** Duration credit earned linearly from one day up to DISRUPT_DUR_FULL_DAYS. */
export const DISRUPT_DUR_SPAN = 0.5;
/** Days of duration at which the credit saturates — a month-long disruption is not four times a week-long one. */
export const DISRUPT_DUR_FULL_DAYS = 7;
/** Exponential recovery time constant, in days, for a disruption's charge to decay back to zero. */
export const DISRUPT_TAU = 10;
/** Points cap on the disruption charge. */
export const DISRUPT_CAP = 2.5;

/**
 * Points weight on the anxiety term. M7 (audit Part I §4): this is the
 * ATTENTIONAL-CONTROL / processing-efficiency account (Eysenck, Derakshan,
 * Santos & Calvo 2007), not the arousal inverted-U the comment here used to
 * claim. The term multiplies trait anxiety by relative STAKES — `worthPct` is
 * a paper's share of the grade, not its cognitive load — and attentional
 * control theory is exactly the account under which evaluative pressure, not
 * arousal per se, consumes the working-memory resources a hard paper needs.
 *
 * One-sided on purpose: a heavier-than-typical paper charges a self-reported
 * anxious student and an easier one never credits them, because worry impairs
 * efficiency without a symmetric facilitation on the low-stakes side. An
 * arousal account would have to credit that side; this term does not, which is
 * the clearest sign it was never the arousal account in the first place.
 */
export const ANX_W = 1.5;
/** Midpoint of the 1-5 test-anxiety self-rating: at or below it the term is silent. */
export const ANX_MID = 3;
/** Rating points above ANX_MID at which the anxiety scaler reaches 1.0 (i.e. a stated 5). */
export const ANX_SPAN = 2;

/** Points weight on chronotype/sitting-time synchrony. Measured effects run ~0.05-0.1 sd, under a point, so this stays small. */
export const CHRONO_W = 0.75;

/**
 * M6 (audit Part I §4). Peak hour of day by self-reported chronotype — the
 * hour at which the synchrony effect is nil and the charge is zero. Larks peak
 * mid-morning, owls mid-to-late afternoon, and the charge grows smoothly with
 * distance from that hour in EITHER direction, since the synchrony literature
 * reports off-peak testing costing performance whichever side of the peak it
 * falls on.
 *
 * This replaces a CLIFF: the term used to charge an owl the full CHRONO_W for
 * a sitting at or before 9am and exactly nothing at 10am, so a one-hour
 * timetable change swung an entire channel.
 *
 * The old owl-full / lark-half asymmetry is DROPPED rather than kept: no cited
 * argument supported charging larks half, and the same literature reports the
 * effect in both directions. Note also that `Profile.chronotype` is a bare
 * category with no strength field, so the charge cannot be scaled by how
 * strongly the student holds the self-report — only by how far the sitting
 * sits from the peak. That is a data-model limit, stated here rather than left
 * for a reader to wonder about.
 */
export const CHRONO_PEAK_HOUR: Record<Chronotype, number> = {
  lark: 9,
  owl: 16,
};

/**
 * Hours of misalignment at which the chronotype charge reaches tanh(1) = 0.76
 * of CHRONO_W. Six hours is roughly half a school day: a sitting half a day
 * away from your own peak is as mistimed as a timetable can make it, and the
 * tanh saturates rather than running on past that.
 */
export const CHRONO_TAPER_H = 6;


/** Added to the outcome sd multiplier for a low-determinism subject — loose marker judgement (vs formula marking) adds roughly 15-25% to score sd. */
export const TRAIT_MARKER_W = 0.20;
/** Added to the outcome sd multiplier for a low-breadth subject with uneven mastery — a narrow-sampling paper is luckier to sit when mastery is patchy. */
export const TRAIT_SAMPLING_W = 0.15;
/** Ceiling on the combined trait sd multiplier — traits widen a forecast, they never explode it. */
export const TRAIT_SDMULT_CAP = 1.4;

/** Share of a subject's marks carrying a "time" error kind before the time-pressure nudge fires. */
export const TRAIT_TIME_MIN_SHARE = 0.25;
/** Flat sd-multiplier nudge for a time-pressured desk. Small: one self-classified error kind is a hint, not a measurement. */
export const TRAIT_TIME_W = 0.05;
/** Stated belief (1-5) at or below which the low-confidence nudge fires. */
export const TRAIT_BELIEF_MAX = 2;
/** Flat sd-multiplier nudge for a stated low belief. Same size as TRAIT_TIME_W and for the same reason. */
export const TRAIT_BELIEF_W = 0.05;

/** Points cap on the WHOLE signal-adjustment layer before the channel-credibility gate (../params.ts) scales it down — set near EFFORT_ACTUAL_W, the layer's closest sibling. After the gate the realized max is roughly ±1.4. */
export const SIGNAL_ADJ_CAP = 4;

/**
 * Display/notes floor, in points: a contribution under this magnitude is
 * noise, not a reason — never shown, never counted toward `terms`/`reasons`.
 * One owner, because signalread.ts and disrupt.ts each used to carry their own
 * private copy of the same 0.05.
 */
export const SIGNAL_NOTE_FLOOR = 0.05;

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
