import { subjectForecast } from "../regression";
import { avg, clamp, pDate, round1 } from "../utils";
import { detrend, examOffset, type ExamOffset } from "./calibration";
import { ewma } from "./ensemble";
import { EWMA_HALF_LIFE_DAYS, RELIABILITY_SD } from "./params";
import { mad, median, shrunkSlope, theilSen, winsorizedMean } from "./robust";
import type { GradeEntry, PriceResult, Subject } from "../../types";
import type { QuantPoint } from "./types";

/**
 * The diagnostics desk: one multifactor read per subject, plus the
 * cross-sectional norms every relative statement is measured against.
 * Everything here is deliberately small-n honest — trends are τ-gated,
 * shocks are floored by exam reliability, volatility is print-to-print
 * (RMSSD) rather than deviation-from-median, which a whipsaw fools.
 *
 * The wire turns these numbers into copy; this module never writes prose.
 */

/** Ratio denominators never collapse below this, pts. */
export const VOL_FLOOR = 2;

/** A dated story halves once this many newer prints supersede it. */
export const DECAY_PRINT_HALF_LIFE = 2;
/** Calendar decay only starts past this age — sessions are the market clock. */
export const DECAY_CAL_HORIZON_DAYS = 120;
export const DECAY_CAL_HALF_LIFE_DAYS = 60;

/**
 * What one desk must bring to the diagnostics pass — a structural slice of
 * SubjectStat, so the live board threads its rows straight through while a
 * historical reprice (pricesAsOf) can rebuild the same shape from a truncated
 * tape. `quant` is the FAIR price here: factors describe the tape, never the
 * mark that will be charged against it.
 */
export interface FactorInput {
  sub: Subject;
  /** Sorted by date ascending. */
  entries: GradeEntry[];
  scores: number[];
  latest: GradeEntry | null;
  ath: number | null;
  staleDays: number | null;
  quant: PriceResult | null;
  /**
   * The desk's fair-share effort read for the round being priced. Absent on
   * every caller that does not price a budget, which is what keeps the effort
   * premia an exact identity on a book with no allocation filed.
   */
  effort?: import("./effort").EffortPressure | null;
  /**
   * The desk's centred readiness log-strength from the duel pile. Absent on
   * every caller that does not price a pile, which is what keeps the readiness
   * premium an exact identity on a book that has never duelled.
   */
  readiness?: import("./readiness").ReadinessPressure | null;
}

export interface BookContext {
  /** Desks in the report. */
  desks: number;
  /** Median print-to-print volatility over desks with ≥4 prints on their vol basis. */
  medianVol: number | null;
  medianSlope30: number | null;
  medianPrice: number | null;
  medianStaleDays: number | null;
  medianCwStaleDays: number | null;
}

/** A same-date exam + coursework double print; gap = coursework − exam. */
export interface SessionPair {
  date: string;
  exam: number;
  coursework: number;
  gap: number;
}

export interface CourseworkSignal {
  nExams: number;
  nCoursework: number;
  /** Recency-weighted coursework level today (difficulty-detrended). */
  cwMean: number | null;
  cwSd: number | null;
  /** τ-gated coursework trend, pts/30d. Null below 2 coursework prints. */
  cwSlope30: number | null;
  /** Recency-weighted exam level today. */
  examAnchor: number | null;
  /** Shrunk exam-vs-coursework offset δ̂ from the calibration desk. */
  delta: number;
  /** What the coursework tape prices the next exam at: cwMean + δ̂. */
  impliedExam: number | null;
  /** impliedExam − examAnchor: the exam surprise the coursework tape implies. */
  surprise: number | null;
  /** surprise / √(cwSd²/nCw + exam reliability²) — never divides by zero. */
  surpriseZ: number | null;
  cwStaleDays: number | null;
  /** The desk's own coursework cadence: median day-gap between prints. */
  cwGapMedian: number | null;
}

export interface DeskFactors {
  id: string;
  ticker: string;
  n: number;
  /** τ-gated trend on the full detrended tape, pts/30d (advisor's construction). */
  slope30: number;
  /** slope30 minus the book median — lagging the tape even while "flat". */
  relSlope30: number | null;
  /** Latest print vs all-time high, ≥ 0. */
  drawdown: number;
  /** Print-to-print RMSSD on the vol basis. */
  vol: number;
  /** Exams only once four exist — mixed tapes conflate divergence with instability. */
  volBasis: "exam" | "mixed";
  /** How many prints the vol basis actually spans. Published so the derivation
      layer can state the n ≥ 4 gate on the COUNT: testing `vol > 0` instead
      fails a long, perfectly stable tape, whose RMSSD is legitimately 0. */
  volN: number;
  volRatio: number | null;
  /** Recent swing vs own history; null until the tape is long enough. */
  volExpansion: number | null;
  /** Downside semideviation of the recent tape vs the recency-weighted level. */
  semiDev: number;
  /** Consecutive prints under the estimate that stood before each of them. */
  missStreak: number;
  avgMissDeficit: number;
  /** Consecutive strictly-lower exam prints ending at the latest. */
  downStreak: number;
  /** Winsorized trailing exam mean the latest print is judged against. */
  examTrail: number | null;
  /** Latest exam minus examTrail — the earnings shock. */
  shock: number | null;
  /** Shock over max(trailing MAD, exam reliability): honest sigma units. */
  shockZ: number | null;
  /** Latest exam vs the nearest exam 330–400 days earlier. */
  yoyDelta: number | null;
  /** Latest exam minus its own reference average (class first, then year). */
  alphaLatest: number | null;
  alphaTrail: number | null;
  /** alphaLatest − alphaTrail: the moat closing. */
  alphaCollapse: number | null;
  coursework: CourseworkSignal;
  sessionPairs: SessionPair[];
  worstPair: SessionPair | null;
  targetGap: number | null;
  consistent: boolean;
}

export interface FactorReport {
  book: BookContext;
  desks: DeskFactors[];
}

const DAY = 86400000;
const daysBetween = (from: string, to: string): number =>
  Math.round((pDate(to).getTime() - pDate(from).getTime()) / DAY);

/** √(mean of min(0, y − μ)²): only the downside counts. 0 below n=3. */
export function downsideSemiDev(ys: number[], mu: number): number {
  if (ys.length < 3) return 0;
  let s = 0;
  for (const y of ys) {
    const d = Math.min(0, y - mu);
    s += d * d;
  }
  return Math.sqrt(s / ys.length);
}

/**
 * Root-mean-square successive difference: how hard the tape swings print to
 * print. A whipsaw that oscillates around a stable median fools MAD/stdev;
 * it cannot fool its own first differences. Null below n=4.
 */
export function rmssd(xs: number[]): number | null {
  if (xs.length < 4) return null;
  let s = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    s += d * d;
  }
  return Math.sqrt(s / (xs.length - 1));
}

/**
 * Consecutive latest prints under the estimate that stood before each one.
 * The forecast needs 3 priors, so the streak is 0 below n=4.
 */
export function missStreak(sorted: Pick<GradeEntry, "score">[]): { streak: number; avgDeficit: number } {
  let streak = 0;
  let total = 0;
  for (let i = sorted.length - 1; i >= 3; i--) {
    const est = subjectForecast(sorted.slice(0, i));
    if (!est) break;
    const deficit = est.pred - sorted[i].score;
    if (deficit <= 0.5) break;
    streak++;
    total += deficit;
  }
  return { streak, avgDeficit: streak ? round1(total / streak) : 0 };
}

/**
 * Market-time decay: a dated story fades as newer prints supersede it, not as
 * the calendar turns — on a term cadence the April session IS the current
 * state in July. A calendar tail still bites once the tape goes truly stale.
 */
export function decayFactor(printsSince: number, ageDays: number): number {
  const byPrints = Math.pow(2, -Math.max(0, printsSince) / DECAY_PRINT_HALF_LIFE);
  const byCalendar = Math.pow(2, -Math.max(0, ageDays - DECAY_CAL_HORIZON_DAYS) / DECAY_CAL_HALF_LIFE_DAYS);
  return byPrints * byCalendar;
}

/** Same-date exam + coursework pairs, ascending by date. */
export function sessionPairs(entries: GradeEntry[]): SessionPair[] {
  const byDate = new Map<string, { exam: number[]; cw: number[] }>();
  for (const e of entries) {
    const b = byDate.get(e.date) ?? { exam: [], cw: [] };
    (e.type === "Exam" ? b.exam : b.cw).push(e.score);
    byDate.set(e.date, b);
  }
  const out: SessionPair[] = [];
  for (const [date, b] of byDate) {
    if (!b.exam.length || !b.cw.length) continue;
    const exam = round1(avg(b.exam));
    const coursework = round1(avg(b.cw));
    out.push({ date, exam, coursework, gap: round1(coursework - exam) });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * The coursework→exam bridge: coursework never pays the grade, but it prices
 * the next exam via level + δ̂. Everything runs on the same day axis and
 * difficulty detrending as the price engine, so the two never disagree about
 * what a print "really" said.
 */
export function courseworkSignal(entries: GradeEntry[], todayIso: string): CourseworkSignal {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const off: ExamOffset = examOffset(sorted);
  const base: CourseworkSignal = {
    nExams: off.nExams, nCoursework: off.nCoursework,
    cwMean: null, cwSd: null, cwSlope30: null, examAnchor: null,
    delta: off.delta, impliedExam: null, surprise: null, surpriseZ: null,
    cwStaleDays: null, cwGapMedian: null,
  };
  if (!sorted.length) return base;

  const first = sorted[0].date;
  const pts: QuantPoint[] = detrend(sorted).map(({ entry, adjusted }) => ({
    x: daysBetween(first, entry.date), y: adjusted, type: entry.type,
  }));
  const xToday = Math.max(daysBetween(first, todayIso), pts[pts.length - 1].x);
  const cwPts = pts.filter((p) => p.type !== "Exam");
  const exPts = pts.filter((p) => p.type === "Exam");

  const cw = ewma(cwPts, EWMA_HALF_LIFE_DAYS, xToday);
  const ex = ewma(exPts, EWMA_HALF_LIFE_DAYS, xToday);
  base.cwMean = cw ? round1(cw.mean) : null;
  base.cwSd = cw ? round1(cw.sd) : null;
  base.examAnchor = ex ? round1(ex.mean) : null;
  base.cwSlope30 = cwPts.length >= 2 ? round1(shrunkSlope(theilSen(cwPts)) * 30) : null;
  base.impliedExam = cw ? round1(clamp(cw.mean + off.delta, 0, 100)) : null;
  if (base.impliedExam != null && ex) {
    base.surprise = round1(base.impliedExam - ex.mean);
    const denom = Math.sqrt((cw!.sd * cw!.sd) / Math.max(1, off.nCoursework) + RELIABILITY_SD.Exam ** 2);
    base.surpriseZ = round1(base.surprise / denom);
  }

  const cwDates = sorted.filter((e) => e.type !== "Exam").map((e) => e.date);
  if (cwDates.length) {
    base.cwStaleDays = Math.max(0, daysBetween(cwDates[cwDates.length - 1], todayIso));
    if (cwDates.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < cwDates.length; i++) gaps.push(daysBetween(cwDates[i - 1], cwDates[i]));
      base.cwGapMedian = median(gaps);
    }
  }
  return base;
}

const refOf = (e: GradeEntry): number | null => e.classAvg ?? e.yearAvg ?? null;

function deskFactors(s: FactorInput, todayIso: string): Omit<DeskFactors, "relSlope30" | "volRatio" | "consistent"> & { volN: number } {
  const es = s.entries;
  const n = es.length;
  const todayMs = pDate(todayIso).getTime();

  // Advisor's exact trend construction: detrended tape, x = days before today.
  const relPts = detrend(es).map(({ entry, adjusted }) => ({
    x: Math.round((pDate(entry.date).getTime() - todayMs) / DAY),
    y: adjusted,
  }));
  const slope30 = round1(shrunkSlope(theilSen(relPts)) * 30);

  const exams = es.filter((e) => e.type === "Exam");
  const examScores = exams.map((e) => e.score);
  const volBasis: DeskFactors["volBasis"] = examScores.length >= 4 ? "exam" : "mixed";
  const volSrcAll = volBasis === "exam" ? examScores : s.scores;
  const volSrc = volSrcAll.slice(-10);
  const vol = round1(rmssd(volSrc) ?? 0);
  const volPrev = volSrcAll.slice(0, -5).slice(-10);
  const volExpansion =
    volPrev.length >= 4 && volSrcAll.length >= 9
      ? round1((rmssd(volSrcAll.slice(-5)) ?? 0) / Math.max(rmssd(volPrev) ?? 0, VOL_FLOOR))
      : null;

  // Earnings shock: the latest exam against the winsorized trailing exam mean,
  // in sigma units floored by exam reliability so a tight tape can't explode z.
  const lastExam = exams[exams.length - 1] ?? null;
  const priorExams = examScores.slice(0, -1).slice(-6);
  let examTrail: number | null = null, shock: number | null = null, shockZ: number | null = null;
  if (lastExam && priorExams.length >= 3) {
    examTrail = round1(winsorizedMean(priorExams)!);
    shock = round1(lastExam.score - examTrail);
    shockZ = round1(shock / Math.max(mad(priorExams), RELIABILITY_SD.Exam));
  }
  let downStreak = 0;
  for (let i = exams.length - 1; i > 0; i--) {
    if (exams[i].score < exams[i - 1].score) downStreak++;
    else break;
  }

  // Miss streak runs on the exam tape once it is deep enough — a mixed tape
  // lets a hot coursework print drag the estimate and fake a miss.
  const ms = missStreak(examScores.length >= 4 ? exams : es);

  let yoyDelta: number | null = null;
  if (lastExam) {
    let bestDist = Infinity;
    for (const e of exams.slice(0, -1)) {
      const d = daysBetween(e.date, lastExam.date);
      if (d < 330 || d > 400) continue;
      const dist = Math.abs(d - 365);
      if (dist < bestDist) { bestDist = dist; yoyDelta = round1(lastExam.score - e.score); }
    }
  }

  let alphaLatest: number | null = null, alphaTrail: number | null = null, alphaCollapse: number | null = null;
  if (lastExam) {
    const r = refOf(lastExam);
    if (r != null) alphaLatest = round1(lastExam.score - r);
  }
  const priorAlphas = exams
    .slice(0, -1)
    .map((e) => { const r = refOf(e); return r != null ? e.score - r : null; })
    .filter((v): v is number => v != null);
  if (priorAlphas.length >= 3) alphaTrail = round1(avg(priorAlphas));
  if (alphaLatest != null && alphaTrail != null) alphaCollapse = round1(alphaLatest - alphaTrail);

  // Downside semideviation of the recent tape vs the recency-weighted level.
  let semiDev = 0;
  if (es.length) {
    const first = es[0].date;
    const pts: QuantPoint[] = detrend(es).map(({ entry, adjusted }) => ({
      x: daysBetween(first, entry.date), y: adjusted, type: entry.type,
    }));
    const level = ewma(pts, EWMA_HALF_LIFE_DAYS, Math.max(daysBetween(first, todayIso), pts[pts.length - 1].x));
    if (level) semiDev = round1(downsideSemiDev(pts.slice(-10).map((p) => p.y), level.mean));
  }

  const pairs = sessionPairs(es);
  const worstPair = pairs.length
    ? pairs.reduce((w, p) => (Math.abs(p.gap) > Math.abs(w.gap) ? p : w))
    : null;

  return {
    id: s.sub.id, ticker: s.sub.ticker, n,
    slope30,
    drawdown: s.ath != null && s.latest ? Math.max(0, round1(s.ath - s.latest.score)) : 0,
    vol, volBasis, volN: volSrc.length, volExpansion,
    semiDev,
    missStreak: ms.streak, avgMissDeficit: ms.avgDeficit,
    downStreak, examTrail, shock, shockZ, yoyDelta,
    alphaLatest, alphaTrail, alphaCollapse,
    coursework: courseworkSignal(es, todayIso),
    sessionPairs: pairs, worstPair,
    targetGap: s.sub.target != null && s.quant ? round1(s.sub.target - s.quant.price) : null,
  };
}

/**
 * One pass over the book: per-desk factors, then the cross-sectional norms,
 * then the relative fields that need them. O(desks × n²) at n ≤ ~11 — cheap.
 */
export function computeFactors(stats: FactorInput[], todayIso: string): FactorReport {
  const pre = stats.map((s) => ({ stat: s, f: deskFactors(s, todayIso) }));

  const volEligible = pre.filter((p) => p.f.volN >= 4).map((p) => p.f.vol);
  const medianVol = volEligible.length >= 2 ? median(volEligible) : null;
  const slopeEligible = pre.filter((p) => p.f.n >= 4).map((p) => p.f.slope30);
  const medianSlope30 = slopeEligible.length >= 2 ? median(slopeEligible) : null;
  const prices = pre.map((p) => p.stat.quant?.price).filter((v): v is number => v != null);
  const stales = pre.map((p) => p.stat.staleDays).filter((v): v is number => v != null);
  const cwStales = pre.map((p) => p.f.coursework.cwStaleDays).filter((v): v is number => v != null);

  const book: BookContext = {
    desks: pre.length,
    medianVol: medianVol != null ? round1(medianVol) : null,
    medianSlope30: medianSlope30 != null ? round1(medianSlope30) : null,
    medianPrice: prices.length ? round1(median(prices)!) : null,
    medianStaleDays: stales.length ? Math.round(median(stales)!) : null,
    medianCwStaleDays: cwStales.length ? Math.round(median(cwStales)!) : null,
  };

  const desks: DeskFactors[] = pre.map(({ f }) => {
    const volRatio =
      book.medianVol != null && f.volN >= 4 ? round1(f.vol / Math.max(book.medianVol, VOL_FLOOR)) : null;
    return {
      ...f,
      relSlope30: book.medianSlope30 != null ? round1(f.slope30 - book.medianSlope30) : null,
      volRatio,
      consistent:
        f.n >= 6 && f.volN >= 4 && f.vol <= 3.5 &&
        (volRatio == null || volRatio <= 0.8) &&
        f.slope30 >= -0.5 && f.missStreak === 0,
    };
  });

  return { book, desks };
}
