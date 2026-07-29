import { clamp, round1 } from "../utils";
import { entryTermKey } from "../periods";
import { normCdf, normPdf, normQuantile } from "./bayes";
import { percentileFromRank } from "./calibration";
import { winsorizedMean } from "./robust";
import { shrinkToward } from "./shrinkage";
import {
  DEPTH_BASIS_SHRINK, DEPTH_LADDER_SPAN, DEPTH_LADDER_STEP,
  DEPTH_MIN_GROUPS, DEPTH_MIN_PRINTS, DEPTH_SD_ANCHOR_K, DEPTH_SIGMA_FLOOR,
} from "./params";
import type {
  DepthLevel, DepthModel, DepthRead, DepthSettings, GradeEntry, Settings, Subject, SubjectDepth,
} from "../../types";

/**
 * MARKET DEPTH — the field behind the class.
 *
 * A placement ("24th of 36") is a statement about a CLASS, and a class is only
 * the whole field when a school does not stream. Where it does, the class is a
 * slice of the year level chosen by aggregate mark, so the same placement means
 * something different in a strong stream than in a weak one — and a student can
 * hold their rank while the class around them changes underneath.
 *
 * The fit separates the two. For every ranked print:
 *
 *     score − yearMean  =  premium[period] + basis[desk] + σ_class · z(rank) + ε
 *
 * z(rank) is where the placement puts the student inside their own class, so
 * whatever is left over is a property of the CLASS, not of them:
 *
 *   premium[period] — the form class's strength over the year level. THE number.
 *   basis[desk]     — a desk whose own class differs from the form class
 *                     (an option subject, a set, a different teacher's group).
 *
 * The two are collinear on their own — shifting every premium up and every
 * basis down fits identically — so the basis block carries a ridge penalty
 * (DEPTH_BASIS_SHRINK). That both identifies the system and stops a desk with
 * one ranked print from absorbing its entire residual.
 *
 * Everything above is fitted from data alone and needs no configuration. Going
 * from a class position to a FIELD position needs one more thing — the spread
 * of the year level — which a single student's reports cannot identify. That
 * comes from DepthSettings, whose defaults (one stream, zero tightness) say
 * "the class IS the field" and reproduce the plain placement percentile exactly.
 */

/* ── Observations ─────────────────────────────────────────────────── */

interface Obs {
  group: string;
  subjectId: string;
  /** score − yearAvg, the field excess we are decomposing. */
  e: number;
  /** Standardised placement inside the class. */
  z: number;
}

/** A placement we can read at all: a rank inside a cohort that can hold it. */
const ranked = (e: GradeEntry): boolean =>
  e.rank != null && e.cohortN != null && e.cohortN >= 2 && e.rank >= 1 && e.rank <= e.cohortN;

/**
 * …and one the FIT can use: it also needs a year-level mark to decompose, and it
 * must be a CLASS placement — a year-scoped rank is already a field position and
 * does not inform the class-vs-year (premium/basis) split.
 */
const fittable = (e: GradeEntry): boolean =>
  ranked(e) && e.yearAvg != null && (e.rankScope ?? "class") !== "year";

/**
 * A direct read of σ_class from reported cohort SDs (class-scoped only), shrunk
 * onto the placement-inferred value by credibility: a measurement beats an
 * inference, but a lone noisy SD should not overturn the fit. No SDs ⇒ no move.
 */
function anchorSigma(fitted: number, sdObs: number[]): number {
  if (!sdObs.length) return fitted;
  const direct = winsorizedMean(sdObs);
  if (direct == null || !(direct > 0)) return fitted;
  return Math.max(DEPTH_SIGMA_FLOOR, shrinkToward(direct, sdObs.length, fitted, DEPTH_SD_ANCHOR_K));
}

/** Hazen plotting position, standardised: rank 1 of N sits near the top. */
export const classZ = (rank: number, cohortN: number): number =>
  normQuantile(1 - (rank - 0.5) / cohortN);

/* ── Cohort geometry ──────────────────────────────────────────────── */

const bandVarCache = new Map<number, number>();

/**
 * Average within-band variance of a standard normal cut into S
 * equal-probability bands — what streaming leaves behind when it is perfect.
 * Var(band means) = (1/S)·Σ m_j² with m_j = S·(φ(a_j) − φ(b_j)), so the
 * remainder is 1 − that. S = 1 gives 1: one band removes nothing.
 */
export function withinBandVariance(streams: number): number {
  const S = Math.max(1, Math.round(streams));
  if (S === 1) return 1;
  const hit = bandVarCache.get(S);
  if (hit != null) return hit;
  let between = 0;
  for (let j = 1; j <= S; j++) {
    const a = j === 1 ? -Infinity : normQuantile((j - 1) / S);
    const b = j === S ? Infinity : normQuantile(j / S);
    const m = S * ((a === -Infinity ? 0 : normPdf(a)) - (b === Infinity ? 0 : normPdf(b)));
    between += m * m;
  }
  const v = clamp(1 - between / S, 1e-4, 1);
  bandVarCache.set(S, v);
  return v;
}

/**
 * The year-level spread implied by the within-class spread.
 *
 *     σ_class = σ_year · √(1 − ρ²·(1 − v_S))
 *
 * ρ = 0 (classes are random slices) or S = 1 (there is only one class) both
 * collapse this to σ_year = σ_class, which is the honest answer for a school
 * that does not stream. ρ = 1 makes the class exactly a truncated band.
 */
export function yearSpread(sigmaClass: number, d: DepthSettings): number {
  const rho = clamp(d.streamTightness, 0, 0.995);
  const shrink = 1 - rho * rho * (1 - withinBandVariance(d.streamsPerLevel));
  return sigmaClass / Math.sqrt(Math.max(shrink, 1e-4));
}

/* ── Penalised least squares ──────────────────────────────────────── */

/** Solve Ax = b by Gaussian elimination with partial pivoting; null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-10) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  // Full Gauss-Jordan leaves M diagonal, so each unknown reads straight off.
  return M.map((row, i) => row[n] / M[i][i]);
}

const emptyModel = (sigmaClass: number, yearSize: number, medianCohort: number): DepthModel => ({
  sigmaClass: round1(sigmaClass),
  sigmaYear: round1(sigmaClass),
  yearSize,
  medianCohort,
  groups: [],
  basis: {},
  rmse: 0,
  n: 0,
  streamed: false,
  premiumMean: 0,
  premiumSe: 0,
  fitted: false,
});

/**
 * Fit the book-wide depth model. One pass over every ranked print in every
 * subject — the fit is a property of the BOOK, not of any one desk, because
 * that is the only way a period's class strength is identifiable.
 */
export function fitDepth(entries: GradeEntry[], settings: Settings): DepthModel {
  const d = settings.depth;
  const usable = entries.filter(fittable);
  // Direct within-class spread measurements (class-scoped) anchor σ_class below.
  const sdObs = entries
    .filter((e) => e.cohortSD != null && (e.cohortSD as number) > 0 && (e.rankScope ?? "class") !== "year")
    .map((e) => e.cohortSD as number);

  const cohorts = usable.map((e) => e.cohortN as number).sort((a, b) => a - b);
  const medianCohort = cohorts.length ? cohorts[Math.floor(cohorts.length / 2)] : 30;
  const yearSize = Math.max(
    2,
    Math.round(d.yearSize ?? Math.max(1, d.streamsPerLevel) * medianCohort),
  );

  const obs: Obs[] = usable.map((e) => ({
    group: entryTermKey(e, settings.calendar),
    subjectId: e.subjectId,
    e: e.score - (e.yearAvg as number),
    z: classZ(e.rank as number, e.cohortN as number),
  }));

  const groupKeys = [...new Set(obs.map((o) => o.group))].sort();
  const subjectIds = [...new Set(obs.map((o) => o.subjectId))].sort();

  // Nothing to fit: fall back to the raw spread of the excesses.
  if (obs.length < DEPTH_MIN_PRINTS || groupKeys.length < DEPTH_MIN_GROUPS) {
    const mean = obs.length ? obs.reduce((a, o) => a + o.e, 0) / obs.length : 0;
    const v = obs.length > 1
      ? obs.reduce((a, o) => a + (o.e - mean) ** 2, 0) / (obs.length - 1)
      : DEPTH_SIGMA_FLOOR ** 2;
    return emptyModel(anchorSigma(Math.max(DEPTH_SIGMA_FLOOR, Math.sqrt(v)), sdObs), yearSize, medianCohort);
  }

  // Parameters: [premium per group, basis per desk, σ_class].
  const G = groupKeys.length;
  const S = subjectIds.length;
  const P = G + S + 1;
  const gi = new Map(groupKeys.map((k, i) => [k, i]));
  const si = new Map(subjectIds.map((k, i) => [k, G + i]));

  const A: number[][] = Array.from({ length: P }, () => new Array(P).fill(0));
  const b = new Array(P).fill(0);
  for (const o of obs) {
    const idx = [gi.get(o.group) as number, si.get(o.subjectId) as number, P - 1];
    const val = [1, 1, o.z];
    for (let a = 0; a < 3; a++) {
      b[idx[a]] += val[a] * o.e;
      for (let c = 0; c < 3; c++) A[idx[a]][idx[c]] += val[a] * val[c];
    }
  }
  // Ridge on the basis block only — the identifying penalty.
  for (let i = G; i < G + S; i++) A[i][i] += DEPTH_BASIS_SHRINK;

  const sol = solve(A, b);
  if (!sol) {
    const mean = obs.reduce((a, o) => a + o.e, 0) / obs.length;
    const v = obs.reduce((a, o) => a + (o.e - mean) ** 2, 0) / (obs.length - 1);
    return emptyModel(anchorSigma(Math.max(DEPTH_SIGMA_FLOOR, Math.sqrt(v)), sdObs), yearSize, medianCohort);
  }

  const sigmaClass = anchorSigma(Math.max(DEPTH_SIGMA_FLOOR, sol[P - 1]), sdObs);
  const basis: Record<string, number> = {};
  subjectIds.forEach((id, i) => { basis[id] = round1(sol[G + i]); });

  let sse = 0;
  for (const o of obs) {
    const fit = sol[gi.get(o.group) as number] + sol[si.get(o.subjectId) as number] + sol[P - 1] * o.z;
    sse += (o.e - fit) ** 2;
  }
  const rmse = Math.sqrt(sse / obs.length);

  const counts = new Map<string, number>();
  for (const o of obs) counts.set(o.group, (counts.get(o.group) ?? 0) + 1);
  const groups = groupKeys.map((key) => ({
    key,
    label: key.replace(/^(\d{4})-T(\d)$/, "T$2 $1"),
    premium: round1(sol[gi.get(key) as number]),
    n: counts.get(key) ?? 0,
  }));

  const prem = groups.map((g) => g.premium);
  const premiumMean = prem.reduce((a, p) => a + p, 0) / prem.length;
  const premVar = prem.length > 1
    ? prem.reduce((a, p) => a + (p - premiumMean) ** 2, 0) / (prem.length - 1)
    : 0;
  const premiumSe = Math.sqrt(premVar / prem.length);

  return {
    sigmaClass: round1(sigmaClass),
    sigmaYear: round1(yearSpread(sigmaClass, d)),
    yearSize,
    medianCohort,
    groups,
    basis,
    rmse: round1(rmse),
    n: obs.length,
    // A premium that clears its own noise floor means the classes are not
    // interchangeable — the book is streamed, whatever the settings say.
    streamed: Math.abs(premiumMean) > 2 * Math.max(premiumSe, 0.5),
    premiumMean: round1(premiumMean),
    premiumSe: round1(premiumSe),
    fitted: true,
  };
}

/* ── Reading one print ────────────────────────────────────────────── */

const premiumOf = (model: DepthModel, key: string): number =>
  model.groups.find((g) => g.key === key)?.premium ?? 0;

/**
 * Where one placement puts the student in the FIELD.
 *
 * Two routes to the same z, and they agree exactly when the fit residual is
 * zero — because premium + basis + σ_class·classZ IS score − yearAvg by
 * construction:
 *
 *   direct  (score − yearMean) / σ_year — near model-free, so it wins whenever
 *           the print carries a year-level mark.
 *   via the class — where the class sits in the year, plus where the student
 *           sits in the class. The fallback when there is no year-level mark,
 *           and the reason an unfitted book degrades EXACTLY to the placement
 *           percentile: premium and basis are 0 and σ_year is σ_class, so
 *           fieldZ collapses to classZ.
 */
function readOf(e: GradeEntry, model: DepthModel, settings: Settings): DepthRead {
  const rank = e.rank as number;
  const cohortN = e.cohortN as number;
  const z = classZ(rank, cohortN);
  // A year-scoped placement is already a field position: the "cohort" IS the year
  // level, so its z is the field z and no class-vs-year premium/basis applies.
  const yearScoped = (e.rankScope ?? "class") === "year";
  const premium = yearScoped ? 0 : premiumOf(model, entryTermKey(e, settings.calendar));
  const basis = yearScoped ? 0 : (model.basis[e.subjectId] ?? 0);
  const fieldZ = yearScoped
    ? z
    : e.yearAvg != null
      ? (e.score - e.yearAvg) / model.sigmaYear
      : (premium + basis + model.sigmaClass * z) / model.sigmaYear;
  const p = normCdf(fieldZ);
  return {
    date: e.date,
    score: e.score,
    rank,
    cohortN,
    // With no year-level mark, back it out of the field position: a year-scoped
    // z spans σ_year, a class-scoped one spans σ_class plus the class offset.
    yearAvg: e.yearAvg
      ?? round1(yearScoped ? e.score - model.sigmaYear * z : e.score - model.sigmaClass * z - premium - basis),
    classZ: round1(z),
    classPct: round1(percentileFromRank(rank, cohortN)),
    premium,
    basis,
    fieldZ: round1(fieldZ),
    fieldPct: round1(100 * p),
    fieldRank: clamp(Math.round((1 - p) * model.yearSize + 0.5), 1, model.yearSize),
  };
}

/* ── The order book ───────────────────────────────────────────────── */

/**
 * The field as a depth ladder: estimated heads at each mark level across the
 * year, the student's own mark as the touch, and their class overlaid as a
 * soft band. The class is drawn as a distribution rather than a hard slice
 * because loose streaming genuinely spills it across levels.
 *
 * The outer rungs are open-ended so the heads sum to exactly the year size.
 */
export function depthLadder(read: DepthRead, model: DepthModel): DepthLevel[] {
  const step = DEPTH_LADDER_STEP;
  const mu = read.yearAvg;
  const sy = model.sigmaYear;
  const lo = clamp(Math.floor((mu - DEPTH_LADDER_SPAN * sy) / step) * step, 0, 100 - step);
  const hi = clamp(Math.ceil((mu + DEPTH_LADDER_SPAN * sy) / step) * step, lo + step, 100);

  const classMu = mu + read.premium + read.basis;
  const cs = model.sigmaClass;
  const levels: DepthLevel[] = [];

  for (let a = lo; a < hi; a += step) {
    const bottom = a === lo;
    const top = a + step >= hi;
    const zl = bottom ? -Infinity : (a - mu) / sy;
    const zh = top ? Infinity : (a + step - mu) / sy;
    const cl = bottom ? -Infinity : (a - classMu) / cs;
    const ch = top ? Infinity : (a + step - classMu) / cs;
    const P = (x: number) => (x === Infinity ? 1 : x === -Infinity ? 0 : normCdf(x));
    levels.push({
      lo: a,
      hi: a + step,
      openLo: bottom,
      openHi: top,
      count: model.yearSize * (P(zh) - P(zl)),
      classCount: read.cohortN * (P(ch) - P(cl)),
      side: read.score >= a && (read.score < a + step || top) ? "touch" : read.score < a ? "ask" : "bid",
    });
  }
  return levels.reverse(); // a ladder reads top-down, best offer first
}

/* ── Per-desk assembly ────────────────────────────────────────────── */

/**
 * A desk's depth read. Null when the desk has never carried a placement —
 * there is nothing to say about a field position we cannot see.
 */
export function subjectDepth(
  sub: Subject,
  entries: GradeEntry[],
  model: DepthModel,
  settings: Settings,
): SubjectDepth | null {
  // Reading is looser than fitting: a placement without a year-level mark
  // still says where you stand, via the class the model already priced.
  const reads = entries.filter(ranked);
  if (!reads.length) return null;
  const history = reads.map((e) => readOf(e, model, settings));
  const latest = history[history.length - 1];
  const streams = Math.max(1, Math.round(settings.depth.streamsPerLevel));
  const classZScore = (latest.premium + latest.basis) / model.sigmaYear;
  return {
    latest,
    history,
    basis: model.basis[sub.id] ?? 0,
    ladder: depthLadder(latest, model),
    streamIndex: streams > 1 ? clamp(Math.ceil((1 - normCdf(classZScore)) * streams), 1, streams) : null,
    streamsPerLevel: streams,
  };
}

/**
 * The PEER PREMIUM tape: how strong the class around you was, period by
 * period. A step down here with placements unchanged is a reclassification —
 * the same student, a different field.
 */
export const premiumHistory = (model: DepthModel): { key: string; label: string; premium: number }[] =>
  model.groups.map(({ key, label, premium }) => ({ key, label, premium }));
