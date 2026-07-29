/**
 * Derivations for Part II of the paper — the MARK and every charge behind it.
 *
 * The waterfall in the drawer already itemizes the discount; what it cannot
 * show in one line is that each item is a bounded function of a named factor,
 * that the factor had to clear a small-n gate to report at all, and that the
 * displayed points are the raw charge after credibility shrinkage and tanh
 * saturation have been allocated back proportionally. These build that.
 */

import {
  PREMIUM_CAPS, UNC_FREE_SD, UNC_WEIGHT,
} from "../quant/mark";
import { DECAY_CAL_HORIZON_DAYS, VOL_FLOOR } from "../quant/factors";
import { round1 } from "../utils";
import {
  CUSUM_H, CUSUM_K, CUSUM_Z_CAP, EFFORT_ACTUAL_W, EFFORT_PLAN_W, MARK_CRED_K,
  MARK_MAX_DISCOUNT, READINESS_W, STALE_FREE_SESSION_DAYS, UPSIDE_DAMP,
} from "../quant/params";
import { fmt, sgn, v, type Derivation, type DeriveCtx, type DerivationInput } from "./types";

const PT = "PTS";

/** The mark trace, or null when this desk was never priced. */
const traceOf = (ctx: DeriveCtx) => ctx.stat?.quant?.trace?.mark ?? null;

const num = (x: number | null | undefined, dp = 1, unit = ""): string =>
  x == null ? "—" : `${x.toFixed(dp)}${unit}`;

/* ── 𝒟 · the aggregate discount ────────────────────────────────────── */

export function markDiscount(ctx: DeriveCtx): Derivation | null {
  const q = ctx.stat?.quant;
  const t = traceOf(ctx);
  if (!q || !t) return null;
  const C = MARK_MAX_DISCOUNT;
  const inner = (t.cred * t.floored) / C;

  return {
    id: "mark.discount",
    title: "MARK-TO-MARKET DISCOUNT",
    symbol: "\\mathcal{D}",
    claim:
      "THE SUM OF EVERY LIVE RISK CHARGE, SHRUNK BY HOW MUCH TAPE SUPPORTS IT AND PASSED THROUGH A SMOOTH CEILING.",
    steps: [
      {
        tex: `\\mathcal{D} \\;=\\; C\\,\\tanh\\!\\left(\\frac{1}{C}\\cdot\\frac{n}{n+\\kappa}\\sum_{j}\\pi_j\\right), \\qquad C = ${C},\\; \\kappa = ${MARK_CRED_K}`,
        subst: `\\mathcal{D} \\;=\\; ${C}\\,\\tanh\\!\\left(\\frac{1}{${C}}\\cdot\\frac{${v(t.factors.n, 0)}}{${v(t.factors.n, 0)}+${MARK_CRED_K}}\\cdot ${v(t.floored)}\\right) \\;=\\; ${v(q.discount, 1)}`,
        note: "Σπⱼ IS FLOORED AT ZERO FIRST — THE MARKET NEVER PAYS ABOVE FAIR VALUE.",
      },
      {
        tex: `Z \\;=\\; \\frac{n}{n+\\kappa} \\quad\\text{(Bühlmann credibility)}`,
        subst: `Z \\;=\\; \\frac{${v(t.factors.n, 0)}}{${v(t.factors.n, 0)} + ${MARK_CRED_K}} \\;=\\; ${v(t.cred, 3)}`,
        note: "A THIN DESK IS NOT MARKED DOWN FOR PATHOLOGIES NOBODY COULD YET HAVE MEASURED.",
      },
      {
        tex: `\\tanh(x) \\approx x \\;\\; (x \\to 0), \\qquad \\lim_{x\\to\\infty} C\\tanh(x) = C`,
        subst: `x = ${v(inner, 4)} \\;\\Rightarrow\\; \\text{saturation loss } ${v(t.cred * t.floored - q.discount, 2)}\\;\\text{${PT}}`,
        note: "LOCALLY LINEAR, SO ORDINARY DISCOUNTS ARE EXACTLY THE SUM OF THEIR PARTS; SATURATING, SO NO DESK IS EVER MARKED TO ZERO.",
      },
    ],
    inputs: [
      { sym: "\\textstyle\\sum_j\\pi_j", label: "raw charge sheet", value: num(t.rawSum, 2, " " + PT) },
      { sym: "n", label: "prints on the desk", value: String(t.factors.n) },
      { sym: "Z", label: "credibility", value: fmt(t.cred, 3) },
      { sym: "C", label: "soft ceiling", value: `${C} ${PT}` },
    ],
    result: { tex: "\\mathcal{D}", value: fmt(q.discount, 1), unit: PT },
    gates: [
      { text: `Σπⱼ > 0 — the desk owes a discount`, pass: t.floored > 0 },
      { text: `𝒟 < C = ${C} always`, pass: q.discount < C },
    ],
    refs: ["buhlmann1967", "tversky1992"],
    related: ["mark.attribution", "mark.price", "mark.regime"],
    source: "src/lib/quant/mark.ts · markDesk",
  };
}

/* ── The MARK itself ───────────────────────────────────────────────── */

export function markPrice(ctx: DeriveCtx): Derivation | null {
  const q = ctx.stat?.quant;
  const t = traceOf(ctx);
  if (!q || !t) return null;
  return {
    id: "mark.price",
    title: "THE MARK",
    symbol: "\\mathrm{PX}",
    claim:
      "WHAT A RISK-AVERSE MARKET WOULD PAY TODAY: FAIR VALUE LESS AN ITEMIZED, ATTRIBUTABLE RISK DISCOUNT.",
    steps: [
      {
        tex: `\\mathrm{PX} \\;=\\; \\operatorname{clip}_{[0,100]}\\big(\\mathrm{FV} - \\mathcal{D}\\big), \\qquad \\mathcal{D} \\ge 0`,
        subst: `\\mathrm{PX} \\;=\\; ${v(q.fv, 1)} - ${v(q.discount, 1)} \\;=\\; ${v(q.price, 1)}`,
        note: "𝒟 ≥ 0 IS STRUCTURAL. POSITIVE EVIDENCE CAN AT MOST RETURN A DESK TO PAR — FAIR VALUE ALREADY COUNTED THE GOOD NEWS.",
      },
      {
        // λ is 1/η, not the textbook 2.25 — quoting both made the panel
        // contradict itself and its own sibling note, which prints 1/η ≈ 2.9.
        tex: `\\text{charges bill at } 1, \\quad \\text{credits at } \\eta = ${UPSIDE_DAMP} \\;=\\; \\lambda^{-1},\\; \\lambda \\approx ${(1 / UPSIDE_DAMP).toFixed(1)}`,
        note: "THE MARK IS NOT AN ESTIMATOR BUT A DECISION VARIABLE: IT ALLOCATES STUDY TIME UNDER AN ASYMMETRIC LOSS FUNCTION.",
      },
    ],
    inputs: [
      { sym: "\\mathrm{FV}", label: "fair value", value: fmt(q.fv, 1) },
      { sym: "\\mathcal{D}", label: "risk discount", value: fmt(q.discount, 1) },
      { sym: "\\eta", label: "upside damping", value: String(UPSIDE_DAMP) },
      { sym: "n", label: "prints", value: String(t.factors.n) },
    ],
    result: { tex: "\\mathrm{PX}", value: fmt(q.price, 1) },
    gates: [{ text: "PX ≤ FV — the market never pays above fair value", pass: q.price <= q.fv + 1e-9 }],
    refs: ["tversky1992"],
    related: ["mark.discount", "fv.ensemble", "mark.regime"],
    source: "src/lib/quant/mark.ts · markDesk",
  };
}

/* ── Attribution ───────────────────────────────────────────────────── */

export function markAttribution(ctx: DeriveCtx): Derivation | null {
  const q = ctx.stat?.quant;
  const t = traceOf(ctx);
  if (!q || !t) return null;
  const shown = q.premia.reduce((a, l) => a + l.pts, 0);
  // The rounding remainder that actually lands on the largest line: the sum of
  // the round₁'d scaled charges BEFORE absorption, subtracted from the discount.
  // Summing q.premia.pts here instead would be the post-absorption total, which
  // is ≡ D by construction and would print r = 0.0 every time — the one number
  // this step exists to expose.
  const roundedScaled = q.premia.reduce((a, line) => {
    const rl = t.raw.find((l) => l.key === line.key);
    return a + (rl ? round1(rl.pts * t.shrink) : 0);
  }, 0);
  const resid = round1(q.discount - roundedScaled);
  return {
    id: "mark.attribution",
    title: "EXACT ATTRIBUTION",
    symbol: "\\tilde\\pi_j",
    claim: "EVERY DISPLAYED LINE IS RESCALED SO THE WATERFALL SUMS TO THE DISCOUNT TO THE LAST DECIMAL.",
    steps: [
      {
        tex: `\\tilde\\pi_j \\;=\\; \\pi_j \\cdot \\frac{\\mathcal{D}}{\\sum_k \\pi_k}, \\qquad \\sum_j \\tilde\\pi_j \\;\\equiv\\; \\mathcal{D}`,
        subst: `\\tilde\\pi_j \\;=\\; \\pi_j \\cdot \\frac{${v(q.discount, 1)}}{${v(t.rawSum, 2)}} \\;=\\; \\pi_j \\cdot ${v(t.shrink, 4)}`,
        note: "THE CREDIBILITY AND SATURATION HAIRCUTS ARE ALLOCATED PROPORTIONALLY, NOT TO WHICHEVER LINE IS CONVENIENT.",
      },
      {
        tex: `r \\;=\\; \\mathcal{D} - \\sum_j \\operatorname{round}_1(\\tilde\\pi_j) \\;\\longrightarrow\\; \\text{assigned to } \\arg\\max_j |\\tilde\\pi_j|`,
        subst: `r \\;=\\; ${v(q.discount, 1)} - ${v(roundedScaled, 1)} \\;=\\; ${v(resid, 1)}`,
        note: "A RISK MODEL WHOSE EXPLANATION DOES NOT RECONCILE WITH ITS OWN OUTPUT IS NOT AN EXPLANATION. r LANDS ON THE LARGEST LINE SO THE ROUNDED WATERFALL STILL SUMS TO D EXACTLY.",
      },
    ],
    inputs: [
      { sym: "\\textstyle\\sum\\pi_k", label: "raw charge sheet", value: fmt(t.rawSum, 2) },
      { sym: "\\mathcal{D}", label: "discount", value: fmt(q.discount, 1) },
      { sym: "\\mathcal{D}/\\Sigma", label: "attribution scale", value: fmt(t.shrink, 4) },
      { sym: "J", label: "lines shown", value: String(q.premia.length) },
    ],
    result: { tex: "\\textstyle\\sum_j\\tilde\\pi_j", value: fmt(shown, 1), unit: PT },
    gates: [{ text: "waterfall reconciles to the displayed discount", pass: Math.abs(shown - q.discount) < 0.051 }],
    related: ["mark.discount"],
    source: "src/lib/quant/mark.ts · markDesk",
  };
}

/* ── Regime ────────────────────────────────────────────────────────── */

export function markRegime(ctx: DeriveCtx): Derivation | null {
  const q = ctx.stat?.quant;
  const t = traceOf(ctx);
  if (!q || !t) return null;
  const alarmed = !!t.cusum?.alarm;
  return {
    id: "mark.regime",
    title: "PRICING REGIME",
    symbol: "\\mathcal{R}",
    claim: "A BAND READ OFF THE DISCOUNT — WITH A CONFIRMED DRIFT ALARM OVERRIDING IT, BECAUSE THAT IS A STATE, NOT A QUANTITY.",
    steps: [
      {
        tex: `\\mathcal{R}(\\mathcal{D}) = \\begin{cases}\\text{PRIME} & \\mathcal{D} < 2.5\\\\ \\text{STABLE} & 2.5 \\le \\mathcal{D} < 6.5\\\\ \\text{STRESSED} & 6.5 \\le \\mathcal{D} < 12.5\\\\ \\text{DISTRESSED} & \\mathcal{D} \\ge 12.5\\end{cases}`,
        subst: `\\mathcal{D} = ${v(q.discount, 1)} \\;\\Longrightarrow\\; \\textsf{${q.regime}}`,
      },
      {
        tex: `S \\ge h \\;\\Longrightarrow\\; \\mathcal{R} \\leftarrow \\max(\\mathcal{R},\\, \\text{STRESSED})`,
        subst: alarmed
          ? `S = ${v(t.cusum!.stat, 1)} \\ge ${CUSUM_H} \\;\\Longrightarrow\\; \\text{override active}`
          : `S = ${t.cusum ? v(t.cusum.stat, 1) : "\\text{n/a}"} < ${CUSUM_H} \\;\\Longrightarrow\\; \\text{no override}`,
        note: "A CONFIRMED DRIFT IS A QUALITATIVE STATE. THE BANDS ALONE WOULD LET A SLOW BLEED READ AS STABLE.",
      },
    ],
    inputs: [
      { sym: "\\mathcal{D}", label: "discount", value: fmt(q.discount, 1) },
      { sym: "S", label: "cusum statistic", value: t.cusum ? fmt(t.cusum.stat, 1) : "—", missing: !t.cusum },
      { sym: "h", label: "alarm threshold", value: String(CUSUM_H) },
    ],
    result: { tex: "\\mathcal{R}", value: q.regime },
    gates: [{ text: "drift alarm active", pass: alarmed }],
    refs: ["page1954"],
    related: ["mark.discount", "mark.cusum"],
    source: "src/lib/quant/mark.ts · markDesk",
  };
}

/* ── CUSUM ─────────────────────────────────────────────────────────── */

export function markCusum(ctx: DeriveCtx): Derivation | null {
  const t = traceOf(ctx);
  if (!t) return null;
  const c = t.cusum;
  return {
    id: "mark.cusum",
    title: "DRIFT DETECTOR · PAGE CUSUM",
    symbol: "S",
    claim:
      "HAS THIS DESK PRINTED UNDER ITS OWN FORECAST LONG ENOUGH THAT THE MISSES STOPPED BEING NOISE? A CHANGE-POINT QUESTION, NOT A SLOPE.",
    steps: [
      {
        tex: `z_i \\;=\\; \\operatorname{clip}_{\\pm ${CUSUM_Z_CAP}}\\!\\left(\\frac{y_i - \\hat y_{i\\,|\\,<i}}{\\max(\\operatorname{MAD},\\, R_{c_i})}\\right)`,
        note: "RESIDUALS ARE WALK-FORWARD: EACH PRINT IS SCORED AGAINST THE FORECAST THAT STOOD BEFORE IT, NOT AGAINST A FIXED LINE.",
      },
      {
        tex: `S_i \\;=\\; \\max\\big(0,\\; S_{i-1} - z_i - k\\big), \\qquad k = ${CUSUM_K}, \\quad \\text{alarm} \\iff S_i \\ge h = ${CUSUM_H}`,
        subst: c
          ? `S = ${v(c.stat, 1)}, \\quad S_{\\max} = ${v(c.peak, 1)} \\;\\Longrightarrow\\; \\textsf{${c.alarm ? "ALARM" : "QUIET"}}`
          : undefined,
        note: "UPSIDE RESIDUALS DRAIN THE STATISTIC, SO A WHIPSAW ACCUMULATES NOTHING. PER-STEP WINSORIZATION MEANS ONE CRASH PRINT IS A SHOCK, NOT DRIFT.",
      },
    ],
    inputs: [
      { sym: "S", label: "statistic now", value: c ? fmt(c.stat, 1) : "—", missing: !c },
      { sym: "S_{\\max}", label: "worst excursion", value: c ? fmt(c.peak, 1) : "—", missing: !c },
      { sym: "k", label: "free allowance / print", value: String(CUSUM_K) },
      { sym: "h", label: "alarm threshold", value: String(CUSUM_H) },
    ],
    result: { tex: "S", value: c ? fmt(c.stat, 1) : "—", unit: c ? "σ" : undefined },
    gates: [
      { text: "n ≥ 4 — three prints seed the forecast, one more scores it", pass: c != null },
      { text: `S ≥ h = ${CUSUM_H}`, pass: !!c?.alarm },
    ],
    refs: ["page1954", "huber1964"],
    related: ["premium.cusum", "mark.regime"],
    source: "src/lib/quant/cusum.ts · cusumDrift",
  };
}

/* ── The premium schedule ──────────────────────────────────────────── */

type MarkTraceOf = NonNullable<ReturnType<typeof traceOf>>;

interface PremiumSpec {
  title: string;
  symbol: string;
  claim: string;
  /** General form and the substituted form, given the trace and the priced view. */
  build: (t: MarkTraceOf, q: NonNullable<NonNullable<DeriveCtx["stat"]>["quant"]>) => {
    tex: string;
    subst?: string;
    note?: string;
    inputs: DerivationInput[];
    gates?: { text: string; pass: boolean }[];
    refs?: Derivation["refs"];
    related?: string[];
  } | null;
}

const PREMIUM_SPECS: Record<string, PremiumSpec> = {
  unc: {
    title: "UNCERTAINTY PREMIUM",
    symbol: "\\pi_{\\text{unc}}",
    claim: "ERROR BARS WIDER THAN ONE CLEAN EXAM'S RELIABILITY COST MONEY — THE MARKET PAYS FOR WHAT IT CAN TRUST.",
    build: (_t, q) => ({
      tex: `\\pi_{\\text{unc}} = \\min\\!\\big(${PREMIUM_CAPS.unc},\\; ${UNC_WEIGHT}\\,(\\hat\\sigma - ${UNC_FREE_SD})^{+}\\big)`,
      subst: `= \\min\\!\\big(${PREMIUM_CAPS.unc},\\; ${UNC_WEIGHT}\\,(${v(q.sd, 1)} - ${UNC_FREE_SD})^{+}\\big)`,
      note: `σ UNDER ${UNC_FREE_SD} IS FREE: CHARGING FOR IT WOULD BILL EVERY DESK FOR MEASUREMENT NOISE THE ENGINE ITSELF CALLS IRREDUCIBLE, AND DOUBLE-COUNT INSTABILITY.`,
      inputs: [
        { sym: "\\hat\\sigma", label: "blended sd", value: `${q.sd.toFixed(1)} ${PT}` },
        { sym: "\\hat\\sigma_0", label: "free reliability", value: `${UNC_FREE_SD} ${PT}` },
        { sym: "\\nu", label: "student-t df", value: String(q.df) },
      ],
      refs: ["student1908"],
      related: ["fv.interval"],
    }),
  },
  vol: {
    title: "INSTABILITY PREMIUM",
    symbol: "\\pi_{\\text{vol}}",
    claim: "PRINT-TO-PRINT SWING, SCALED BY HOW IT SITS AGAINST THE BOOK, WITH A KICKER WHEN THE RECENT TAPE IS EXPANDING.",
    build: (t) => {
      const f = t.factors;
      const rel = Math.min(1.6, Math.max(0.6, f.volRatio ?? 1));
      const exp = f.volExpansion != null && f.volExpansion > 1.3 ? 1.5 * Math.min(f.volExpansion - 1.3, 1) : 0;
      return {
        tex: `\\pi_{\\text{vol}} = \\min\\!\\Big(${PREMIUM_CAPS.vol},\\; 0.55\\,(\\mathrm{RMSSD} - ${VOL_FLOOR})^{+}\\cdot\\operatorname{clip}_{[0.6,1.6]}(\\rho_{\\text{vol}}) \\;+\\; 1.5\\min(\\varepsilon - 1.3,\\,1)^{+}\\Big)`,
        subst: `= \\min\\!\\Big(${PREMIUM_CAPS.vol},\\; 0.55\\,(${v(f.vol, 1)} - ${VOL_FLOOR})^{+}\\cdot ${v(rel, 2)} + ${v(exp, 2)}\\Big)`,
        note: "RMSSD, NOT σ: A TAPE THAT WHIPSAWS 70→85→70→85 HAS AN ORDINARY DEVIATION ABOUT ITS MEDIAN AND CANNOT HIDE FROM ITS OWN FIRST DIFFERENCES.",
        inputs: [
          { sym: "\\mathrm{RMSSD}", label: `swing (${f.volBasis} basis)`, value: num(f.vol, 1) },
          { sym: "\\rho_{\\text{vol}}", label: "vs book median", value: f.volRatio == null ? "—" : `${f.volRatio.toFixed(1)}×`, missing: f.volRatio == null },
          { sym: "\\varepsilon", label: "recent expansion", value: f.volExpansion == null ? "—" : `${f.volExpansion.toFixed(2)}×`, missing: f.volExpansion == null },
        ],
        gates: [
          { text: "n ≥ 4 on the vol basis", pass: f.volN >= 4 },
          { text: "≥ 2 eligible desks for the book ratio", pass: f.volRatio != null },
        ],
        refs: ["vonneumann1941"],
        related: ["factor.rmssd"],
      };
    },
  },
  mom: {
    title: "MOMENTUM PREMIUM",
    symbol: "\\pi_{\\text{mom}}",
    claim: "THE POINTS THE τ-GATED TREND BLEEDS OVER ONE RATING HORIZON.",
    build: (t) => ({
      tex: `\\pi_{\\text{mom}} = \\min\\!\\big(${PREMIUM_CAPS.mom},\\; (-\\hat\\beta_{30})^{+}\\cdot H\\big), \\qquad H = \\tfrac{\\text{horizon}}{30}`,
      subst: `= \\min\\!\\big(${PREMIUM_CAPS.mom},\\; (${v(-t.factors.slope30, 1)})^{+}\\cdot ${v(t.H, 2)}\\big)`,
      note: "THE HORIZON IS THE DESK'S OWN MEDIAN PRINT GAP — A DESK THAT PRINTS MONTHLY IS CHARGED OVER A MONTH.",
      inputs: [
        { sym: "\\hat\\beta_{30}", label: "τ-gated slope /30d", value: sgn(t.factors.slope30, 1) },
        { sym: "H", label: "horizons", value: fmt(t.H, 2) },
      ],
      gates: [{ text: "τ-gate open (n ≥ 4, p ≤ 0.5)", pass: t.factors.slope30 !== 0 }],
      refs: ["theil1950", "sen1968", "kendall1938"],
      related: ["fv.trend"],
    }),
  },
  lag: {
    title: "RELATIVE LAG PREMIUM",
    symbol: "\\pi_{\\text{lag}}",
    claim: "TRAILING THE BOOK'S OWN DRIFT WHILE NOMINALLY LOOKING FLAT.",
    build: (t) =>
      t.factors.relSlope30 == null
        ? null
        : {
            tex: `\\pi_{\\text{lag}} = \\min\\!\\big(${PREMIUM_CAPS.lag},\\; 0.8\\,(-\\hat\\beta_{30}^{\\,\\text{rel}})^{+}\\cdot H\\big), \\qquad \\hat\\beta_{30}^{\\,\\text{rel}} = \\hat\\beta_{30} - \\operatorname{median}_s \\hat\\beta_{30}^{(s)}`,
            subst: `= \\min\\!\\big(${PREMIUM_CAPS.lag},\\; 0.8\\,(${v(-t.factors.relSlope30, 1)})^{+}\\cdot ${v(t.H, 2)}\\big)`,
            note: "MEASURED AGAINST THE BOOK MEDIAN, NOT ZERO: A TERM IN WHICH EVERYTHING SAGS IS NOT SIX FAILING DESKS.",
            inputs: [
              { sym: "\\hat\\beta_{30}", label: "own slope /30d", value: sgn(t.factors.slope30, 1) },
              { sym: "\\tilde\\beta", label: "book median slope", value: t.book.medianSlope30 == null ? "—" : sgn(t.book.medianSlope30, 1), missing: t.book.medianSlope30 == null },
              { sym: "\\hat\\beta^{\\,\\text{rel}}", label: "excess drift", value: sgn(t.factors.relSlope30, 1) },
            ],
            gates: [{ text: "≥ 2 eligible desks on the book", pass: true }],
            related: ["premium.mom"],
          },
  },
  shock: {
    title: "EXAM SHOCK PREMIUM",
    symbol: "\\pi_{\\text{shock}}",
    claim: "THE LATEST EXAM AGAINST ITS OWN WINSORIZED TRAIL, IN HONEST SIGMA, FADING AS NEWER PRINTS SUPERSEDE IT.",
    build: (t) => {
      const f = t.factors;
      if (f.shockZ == null) return null;
      const decay =
        Math.pow(2, -Math.max(0, t.printsSinceExam) / 2) *
        Math.pow(2, -Math.max(0, (t.examAgeDays ?? 0) - DECAY_CAL_HORIZON_DAYS) / 60);
      return {
        tex: `\\pi_{\\text{shock}} = \\min\\!\\big(${PREMIUM_CAPS.shock},\\; 1.6\\,(-z_{\\text{shock}})^{+}\\cdot \\phi\\big), \\qquad \\phi = 2^{-p/2}\\cdot 2^{-(a-${DECAY_CAL_HORIZON_DAYS})^{+}/60}`,
        subst: `= \\min\\!\\big(${PREMIUM_CAPS.shock},\\; 1.6\\cdot ${v(-f.shockZ, 2)}\\cdot ${v(decay, 3)}\\big)`,
        note: "SHOCK DECAYS ON MARKET TIME, NOT CALENDAR TIME: ON A TERMLY CADENCE THE APRIL SITTING IS THE CURRENT STATE IN JULY.",
        inputs: [
          { sym: "z_{\\text{shock}}", label: "sigma vs trail", value: sgn(f.shockZ, 1) + "σ" },
          { sym: "\\bar y^{\\,w}", label: "winsorized trail", value: num(f.examTrail, 1) },
          { sym: "p", label: "prints since exam", value: String(t.printsSinceExam) },
          { sym: "a", label: "exam age", value: t.examAgeDays == null ? "—" : `${t.examAgeDays}d`, missing: t.examAgeDays == null },
          { sym: "\\phi", label: "supersession decay", value: fmt(decay, 3) },
        ],
        gates: [{ text: "≥ 3 prior exams to form a trail", pass: f.examTrail != null }],
        refs: ["huber1964", "rousseeuw1993"],
        related: ["factor.shock"],
      };
    },
  },
  down: {
    title: "DOWNSIDE PREMIUM",
    symbol: "\\pi_{\\text{down}}",
    claim: "SEMIDEVIATION PLUS THE STREAKS — MISSES AGAINST THE STANDING ESTIMATE, AND STRICTLY LOWER EXAM PRINTS.",
    build: (t) => {
      const f = t.factors;
      return {
        tex: `\\pi_{\\text{down}} = \\min\\!\\big(${PREMIUM_CAPS.down},\\; 0.4\\,\\varsigma^{-} + 0.7\\min(m,4) + 0.5\\min(d,4)\\big)`,
        subst: `= \\min\\!\\big(${PREMIUM_CAPS.down},\\; 0.4\\cdot ${v(f.semiDev, 1)} + 0.7\\cdot ${v(Math.min(f.missStreak, 4), 0)} + 0.5\\cdot ${v(Math.min(f.downStreak, 4), 0)}\\big)`,
        note: "THE MISS STREAK COUNTS FAILURES TO MEET THE STANDARD THE DESK ITSELF HAD SET — EACH PRINT AGAINST THE FORECAST THAT STOOD BEFORE IT.",
        inputs: [
          { sym: "\\varsigma^{-}", label: "downside semidev", value: num(f.semiDev, 1) },
          { sym: "m", label: "miss streak", value: String(f.missStreak) },
          { sym: "d", label: "down streak", value: String(f.downStreak) },
          { sym: "\\bar\\delta", label: "avg deficit", value: num(f.avgMissDeficit, 1) },
        ],
        gates: [{ text: "n ≥ 3 for semideviation, n ≥ 4 for the streak", pass: f.n >= 4 }],
        refs: ["markowitz1959", "sortino1994"],
        related: ["factor.semidev", "factor.miss"],
      };
    },
  },
  cw: {
    title: "COURSEWORK DIVERGENCE",
    symbol: "\\pi_{\\text{cw}}",
    claim:
      "COURSEWORK NEVER PAYS THE GRADE, BUT IT PRICES THE NEXT EXAM. TALKING THE EXAM DOWN CHARGES FULLY; TALKING IT UP CREDITS DAMPED.",
    build: (t) => {
      const cw = t.factors.coursework;
      if (cw.surpriseZ == null) return null;
      const down = cw.surpriseZ < 0;
      const sinking = cw.cwSlope30 != null && cw.cwSlope30 < 0 ? 0.5 * Math.min(-cw.cwSlope30, 3) : 0;
      return {
        tex: `\\pi_{\\text{cw}} = \\begin{cases}\\min\\big(${PREMIUM_CAPS.cw},\\; 1.4|z_{\\text{cw}}| + 0.5\\min(-\\hat\\beta^{\\,\\text{cw}}_{30},3)^{+}\\big) & z_{\\text{cw}} < 0\\\\[4pt] -\\eta\\,\\min(1.4\\,z_{\\text{cw}},\\,3) & z_{\\text{cw}} \\ge 0\\end{cases}`,
        subst: down
          ? `= \\min\\big(${PREMIUM_CAPS.cw},\\; 1.4\\cdot ${v(-cw.surpriseZ, 2)} + ${v(sinking, 2)}\\big)`
          : `= -${UPSIDE_DAMP}\\cdot\\min(1.4\\cdot ${v(cw.surpriseZ, 2)},\\,3) \\;=\\; ${v(-UPSIDE_DAMP * Math.min(1.4 * cw.surpriseZ, 3), 2)}`,
        note: `THE ASYMMETRY IS THE POINT: THE SAME MARGIN THE OTHER WAY CHARGES ROUGHLY 1/η ≈ ${(1 / UPSIDE_DAMP).toFixed(1)}× WHAT IT CREDITS, BEFORE THE −3 CAP ON CREDITS EVEN BITES.`,
        inputs: [
          { sym: "z_{\\text{cw}}", label: "coursework surprise", value: sgn(cw.surpriseZ, 2) + "σ" },
          { sym: "\\text{cw}", label: "coursework level", value: num(cw.cwMean, 1) },
          { sym: "\\hat\\delta", label: "cw→exam bridge", value: sgn(cw.delta, 1) },
          { sym: "\\widehat{\\text{ex}}", label: "cw-implied exam", value: num(cw.impliedExam, 1) },
          { sym: "A_{\\text{ex}}", label: "exam anchor", value: num(cw.examAnchor, 1) },
          { sym: "\\eta", label: "upside damping", value: String(UPSIDE_DAMP) },
        ],
        gates: [{ text: "both sides of the tape non-empty", pass: cw.nExams > 0 && cw.nCoursework > 0 }],
        refs: ["tversky1992"],
        related: ["oracle.carry"],
      };
    },
  },
  alpha: {
    title: "ALPHA EROSION PREMIUM",
    symbol: "\\pi_{\\alpha}",
    claim: "THE MOAT CLOSING, AND TRADING UNDER YOUR OWN REFERENCE.",
    build: (t) => {
      const f = t.factors;
      return {
        tex: `\\pi_{\\alpha} = \\min\\!\\big(${PREMIUM_CAPS.alpha},\\; 0.5\\,(-\\Delta\\alpha)^{+} + 0.35\\,(-\\alpha_{\\text{last}})^{+}\\big), \\qquad \\Delta\\alpha = \\alpha_{\\text{last}} - \\bar\\alpha_{\\text{trail}}`,
        subst: `= \\min\\!\\big(${PREMIUM_CAPS.alpha},\\; 0.5\\,(${v(-(f.alphaCollapse ?? 0), 1)})^{+} + 0.35\\,(${v(-(f.alphaLatest ?? 0), 1)})^{+}\\big)`,
        note: "TWO DESKS AT 70 ARE NOT THE SAME DESK IF ONE HOLDS A +12 EDGE OVER ITS COHORT AND THE OTHER'S EDGE JUST CLOSED.",
        inputs: [
          { sym: "\\alpha_{\\text{last}}", label: "latest edge", value: f.alphaLatest == null ? "—" : sgn(f.alphaLatest, 1), missing: f.alphaLatest == null },
          { sym: "\\bar\\alpha", label: "trailing edge", value: f.alphaTrail == null ? "—" : sgn(f.alphaTrail, 1), missing: f.alphaTrail == null },
          { sym: "\\Delta\\alpha", label: "moat move", value: f.alphaCollapse == null ? "—" : sgn(f.alphaCollapse, 1), missing: f.alphaCollapse == null },
        ],
        gates: [{ text: "≥ 3 referenced prints", pass: f.alphaCollapse != null }],
        related: ["factor.alpha"],
      };
    },
  },
  cusum: {
    title: "DRIFT ALARM PREMIUM",
    symbol: "\\pi_{\\text{cusum}}",
    claim: "THE CHANGE-POINT DETECTOR HAS FIRED: SUSTAINED BLEED BEYOND NOISE.",
    build: (t) =>
      !t.cusum?.alarm
        ? null
        : {
            tex: `\\pi_{\\text{cusum}} = \\min\\!\\big(${PREMIUM_CAPS.cusum},\\; 1.2\\min(S - h + 1,\\; 4)\\big)`,
            subst: `= \\min\\!\\big(${PREMIUM_CAPS.cusum},\\; 1.2\\min(${v(t.cusum.stat, 1)} - ${CUSUM_H} + 1,\\; 4)\\big)`,
            note: "CHARGED ONLY PAST THE ALARM THRESHOLD, SO THE FIRST POINT OF DRIFT IS NOT BILLED TWICE BY THE MOMENTUM LINE.",
            inputs: [
              { sym: "S", label: "cusum statistic", value: fmt(t.cusum.stat, 1) },
              { sym: "h", label: "threshold", value: String(CUSUM_H) },
              { sym: "S_{\\max}", label: "worst excursion", value: fmt(t.cusum.peak, 1) },
            ],
            refs: ["page1954"],
            related: ["mark.cusum"],
          },
  },
  stale: {
    title: "STALE TAPE PREMIUM",
    symbol: "\\pi_{\\text{stale}}",
    claim: "AN UNPRICED DESK DECAYS TOWARD CAUTION — BUT A TERM GAP IS THE NORMAL RHYTHM OF THE INSTRUMENT, NOT NEGLECT.",
    build: (t) =>
      t.staleDays == null
        ? null
        : {
            tex: `\\pi_{\\text{stale}} = \\min\\!\\left(${PREMIUM_CAPS.stale},\\; \\frac{(\\text{stale} - ${STALE_FREE_SESSION_DAYS})^{+}}{30}\\right)`,
            subst: `= \\min\\!\\left(${PREMIUM_CAPS.stale},\\; \\frac{(${v(t.staleDays, 0)} - ${STALE_FREE_SESSION_DAYS})^{+}}{30}\\right)`,
            note: `STALE IS COUNTED IN SCHOOL DAYS: A DESK CANNOT PRINT OVER THE SUMMER, SO THE SUMMER CANNOT AGE IT. THE FIRST ${STALE_FREE_SESSION_DAYS} — ONE FULL TERM OF SILENCE AND CHANGE — ARE FREE.`,
            inputs: [
              { sym: "\\text{stale}", label: "school days since print", value: `${Math.round(t.staleDays)}d` },
              { sym: "\\text{free}", label: "grace period", value: `${STALE_FREE_SESSION_DAYS}d` },
            ],
          },
  },
  effort: {
    title: "EFFORT PREMIUM",
    symbol: "\\pi_{\\text{effort}}",
    claim: "WHAT YOU MEASURED YOURSELF SPENDING ON THIS DESK, AGAINST AN EVEN SHARE OF THE SAME WEEK.",
    build: (t) => {
      const e = t.effort;
      if (!e || e.actualRatio == null) return null;
      const r = e.actualRatio;
      const deficit = Math.min(1, Math.max(0, 1 - r));
      const surplus = Math.min(1, Math.max(0, r - 1));
      return {
        tex:
          `\\pi_{\\text{effort}} = \\begin{cases}` +
          `\\min\\!\\big(${PREMIUM_CAPS.effort},\\; ${EFFORT_ACTUAL_W}\\,(1-\\rho_a)\\big) & \\rho_a < 1\\\\[2pt]` +
          `-\\,${EFFORT_ACTUAL_W}\\,\\eta\\min(\\rho_a-1,\\,1) & \\rho_a \\ge 1\\end{cases}` +
          `,\\qquad \\rho_a = \\frac{n\\,x_a}{T}`,
        subst:
          deficit > 0
            ? `= \\min\\!\\big(${PREMIUM_CAPS.effort},\\; ${EFFORT_ACTUAL_W}\\cdot ${v(deficit, 3)}\\big)`
            : `= -\\,${EFFORT_ACTUAL_W}\\cdot ${UPSIDE_DAMP}\\cdot ${v(surplus, 3)}`,
        note:
          "THE REFERENCE IS AN EVEN SHARE, NOT THE MODEL'S OWN RECOMMENDATION: THE RECOMMENDATION IS FITTED FROM PRIORITY, WHICH IS DOWNSTREAM OF THIS VERY MARK, AND MARKING AGAINST IT WOULD CLOSE A FEEDBACK LOOP. " +
          "THE ACTUAL RING IS DIVIDED BY THE PLANNED TOTAL, SO A WEEK YOU UNDER-RAN OVERALL STARVES EVERY DESK INSTEAD OF RENORMALIZING ITSELF BACK TO BALANCED.",
        inputs: [
          { sym: "\\rho_a", label: "share of an even week", value: `${(r * 100).toFixed(0)}%` },
          { sym: "x_a", label: "actual spend", value: e.actualHours == null ? "—" : `${e.actualHours.toFixed(1)} h/wk`, missing: e.actualHours == null },
          { sym: "w", label: "actual weight", value: `${EFFORT_ACTUAL_W} ${PT}` },
          { sym: "\\eta", label: "upside damping", value: String(UPSIDE_DAMP) },
        ],
        gates: [{ text: "actual hours recorded for this desk", pass: true }],
        related: ["premium.plan"],
      };
    },
  },
  ready: {
    title: "READINESS PREMIUM",
    symbol: "\\pi_{\\text{ready}}",
    claim: "YOUR OWN FORCED-CHOICE ORDERING, PRICED AS A TILT ACROSS THE BOOK — NEVER AS A LEVEL.",
    build: (t) => {
      const r = t.readiness;
      if (!r) return null;
      const charged = r.lambda < 0;
      const mag = Math.min(1, Math.abs(r.lambda));
      const p = 1 / (1 + Math.exp(-Math.abs(r.lambda)));
      return {
        tex:
          `\\pi_{\\text{ready}} = \\begin{cases}` +
          `\\min\\!\\big(${PREMIUM_CAPS.ready},\\; ${READINESS_W}\\,\\min(-\\lambda,1)\\,\\gamma\\big) & \\lambda < 0\\\\[2pt]` +
          `-\\,${READINESS_W}\\,\\min(\\lambda,1)\\,\\gamma\\,\\eta & \\lambda \\ge 0\\end{cases}`,
        subst: charged
          ? `= \\min\\!\\big(${PREMIUM_CAPS.ready},\\; ${READINESS_W}\\cdot${v(mag, 3)}\\cdot${v(r.credibility, 3)}\\big)`
          : `= -\\,${READINESS_W}\\cdot${v(mag, 3)}\\cdot${v(r.credibility, 3)}\\cdot${UPSIDE_DAMP}`,
        note:
          "λ IS BRADLEY-TERRY LOG-STRENGTH FROM THE ELO PILE, CENTRED SO Σλ = 0 ACROSS THE LISTED DESKS. WHAT THIS LINE CHARGES ONE DESK IT CREDITS ANOTHER: A GUT CALL ABOUT WHICH PAPER YOU ARE READIER FOR IS INFORMATION ABOUT ORDERING, AND IS NOT ALLOWED TO MOVE THE BOOK'S LEVEL. " +
          "THE CREDIT SIDE IS DAMPED LIKE EVERY OTHER CREDIT ON THE SHEET, WHICH LEAVES AN UNEVENLY PREPARED BOOK A SMALL NET CHARGE — DISPERSION IN READINESS IS ITSELF A RISK, AND THE LOSS-AVERSE DESK PRICES IT.",
        inputs: [
          { sym: "\\lambda", label: "log-strength", value: sgn(r.lambda, 3) },
          { sym: "P", label: "pick vs average", value: `${(p * 100).toFixed(0)}%` },
          { sym: "\\gamma", label: "pile credibility", value: fmt(r.credibility, 3) },
          { sym: "R", label: "elo rating", value: fmt(r.rating, 0) },
          { sym: "W-L", label: "arena record", value: `${r.wins}-${r.losses}` },
          { sym: "\\eta", label: "upside damping", value: String(UPSIDE_DAMP) },
        ],
        gates: [
          { text: "this desk has been duelled", pass: r.wins + r.losses > 0 },
          { text: "the pile has earned more than its unproven prior", pass: r.credibility > 0 },
        ],
        refs: ["bradley1952", "elo1978", "tversky1992"],
        related: ["duel.elo", "earn.readiness"],
      };
    },
  },
  plan: {
    title: "PLAN PREMIUM",
    symbol: "\\pi_{\\text{plan}}",
    claim: "WHAT YOU MEANT TO SPEND, CHARGED AT ABOUT A THIRD OF WHAT YOU MEASURED — AN INTENTION IS EVIDENCE, BUT WEAKER EVIDENCE.",
    build: (t) => {
      const e = t.effort;
      if (!e) return null;
      const r = e.planRatio;
      const deficit = Math.min(1, Math.max(0, 1 - r));
      const surplus = Math.min(1, Math.max(0, r - 1));
      return {
        tex:
          `\\pi_{\\text{plan}} = \\begin{cases}` +
          `\\min\\!\\big(${PREMIUM_CAPS.plan},\\; ${EFFORT_PLAN_W}\\,(1-\\rho_p)\\big) & \\rho_p < 1\\\\[2pt]` +
          `-\\,${EFFORT_PLAN_W}\\,\\eta\\min(\\rho_p-1,\\,1) & \\rho_p \\ge 1\\end{cases}` +
          `,\\qquad \\rho_p = \\frac{n\\,x_p}{T}`,
        subst:
          deficit > 0
            ? `= \\min\\!\\big(${PREMIUM_CAPS.plan},\\; ${EFFORT_PLAN_W}\\cdot ${v(deficit, 3)}\\big)`
            : `= -\\,${EFFORT_PLAN_W}\\cdot ${UPSIDE_DAMP}\\cdot ${v(surplus, 3)}`,
        note: `THE PLAN SUMS TO THE BUDGET BY CONSTRUCTION, SO ITS SHARES AVERAGE EXACTLY ONE: THIS LINE PRICES THE SHAPE OF THE WEEK YOU DREW, NEVER ITS SIZE. NOTHING HERE CLAIMS AN HOUR BUYS A POINT — ${EFFORT_PLAN_W} ${PT} AT TOTAL STARVATION IS A RESOURCING RISK CHARGE, AND THE SWITCH ON THE EFFORT CARD REMOVES IT ENTIRELY.`,
        inputs: [
          { sym: "\\rho_p", label: "share of an even week", value: `${(r * 100).toFixed(0)}%` },
          { sym: "x_p", label: "planned spend", value: e.planHours == null ? "—" : `${e.planHours.toFixed(1)} h/wk`, missing: e.planHours == null },
          { sym: "w", label: "plan weight", value: `${EFFORT_PLAN_W} ${PT}` },
          { sym: "\\eta", label: "upside damping", value: String(UPSIDE_DAMP) },
        ],
        related: ["premium.effort"],
      };
    },
  },
  steady: {
    title: "CONSISTENCY CREDIT",
    symbol: "\\pi_{\\text{steady}}",
    claim: "THE ONE STANDING CREDIT: A TIGHT, HONEST TAPE EARNS BACK TOWARD PAR. NEVER PAST IT.",
    build: (t) => ({
      tex: `\\pi_{\\text{steady}} = -\\min\\!\\big(2,\\; 1 + 0.3\\,(3.5 - \\mathrm{RMSSD})^{+}\\big)`,
      subst: `= -\\min\\!\\big(2,\\; 1 + 0.3\\,(3.5 - ${v(t.factors.vol, 1)})^{+}\\big)`,
      note: "A CREDIT CAN AT MOST RETURN A DESK TO FAIR VALUE, BECAUSE 𝒟 IS FLOORED AT ZERO BEFORE IT IS APPLIED.",
      inputs: [
        { sym: "\\mathrm{RMSSD}", label: "print-to-print swing", value: num(t.factors.vol, 1) },
        { sym: "\\eta", label: "upside damping", value: String(UPSIDE_DAMP) },
      ],
      gates: [{ text: "consistency gate passed", pass: t.factors.consistent }],
    }),
  },
};

/** One premium line, from its formula through attribution to the shown points. */
export function premium(key: string, ctx: DeriveCtx): Derivation | null {
  const q = ctx.stat?.quant;
  const t = traceOf(ctx);
  const spec = PREMIUM_SPECS[key];
  if (!q || !t || !spec) return null;

  const built = spec.build(t, q);
  if (!built) return null;
  const raw = t.raw.find((l) => l.key === key);
  const shown = q.premia.find((l) => l.key === key);

  const steps: Derivation["steps"] = [
    { tex: built.tex, subst: built.subst, note: built.note },
  ];
  if (raw && shown) {
    // The scaled product and the displayed points differ by at most one
    // rounding remainder, which the largest line absorbs so the waterfall sums
    // exactly. Show the arithmetic honestly rather than asserting a false
    // equality — this is the one place the two can legitimately disagree.
    const scaled = raw.pts * t.shrink;
    const resid = shown.pts - scaled;
    steps.push({
      tex: `\\tilde\\pi_{\\text{${key}}} = \\pi_{\\text{${key}}}\\cdot\\frac{\\mathcal{D}}{\\sum_k\\pi_k}`,
      subst:
        Math.abs(resid) >= 0.005
          ? `\\tilde\\pi = ${v(raw.pts, 2)} \\cdot ${v(t.shrink, 4)} = ${v(scaled, 2)} \\;\\xrightarrow{\\;r = ${v(resid, 2)}\\;}\\; ${v(shown.pts, 1)}\\;\\text{${PT}}`
          : `\\tilde\\pi = ${v(raw.pts, 2)} \\cdot ${v(t.shrink, 4)} \\;=\\; ${v(shown.pts, 1)}\\;\\text{${PT}}`,
      note:
        Math.abs(resid) >= 0.005
          ? "THE LINE THE WATERFALL SHOWS IS THE RAW CHARGE AFTER CREDIBILITY AND SATURATION ARE ALLOCATED BACK — PLUS THE ROUNDING REMAINDER r, WHICH LANDS ON THE LARGEST LINE SO THE WATERFALL SUMS TO THE DISCOUNT EXACTLY."
          : "THE LINE THE WATERFALL SHOWS IS THE RAW CHARGE AFTER CREDIBILITY AND SATURATION ARE ALLOCATED BACK.",
    });
  }

  const inputs: DerivationInput[] = [...built.inputs];
  if (raw) inputs.push({ sym: "\\pi", label: "raw charge", value: `${fmt(raw.pts, 2)} ${PT}` });
  const capped = key in PREMIUM_CAPS ? PREMIUM_CAPS[key as keyof typeof PREMIUM_CAPS] : null;
  inputs.push({
    sym: "\\text{cap}",
    label: "line ceiling",
    value: capped == null ? "own bound" : `${capped} ${PT}`,
    missing: capped == null,
  });

  const pts = shown?.pts ?? raw?.pts ?? 0;
  return {
    id: `premium.${key}`,
    title: spec.title,
    symbol: spec.symbol,
    claim: spec.claim,
    steps,
    inputs,
    result: {
      tex: spec.symbol,
      // A line that was never charged is not a charge of minus nothing.
      // `rawPremia` drops anything under 0.05 pts, so `pts` lands on exactly 0
      // and used to take the charge sign — printing "−0.0 PTS" as the ALPHA
      // EROSION header on a desk whose moat is widening.
      value: pts === 0 ? "0.0" : `${pts > 0 ? "−" : "+"}${Math.abs(pts).toFixed(1)}`,
      unit: PT,
    },
    gates: built.gates,
    refs: built.refs,
    related: [...(built.related ?? []), "mark.discount"],
    source: "src/lib/quant/mark.ts · rawPremia",
  };
}

export const PREMIUM_KEYS = Object.keys(PREMIUM_SPECS);
