import type { AssessmentType } from "../../types";

/**
 * Engine version, stamped onto every forecast the register logs. Bump it on a
 * core recalibration so old forecasts are never scored against a newer model —
 * the register keys on it, and the skill baseline is version-specific.
 */
export const ENGINE_VERSION = "gx-1";

/* ── Bias register calibration ─────────────────────────────────────── */

/** Pseudo-observations shrinking the pooled GLOBAL forecast bias toward zero. */
export const BIAS_KAPPA_GLOBAL = 3;
/**
 * Pseudo-observations shrinking each PER-SUBJECT bias toward the global offset.
 * Deliberately large: a per-subject bias is barely identified from a handful of
 * resolved forecasts, so it must barely leave the pool or the register oscillates.
 */
export const BIAS_KAPPA_SUBJECT = 7;
/** Pseudo-observations shrinking the interval-WIDTH recalibration toward 1. */
export const BIAS_KAPPA_WIDTH = 4;

/**
 * Engine constants. Two per-type tables answer two different questions:
 *
 * RELIABILITY_SD — "how noisy is one reading of true ability?" Exams are the
 * cleanest single measurement (controlled conditions), quizzes the noisiest.
 * Feeds the Kalman observation model.
 *
 * SIGNAL_WEIGHT — "how much should this print move the capability price?"
 * Coursework (tests/assignments) is frequent and tracks day-to-day capability,
 * so it is weighted heavily in the recency-decayed members of the price.
 */
export const RELIABILITY_SD: Record<AssessmentType, number> = {
  Exam: 5,
  Test: 6.5,
  Assignment: 8,
  Quiz: 10,
};

export const SIGNAL_WEIGHT: Record<AssessmentType, number> = {
  Exam: 1.25,
  Test: 1.6,
  Assignment: 1.6,
  Quiz: 0.7,
};

/**
 * Per-observation reliability multipliers on the Kalman observation-noise sd.
 * An official transcript mark is measured precisely (1.0); a half-remembered or
 * estimated one is noisier and should pull the ability estimate proportionally
 * less. Absent tag ⇒ "official" ⇒ 1.0, so an untagged book is unchanged.
 */
export const RELIABILITY_MULT: Record<import("../../types").ReliabilityTag, number> = {
  official: 1.0,
  returned: 1.0,
  remembered: 1.3,
  estimated: 1.8,
  partial: 2.2,
};

/** The reliability multiplier for a tag (or 1.0 when untagged). */
export const reliabilityMult = (tag?: import("../../types").ReliabilityTag | null): number =>
  tag ? RELIABILITY_MULT[tag] : 1.0;

/**
 * Extra observation-noise widening for a boundary-censored reading (a maxed or
 * floored paper), stacked on top of the reliability multiplier. A censored mark
 * only bounds the true ability, so it should pull the level less than a clean
 * interior mark — the interim of the one-sided likelihood that reads it as a
 * true bound. Absent flag ⇒ 1.0, so an untagged book is unchanged.
 */
export const CENSORED_MULT = 1.5;

/** Random-walk ability drift, pts² per day (Kalman process noise). */
export const Q_PER_DAY = 0.06;

/**
 * Huber knee (in innovation σ) for the Kalman's robust observation noise, which
 * fires ONLY on prints flagged uncertain by their reliability tag (rMult > 1).
 * Inside ±HUBER_C the update is exactly Gaussian; past it the observation
 * variance is inflated in proportion to the standardized surprise, so a wild
 * low-reliability result is partly attributed to a measurement error instead of
 * yanking the level, and leaves more posterior uncertainty behind it.
 *
 * The reliability gate is the whole point: a shockingly-low OFFICIAL mark is
 * almost certainly real and must be written straight into the level, whereas a
 * shocking REMEMBERED/ESTIMATED one might be mis-recalled. A blanket knee, tried
 * first, lifted per-subject skill (0.27) but by holding genuine exam shocks out
 * of the level it worsened the aggregate the model is judged on (meanMae 6.12)
 * and the bias — so the gate is now the reliability signal itself. C3 is thus an
 * exact identity on an all-official book (the fixture, and §21): down-weighting
 * is licensed by the same signal that scales R. Pairs with the regime-break flag
 * (a declared level shift) without needing a hard test.
 */
export const HUBER_C = 2.0;

/**
 * Damped-trend saturation length in days (see robust.dampedDrift). The trend
 * member rides its fitted slope only for about this long past the last print
 * before the drift levels off, so a slope that fit a hot streak cannot pay out
 * forever — the structural cure for the engine's optimism. Short one-step gaps
 * are barely damped; a full rating horizon out, the extrapolation is capped.
 */
export const DRIFT_SATURATION_DAYS = 90;

/** EWMA member recency half-life. */
export const EWMA_HALF_LIFE_DAYS = 60;

/** Prior ability when the whole book is empty. */
export const PRIOR_MEAN_FALLBACK = 70;

/** Prior ability variance (15² — weak). */
export const PRIOR_VAR = 225;

/** Walk-forward validation window for ensemble weighting. */
export const LOO_WINDOW = 8;

/**
 * Predictive-dispersion markup on the blended ensemble sd. The moment-matched
 * mixture variance captures member disagreement and each member's in-sample
 * residual scatter, but not the members' own estimation uncertainty, so it runs
 * systematically too tight out-of-sample — the engine's realized 90% intervals
 * covered ~0.79, not 0.90. A sweep of this factor against walk-forward CRPS on
 * the fixture bottoms across a flat 1.1–1.3 basin (CRPS 6.82 → 6.78, coverage
 * 0.79 → 0.84); 1.15 is a conservative interior point. Widening lowers a PROPER
 * score, so the shortfall was genuine over-confidence, not lost sharpness. See
 * README §26. A later boundary-aware (censored-t) likelihood refines the shape.
 */
export const ENSEMBLE_DISPERSION = 1.15;

/**
 * SILENCE IS MEASURED IN SCHOOL DAYS (see lib/calendar.ts). A desk cannot
 * print over the summer, so the summer cannot age it — but a desk that has sat
 * out a whole term of teaching genuinely has gone quiet.
 *
 * Both windows are the old calendar-day constants converted at this school's
 * rhythm (≈55 session days to a term): 120 calendar days of free silence is
 * one term plus change, and a 60-day calendar half-life is ~35 session days.
 * Behaviour across a normal term gap is unchanged; what disappears is the book
 * ageing over holidays nobody could have printed in.
 */
export const STALE_FREE_SESSION_DAYS = 65;
export const RATING_FRESH_HALF_SESSION_DAYS = 35;

/** Pseudo-observations pulling the exam-vs-coursework offset toward 0. */
export const EXAM_OFFSET_SHRINK = 3;

/**
 * Points a one-tap difficulty moves the detrended score when NO cohort average
 * is present — a "hard" paper credits +this, an "easy" one −this. Deliberately
 * modest: a self-report is a coarse fallback for the measured class/year gap,
 * which always wins when it exists.
 */
export const DIFFICULTY_ADJ = 3;

/* ── Analyst desk ──────────────────────────────────────────────────── */

/**
 * The rating horizon is the desk's own median print gap — rate a monthly desk
 * over a month — clamped so neither a cram week nor a summer break sets it.
 */
export const HORIZON_MIN_DAYS = 14;
export const HORIZON_MAX_DAYS = 90;
export const HORIZON_FALLBACK_DAYS = 30;

/** Bühlmann credibility pseudo-prints: z̄ is trusted n/(n+κ) of the way. */
export const RATING_CREDIBILITY_K = 3;

/** HOLD half-band in z units; |z*| under this is no call at all. */
export const RATING_BAND = 0.35;

/**
 * Error-correction speed: the share of an analyst's own gap to FAIR VALUE it
 * expects to close in one horizon. The weighted gaps cancel (fair value IS the
 * weighted member mean), so this never moves the consensus — it is what makes
 * the analysts disagree with each other honestly. Measured against the mark
 * instead, the gaps would sum to the discount rather than to zero.
 */
export const ECM_ADJUSTMENT = 0.35;

/** |z*| ≥ STRONG × band is a conviction call. */
export const RATING_STRONG_MULT = 3;

/** A desk needs this many priced peers before the benchmark means anything. */
export const BENCHMARK_MIN_DESKS = 3;

/* ── Drift detector (CUSUM) ────────────────────────────────────────── */

/**
 * One-sided downward Page CUSUM on standardized walk-forward residuals.
 * The allowance k is the drift the desk is allowed for free each print; the
 * statistic alarms at h. Per-step z is winsorized so a single crash print
 * reads as a shock (the shock premium's job), never as drift.
 */
export const CUSUM_K = 0.4;
export const CUSUM_H = 2.5;
export const CUSUM_Z_CAP = 2.5;

/* ── Mark-to-market desk ───────────────────────────────────────────── */

/** Soft ceiling on the total mark-to-market discount, pts — never reached. */
export const MARK_MAX_DISCOUNT = 25;

/**
 * Loss aversion at the marking desk: an upside surprise earns this fraction
 * of what an equal downside surprise charges. Kahneman runs the risk book.
 */
export const UPSIDE_DAMP = 0.35;

/** Bühlmann pseudo-prints for the mark: thin desks are marked gently. */
export const MARK_CRED_K = 2;

/* ── Effort weighting ──────────────────────────────────────────────── */

/**
 * Points charged at TOTAL starvation (share = 0 of an even week) on each ring
 * of the effort spider — a RESOURCING premium, not an effort→grade coefficient.
 * Nothing here claims an hour buys a point; the claim is the weaker, defensible
 * one a risk desk actually makes: a desk you are visibly under-resourcing this
 * term is worth less TODAY than one you are not, and the market prices that.
 *
 * ACTUAL over PLAN, roughly 3:1. What you measured yourself doing is evidence;
 * what you meant to do is an intention, and intentions are cheap — but not free,
 * because a plan that starves a desk is the decision that produces the spend.
 * Recording actual hours therefore moves the mark HARD, which is exactly why the
 * card carries a one-tap way to clear a figure you were never really measuring
 * and a switch to take effort out of the pricing altogether.
 *
 * Both are exactly zero on a book that has filed no allocation, so the fixture,
 * §21 and the walk-forward gate are untouched by this feature's existence.
 */
export const EFFORT_ACTUAL_W = 4;
export const EFFORT_PLAN_W = 1.25;

/* ── Readiness weighting (D2 → §15c) ──────────────────────────────── */

/**
 * Points charged at a full unit of Bradley-Terry log-strength below the book's
 * middle — λ = −1, i.e. a desk you would pick against about 73% of the time.
 * Deliberately the same ceiling as the PLAN line and less than half the ACTUAL
 * one: a forced-choice gut call is a self-report, and a self-report about how
 * prepared you feel is softer evidence than hours you measured yourself keeping.
 *
 * Because λ is centred across the cross-section, this line is a TILT rather than
 * a level: what it charges one desk it credits another, up to the loss-aversion
 * damping on the credit side. The residue that damping leaves is a small charge
 * on DISPERSION — an unevenly prepared book — which is intended (§15c).
 */
export const READINESS_W = 2.5;

/**
 * Pseudo-duels holding a thin pile back. Five answers — one round of the arena —
 * buys about a third of the charge; three rounds buys two thirds. Nobody's first
 * five gut calls should move a price much.
 */
export const READINESS_DUEL_KAPPA = 8;

/**
 * Pseudo-rounds shrinking the readiness skill multiplier toward its prior. Exam
 * rounds are far scarcer than sittings, so this is small — two rounds of real
 * evidence already move the multiplier meaningfully.
 */
export const READINESS_KAPPA = 2;

/**
 * What the readiness multiplier is worth before a single round has scored it.
 *
 * Not zero, unlike the §27 pool, and the difference is the point: the pool makes
 * a FORECAST, and a forecaster with no record has earned nothing. Readiness
 * reports a STATE — how prepared you feel — which the engine already charges the
 * moment it exists everywhere else it appears (a difficulty tag, a reliability
 * tag, a plan that starves a desk). What the record buys is the right to be
 * charged more or less than this baseline.
 */
export const READINESS_PRIOR = 0.4;

/* ── The credibility pool: the desk vs the person at it ────────────── */

/**
 * Pseudo-sittings pulling the weight on YOUR call toward zero — the desk's own
 * forecast. Deliberately large against the handful of sittings a student ever
 * calls: the share your record implies is barely identified from four or five
 * papers, so it has to be earned slowly or the forecast oscillates with every
 * lucky guess. At κ = 4 a perfect record over four sittings buys half the share
 * it nominally justifies, and one sitting buys a fifth of it.
 */
export const SELF_POOL_KAPPA = 4;

/**
 * The most the student's own call can ever weigh. Capped strictly under a half
 * on purpose: a self-report is the one input in the engine the book cannot
 * audit (§23), and a forecast the student can move more than the tape can is a
 * wish with an interval around it. At the cap the desk still owns the majority
 * of every call it makes.
 */
export const SELF_POOL_CAP = 0.45;

/* ── The wire: an outside AI desk's forecasts (§29) ────────────────── */

/**
 * Pseudo-sittings pulling the wire's weight toward zero. Same κ as the self
 * pool — the identification problem is identical: a handful of resolved
 * sittings, a ratio barely pinned down, a weight that must move slowly.
 */
export const AI_POOL_KAPPA = 4;

/**
 * The most the wire's call can ever weigh — strictly below SELF_POOL_CAP. The
 * student's channel is unaudited but at least self-interested in its own book;
 * the wire is an outside desk whose model, inputs and failure modes the engine
 * cannot inspect at all. An outside forecaster earns a smaller maximum seat.
 */
export const AI_POOL_CAP = 0.35;

/**
 * Joint ceiling on the TOTAL outside seat (you + the wire). The per-channel
 * caps bind one channel at a time; two channels that each earned their cap
 * would otherwise take 80% of a call between them. When the sum exceeds the
 * ceiling both weights are scaled proportionally — each channel keeps what it
 * earned RELATIVE to the other — and the house model always keeps ≥ 40% of
 * every forecast it makes.
 */
export const POOL_CEIL = 0.6;

/* ── Market depth ──────────────────────────────────────────────────── */

/**
 * The depth fit needs enough ranked prints spread over enough reporting
 * periods to separate "the class is strong" from "the student is strong".
 * Below either threshold it declines to guess and the book stays class-only.
 */
export const DEPTH_MIN_PRINTS = 6;
export const DEPTH_MIN_GROUPS = 2;

/**
 * Ridge pseudo-observations pulling each desk's basis toward 0. This is also
 * what identifies the fit: premium and basis are otherwise collinear, and the
 * penalty is what says "attribute a common shift to the class, not the desks".
 * Without it a desk with one ranked print absorbs its whole residual.
 */
export const DEPTH_BASIS_SHRINK = 2;

/** Within-class spread never collapses below this — 36 students always differ. */
export const DEPTH_SIGMA_FLOOR = 2;

/**
 * Credibility pseudo-count for the σ_class anchor: a reported cohort SD is a
 * DIRECT measurement of the within-class spread, so it shrinks the placement-
 * inferred σ_class toward the measured value with this pseudo-weight. Small, so
 * even a couple of real measurements pull hard; zero measurements ⇒ no move.
 */
export const DEPTH_SD_ANCHOR_K = 3;

/** Order-book rung height, points. */
export const DEPTH_LADDER_STEP = 2;

/** Rungs are drawn across ±this many σ of the year-level distribution. */
export const DEPTH_LADDER_SPAN = 3;
