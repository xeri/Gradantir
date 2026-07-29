import { clamp, round1 } from "../utils";
import { entriesAvg } from "../weights";
import { predictiveInterval, truncatedQuantile } from "./bayes";
import { detrendMeta, examOffset } from "./calibration";
import { ensemble, type EnsembleResult } from "./ensemble";
import { examOracle, type OracleResult } from "./oracle";
import type { PoolStats } from "./shrinkage";
import type { PriceTrace } from "./trace";
import type { ForwardView, GradeEntry, GradeProjection, Interval, PriceResult, Settings, Subject } from "../../types";

/**
 * The ticker price: a 0–100 capability estimate over ALL prints — coursework
 * weighted heavily — with Student-t credible intervals. Separately,
 * projectGrade computes what actually pays out, which by default is exams
 * only: coursework informs the price, not the grade.
 */

const roundIv = (iv: Interval): Interval => ({ lo: round1(iv.lo), hi: round1(iv.hi) });

/**
 * The analyst views: each member's estimate today and one horizon out, with
 * the blend weight it earned in walk-forward validation. The pair is what
 * makes a member's DRIFT readable — level members hold, the gated trend moves.
 */
const viewsOf = (ens: EnsembleResult): ForwardView[] =>
  ens.forward.map((m) => ({
    name: m.name,
    weight: ens.weights[m.name],
    // Unclamped on purpose. `now` and `mean` feed the return/drift math and the
    // identity Σ w(M − FV) = 0 that fair value rests on (FV is the weighted
    // member mean). Clamping a member forecasting past the ceiling broke that
    // identity — erasing a near-ceiling desk's momentum and skewing analyst
    // dispersion. Scores are clamped downstream, where one is actually shown.
    now: ens.members.find((x) => x.name === m.name)?.mean ?? m.mean,
    mean: m.mean,
    sd: m.sd,
  }));

/** The working behind fair value, kept for the derivation layer. */
const priceTrace = (
  ens: EnsembleResult,
  entries: GradeEntry[],
  pool: PoolStats | null,
  offset: ReturnType<typeof examOffset>,
  oracle: OracleResult | null,
): PriceTrace => ({
  oracle,
  n: entries.length,
  members: ens.members.map((m) => ({
    name: m.name,
    mean: m.mean,
    sd: m.sd,
    validation: ens.validation[m.name] ?? null,
    weight: ens.weights[m.name],
  })),
  fixedWeights: ens.fixedWeights,
  mean: ens.mean,
  sd: ens.sd,
  df: ens.df,
  pool,
  offset,
  detrend: detrendMeta(entries),
  horizonDays: ens.horizonDays,
});

export function priceSubject(
  entries: GradeEntry[],
  pool: PoolStats | null,
  // The price runs on the engine's own SIGNAL_WEIGHTs; settings stays in the
  // signature so callers thread one context object and the API can grow.
  _settings: Settings,
  todayIso: string,
): PriceResult | null {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const ens = ensemble(sorted, pool, todayIso);
  if (!ens) return null;

  const t = { mean: ens.mean, scale: ens.sd, df: ens.df };
  let lastExamPct: number | null = null;
  let lastExamDate: string | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].type === "Exam") {
      lastExamPct = sorted[i].score;
      lastExamDate = sorted[i].date;
      break;
    }
  }

  const prev = sorted.length >= 2 ? ensemble(sorted.slice(0, -1), pool, todayIso) : null;
  const prevOracle = prev ? examOracle(sorted.slice(0, -1), pool, todayIso) : null;

  const off = examOffset(sorted);
  // The oracle forecasts the next EXAM, so it is built on exam-level anchors —
  // never on ens.mean, which already contains the exams δ̂ would re-add.
  const oracle = examOracle(sorted, pool, todayIso);
  const nextMean = oracle ? oracle.mean : clamp(ens.mean, 0, 100);
  const nextSd = oracle ? oracle.sd : ens.sd;
  const nextDf = oracle ? oracle.df : ens.df;
  const nextT = { mean: nextMean, scale: nextSd, df: nextDf };

  const weights: Record<string, number> = {};
  for (const [name, w] of Object.entries(ens.weights)) weights[name] = Math.round(w * 100);

  const fair = clamp(round1(ens.mean), 0, 100);
  return {
    // Provisional: price ships at fair value; the book-level mark pass
    // (quant/mark.ts) overwrites price/discount/premia/regime in one sweep.
    // fv is the number the mark discounts from and never changes after this.
    price: fair,
    fv: fair,
    discount: 0,
    premia: [],
    regime: "STABLE",
    sd: round1(ens.sd),
    df: ens.df,
    ci50: roundIv(predictiveInterval(t, 0.5)),
    ci90: roundIv(predictiveInterval(t, 0.9)),
    p10: round1(truncatedQuantile(t, 0.1)),
    lastExamPct,
    lastExamDate,
    prevPrice: prev ? clamp(round1(prev.mean), 0, 100) : null,
    nextExam: {
      mean: round1(nextMean),
      sd: round1(nextSd),
      ci50: roundIv(predictiveInterval(nextT, 0.5)),
      ci90: roundIv(predictiveInterval(nextT, 0.9)),
    },
    weights,
    horizonDays: ens.horizonDays,
    // The carry the analyst desk earns is the gap between where the next exam
    // is expected to print and what the desk is worth today — NOT δ̂ itself,
    // which the members have already partly priced. δ̂ stays on the trace.
    carry: round1(nextMean - ens.mean),
    prevCarry: prevOracle ? round1(prevOracle.mean - (prev as EnsembleResult).mean) : null,
    forward: viewsOf(ens),
    prevForward: prev ? viewsOf(prev) : null,
    trace: { price: priceTrace(ens, sorted, pool, off, oracle) },
  };
}

/**
 * Final-grade projection. Precedence: explicit per-result worthPct beats the
 * subject-level coursework/exam blend beats the default — exams only, where
 * coursework contributes nothing (it is a capability signal, not a grade).
 */
export function projectGrade(entries: GradeEntry[], sub: Subject, settings: Settings): GradeProjection {
  const exams = entries.filter((e) => e.type === "Exam");
  const coursework = entries.filter((e) => e.type !== "Exam");
  const examAvgRaw = entriesAvg(exams, settings);
  const cwAvgRaw = entriesAvg(coursework, settings);
  const examAvg = examAvgRaw != null ? round1(examAvgRaw) : null;
  const courseworkAvg = cwAvgRaw != null ? round1(cwAvgRaw) : null;

  const worthEntries = entries.filter((e) => e.worthPct != null);
  if (worthEntries.length) {
    let sw = 0, sws = 0;
    for (const e of worthEntries) {
      sw += e.worthPct as number;
      sws += (e.worthPct as number) * e.score;
    }
    return {
      grade: sw > 0 ? round1(sws / sw) : null,
      mode: "worth",
      courseworkAvg,
      examAvg,
      worthCoverage: round1(sw),
    };
  }

  if (sub.courseworkPct != null && sub.courseworkPct > 0) {
    // A coursework share outside [0,100] makes this a extrapolation rather than
    // a blend, and it prints a negative grade. The editors clamp, but a stored
    // book predates several of them.
    const p = Math.min(1, sub.courseworkPct / 100);
    const grade =
      cwAvgRaw != null && examAvgRaw != null
        ? round1(p * cwAvgRaw + (1 - p) * examAvgRaw)
        : examAvg ?? courseworkAvg;
    return { grade, mode: "blend", courseworkAvg, examAvg, worthCoverage: null };
  }

  return { grade: examAvg, mode: "exam-only", courseworkAvg, examAvg, worthCoverage: null };
}
