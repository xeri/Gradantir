import { clamp } from "../utils";
import { examOffset, type ExamOffset } from "./calibration";
import { ensemble } from "./ensemble";
import type { PoolStats } from "./shrinkage";
import type { GradeEntry } from "../../types";

/**
 * The next-exam oracle.
 *
 * δ̂ (calibration.ts) is a BRIDGE from coursework to exams, so it may be
 * crossed exactly once, from the coursework side. Adding it to a capability
 * estimate that already contains the exams crosses it one and a half times:
 * with effective exam weight w the forecast lands w·(E − C) past the exam
 * level, which on a desk whose coursework and exams disagree sharply is worth
 * ten points and always in the wrong direction.
 *
 * So the oracle is built from two estimators of the SAME quantity — where the
 * next exam will print — and blended by precision:
 *
 *   exam side       ensemble over the exam tape alone
 *   coursework side ensemble over the coursework tape alone, plus δ̂
 *
 * Both sides run through the ordinary `ensemble`, so both inherit shrinkage
 * toward the book, the Kalman's honest gap handling, the τ gate and the small-n
 * degradation — a desk with one exam is not asked to forecast from one exam.
 * The blend is moment-matched as a mixture exactly as the ensemble is, so when
 * the two sides disagree the band widens rather than quietly averaging.
 */

export interface OracleResult {
  /** Where the next exam is expected to print, 0–100. */
  mean: number;
  /** Blended scale, carrying the disagreement between the two sides. */
  sd: number;
  df: number;
  /** The exam tape's own read, before the coursework side. Null with no exams. */
  examSide: number | null;
  /** cwLevel + δ̂ — what the coursework tape prices the exam at. Null with none. */
  cwSide: number | null;
  /** Weight the exam side took in the blend, 0–1. */
  examWeight: number;
  offset: ExamOffset;
}

/**
 * Forecast the next exam from the tape. Null only when there is nothing to
 * forecast from at all — one side missing is not a failure, it is the other
 * side answering alone.
 */
export function examOracle(
  entries: GradeEntry[],
  pool: PoolStats | null,
  todayIso: string,
): OracleResult | null {
  const offset = examOffset(entries);
  const exams = entries.filter((e) => e.type === "Exam");
  const coursework = entries.filter((e) => e.type !== "Exam");

  // Each side is priced by the full engine on its own tape. Detrending,
  // pooling and validation all apply — this is the price of an exam-only desk
  // and the price of a coursework-only desk, not two bare averages.
  const ex = exams.length ? ensemble(exams, pool, todayIso) : null;
  const cw = coursework.length ? ensemble(coursework, pool, todayIso) : null;
  if (!ex && !cw) return null;

  // δ̂ crosses here and only here: the coursework level is translated into
  // exam terms before the two sides are ever compared.
  const examSide = ex ? ex.mean : null;
  const cwSide = cw ? cw.mean + offset.delta : null;

  if (examSide == null) {
    return {
      mean: clamp(cwSide as number, 0, 100), sd: cw!.sd, df: cw!.df,
      examSide, cwSide, examWeight: 0, offset,
    };
  }
  if (cwSide == null) {
    return {
      mean: clamp(examSide, 0, 100), sd: ex!.sd, df: ex!.df,
      examSide, cwSide, examWeight: 1, offset,
    };
  }

  // Precision weights: the tighter side speaks louder, and neither can take
  // infinite weight because both sds carry the ensemble's own floor.
  const pE = 1 / (ex!.sd * ex!.sd);
  const pC = 1 / (cw!.sd * cw!.sd);
  const wE = pE / (pE + pC);
  const mean = wE * examSide + (1 - wE) * cwSide;
  // Mixture moment-matching, as in ensemble(): disagreement widens the band.
  const variance =
    wE * (ex!.sd * ex!.sd + (examSide - mean) * (examSide - mean)) +
    (1 - wE) * (cw!.sd * cw!.sd + (cwSide - mean) * (cwSide - mean));

  return {
    mean: clamp(mean, 0, 100),
    sd: Math.sqrt(variance),
    // The thinner side sets the tails: a forecast leaning on two exams is not
    // made confident by a long coursework tape it only half trusts.
    df: Math.min(ex!.df, cw!.df),
    examSide, cwSide, examWeight: wE, offset,
  };
}
