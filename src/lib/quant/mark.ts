import { clamp, pDate, round1 } from "../utils";
import {
  computeFactors, decayFactor, VOL_FLOOR,
  type BookContext, type DeskFactors, type FactorInput,
} from "./factors";
import { cusumDrift, type CusumResult } from "./cusum";
import type { EffortPressure } from "./effort";
import type { ReadinessPressure } from "./readiness";
import {
  CUSUM_H, EFFORT_ACTUAL_W, EFFORT_PLAN_W, MARK_CRED_K, MARK_MAX_DISCOUNT,
  READINESS_W, STALE_FREE_SESSION_DAYS, UPSIDE_DAMP,
} from "./params";
import type { MarkTrace } from "./trace";
import type { PremiumLine, PriceResult, Regime } from "../../types";

/**
 * The mark-to-market desk. Fair value answers "what is this desk probably
 * worth?"; the MARK answers "what would a risk-averse market actually pay for
 * it today?" — fair value minus explicit risk premia, every one an
 * attributable line item in points. Loss-averse by construction: penalties
 * charge at full weight, the only credits (steady tape, coursework upgrade)
 * are damped and can at best lift the desk back to par. The market never pays
 * above fair value.
 *
 * Small-n honesty: a premium whose factor is unavailable contributes nothing,
 * every line is capped, the sum is credibility-shrunk by n/(n+κ), and the
 * total rides a smooth tanh ceiling. Constants are tuned for this book's
 * scale — a half-dozen desks printing 5–11 times over three years.
 */

export interface MarkContext {
  staleDays: number | null;
  /** Days since the latest exam print; null when the desk has never sat one. */
  examAgeDays: number | null;
  /** Prints of any type after the latest exam — supersession decays a shock. */
  printsSinceExam: number;
  cusum: CusumResult | null;
  /**
   * The desk's share of the study week against an even share — null whenever no
   * budget is being priced (no allocation filed, or effort weighting switched
   * off), which makes both effort lines vanish rather than charge zero.
   */
  effort: EffortPressure | null;
  /**
   * The desk's centred readiness log-strength from the duel pile — null whenever
   * no pile is being priced (nothing duelled, or readiness weighting switched
   * off), which makes the line vanish rather than charge zero.
   */
  readiness: ReadinessPressure | null;
}

export interface MarkResult {
  /** The harsh price: fv − discount, 0–100. */
  mark: number;
  fv: number;
  /** fv − mark, ≥ 0. */
  discount: number;
  /** Attribution lines summing exactly to the discount; harshest first. */
  premia: PremiumLine[];
  regime: Regime;
  /** The working: factors, raw lines, credibility, saturation. */
  trace: MarkTrace;
}

/** Per-premium ceilings, pts. Credits carry their own bounds in the formulas. */
export const PREMIUM_CAPS = {
  unc: 6, vol: 7, mom: 7, lag: 4, shock: 6, down: 6, cw: 6, alpha: 5, cusum: 5, stale: 4,
  effort: 6, plan: 2.5, ready: READINESS_W,
} as const;

/** Discount bands the regime steps through: PRIME < STABLE < STRESSED < DISTRESSED. */
const REGIME_BANDS: [number, Regime][] = [
  [2.5, "PRIME"],
  [6.5, "STABLE"],
  [12.5, "STRESSED"],
];

/**
 * sd this wide is priced for free: one clean exam's reliability. Charging
 * under it would bill every desk for measurement noise the engine itself
 * asserts is irreducible — and double-count the instability premium, which
 * already prices the swing that fattens sd.
 */
export const UNC_FREE_SD = 5;
export const UNC_WEIGHT = 0.6;
/**
 * SCHOOL days of silence before the stale premium accrues. Sessions are the
 * market clock (see decayFactor and lib/calendar.ts): a term gap is free, a
 * holiday cannot age anyone, a vanished desk is not free.
 */
const STALE_FREE_DAYS = STALE_FREE_SESSION_DAYS;

interface FvView {
  price: number;
  sd: number;
  horizonDays: number;
}

const cap = (key: keyof typeof PREMIUM_CAPS, pts: number): number =>
  Math.min(PREMIUM_CAPS[key], pts);

/**
 * The unshrunk premium lines. Order here is the charge sheet, not the
 * waterfall — markDesk re-sorts by size after attribution.
 */
export function rawPremia(
  fv: FvView,
  f: DeskFactors,
  _book: BookContext,
  ctx: MarkContext,
): PremiumLine[] {
  const lines: PremiumLine[] = [];
  // Full precision here — rounding is markDesk's display concern.
  const add = (key: string, label: string, pts: number, note: string) => {
    if (Math.abs(pts) >= 0.05) lines.push({ key, label, pts, note });
  };
  const H = fv.horizonDays / 30;

  // UNCERTAINTY — fat error bars cost; the market pays for what it can trust.
  add("unc", "UNCERTAINTY", cap("unc", UNC_WEIGHT * Math.max(0, fv.sd - UNC_FREE_SD)), `±${fv.sd.toFixed(1)} WIDE`);

  // INSTABILITY — own print-to-print swing, scaled by how it sits vs the book,
  // with a kicker when the recent tape is expanding vs its own history.
  const relScale = clamp(f.volRatio ?? 1, 0.6, 1.6);
  const expansion = f.volExpansion != null && f.volExpansion > 1.3 ? 1.5 * Math.min(f.volExpansion - 1.3, 1) : 0;
  add(
    "vol", "INSTABILITY",
    cap("vol", 0.55 * Math.max(0, f.vol - VOL_FLOOR) * relScale + expansion),
    `RMSSD ${f.vol.toFixed(1)}${f.volRatio != null && f.volRatio >= 1.1 ? ` · ${f.volRatio.toFixed(1)}× BOOK` : ""}`,
  );

  // MOMENTUM — the points the τ-gated trend bleeds over one rating horizon.
  add("mom", "MOMENTUM", cap("mom", Math.max(0, -f.slope30) * H), `BLEEDING ${Math.abs(f.slope30).toFixed(1)}/30D`);

  // RELATIVE LAG — trailing the book's own drift even while looking flat.
  if (f.relSlope30 != null) {
    add("lag", "REL LAG", cap("lag", 0.8 * Math.max(0, -f.relSlope30) * H), `${Math.abs(f.relSlope30).toFixed(1)}/30D UNDER BOOK`);
  }

  // EXAM SHOCK — the latest exam under its winsorized trail, in honest sigma,
  // fading as newer prints supersede it and the calendar moves on.
  if (f.shockZ != null && f.shockZ < 0) {
    const decay = decayFactor(ctx.printsSinceExam, ctx.examAgeDays ?? 0);
    add("shock", "EXAM SHOCK", cap("shock", 1.6 * -f.shockZ * decay), `LAST EXAM ${f.shockZ.toFixed(1)}σ UNDER TRAIL`);
  }

  // DOWNSIDE — semideviation plus the streaks: misses against the standing
  // estimate and strictly-lower exam prints.
  const downParts: string[] = [];
  if (f.semiDev > 0) downParts.push(`SEMIDEV ${f.semiDev.toFixed(1)}`);
  if (f.missStreak > 0) downParts.push(`${f.missStreak} MISS STREAK`);
  if (f.downStreak > 0) downParts.push(`${f.downStreak} DOWN STREAK`);
  add(
    "down", "DOWNSIDE",
    cap("down", 0.4 * f.semiDev + 0.7 * Math.min(f.missStreak, 4) + 0.5 * Math.min(f.downStreak, 4)),
    downParts.join(" · ") || "—",
  );

  // CW DIVERGENCE — coursework never pays the grade, but it prices the next
  // exam. Loss-averse: a coursework tape talking the exam DOWN charges fully
  // (deeper when the tape itself is sinking); talking it UP credits damped.
  const cw = f.coursework;
  if (cw.surpriseZ != null) {
    if (cw.surpriseZ < 0) {
      const sinking = cw.cwSlope30 != null && cw.cwSlope30 < 0 ? 0.5 * Math.min(-cw.cwSlope30, 3) : 0;
      add(
        "cw", "CW DIVERGENCE",
        cap("cw", 1.4 * -cw.surpriseZ + sinking),
        cw.impliedExam != null ? `CW PRICES NEXT EXAM ${cw.impliedExam.toFixed(0)}` : "CW TAPE DIVERGING",
      );
    } else {
      add("cw", "CW UPGRADE", -Math.min(1.4 * cw.surpriseZ, 3) * UPSIDE_DAMP, "CW TAPE TALKS EXAM UP — DAMPED");
    }
  }

  // ALPHA EROSION — the moat closing, and trading under your own reference.
  const alphaParts: string[] = [];
  if (f.alphaCollapse != null && f.alphaCollapse < 0) alphaParts.push(`MOAT ${f.alphaCollapse.toFixed(1)}`);
  if (f.alphaLatest != null && f.alphaLatest < 0) alphaParts.push(`${Math.abs(f.alphaLatest).toFixed(1)} UNDER REF`);
  add(
    "alpha", "ALPHA EROSION",
    cap("alpha", 0.5 * Math.max(0, -(f.alphaCollapse ?? 0)) + 0.35 * Math.max(0, -(f.alphaLatest ?? 0))),
    alphaParts.join(" · ") || "—",
  );

  // DRIFT ALARM — the CUSUM has fired: sustained bleed beyond noise.
  if (ctx.cusum?.alarm) {
    add("cusum", "DRIFT ALARM", cap("cusum", 1.2 * Math.min(ctx.cusum.stat - CUSUM_H + 1, 4)), `${ctx.cusum.stat.toFixed(1)}σ SUSTAINED BLEED`);
  }

  // EFFORT — the desk's share of the study week against an EVEN share of the
  // same week. Two rings, two lines, deliberately unequal: what you MEASURED
  // yourself spending is evidence and charges at full weight; what you merely
  // PLANNED is an intention and charges at about a third of it. Loss-averse
  // like the rest of the sheet — starving a desk costs, lavishing it credits
  // only a damped fraction, because an hour has never been shown to buy a
  // point on this book and the engine refuses to pretend otherwise.
  if (ctx.effort) {
    const e = ctx.effort;
    const share = (r: number) => `${Math.round(r * 100)}% OF AN EVEN SHARE`;
    const hrs = (h: number | null) => (h == null ? "" : `${h.toFixed(1)}H/WK · `);
    if (e.actualRatio != null) {
      const deficit = clamp(1 - e.actualRatio, 0, 1);
      const surplus = clamp(e.actualRatio - 1, 0, 1);
      if (deficit > 0) {
        add("effort", "EFFORT DEFICIT", cap("effort", EFFORT_ACTUAL_W * deficit), `${hrs(e.actualHours)}${share(e.actualRatio)} SPENT`);
      } else {
        add("effort", "EFFORT SURPLUS", -EFFORT_ACTUAL_W * surplus * UPSIDE_DAMP, `${hrs(e.actualHours)}OVER-RESOURCED — DAMPED CREDIT`);
      }
    }
    const planDeficit = clamp(1 - e.planRatio, 0, 1);
    const planSurplus = clamp(e.planRatio - 1, 0, 1);
    if (planDeficit > 0) {
      add("plan", "PLAN DEFICIT", cap("plan", EFFORT_PLAN_W * planDeficit), `${hrs(e.planHours)}${share(e.planRatio)} PLANNED`);
    } else {
      add("plan", "PLAN SURPLUS", -EFFORT_PLAN_W * planSurplus * UPSIDE_DAMP, `${hrs(e.planHours)}FAVOURED IN THE PLAN — DAMPED CREDIT`);
    }
  }

  // READINESS — the forced-choice pile (D2), read as Bradley-Terry log-strength
  // and CENTRED across the cross-section, so what it charges one desk it credits
  // another: a gut call about which paper you are readier for is information
  // about ordering and is not allowed to move the book's level. Loss-averse like
  // the rest of the sheet, which leaves a small net charge on an unevenly
  // prepared book — dispersion in readiness is itself a risk (§15c). Scaled by
  // the pile's own credibility: how many answers it holds, and how well the
  // orderings it implied have actually predicted exam orderings.
  if (ctx.readiness) {
    const r = ctx.readiness;
    const odds = (l: number) => `${Math.round((1 / (1 + Math.exp(-Math.abs(l)))) * 100)}% PICK`;
    const record = `${r.wins}-${r.losses} IN THE ARENA`;
    if (r.lambda < 0) {
      add("ready", "READINESS", cap("ready", READINESS_W * clamp(-r.lambda, 0, 1) * r.credibility), `LEAST READY · ${odds(r.lambda)} AGAINST · ${record}`);
    } else {
      add("ready", "READINESS EDGE", -READINESS_W * clamp(r.lambda, 0, 1) * r.credibility * UPSIDE_DAMP, `READIEST · ${odds(r.lambda)} FOR · ${record} — DAMPED CREDIT`);
    }
  }

  // STALE TAPE — an unpriced desk decays toward caution.
  if (ctx.staleDays != null) {
    add("stale", "STALE TAPE", cap("stale", Math.max(0, ctx.staleDays - STALE_FREE_DAYS) / 30), `${Math.round(ctx.staleDays)} SESSION DAYS SINCE PRINT`);
  }

  // CONSISTENCY — the one standing credit: a tight, honest tape earns back
  // toward par. Never past it.
  if (f.consistent) {
    add("steady", "CONSISTENCY", -Math.min(2, 1 + 0.3 * Math.max(0, 3.5 - f.vol)), "TIGHT TAPE — CREDIT");
  }

  return lines;
}

export function markDesk(
  fv: FvView,
  f: DeskFactors,
  book: BookContext,
  ctx: MarkContext,
  opts?: { drop?: ReadonlySet<string> },
): MarkResult {
  // Ablation seam: drop named premium lines before shrinkage/attribution. The
  // default (no drop) keeps every line, so the pass is byte-identical to before.
  const lines = opts?.drop ? rawPremia(fv, f, book, ctx).filter((l) => !opts.drop!.has(l.key)) : rawPremia(fv, f, book, ctx);
  const sum = lines.reduce((a, l) => a + l.pts, 0);
  const raw = Math.max(0, sum);
  const cred = f.n / (f.n + MARK_CRED_K);
  const disc = raw > 0 ? MARK_MAX_DISCOUNT * Math.tanh((cred * raw) / MARK_MAX_DISCOUNT) : 0;
  const mark = round1(clamp(fv.price - disc, 0, 100));
  const discount = round1(Math.max(0, fv.price - mark));
  const trace: MarkTrace = {
    factors: f,
    book,
    cusum: ctx.cusum,
    staleDays: ctx.staleDays,
    examAgeDays: ctx.examAgeDays,
    printsSinceExam: ctx.printsSinceExam,
    effort: ctx.effort,
    readiness: ctx.readiness,
    raw: lines,
    rawSum: sum,
    floored: raw,
    cred,
    shrink: sum > 0 ? discount / sum : 0,
    H: fv.horizonDays / 30,
  };

  // Attribution: scale every line by the same shrink so the waterfall sums to
  // the discount exactly — the credibility and tanh haircuts are allocated
  // proportionally, then the rounding remainder lands on the largest line.
  let premia: PremiumLine[] = [];
  if (discount > 0 && sum > 0) {
    const shrink = discount / sum;
    premia = lines
      .map((l) => ({ ...l, pts: round1(l.pts * shrink) }))
      .filter((l) => Math.abs(l.pts) >= 0.05);
    const shown = premia.reduce((a, l) => a + l.pts, 0);
    const resid = round1(discount - shown);
    if (resid !== 0 && premia.length) {
      let big = 0;
      for (let i = 1; i < premia.length; i++) if (Math.abs(premia[i].pts) > Math.abs(premia[big].pts)) big = i;
      premia[big] = { ...premia[big], pts: round1(premia[big].pts + resid) };
    }
    premia.sort((a, b) => b.pts - a.pts);
  }

  let regime: Regime = "DISTRESSED";
  // Regime reads off the TRUE risk charge `disc`, not the display `discount`.
  // When fair value is so low that fv − disc would go negative, mark floors at 0
  // and the display discount (fv − mark) is truncated below the real charge —
  // reading the regime off it would let the MOST distressed desk report a milder
  // band, even PRIME (fv 2, disc 5 ⇒ discount 2 ⇒ PRIME). The charge is what the
  // regime classifies; the floor is only a display bound on the price.
  for (const [band, r] of REGIME_BANDS) {
    if (disc < band) { regime = r; break; }
  }
  if (ctx.cusum?.alarm && (regime === "PRIME" || regime === "STABLE")) regime = "STRESSED";

  return { mark, fv: fv.price, discount, premia, regime, trace };
}

/**
 * One marking sweep over a book: factors are cross-sectional (relative lag,
 * vol vs the book median), so desks are only ever marked together. Marks from
 * `quant.fv`, so the pass is idempotent on already-marked results.
 */
export function markBook(
  inputs: FactorInput[],
  todayIso: string,
  opts?: { drop?: ReadonlySet<string> },
): Map<string, MarkResult> {
  const { book, desks } = computeFactors(inputs, todayIso);
  const byId = new Map(desks.map((d) => [d.id, d]));
  const today = pDate(todayIso).getTime();
  const out = new Map<string, MarkResult>();
  for (const inp of inputs) {
    const q = inp.quant;
    const f = byId.get(inp.sub.id);
    if (!q || !f || !inp.entries.length) continue;
    let examAgeDays: number | null = null;
    let printsSinceExam = 0;
    for (let i = inp.entries.length - 1; i >= 0; i--) {
      if (inp.entries[i].type === "Exam") {
        examAgeDays = Math.max(0, Math.round((today - pDate(inp.entries[i].date).getTime()) / 86400000));
        break;
      }
      printsSinceExam++;
    }
    const ctx: MarkContext = {
      staleDays: inp.staleDays,
      examAgeDays,
      printsSinceExam,
      cusum: cusumDrift(inp.entries),
      effort: inp.effort ?? null,
      readiness: inp.readiness ?? null,
    };
    out.set(inp.sub.id, markDesk({ price: q.fv, sd: q.sd, horizonDays: q.horizonDays }, f, book, ctx, opts));
  }
  return out;
}

/** Stamp a mark onto a priced desk: price becomes the mark, fv stays put. */
export function applyMark(quant: PriceResult, m: MarkResult): PriceResult {
  return {
    ...quant,
    price: m.mark,
    fv: m.fv,
    discount: m.discount,
    premia: m.premia,
    regime: m.regime,
    trace: quant.trace ? { ...quant.trace, mark: m.trace } : undefined,
  };
}
