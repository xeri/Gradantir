import { clamp } from "../utils";
import { median, normCdf } from "./robust";
import {
  BENCHMARK_MIN_DESKS, ECM_ADJUSTMENT, Q_PER_DAY, RATING_BAND, RATING_CREDIBILITY_K,
  RATING_FRESH_HALF_SESSION_DAYS, RATING_STRONG_MULT,
} from "./params";
import type { AnalystView, ForwardView, PriceResult, Rating, RatingResult, Subject } from "../../types";

/**
 * The analyst desk. The four ensemble members are four analysts: each carries
 * its own lens (adaptive level, recent form, long-run mean, gated momentum),
 * each is weighted by how well it actually forecast the prints it had not yet
 * seen, and each publishes an expected TOTAL RETURN over the desk's own
 * horizon — capital move plus exam carry:
 *
 *   rₘ = (Tₘ − Mₘ) + φ(Mₘ − FV) + carry
 *        momentum      convergence    exam carry
 *
 * The middle term is an error-correction: an analyst who thinks the desk is
 * mispriced expects a share φ of that gap to close. It is measured against
 * FAIR VALUE, because fair value IS the weighted member mean — so the gaps
 * cancel exactly and the term makes the analysts disagree honestly without
 * ever moving the call. Against the mark they would sum to the discount
 * instead, quietly paying every distressed desk φ·𝒟 for being cheap.
 *
 * A rating is the weighted consensus of that return MEASURED AGAINST THE BOOK.
 * A term where every desk rises is not a book full of buys.
 *
 * Deliberately orthogonal to the advisor: the advisor answers "where is the
 * stress?", a rating answers "which way is this desk headed?".
 */

/** Strongest to weakest — the order the consensus bar is drawn in. */
export const RATINGS: Rating[] = ["STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL", "N/A"];

/** Position on the scale, 0 = STRONG BUY. N/A sits outside it. */
export const RATING_RANK: Record<Rating, number> = {
  "STRONG BUY": 0, BUY: 1, HOLD: 2, SELL: 3, "STRONG SELL": 4, "N/A": 5,
};

/** A rating change worth printing on the wire — never to or from N/A. */
export function ratingMove(prev: Rating | null, now: Rating): "UPGRADE" | "DOWNGRADE" | null {
  if (!prev || prev === now || prev === "N/A" || now === "N/A") return null;
  return RATING_RANK[now] < RATING_RANK[prev] ? "UPGRADE" : "DOWNGRADE";
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const emptyDistribution = (): Record<Rating, number> =>
  ({ "STRONG BUY": 0, BUY: 0, HOLD: 0, SELL: 0, "STRONG SELL": 0, "N/A": 0 });

/** Blend weights renormalized over the members that actually published. */
function normalized(views: ForwardView[]): number[] {
  const total = views.reduce((a, v) => a + v.weight, 0);
  return total > 0 ? views.map((v) => v.weight / total) : views.map(() => 1 / views.length);
}

/**
 * What actually drives the consensus: each member's own drift plus the desk's
 * carry. This is the part that survives the weighted average.
 */
const coreReturns = (views: ForwardView[], carry: number): number[] =>
  views.map((v) => v.mean - v.now + carry);

/**
 * What each analyst publishes: the core return plus the share of its own gap
 * to FAIR VALUE it expects to close.
 *
 * The gap is measured against fv, not the mark, because the identity that
 * makes this term honest — Σ wₘ(Mₘ − PX) = 0 — holds only when PX is the
 * weighted member mean, and the weighted member mean IS fair value. Measured
 * against the mark the gaps would sum to the discount instead of to zero, and
 * every analyst on a distressed desk would publish φ·𝒟 of pure bookkeeping.
 */
const viewReturns = (views: ForwardView[], carry: number, fv: number): number[] =>
  views.map((v) => v.mean - v.now + ECM_ADJUSTMENT * (v.now - fv) + carry);

/** One desk's consensus expected return over its horizon, in points. */
function consensusReturn(quant: PriceResult): number | null {
  if (!quant.forward.length) return null;
  const w = normalized(quant.forward);
  return coreReturns(quant.forward, quant.carry).reduce((a, r, i) => a + w[i] * r, 0);
}

/**
 * The book's own expected return over the horizon: what a desk must beat to
 * earn a BUY. Median, not mean — with six desks one runaway line must not set
 * the bar. Below three priced desks there is no cross-section, so desks are
 * rated absolute and the UI says so.
 */
export function benchmarkDrift(quants: (PriceResult | null)[]): number | null {
  const rs: number[] = [];
  for (const q of quants) {
    if (!q) continue;
    const r = consensusReturn(q);
    if (r != null) rs.push(r);
  }
  return rs.length >= BENCHMARK_MIN_DESKS ? median(rs) : null;
}

const bucket = (z: number, band: number): Rating => {
  const strong = RATING_STRONG_MULT * band;
  if (z >= strong) return "STRONG BUY";
  if (z >= band) return "BUY";
  if (z <= -strong) return "STRONG SELL";
  if (z <= -band) return "SELL";
  return "HOLD";
};

const uncovered = (note: string): RatingResult => ({
  rating: "N/A", score: 0, conviction: 0,
  target: null, targetLo: null, targetHi: null, upside: null,
  horizon: 0, expected: 0, benchmark: 0, dispersion: 0, risk: 0, band: RATING_BAND,
  views: [], distribution: emptyDistribution(), note,
});

export interface RateContext {
  /** The mark — what targets are quoted off. */
  price: number;
  /**
   * Fair value — the weighted member mean, and therefore the only anchor the
   * convergence term can use without the gaps summing to the discount.
   * Defaults to `price` for callers that never marked (tests, thin books).
   */
  fv?: number;
  /** Exam carry — what the next exam is expected to print over fair value. */
  carry: number;
  /** Prints behind the views — drives Bühlmann credibility. */
  n: number;
  staleDays: number;
  horizon: number;
  /** The book's expected return over the same horizon; null = rate absolute. */
  benchmark: number | null;
}

/**
 * One desk's consensus:
 *
 *   rₘ = (Tₘ − Mₘ) + φ(Mₘ − FV) + carry        each analyst's total return
 *   r̄  = Σ wₘ rₘ                               the consensus (φ nets to zero)
 *   D  = √(Σ wₘ (rₘ − r̄)²)                     how far apart they publish
 *   nₑff = 1 / Σ wₘ²                           Kish's effective analyst count
 *   s  = √(q·H + D²core/nₑff)                  drift noise + consensus error
 *   z  = (r̄ − b) / s                           risk-adjusted excess over the book
 *   z* = z · n/(n+κ) · 2^(−stale/60)           credibility × information decay
 *
 * Disagreement is priced as estimation error, not as a wider goalpost: four
 * analysts splitting is weaker evidence than four agreeing, but a validated
 * trend can still carry a call. The consensus error uses only the spread of
 * the momentum+carry part (D²core) — the convergence term contributes nothing
 * to r̄, so its spread cannot be error in r̄. The full D scores the analysts
 * against each other.
 */
export function rateDesk(views: ForwardView[], ctx: RateContext): RatingResult {
  if (ctx.n === 0 || !views.length) return uncovered("NO COVERAGE — THE LINE OPENS WITH ITS FIRST PRINT");

  const b = ctx.benchmark ?? 0;
  const w = normalized(views);
  const core = coreReturns(views, ctx.carry);
  const rs = viewReturns(views, ctx.carry, ctx.fv ?? ctx.price);

  const expected = core.reduce((a, r, i) => a + w[i] * r, 0);
  // The consensus error carries only the spread of what the consensus is made
  // of; the convergence term nets to zero and cannot be error in the mean.
  const coreSpread = Math.sqrt(core.reduce((a, r, i) => a + w[i] * (r - expected) * (r - expected), 0));
  const dispersion = Math.sqrt(rs.reduce((a, r, i) => a + w[i] * (r - expected) * (r - expected), 0));
  const nEff = 1 / w.reduce((a, x) => a + x * x, 0);
  const risk = Math.sqrt(Q_PER_DAY * ctx.horizon + (coreSpread * coreSpread) / nEff);

  // risk is 0 only in the degenerate corner where the horizon is zero (an exam
  // dated today) AND the analysts are unanimous — no dispersion, no drift noise.
  // There is no risk-adjusted signal to read there, so z is flat rather than NaN.
  const z = risk > 0 ? (expected - b) / risk : 0;
  const credibility = ctx.n / (ctx.n + RATING_CREDIBILITY_K);
  // Staleness is school days: a rating cannot decay over a holiday nobody
  // could have printed in.
  const freshness = Math.pow(2, -Math.max(0, ctx.staleDays) / RATING_FRESH_HALF_SESSION_DAYS);
  const score = z * credibility * freshness;

  // An individual analyst is scored against the SPREAD OF OPINION it sits in:
  // a lone dissenter among four agreeing desks is an extreme call, the same
  // number among four scattered ones is not.
  const viewRisk = Math.sqrt(Q_PER_DAY * ctx.horizon + (dispersion * dispersion) / nEff);
  const analysts: AnalystView[] = views.map((v, i) => {
    const vz = viewRisk > 0 ? (rs[i] - b) / viewRisk : 0;
    return {
      name: v.name,
      weight: Math.round(w[i] * 100),
      ret: round2(rs[i]),
      target: Math.round(clamp(ctx.price + rs[i], 0, 100) * 10) / 10,
      z: round2(vz),
      rating: bucket(vz, RATING_BAND),
    };
  });
  const distribution = emptyDistribution();
  for (const a of analysts) distribution[a.rating]++;

  const target = clamp(ctx.price + expected, 0, 100);
  const targets = analysts.map((a) => a.target);
  // One print is a data point, not a view — every member is echoing the same
  // shrunk prior, so the desk stays uncovered no matter how the numbers land.
  const rating: Rating = ctx.n < 2 ? "N/A" : bucket(score, RATING_BAND);

  let note: string;
  if (ctx.n < 2) note = "COVERAGE INITIATED — ONE PRINT IS NOT A VIEW";
  else if (ctx.staleDays >= 30) note = `SIGNAL DECAYED — ${Math.round(ctx.staleDays)} SESSION DAYS SINCE LAST PRINT`;
  else if (ctx.benchmark == null) note = "RATED ABSOLUTE — BOOK TOO THIN FOR A BENCHMARK";
  else note = `EXPECTED ${expected >= 0 ? "+" : ""}${expected.toFixed(1)} VS BOOK ${b >= 0 ? "+" : ""}${b.toFixed(1)} PTS / ${ctx.horizon}D`;

  return {
    rating,
    score: round2(score),
    // P(the excess really has the sign we called), from the same statistic.
    conviction: Math.round(100 * (2 * normCdf(Math.abs(score)) - 1)),
    target: Math.round(target * 10) / 10,
    targetLo: Math.min(...targets),
    targetHi: Math.max(...targets),
    upside: ctx.price > 0 ? round2(100 * ((target - ctx.price) / ctx.price)) : null,
    horizon: ctx.horizon,
    expected: round2(expected),
    benchmark: round2(b),
    dispersion: round2(dispersion),
    risk: round2(risk),
    band: RATING_BAND,
    views: analysts,
    distribution,
    note,
  };
}

export interface RatingInput {
  sub: Subject;
  quant: PriceResult | null;
  /** Prints on the desk. */
  n: number;
  staleDays: number | null;
  /**
   * Still trading? A delisted desk is rated (its last call stands, frozen) but
   * never sets the bar: the benchmark is a FORWARD quantity — the return the
   * book expects over the coming horizon — and a subject you will not sit
   * again has no forward return to contribute. Defaults to true.
   */
  listed?: boolean;
}

/**
 * One cross-sectional pass: establish the book's expected return, then rate
 * every desk against it — including the rating that stood before the latest
 * print, so an upgrade or downgrade is attributable to that print alone.
 */
export function rateBook(inputs: RatingInput[]): Map<string, { rating: RatingResult; prev: Rating | null }> {
  const benchmark = benchmarkDrift(inputs.filter((i) => i.listed !== false).map((i) => i.quant));
  const out = new Map<string, { rating: RatingResult; prev: Rating | null }>();

  for (const { sub, quant, n, staleDays } of inputs) {
    if (!quant) {
      out.set(sub.id, { rating: uncovered("NO COVERAGE — THE LINE OPENS WITH ITS FIRST PRINT"), prev: null });
      continue;
    }
    const ctx: RateContext = {
      price: quant.price,
      fv: quant.fv,
      carry: quant.carry,
      n,
      staleDays: staleDays ?? 0,
      horizon: quant.horizonDays,
      benchmark,
    };
    const rating = rateDesk(quant.forward, ctx);
    // The prior call is the same book benchmark against the desk as it stood
    // one print ago — price, carry and views all rewound — so a change is
    // attributable to that print and nothing else.
    const prev =
      quant.prevForward && n >= 2
        ? rateDesk(quant.prevForward, {
            ...ctx,
            n: n - 1,
            price: quant.prevPrice ?? quant.price,
            // prevPrice is the rewound ENSEMBLE mean, i.e. the previous fair
            // value — which is exactly the anchor the convergence term wants.
            fv: quant.prevPrice ?? quant.fv,
            carry: quant.prevCarry ?? quant.carry,
          }).rating
        : null;
    out.set(sub.id, { rating, prev });
  }
  return out;
}
