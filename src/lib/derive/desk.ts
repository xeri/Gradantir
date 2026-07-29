/**
 * Derivations for Part IV — the analyst desk and the advisor.
 *
 * Three orthogonal axes run the terminal and the interface deliberately never
 * blends them: the MARK is level, the RATING is direction, the ADVISOR is
 * urgency. A desk can be DISTRESSED and STRONG BUY at once — badly damaged and
 * turning — which is precisely the position worth working on, and precisely
 * the reading a single blended "score" would destroy. These make the second
 * and third axes checkable.
 */

import {
  BENCHMARK_MIN_DESKS, ECM_ADJUSTMENT, Q_PER_DAY, RATING_BAND, RATING_CREDIBILITY_K,
  RATING_FRESH_HALF_SESSION_DAYS, RATING_STRONG_MULT,
} from "../quant/params";
import { STALE_FREE_DAYS, STALE_SPAN_DAYS } from "../quant/advisor";
import { fmt, sgn, v, type Derivation, type DeriveCtx } from "./types";

const MEMBER_LABEL: Record<string, string> = { kalman: "KALMAN", ewma: "EWMA", shrunk: "MEAN", trend: "TREND" };

export function ratingScore(ctx: DeriveCtx): Derivation | null {
  const s = ctx.stat;
  if (!s) return null;
  const r = s.rating;
  const n = s.entries.length;
  if (!r.views.length) return null;

  const cred = n / (n + RATING_CREDIBILITY_K);
  const fresh = Math.pow(2, -Math.max(0, s.staleDays ?? 0) / RATING_FRESH_HALF_SESSION_DAYS);
  const z = r.risk > 0 ? (r.expected - r.benchmark) / r.risk : 0;
  // From the EXACT member weights, not the whole-percent ones the interface
  // prints: four equal analysts must read n_eff = 4.00, not 3.99.
  const fw = s.quant?.forward ?? [];
  const wSum = fw.reduce((a, x) => a + x.weight, 0);
  const w = wSum > 0 ? fw.map((x) => x.weight / wSum) : fw.map(() => 1 / Math.max(1, fw.length));
  const nEff = w.length ? 1 / w.reduce((a, x) => a + x * x, 0) : 0;
  const strong = Math.round(RATING_STRONG_MULT * RATING_BAND * 100) / 100;

  return {
    id: "rating.score",
    title: "CONSENSUS · RISK-ADJUSTED EXCESS",
    symbol: "z^{\\ast}",
    claim:
      "WHICH WAY IS THIS DESK HEADED, RELATIVE TO THE BOOK? A TERM IN WHICH EVERYTHING RISES IS NOT A BOOK FULL OF BUYS.",
    steps: [
      {
        tex: `\\bar r = \\sum_m w_m r_m, \\qquad D = \\sqrt{\\sum_m w_m (r_m - \\bar r)^2}, \\qquad n_{\\text{eff}} = \\Big(\\sum_m w_m^2\\Big)^{-1}`,
        subst: `\\bar r = ${v(r.expected, 2)}, \\qquad D = ${v(r.dispersion, 2)}, \\qquad n_{\\text{eff}} = ${v(nEff, 2)}`,
        note: "n_eff IS KISH'S EFFECTIVE COUNT: FOUR ANALYSTS ONE OF WHICH CARRIES 90% OF THE WEIGHT ARE NOT FOUR ANALYSTS.",
      },
      {
        tex: `s = \\sqrt{q\\,H + \\frac{D_{\\text{core}}^2}{n_{\\text{eff}}}}, \\qquad q = ${Q_PER_DAY}\\;\\text{pts}^2/\\text{day}, \\quad H = ${r.horizon}\\;\\text{days}`,
        subst: `s = ${v(r.risk, 2)}\\;\\text{pts}`,
        note: "DISAGREEMENT IS PRICED AS ESTIMATION ERROR, NOT AS A WIDER GOALPOST. FOUR ANALYSTS SPLITTING IS WEAKER EVIDENCE THAN FOUR AGREEING, BUT A VALIDATED TREND CAN STILL CARRY A CALL.",
      },
      {
        tex: `z = \\frac{\\bar r - b}{s}, \\qquad \\boxed{\\; z^{\\ast} = z \\cdot \\frac{n}{n+\\kappa}\\cdot 2^{-\\text{stale}/${RATING_FRESH_HALF_SESSION_DAYS}} \\;}`,
        subst: `z^{\\ast} = \\frac{${v(r.expected, 2)} - (${v(r.benchmark, 2)})}{${v(r.risk, 2)}}\\cdot ${v(cred, 3)}\\cdot ${v(fresh, 3)} \\;=\\; ${v(r.score, 2)}`,
        note: "CREDIBILITY AND INFORMATION DECAY, IN THAT ORDER: A THIN DESK IS NOT LOUD, AND A SILENT ONE FADES.",
      },
      {
        tex: `\\text{BUY/SELL at } |z^{\\ast}| \\ge ${RATING_BAND}, \\qquad \\text{STRONG at } |z^{\\ast}| \\ge ${strong}, \\qquad n < 2 \\Rightarrow \\text{N/A}`,
        subst: `|z^{\\ast}| = ${v(Math.abs(r.score), 2)} \\;\\Longrightarrow\\; \\textsf{${r.rating}}`,
      },
    ],
    inputs: [
      { sym: "\\bar r", label: "consensus return", value: sgn(r.expected, 2) },
      { sym: "b", label: "book benchmark", value: sgn(r.benchmark, 2) },
      { sym: "s", label: "risk", value: `±${r.risk.toFixed(2)}` },
      { sym: "D", label: "analyst dispersion", value: fmt(r.dispersion, 2) },
      { sym: "z", label: "raw excess", value: sgn(z, 2) },
      { sym: "Z", label: "credibility", value: fmt(cred, 3) },
      { sym: "2^{-\\text{st}/h}", label: "freshness", value: fmt(fresh, 3) },
      { sym: "H", label: "horizon", value: `${r.horizon}d` },
    ],
    result: { tex: "z^{\\ast}", value: sgn(r.score, 2) },
    gates: [
      { text: "n ≥ 2 — one print is a data point, not a view", pass: n >= 2 },
      // Count the desks that actually set the bar, rather than sniffing the note
      // for the word "ABSOLUTE": benchmarkDrift takes the median forward drift of
      // the listed priced desks and needs BENCHMARK_MIN_DESKS of them. A genuine
      // benchmark of exactly 0 would have failed the old `r.benchmark !== 0` test.
      {
        text: `≥ ${BENCHMARK_MIN_DESKS} priced desks for a book benchmark`,
        pass: (ctx.stats ?? []).filter((d) => d.sub.archived !== true && d.quant != null).length >= BENCHMARK_MIN_DESKS,
      },
    ],
    refs: ["kish1965", "buhlmann1967"],
    related: ["rating.return", "rating.conviction", "rating.benchmark"],
    source: "src/lib/quant/ratings.ts · rateDesk",
  };
}

export function ratingReturn(ctx: DeriveCtx): Derivation | null {
  const s = ctx.stat;
  const q = s?.quant;
  if (!s || !q || !s.rating.views.length) return null;
  const rows = s.rating.views
    .map((a) => `${MEMBER_LABEL[a.name] ?? a.name} & ${a.weight}\\% & ${fmt(a.ret, 2)} & ${fmt(a.target, 1)} & ${fmt(a.z, 2)} \\\\`)
    .join(" ");
  return {
    id: "rating.return",
    title: "ANALYST RETURNS · MOMENTUM + CONVERGENCE + CARRY",
    symbol: "r_m",
    claim: "EACH FORECASTER RE-EVALUATED ONE HORIZON OUT, PUBLISHING AN EXPECTED TOTAL RETURN.",
    steps: [
      {
        tex: `r_m \\;=\\; \\underbrace{(T_m - M_m)}_{\\text{momentum}} \\;+\\; \\underbrace{\\varphi\\,(M_m - \\mathrm{FV})}_{\\text{convergence}} \\;+\\; \\underbrace{c}_{\\text{carry}}, \\qquad \\varphi = ${ECM_ADJUSTMENT}`,
        note: "CONVERGENCE IS AN ERROR-CORRECTION TERM: AN ANALYST THAT THINKS THE DESK IS MISPRICED EXPECTS A SHARE φ OF ITS OWN GAP TO CLOSE. THE CARRY c IS WHAT THE NEXT EXAM IS EXPECTED TO PRINT OVER FAIR VALUE.",
      },
      {
        tex: `\\sum_m w_m (M_m - \\mathrm{FV}) \\;=\\; 0 \\qquad\\text{since}\\qquad \\mathrm{FV} = \\sum_m w_m M_m`,
        note: "THE GAP IS MEASURED AGAINST FAIR VALUE, WHICH IS THE WEIGHTED MEMBER MEAN — SO THE GAPS CANCEL EXACTLY AND THE TERM MAKES THE ANALYSTS DISAGREE WITHOUT MOVING THE CONSENSUS. AGAINST THE MARK THEY WOULD SUM TO THE DISCOUNT INSTEAD, PAYING EVERY DAMAGED DESK φ𝒟 FOR BEING CHEAP.",
      },
      {
        tex: `\\bar r \\;=\\; \\sum_m w_m r_m \\;=\\; \\sum_m w_m (T_m - M_m) + c`,
        subst: `\\bar r \\;=\\; ${sgn(s.rating.expected, 2)}\\;\\text{pts}`,
        note: "WHICH IS WHY THE CONSENSUS READS THE SAME WHETHER THE CONVERGENCE TERM IS CARRIED OR NOT.",
      },
      {
        tex: `\\begin{array}{lrrrr} \\textbf{analyst} & w_m & r_m & T_m & z_m \\\\ \\hline ${rows} \\end{array}`,
        note: "AN INDIVIDUAL ANALYST IS SCORED AGAINST THE SPREAD OF OPINION IT SITS IN: A LONE DISSENTER AMONG FOUR AGREEING DESKS IS AN EXTREME CALL; THE SAME NUMBER AMONG FOUR SCATTERED ONES IS NOT.",
      },
    ],
    inputs: [
      { sym: "\\varphi", label: "error-correction speed", value: String(ECM_ADJUSTMENT) },
      { sym: "c", label: "exam carry over fv", value: sgn(q.carry, 2) },
      { sym: "\\mathrm{FV}", label: "fair value", value: fmt(q.fv, 1) },
      { sym: "\\mathrm{PX}", label: "the mark", value: fmt(q.price, 1) },
      { sym: "H", label: "horizon", value: `${q.horizonDays}d` },
    ],
    result: { tex: "\\bar r", value: sgn(s.rating.expected, 2), unit: "PTS" },
    refs: ["engle1987"],
    related: ["rating.score", "fv.ensemble"],
    source: "src/lib/quant/ratings.ts · viewReturns",
  };
}

export function ratingConviction(ctx: DeriveCtx): Derivation | null {
  const r = ctx.stat?.rating;
  if (!r || !r.views.length) return null;
  return {
    id: "rating.conviction",
    title: "CONVICTION",
    symbol: "P",
    claim: "THE EDGE THIS CALL HAS OVER A COIN FLIP — READ OFF THE SAME STATISTIC THAT MADE IT.",
    steps: [
      {
        tex: `P(\\text{right}) = \\Phi(|z^{\\ast}|), \\qquad \\text{CONVICTION} \\;=\\; 100\\big(P(\\text{right}) - P(\\text{wrong})\\big) \\;=\\; 100\\big(2\\Phi(|z^{\\ast}|) - 1\\big)`,
        subst: `= 100\\big(2\\Phi(${v(Math.abs(r.score), 2)}) - 1\\big) \\;=\\; ${v(r.conviction, 0)}`,
        note: "NOT THE PROBABILITY OF BEING RIGHT — THE MARGIN OVER BEING WRONG. AT z* = 0 THE SIGN IS A COIN FLIP: P(RIGHT) = 50% AND THE EDGE IS 0, WHICH IS WHAT A HOLD SHOULD REPORT. A 50 HERE MEANS 75/25.",
      },
    ],
    inputs: [
      { sym: "z^{\\ast}", label: "consensus score", value: sgn(r.score, 2) },
      { sym: "\\Phi(|z^{\\ast}|)", label: "P(right sign)", value: fmt(100 * (0.5 * (1 + r.conviction / 100)), 0) + "%" },
    ],
    result: { tex: "P", value: String(r.conviction), unit: "%" },
    refs: ["abramowitz1964"],
    related: ["rating.score"],
    source: "src/lib/quant/ratings.ts · rateDesk",
  };
}

export function ratingBenchmark(ctx: DeriveCtx): Derivation | null {
  const r = ctx.stat?.rating;
  if (!r) return null;
  const priced = (ctx.stats ?? []).filter((x) => x.quant != null).length;
  return {
    id: "rating.benchmark",
    title: "THE BOOK BENCHMARK",
    symbol: "b",
    claim: "WHAT A DESK MUST BEAT TO EARN A BUY. RATINGS ARE RELATIVE BY CONSTRUCTION.",
    steps: [
      {
        tex: `b \\;=\\; \\operatorname{median}_s\\, \\bar r_s`,
        subst: `b \\;=\\; ${v(r.benchmark, 2)}\\;\\text{pts} \\;/\\; ${r.horizon}\\text{d}`,
        note: "MEDIAN, NOT MEAN — WITH SIX DESKS ONE RUNAWAY LINE MUST NOT SET THE BAR FOR THE OTHER FIVE.",
      },
      {
        tex: `|\\{s : q_s \\ne \\varnothing\\}| \\ge 3 \\quad\\text{else}\\quad \\text{rate absolute}`,
        subst: `${v(priced, 0)}\\;\\text{priced desks}`,
        note: "BELOW THREE PRICED DESKS THERE IS NO CROSS-SECTION, SO DESKS ARE RATED ABSOLUTE AND THE INTERFACE SAYS SO.",
      },
    ],
    inputs: [
      { sym: "b", label: "book expected return", value: sgn(r.benchmark, 2) },
      { sym: "\\bar r", label: "this desk", value: sgn(r.expected, 2) },
      { sym: "\\bar r - b", label: "excess", value: sgn(r.expected - r.benchmark, 2) },
      { sym: "|S|", label: "priced desks", value: String(priced) },
    ],
    result: { tex: "b", value: sgn(r.benchmark, 2), unit: "PTS" },
    related: ["rating.score"],
    source: "src/lib/quant/ratings.ts · benchmarkDrift",
  };
}

export function ratingTarget(ctx: DeriveCtx): Derivation | null {
  const s = ctx.stat;
  const r = s?.rating;
  if (!s || !r || r.target == null || !s.quant) return null;
  return {
    id: "rating.target",
    title: "PRICE TARGET",
    symbol: "T",
    claim: "THE MARK PLUS THE CONSENSUS EXPECTED RETURN OVER ONE HORIZON — WITH THE ANALYSTS' OWN SPREAD BESIDE IT.",
    steps: [
      {
        tex: `T \\;=\\; \\operatorname{clip}_{[0,100]}\\big(\\mathrm{PX} + \\bar r\\big)`,
        subst: `T \\;=\\; ${v(s.quant.price, 1)} ${r.expected >= 0 ? "+" : "-"} ${v(Math.abs(r.expected), 2)} \\;=\\; ${v(r.target, 1)}`,
      },
      {
        tex: `[\\,T_{\\min},\\, T_{\\max}\\,] \\;=\\; \\big[\\min_m T_m,\\; \\max_m T_m\\big]`,
        subst:
          r.targetLo != null && r.targetHi != null
            ? `= [\\,${v(r.targetLo, 1)},\\; ${v(r.targetHi, 1)}\\,]`
            : undefined,
        note: "THE RANGE IS THE ANALYSTS' DISAGREEMENT, NOT A CONFIDENCE INTERVAL. THE CREDIBLE BAND LIVES ON FAIR VALUE.",
      },
    ],
    inputs: [
      { sym: "\\mathrm{PX}", label: "the mark", value: fmt(s.quant.price, 1) },
      { sym: "\\bar r", label: "expected return", value: sgn(r.expected, 2) },
      { sym: "H", label: "horizon", value: `${r.horizon}d` },
      { sym: "\\text{upside}", label: "vs the mark", value: r.upside == null ? "—" : `${sgn(r.upside, 1)}%`, missing: r.upside == null },
    ],
    result: { tex: "T", value: fmt(r.target, 1) },
    related: ["rating.return", "rating.score"],
    source: "src/lib/quant/ratings.ts · rateDesk",
  };
}

export function advisorPriority(ctx: DeriveCtx): Derivation | null {
  // The board hands down the whole advisory list; find our own row in it.
  const sig = ctx.signal ?? ctx.signals?.find((s) => s.id === ctx.stat?.sub.id) ?? null;
  const q = ctx.stat?.quant;
  if (!sig) return null;
  const g = Math.min(1, Math.max(0, sig.gap != null && sig.gap > 0 ? sig.gap / 15 : 0));
  const d = Math.min(1, Math.max(0, sig.downside / 12));
  const sl = Math.min(1, Math.max(0, -sig.slope30 / 5));
  const st = Math.min(1, Math.max(0, (sig.staleDays - STALE_FREE_DAYS) / STALE_SPAN_DAYS));
  return {
    id: "advisor.priority",
    title: "ADVISOR · URGENCY",
    symbol: "\\mathcal{U}",
    claim: "NOT DIRECTION AND NOT LEVEL — WHAT TO WORK ON TONIGHT. FOUR NORMALIZED STRESS FACTORS.",
    steps: [
      {
        tex: `\\mathcal{U} = 100\\cdot\\operatorname{clip}_{[0,1]}\\!\\Big(0.35\\,\\tfrac{\\text{gap}}{15} + 0.30\\,\\tfrac{\\mathrm{FV}-p_{10}}{12} + 0.20\\,\\tfrac{-\\hat\\beta_{30}}{5} + 0.15\\,\\tfrac{\\text{stale}-${STALE_FREE_DAYS}}{${STALE_SPAN_DAYS}}\\Big)`,
        subst: `= 100\\cdot\\big(0.35\\cdot${v(g, 2)} + 0.30\\cdot${v(d, 2)} + 0.20\\cdot${v(sl, 2)} + 0.15\\cdot${v(st, 2)}\\big) \\;=\\; ${v(sig.priority, 0)}`,
        note: "EACH TERM IS CLIPPED TO [0,1] BEFORE WEIGHTING, SO ONE EXTREME FACTOR CANNOT MANUFACTURE URGENCY ON ITS OWN.",
      },
      {
        tex: `\\text{tail} \\;=\\; \\mathrm{FV} - p_{10} \\quad\\text{(not } \\mathrm{PX} - p_{10}\\text{)}`,
        note: "TAIL WIDTH IS MEASURED FROM FAIR VALUE, SINCE p₁₀ IS DRAWN AROUND FV. MEASURING IT FROM THE MARK WOULD NET THE DISCOUNT AGAINST THE TAIL IT ALREADY CHARGED FOR.",
      },
    ],
    inputs: [
      { sym: "\\text{gap}", label: "under target", value: sig.gap == null ? "—" : sgn(sig.gap, 1), missing: sig.gap == null },
      { sym: "\\mathrm{FV}-p_{10}", label: "downside tail", value: fmt(sig.downside, 1) },
      { sym: "\\hat\\beta_{30}", label: "slope /30d", value: sgn(sig.slope30, 1) },
      { sym: "\\text{stale}", label: "days since print", value: `${sig.staleDays}d` },
      { sym: "\\mathrm{FV}", label: "fair value", value: q ? fmt(q.fv, 1) : "—", missing: !q },
    ],
    result: { tex: "\\mathcal{U}", value: sig.priority.toFixed(0), unit: "/100" },
    related: ["fv.p10", "mark.price", "rating.score"],
    source: "src/lib/quant/advisor.ts · advise",
  };
}
