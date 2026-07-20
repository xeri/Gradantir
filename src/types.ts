export type AssessmentType = "Exam" | "Test" | "Assignment" | "Quiz";

/** How results are bucketed along the x-axis. */
export type PeriodMode = "assessment" | "month" | "term" | "semester" | "year";
export type GroupPeriod = Exclude<PeriodMode, "assessment">;

export interface Subject {
  id: string;
  name: string;
  ticker: string;
  color: string;
  /** Desired term average in %, or null when unset. */
  target: number | null;
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
}

export interface Settings {
  /** Per-type multiplier applied to averages when `weighted` is on. */
  weights: Record<AssessmentType, number>;
  weighted: boolean;
}

export interface AppData {
  subjects: Subject[];
  entries: GradeEntry[];
  settings: Settings;
  /** True while the seeded demo book is loaded. */
  sample: boolean;
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
  /** Sorted by date ascending. */
  entries: GradeEntry[];
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
  /** Mean of (score − classAvg) across entries that carry a class average. */
  alpha: number | null;
  alphaCount: number;
  curLabel: string;
  prevLabel: string;
}

export interface CompositeIndex {
  value: number | null;
  delta: number | null;
}
