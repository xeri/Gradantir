import type { AssessmentType, Settings } from "./types";

export const TYPES: AssessmentType[] = ["Exam", "Test", "Assignment", "Quiz"];

export const typePlural = (t: AssessmentType): string => (t === "Quiz" ? "Quizzes" : t + "s");

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const STORE_KEY = "grade-exchange:v2";

export const DEFAULT_WEIGHTS: Record<AssessmentType, number> = {
  Exam: 3,
  Test: 2,
  Assignment: 1.5,
  Quiz: 1,
};

export const DEFAULT_SETTINGS: Settings = {
  weights: { ...DEFAULT_WEIGHTS },
  weighted: true,
};

export const GROUPS: { value: string; label: string }[] = [
  { value: "assessment", label: "EACH RESULT" },
  { value: "month", label: "MONTHLY" },
  { value: "term", label: "BY TERM" },
  { value: "semester", label: "BY SEMESTER" },
  { value: "year", label: "YEARLY" },
];

/**
 * Categorical palette for subject lines, assigned in this fixed order.
 * Validated for the dark surface (#0F131A): OKLCH L band, chroma floor,
 * CVD separation, and ≥3:1 contrast all pass; the one floor-band pair is
 * covered by direct ticker labels everywhere a line appears.
 */
export const PALETTE = [
  "#4D7CFE", // blue
  "#E0662E", // orange
  "#17A873", // green
  "#B06AF0", // violet
  "#AD8617", // gold
  "#2596B8", // cyan
  "#E44A84", // pink
  "#839A2B", // olive
];
