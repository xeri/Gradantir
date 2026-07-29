export type AssessmentType = "Exam" | "Test" | "Assignment" | "Quiz";

/**
 * How the score was obtained — a per-observation reliability tag. It scales the
 * Kalman's observation noise per datum: an official transcript mark is measured
 * precisely, a half-remembered one barely at all, so it should pull the ability
 * estimate proportionally. Absent means "official" (today's behaviour).
 */
export type ReliabilityTag = "official" | "returned" | "remembered" | "estimated" | "partial";

/** How results are bucketed along the x-axis. */
export type PeriodMode = "assessment" | "month" | "term" | "semester" | "year";
export type GroupPeriod = Exclude<PeriodMode, "assessment">;

/** What a logged study block was spent doing — which activities correlate with gains. */
export type SessionKind = "recall" | "practice" | "reading" | "class" | "tutoring";

/** The kind of mistake behind a lost mark — a TopicMark's own diagnosis. */
export type ErrorKind = "careless" | "conceptual" | "procedural" | "time";

/** What took a stretch of days off the normal routine. */
export type DisruptionKind = "illness" | "family" | "event" | "other";

/** Which end of the day the student runs strongest — self-reported once. */
export type Chronotype = "lark" | "owl";

/**
 * Shape priors for how a subject's OWN material behaves, each 0–1 — not a
 * reading on the student, a reading on the desk.
 */
export interface SubjectTraits {
  /** How much a result depends on everything before it (a language vs a one-off unit). */
  cumulativeness: number;
  /** How mechanically gradable the material is (formula marking vs a judged essay). */
  determinism: number;
  /** How much of the syllabus a single assessment can cover. */
  breadth: number;
}

/** What kind of work a subject actually tests — sums to 1. */
export interface SubjectMix {
  knowledge: number;
  procedure: number;
  skill: number;
}

export interface Subject {
  id: string;
  name: string;
  ticker: string;
  color: string;
  /** Desired term average in %, or null when unset. */
  target: number | null;
  /** Soft-delisted: hidden from every board but data retained; restorable. */
  archived?: boolean;
  /**
   * The desk this one descends from — a rename (Science → Physics) or a split
   * (Business & Economics → Business + Economics). The ancestor keeps the
   * prints; this desk carries only what it reported under its own name. See
   * `lib/lineage.ts` for why the history is referenced and never copied.
   */
  formerly?: string | null;
  /**
   * Coursework share of the FINAL GRADE, 0–100. null/0 means coursework
   * contributes nothing to the grade — it is only a capability signal.
   */
  courseworkPct?: number | null;
  /**
   * Shape priors for how this subject's OWN material behaves — set once,
   * rarely revisited. Not a reading on the student; a reading on the desk.
   */
  traits?: SubjectTraits | null;
  /** What kind of work this subject actually tests, as a mix summing to 1. */
  mix?: SubjectMix | null;
  /** Self-rated confidence in current standing, 1 (worst) – 5 (best). */
  belief?: number | null;
  /** Attendance rate for this subject, 0–100%. */
  attendancePct?: number | null;
}

export interface GradeEntry {
  id: string;
  subjectId: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  type: AssessmentType;
  /** 0–100. */
  score: number;
  title: string;
  /** Optional class average for the same assessment — enables alpha stats. */
  classAvg?: number | null;
  /** Optional year-level average — difficulty detrending across classes. */
  yearAvg?: number | null;
  /** Placement in the cohort, 1 = top. Only meaningful with cohortN. */
  rank?: number | null;
  /** Cohort size for rank ("out of how many"). */
  cohortN?: number | null;
  /**
   * Whether `rank`/`cohortN` are measured within the CLASS or the whole YEAR
   * level. Absent = "class" (today's assumption). A year-scoped placement is
   * already a field position, so it skips the class→field inflation and does not
   * feed the class-strength (premium/basis) fit.
   */
  rankScope?: "class" | "year" | null;
  /**
   * The spread (standard deviation) of marks in the cohort for this assessment,
   * points. A DIRECT reading of the within-class σ the depth model otherwise has
   * to infer from placements — so when present it anchors σ_class. Absent = infer
   * it as before.
   */
  cohortSD?: number | null;
  /**
   * One-tap perceived difficulty of the paper. A fallback difficulty signal used
   * ONLY when no cohort average is on the print: a brutal paper means the raw
   * score understates ability (credit it up), an easy one overstates it. When a
   * class/year average exists that measured signal wins and this is ignored.
   * Absent/"normal" = no adjustment.
   */
  difficulty?: "easy" | "normal" | "hard" | null;
  /** This result's share of the final grade, % (0–100]. Overrides the courseworkPct blend. */
  worthPct?: number | null;
  /**
   * How this score was obtained. Scales the Kalman observation noise per datum;
   * absent = "official". A less-reliable reading moves the ability estimate less.
   */
  reliability?: ReliabilityTag | null;
  /**
   * The result sat against a boundary — a mark at/near the ceiling (or floor)
   * where the true ability is only bounded, not measured. It widens this datum's
   * observation noise so a maxed paper pulls the level less; the boundary-aware
   * likelihood that reads it as a one-sided bound is a later refinement. Absent
   * = an ordinary, fully-observed mark.
   */
  censored?: boolean | null;
  /**
   * A structural break took effect at this print — a new teacher, class set,
   * syllabus or cohort. Everything the desk printed BEFORE it belongs to a
   * different process, so the engine fits only from the most recent break
   * onward: the level re-anchors and the shorter tape honestly widens the band.
   * Absent = business as usual, and the whole tape is one regime.
   */
  regimeBreak?: boolean | null;
  /**
   * Which term this result REPORTS ON, e.g. "2026-T1" — set only when the
   * filing was overridden by hand. Absent means "follow the date", which the
   * school calendar answers correctly for every ordinary round; the override
   * exists because no calendar survives a school that moves an exam.
   */
  term?: string | null;
}

/**
 * Cohort geometry — the only school-specific facts in the engine, and all of
 * them adjustable. The defaults assert nothing: one class per year level and
 * zero streaming means "the class IS the field", which reproduces the plain
 * placement percentile exactly.
 */
export interface DepthSettings {
  /** Parallel classes at the year level. */
  streamsPerLevel: number;
  /** Students at the year level; null derives it from streams × cohort size. */
  yearSize: number | null;
  /** 0 = classes are random slices of the year, 1 = perfectly streamed. */
  streamTightness: number;
}

export interface Settings {
  /** Per-type multiplier applied to averages when `weighted` is on. */
  weights: Record<AssessmentType, number>;
  weighted: boolean;
  depth: DepthSettings;
  /**
   * The school's published term dates. Every term, tape and index times itself
   * off this — see `lib/calendar.ts` for the two clocks it runs.
   */
  calendar: import("./lib/calendar").SchoolCalendar;
  /**
   * Split suggestions the student has waved off, by `SplitPlan.key`. A "keep
   * both" is an answer, not a snooze — the book must not re-ask every load.
   */
  ignoredSplits?: string[];
  /**
   * Subject-affinity prior: one hand-set equicorrelation ρ ∈ [0, 1) across the
   * desks, used only to widen the aggregate PREDICTION/COMPOSITE bands beyond
   * independence (a bad term tends to hit every desk). It cannot be fitted from
   * one student's book, so it is a prior the user chooses; absent/0 = today's
   * quadrature. See `aggregate.correlatedSumSd`.
   */
  subjectCorr?: number;
  /**
   * Whether the effort budget (D1) is priced into the mark at all — the switch
   * on the EFFORT BUDGET card. Absent ⇒ ON, since a book with no allocation
   * filed is unaffected either way; setting it to `false` takes both effort
   * premia out of every mark without touching the plan you drew.
   */
  effortWeighting?: boolean;
  /**
   * Whether the next-exam call pools in YOUR own prediction for the sitting,
   * weighted by how the two of you have actually scored against each other
   * (§27). Absent ⇒ ON, and it is the identity until you have called a sitting
   * the desk also called — the weight is earned, never assumed. `false` keeps
   * every forecast the desk's own work.
   */
  selfWeighting?: boolean;
  /**
   * Whether the forced-choice readiness pile (D2) is priced into the mark at all
   * — the switch on the READINESS DUELS card. Absent ⇒ ON, since a book that has
   * never duelled is unaffected either way; `false` takes the readiness line out
   * of every mark without dropping a single duel. See §15c.
   */
  readinessWeighting?: boolean;
  /**
   * Whether your elicited aggregate call (D4) is pooled into the book-level
   * forward AGGREGATE — the switch on the AGGREGATE CALL card. Absent ⇒ ON, and
   * it is the identity until you have logged a call for the pending round and
   * scored at least one before it. Never touches a per-desk mark. See §28.
   */
  aggregateCallWeighting?: boolean;
  /**
   * Whether the wire's AI forecasts (§29) are pooled into the next-exam call.
   * The INVERSE of the other switches: absent ⇒ OFF, stored only when `true`.
   * The other channels default on because they are the student's own inputs and
   * the identity until elicited; an outside desk's forecasts must never start
   * pricing themselves into an old book that was exported before the switch
   * existed. Even on, the weight is earned, capped and jointly ceilinged.
   */
  aiWeighting?: boolean;
  /**
   * Whether the life-signals inputs (topics, study sessions, rest,
   * disruptions) are priced into the mark at all — the switch on the LIFE
   * SIGNALS card. Follows the other student-input switches' polarity: absent
   * ⇒ ON, since a book with nothing logged is unaffected either way; `false`
   * takes every signal out of every mark without deleting a single log.
   */
  signalWeighting?: boolean;
  /** Person-level self-reported traits, not tied to any one subject. */
  profile?: Profile | null;
}

/** Person-level self-reported traits — set once, not tied to any one subject. */
export interface Profile {
  chronotype?: Chronotype | null;
  /** 1 (calm) – 5 (high anxiety) self-rating. */
  testAnxiety?: number | null;
}

/**
 * One forecast in the bias register — a MODEL OUTPUT, and therefore never
 * stored. The register is rebuilt from the tape on every load by walk-forward
 * replay (`quant/eval/replay.ts`): for each exam round the engine is refit on
 * strictly-earlier prints and asked for its call, which is then scored against
 * what the round printed. The running error feeds the shrunk-hierarchical bias
 * correction, and the same as-of calls are what the elicitation channels score
 * themselves against. The id is a DETERMINISTIC composite
 * (`subjectId|roundKey|target|modelVersion`), so the replay is idempotent and
 * two runs over the same book agree exactly.
 */
export interface ForecastLog {
  id: string;
  subjectId: string;
  /** Term key of the TARGET round, e.g. "2026-T2". */
  roundKey: string;
  target: "exam" | "price";
  /** ISO date the forecast was made — the passed-in "now", never a live clock. */
  createdAt: string;
  modelVersion: string;
  point: number;
  sd: number;
  df: number;
  ci90: Interval;
  /** Resolution — recomputed from the current entries each reconcile pass. */
  resolvedEntryId?: string | null;
  resolvedAt?: string | null;
  realized?: number | null;
  /** point − realized: a persistent positive mean is optimism. */
  error?: number | null;
  crps?: number | null;
  is90?: number | null;
}

/**
 * The student's own pre-sitting call, elicited before a paper is sat. A point,
 * optionally bracketed by a self-assessed 90% range — the metacognition tap that
 * the post-mortem flagged as a real, unrecovered information channel. Scored
 * against the realized mark and the model side by side ("you vs the desk").
 */
export interface SelfPrediction {
  /** The mark you expect, 0–100. */
  point: number;
  /** Low end of your 90% range, if you gave one. */
  lo?: number | null;
  /** High end of your 90% range. */
  hi?: number | null;
}

/**
 * The wire's forecast for a sitting — filed by an OUTSIDE AI desk through the
 * intake prompt (§29), never typed by the student. Scored beside your call and
 * the teacher's, and — unlike either — priceable: with the `aiWeighting` switch
 * on it buys a seat in the next-exam pool at a weight its record has EARNED,
 * capped on its own and again jointly with yours. It carries its stated
 * rationale so the terminal can show why the wire called what it called.
 */
export interface AiPrediction {
  /** The mark the AI expects, 0–100. */
  point: number;
  /** Low end of its stated 90% range, if it gave one. */
  lo?: number | null;
  /** High end of its stated 90% range. */
  hi?: number | null;
  /** ≤160-char stated rationale — evidence for the call, not decoration. */
  basis?: string | null;
}

/**
 * A score-less FUTURE assessment — the forward calendar. It names a paper you
 * are about to sit and carries every elicitation made ahead of it: your own
 * prediction, a teacher's, a chip-staked distribution, how much syllabus you
 * have covered. Once the paper is sat and its real GradeEntry logged, the
 * register matches the two and scores the calls; the sitting is kept (not
 * deleted) so the calibration record survives. Absent = an empty calendar,
 * today's behaviour.
 */
export interface Upcoming {
  id: string;
  subjectId: string;
  /** ISO date the paper is sat, YYYY-MM-DD. */
  date: string;
  type: AssessmentType;
  title: string;
  /** Share of the final grade this paper carries, % (0–100]. */
  weight?: number | null;
  /** How much of the assessed syllabus you have covered, 0–100. */
  syllabusCoverage?: number | null;
  /** Your own pre-sitting forecast — a point, optionally with a 90% range. */
  selfPred?: SelfPrediction | null;
  /** A second forecaster's mark: a teacher's or tutor's predicted grade. */
  teacherPred?: number | null;
  /**
   * A staked distribution over score bands (D3): STAKE_CHIPS chips laid across
   * the bands, read as your subjective probability and scored by a proper rule.
   */
  chips?: number[] | null;
  /** The wire's call on this sitting — AI-authored, read-only in the app. */
  aiPred?: AiPrediction | null;
  /** Hour of day the paper starts, 0–23 — feeds chronotype-aware readiness. */
  hour?: number | null;
}

/**
 * A fixed-sum effort budget for a period: STAKE-free tokens spread across the
 * live desks, capturing PLANNED intent and, once the period closes, the ACTUAL
 * split you recall. The planned−actual gap is a person-stable calibration
 * constant, not a causal effort→grade claim. Keyed on the reporting term.
 */
export interface Allocation {
  id: string;
  /** Reporting term this budget is for, e.g. "2026-T2". */
  roundKey: string;
  /** Total tokens to spread — the fixed sum. */
  total: number;
  /**
   * The weekly study hours the whole budget stands for — the ruler the token
   * split is read against, so a share can be quoted as "6.5 h/wk". One scalar
   * for the week; the per-desk hours fall out of `planned`. Absent on plans
   * filed before the budget was expressed in real time.
   */
  hoursPerWeek?: number;
  /** Planned tokens per subject id. Sums to `total`. */
  planned: Record<string, number>;
  /** Actual tokens per subject id, filled in after the fact. Empty until then. */
  actual?: Record<string, number> | null;
  createdAt: string;
}

/**
 * One forced-choice readiness duel: "more ready for A or B?". Pairwise, so it is
 * free of the scale bias a 1–10 rating carries. A pile of these fits a
 * Bradley-Terry / Elo readiness ranking to compare against the model's.
 */
export interface Duel {
  id: string;
  /** The two desks compared. */
  aId: string;
  bId: string;
  /** Which won the duel: the more-ready desk's id. */
  winnerId: string;
  createdAt: string;
}

/**
 * An elicited call on the AGGREGATE — the level the engine actually has skill
 * at. A predicted overall exam average for a round, plus a forced ranking of the
 * desks strongest→weakest. Scored on the average's error and the ranking's rank
 * correlation once the round lands.
 */
export interface MeanCall {
  id: string;
  /** Reporting term this call is for. */
  roundKey: string;
  /** Predicted overall exam average, 0–100. */
  predAvg: number;
  /** Subject ids ranked strongest→weakest. */
  ranking: string[];
  createdAt: string;
}

/**
 * One syllabus topic within a subject — the unit the life signals below are
 * actually measured against, finer than the subject itself.
 */
export interface Topic {
  id: string;
  subjectId: string;
  name: string;
  /** Share of assessed syllabus this topic carries, %; absent => equal weight. */
  weightPct?: number | null;
  /** Topics inside the SAME subject this one depends on — a prerequisite chain. */
  prereqIds?: string[];
}

/**
 * A per-topic breakdown of one GradeEntry's score — how a paper's marks split
 * across syllabus topics, and optionally why marks were lost. Carries a dual
 * foreign key (`entryId`, `topicId`): the sanitizer drops any row where the
 * two disagree on subject, so a mark can never silently attach a topic from
 * one desk to a paper sat on another.
 */
export interface TopicMark {
  id: string;
  entryId: string;
  topicId: string;
  /** 0–100 on this topic's share of that paper. */
  scorePct: number;
  maxMarks?: number | null;
  errorKind?: ErrorKind | null;
}

/** One logged block of study time. */
export interface StudySession {
  id: string;
  subjectId: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  minutes: number;
  kind: SessionKind;
  /** Topics this block covered, when the student can say. */
  topicIds?: string[];
}

/** One night's sleep, self-logged. */
export interface RestLog {
  id: string;
  /** ISO date, YYYY-MM-DD — the night this reading is FOR. */
  date: string;
  hours: number;
  /** "HH:MM" as the sleep export states it. */
  bedtime?: string | null;
}

/** A stretch of days that took the student off their normal routine. */
export interface Disruption {
  id: string;
  date: string;
  /** How many days it ran, from `date`. */
  days?: number | null;
  kind: DisruptionKind;
  note?: string | null;
}

/**
 * The book: everything the student told the exchange, and nothing it computed.
 *
 * The forecast/bias register used to live here too. It does not any more — it is
 * derived state, and derived state stored beside evidence rots (see
 * `quant/eval/replay.ts`). Every prediction, price, score and calibration on
 * every board is recalculated from these fields on load.
 */
export interface AppData {
  subjects: Subject[];
  entries: GradeEntry[];
  settings: Settings;
  /** True while the seeded demo book is loaded. */
  sample: boolean;
  /** The forward calendar: score-less future sittings and their elicitations. */
  upcoming?: Upcoming[];
  /** Effort budgets, one per reporting term. */
  allocations?: Allocation[];
  /** Forced-choice readiness duels — the raw pairwise comparisons. */
  duels?: Duel[];
  /** Elicited aggregate calls: predicted overall average + forced ranking. */
  meanCalls?: MeanCall[];
  /** Syllabus topics within each subject — the unit study and marks are tracked against. */
  topics?: Topic[];
  /** Per-topic breakdowns of graded results. */
  topicMarks?: TopicMark[];
  /** Logged study blocks. */
  sessions?: StudySession[];
  /** Logged nights of sleep. */
  rest?: RestLog[];
  /** Logged disruptions to the normal routine. */
  disruptions?: Disruption[];
}

export interface Forecast {
  /** Predicted next score. */
  pred: number;
  /** Residual std deviation — the honest ± band. */
  sigma: number;
  /** Points gained/lost per assessment on the trend line. */
  slope: number;
}

export type VolatilityLabel = "Steady" | "Variable" | "Volatile";

/** Everything the UI needs to know about one subject, precomputed. */
export interface SubjectStat {
  sub: Subject;
  /**
   * The desk's full LINEAGE tape, sorted by date ascending: its own prints
   * preceded by every ancestor's. Identical to `own` for a desk that never
   * split. Every per-desk figure on this row is computed from it.
   */
  entries: GradeEntry[];
  /**
   * What this desk reported under its OWN name — `entries` minus anything it
   * inherited. Only for callers that must distinguish the two; note that
   * `examAggregate` dedupes on print identity rather than relying on this.
   */
  own: GradeEntry[];
  scores: number[];
  latest: GradeEntry | null;
  /** Latest score minus the one before it. */
  tickDelta: number | null;
  overallAvg: number | null;
  curAvg: number | null;
  prevAvg: number | null;
  /** Current term average minus previous term average. */
  periodDelta: number | null;
  curCount: number;
  /** Std deviation of the last 10 scores. */
  sd: number;
  volatility: VolatilityLabel;
  forecast: Forecast | null;
  ath: number | null;
  athDate: string | null;
  atl: number | null;
  /** Latest score minus all-time high (≤ 0). */
  fromAth: number | null;
  /**
   * Mean of (score − reference) over prints that carry one. Prefers the class
   * average; falls back to the year-level average, which is all most school
   * reports publish.
   */
  alpha: number | null;
  alphaCount: number;
  /** Which average alpha was measured against — the UI labels it. */
  alphaRef: "class" | "year" | null;
  curLabel: string;
  prevLabel: string;
  /** Quant engine output — null when the subject has no prints. */
  quant: PriceResult | null;
  /** Price move caused by the latest print (price now − price without it). */
  priceDelta: number | null;
  /** Final-grade projection honoring courseworkPct / worthPct. */
  gradeProj: GradeProjection;
  /** Year-level percentile from the depth model — the honest one. */
  percentile: number | null;
  percentileCount: number;
  /** Mean Hazen percentile inside the class — what the reports literally say. */
  classPercentile: number | null;
  /** Market depth: the field behind the class. Null without placements. */
  depth: SubjectDepth | null;
  /** Days since the last print. */
  staleDays: number | null;
  /** Analyst-desk consensus rating. */
  rating: RatingResult;
  /** The rating that stood before the latest print — the source of upgrades. */
  ratingPrev: Rating | null;
}

/* ── Quant engine outputs ─────────────────────────────────────────── */

export interface Interval {
  lo: number;
  hi: number;
}

/** Next-exam projection: capability plus the shrunk exam-vs-coursework offset. */
export interface NextExamForecast {
  mean: number;
  sd: number;
  ci50: Interval;
  ci90: Interval;
}

/** One ensemble member's view of the desk, today and at the rating horizon. */
export interface ForwardView {
  name: string;
  /** Walk-forward blend weight, 0–1. */
  weight: number;
  /** The member's own estimate today — the anchor its drift is measured from. */
  now: number;
  /** The same member one horizon out. */
  mean: number;
  sd: number;
}

/**
 * Pricing regime, from the size of the mark-to-market discount. An active
 * drift alarm forces at least STRESSED regardless of the discount.
 */
export type Regime = "PRIME" | "STABLE" | "STRESSED" | "DISTRESSED";

/** One line of the mark-to-market waterfall. Negative pts is a credit. */
export interface PremiumLine {
  key: string;
  label: string;
  /** Points charged against fair value (after shrink/attribution). */
  pts: number;
  /** Terminal-speak evidence for the charge. */
  note: string;
}

/** The engine's full read on one subject. */
export interface PriceResult {
  /** 0–100 MARK — fair value minus the risk discount. THE ticker number. */
  price: number;
  /** Fair value the mark discounts from (the neutral ensemble estimate). */
  fv: number;
  /** fv − price, ≥ 0. */
  discount: number;
  /** Waterfall attribution, harshest first; credits (negative) last. */
  premia: PremiumLine[];
  regime: Regime;
  sd: number;
  /** Student-t degrees of freedom behind the intervals (fat at small n). */
  df: number;
  ci50: Interval;
  ci90: Interval;
  /** 10th-percentile downside outcome. */
  p10: number;
  lastExamPct: number | null;
  lastExamDate: string | null;
  /** Price repriced without the latest print — the source of priceDelta. */
  prevPrice: number | null;
  nextExam: NextExamForecast;
  /** Ensemble member weights (%), for transparency in the UI. */
  weights: Record<string, number>;
  /** Rating horizon in days — the desk's own median print gap, clamped. */
  horizonDays: number;
  /**
   * Exam carry: what the next exam is expected to print over fair value
   * (`nextExam.mean − fv`). This is the return the analyst desk earns simply
   * because the next print is an exam. It is NOT δ̂ — δ̂ is the coursework→exam
   * bridge that the oracle crosses once, and it lives on `trace.price.offset`.
   */
  carry: number;
  /** The same carry without the latest print. */
  prevCarry: number | null;
  /** Each member's forecast at today + horizonDays. */
  forward: ForwardView[];
  /** The same views without the latest print — the source of rating changes. */
  prevForward: ForwardView[] | null;
  /**
   * The engine's working — every intermediate the derivation layer quotes.
   * Optional: nothing in the pricing path reads it, and a hand-built
   * PriceResult in a test need not supply it.
   */
  trace?: import("./lib/quant/trace").QuantTrace;
}

/* ── The analyst desk ─────────────────────────────────────────────── */

export type Rating = "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL" | "N/A";

/** One ensemble member's published view, rated on its own. */
export interface AnalystView {
  name: string;
  /** Blend weight as a percentage — how loud this analyst is. */
  weight: number;
  /** Its expected total return over the horizon, points. */
  ret: number;
  /** Price target: the price plus that return. */
  target: number;
  /** Risk-adjusted excess over the book. */
  z: number;
  rating: Rating;
}

/** The consensus read on one desk. */
export interface RatingResult {
  rating: Rating;
  /** Consensus z*, after credibility and staleness shrinkage. */
  score: number;
  /** P(the call has the right sign), 0–100. */
  conviction: number;
  /** Consensus price target, null when uncovered. */
  target: number | null;
  targetLo: number | null;
  targetHi: number | null;
  /** Consensus target vs the current price, %. */
  upside: number | null;
  horizon: number;
  /** Expected total return over the horizon: drift + exam carry, points. */
  expected: number;
  /** The book's own expected return over the same horizon — what to beat. */
  benchmark: number;
  /** Weighted sd of the analyst returns — disagreement, points. */
  dispersion: number;
  /** Risk the excess is divided by: √(q·H + D²/nₑff). */
  risk: number;
  /** HOLD half-band in z units. */
  band: number;
  views: AnalystView[];
  /** Head-count per rating across the views. */
  distribution: Record<Rating, number>;
  /** Terminal-speak footnote: why the rating is what it is. */
  note: string;
}

export type GradeProjectionMode = "exam-only" | "blend" | "worth";

/** Final-grade projection honoring courseworkPct / per-result worthPct. */
export interface GradeProjection {
  grade: number | null;
  mode: GradeProjectionMode;
  courseworkAvg: number | null;
  examAvg: number | null;
  /** Σ worthPct covered when mode is "worth". */
  worthCoverage: number | null;
}

/**
 * THE AGGREGATE: every desk's last exam, summed. No model, no prediction —
 * what the exams actually printed, out of 100 per reporting desk.
 */
export interface ExamAggregate {
  sum: number;
  outOf: number;
  count: number;
  /** sum / outOf × 100 — the headline percentage. */
  pct: number;
  /** Sum move vs the prior exam round, desks holding two exams only. */
  delta: number | null;
  pctDelta: number | null;
  /** Desks with an exam on file, out of every listed desk. */
  reported: number;
  listed: number;
  /** Newest exam date on the book. */
  asOf: string | null;
  perSubject: { id: string; ticker: string; color: string; score: number; date: string; share: number }[];
}

/** The AGGREGATE's forward twin: the next exam round, priced by the oracle. */
export interface AggregateForecast {
  sum: number;
  outOf: number;
  count: number;
  pct: number;
  sd: number;
  ci90: Interval;
  /** Forecast pct − realized pct, over desks present in both. */
  vsLast: number | null;
}

/**
 * GX COMPOSITE: the scaled capability index — every priced desk's model price,
 * averaged. The book's headline number when you ask "what am I worth now?".
 */
export interface CompositeIndex {
  /** Mean price across priced desks, 0–100. */
  value: number | null;
  /** Mean price move vs the previous term, common desks only. */
  delta: number | null;
  sum: number;
  outOf: number;
  count: number;
  sd: number;
  ci90: Interval;
  perSubject: { id: string; ticker: string; color: string; price: number; share: number }[];
}

export interface AggregatePoint {
  key: string;
  /** The round's own name — "MID 25" — falling back to the term label. */
  label: string;
  sum: number;
  outOf: number;
  /** sum / outOf × 100 — every consumer plots this. */
  pct: number;
  /** The day the point was struck: the round's last print, or today when live. */
  date: string;
  /** True for the trailing mark-to-today point — a price, not a printed round. */
  live?: boolean;
}

/* ── Market depth ─────────────────────────────────────────────────── */

/** One reporting period's class, as fitted. */
export interface DepthGroup {
  key: string;
  label: string;
  /** Class mean − year mean, points. THE peer premium. */
  premium: number;
  /** Ranked prints behind this group's fit. */
  n: number;
}

/** The book-wide depth fit — a property of the book, not of any one desk. */
export interface DepthModel {
  /** Within-class spread of marks, points. */
  sigmaClass: number;
  /** Year-level spread; equals sigmaClass when the book is unstreamed. */
  sigmaYear: number;
  yearSize: number;
  /** Typical class size on the book — what yearSize is derived from. */
  medianCohort: number;
  groups: DepthGroup[];
  /** Per-desk offset between its own class and the form class, points. */
  basis: Record<string, number>;
  /** Residual RMSE, points — how well placements and marks agree. */
  rmse: number;
  /** Ranked prints the fit ran on. */
  n: number;
  /** The premium clears its own noise floor: the book is streamed. */
  streamed: boolean;
  premiumMean: number;
  premiumSe: number;
  /** False when the book was too thin to fit; everything stays class-only. */
  fitted: boolean;
}

/** Where one ranked print sits — in its class, and in the field. */
export interface DepthRead {
  date: string;
  score: number;
  rank: number;
  cohortN: number;
  yearAvg: number;
  /** Standardised placement inside the class. */
  classZ: number;
  /** Hazen percentile inside the class — what the report literally says. */
  classPct: number;
  /** This period's class strength over the year level, points. */
  premium: number;
  /** This desk's own class vs the form class, points. */
  basis: number;
  fieldZ: number;
  /** Percentile across the whole year level — the honest one. */
  fieldPct: number;
  /** Estimated placement across the year level, 1 = top. */
  fieldRank: number;
}

/** One rung of the order book. */
export interface DepthLevel {
  lo: number;
  hi: number;
  /** Outer rungs are open-ended so the heads sum to the year size. */
  openLo: boolean;
  openHi: boolean;
  /** Estimated heads at the year level in this band. */
  count: number;
  /** …of which sit in your own class. */
  classCount: number;
  side: "ask" | "bid" | "touch";
}

/** A desk's depth read plus its ladder. */
export interface SubjectDepth {
  latest: DepthRead;
  history: DepthRead[];
  basis: number;
  ladder: DepthLevel[];
  /** Which stream the desk's class is, 1 = strongest. Null when unstreamed. */
  streamIndex: number | null;
  streamsPerLevel: number;
}

/** One "work on this" advisory signal. */
export interface Signal {
  id: string;
  ticker: string;
  /** 0–100 urgency. */
  priority: number;
  /** Ordered human-readable factors. */
  reasons: string[];
  gap: number | null;
  downside: number;
  slope30: number;
  staleDays: number;
}
