import { avg } from "../utils";
import { winsorizedMean } from "./robust";
import { shrinkToward } from "./shrinkage";
import { DIFFICULTY_ADJ, EXAM_OFFSET_SHRINK } from "./params";
import type { GradeEntry } from "../../types";

/** Fallback difficulty adjustment, in points: +hard, −easy, 0 otherwise. */
const difficultyAdj = (d: GradeEntry["difficulty"]): number =>
  d === "hard" ? DIFFICULTY_ADJ : d === "easy" ? -DIFFICULTY_ADJ : 0;

/**
 * Bridges between what coursework says about capability and what exams pay.
 * Coursework never touches the grade by default — but it predicts the next
 * exam via ability + δ̂, where δ̂ is the (shrunk) exam-vs-coursework gap.
 */

export interface ExamOffset {
  /** Shrunk offset actually applied to forecasts. */
  delta: number;
  /** Raw winsorized-mean gap, or null when either side is empty. */
  raw: number | null;
  nExams: number;
  nCoursework: number;
}

export function examOffset(entries: GradeEntry[]): ExamOffset {
  const exams = entries.filter((e) => e.type === "Exam").map((e) => e.score);
  const coursework = entries.filter((e) => e.type !== "Exam").map((e) => e.score);
  const em = winsorizedMean(exams);
  const cm = winsorizedMean(coursework);
  if (em == null || cm == null) {
    return { delta: 0, raw: null, nExams: exams.length, nCoursework: coursework.length };
  }
  const raw = em - cm;
  return {
    delta: shrinkToward(raw, exams.length, 0, EXAM_OFFSET_SHRINK),
    raw,
    nExams: exams.length,
    nCoursework: coursework.length,
  };
}

/**
 * The correction's own parameters, separated so the derivation layer can quote
 * λ and ρ̄ without re-deriving them from the tape.
 */
export function detrendMeta(entries: GradeEntry[]): { lambda: number; refCount: number; meanRef: number | null } {
  const refs = entries
    .map((e) => e.classAvg ?? e.yearAvg ?? null)
    .filter((r): r is number => r != null);
  if (!refs.length) return { lambda: 0, refCount: 0, meanRef: null };
  return { lambda: refs.length / (refs.length + 2), refCount: refs.length, meanRef: avg(refs) };
}

/**
 * Difficulty detrending: when an assessment's class/year average sat below the
 * subject's usual reference, everyone found it hard — credit the score back.
 * λ = m/(m+2) so a single reference point only partially corrects.
 */
export function detrend(entries: GradeEntry[]): { entry: GradeEntry; adjusted: number }[] {
  const { lambda, refCount, meanRef } = detrendMeta(entries);
  return entries.map((entry) => {
    const ref = entry.classAvg ?? entry.yearAvg ?? null;
    // A measured cohort average is the better difficulty signal and takes
    // precedence; the one-tap self-report only fills the gap where none exists.
    if (ref != null && refCount && meanRef != null) {
      return { entry, adjusted: entry.score - lambda * (ref - meanRef) };
    }
    return { entry, adjusted: entry.score + difficultyAdj(entry.difficulty) };
  });
}

/** Hazen plotting position: rank 1 of N maps near the top, never to 100. */
export function percentileFromRank(rank: number, cohortN: number): number {
  return 100 * (1 - (rank - 0.5) / cohortN);
}
