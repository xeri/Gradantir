/**
 * Derivations for the factor panel — the diagnostic quantities the premia are
 * charged from.
 *
 * These are the drill-down targets: a premium popover explains what it costs,
 * and a chip on it opens the factor that set the price. Each one exists in this
 * engine instead of an obvious alternative (RMSSD instead of σ, semideviation
 * instead of variance, a walk-forward streak instead of a fixed threshold), and
 * saying WHY is most of the point of showing it.
 */

import { RELIABILITY_SD } from "../quant/params";
import { fmt, sgn, v, type Derivation, type DeriveCtx } from "./types";

const traceOf = (ctx: DeriveCtx) => ctx.stat?.quant?.trace?.mark ?? null;
const num = (x: number | null | undefined, dp = 1): string => (x == null ? "—" : x.toFixed(dp));

export function factorRmssd(ctx: DeriveCtx): Derivation | null {
  const t = traceOf(ctx);
  if (!t) return null;
  const f = t.factors;
  return {
    id: "factor.rmssd",
    title: "INSTABILITY · ROOT MEAN SQUARE SUCCESSIVE DIFFERENCE",
    symbol: "\\mathrm{RMSSD}",
    claim: "HOW HARD THE TAPE SWINGS FROM ONE PRINT TO THE NEXT — INCONSISTENCY, WHICH IS NOT THE SAME THING AS SPREAD.",
    steps: [
      {
        tex: `\\mathrm{RMSSD} \\;=\\; \\sqrt{\\frac{1}{n-1}\\sum_{i=2}^{n} (y_i - y_{i-1})^2}`,
        subst: `\\mathrm{RMSSD} \\;=\\; ${v(f.vol, 2)}\\;\\text{pts} \\qquad \\text{(${f.volBasis} basis, last 10 prints)}`,
        note: "A TAPE THAT WHIPSAWS 70→85→70→85 HAS A PERFECTLY ORDINARY STANDARD DEVIATION ABOUT ITS MEDIAN. IT CANNOT DISGUISE ITSELF FROM ITS OWN FIRST DIFFERENCES.",
      },
      {
        tex: `\\rho_{\\text{vol}} \\;=\\; \\frac{\\mathrm{RMSSD}}{\\operatorname{median}_s \\mathrm{RMSSD}^{(s)}}`,
        subst:
          f.volRatio != null && t.book.medianVol != null
            ? `\\rho_{\\text{vol}} \\;=\\; \\frac{${v(f.vol, 1)}}{${v(t.book.medianVol, 1)}} \\;=\\; ${v(f.volRatio, 2)}`
            : undefined,
        note: "MEASURED AGAINST THE BOOK, SO A GENUINELY VOLATILE SUBJECT IS NOT PUNISHED FOR BEING THE KIND OF SUBJECT IT IS.",
      },
      {
        tex: `\\varepsilon \\;=\\; \\frac{\\mathrm{RMSSD}(\\text{last }5)}{\\max\\!\\big(\\mathrm{RMSSD}(\\text{prior }10),\\, 2\\big)}`,
        subst: f.volExpansion != null ? `\\varepsilon \\;=\\; ${v(f.volExpansion, 2)}` : undefined,
        note: "EXPANSION: THE TAPE WIDENING AGAINST ITS OWN HISTORY, CHARGED ON TOP ONCE IT PASSES 1.3×.",
      },
    ],
    inputs: [
      { sym: "\\mathrm{RMSSD}", label: "own swing", value: num(f.vol) },
      { sym: "\\text{basis}", label: "measured on", value: f.volBasis === "exam" ? "exams only" : "all prints" },
      { sym: "\\tilde\\rho", label: "book median swing", value: num(t.book.medianVol), missing: t.book.medianVol == null },
      { sym: "\\rho_{\\text{vol}}", label: "vs book", value: f.volRatio == null ? "—" : `${f.volRatio.toFixed(2)}×`, missing: f.volRatio == null },
      { sym: "\\varepsilon", label: "recent expansion", value: f.volExpansion == null ? "—" : `${f.volExpansion.toFixed(2)}×`, missing: f.volExpansion == null },
    ],
    result: { tex: "\\mathrm{RMSSD}", value: fmt(f.vol, 1), unit: "PTS" },
    gates: [
      { text: "n ≥ 4 on the vol basis", pass: f.volN >= 4 },
      { text: "exam-only basis (≥ 4 exams) — mixed tapes conflate divergence with instability", pass: f.volBasis === "exam" },
      { text: "≥ 2 eligible desks for the book ratio", pass: f.volRatio != null },
    ],
    refs: ["vonneumann1941"],
    related: ["premium.vol"],
    source: "src/lib/quant/factors.ts · rmssd",
  };
}

export function factorSemidev(ctx: DeriveCtx): Derivation | null {
  const t = traceOf(ctx);
  if (!t) return null;
  const f = t.factors;
  return {
    id: "factor.semidev",
    title: "DOWNSIDE SEMIDEVIATION",
    symbol: "\\varsigma^{-}",
    claim: "DISPERSION COUNTED ONLY WHERE IT HURTS. AN UPSIDE SURPRISE IS NOT RISK.",
    steps: [
      {
        tex: `\\varsigma^{-} \\;=\\; \\sqrt{\\frac{1}{n}\\sum_{i=1}^{n} \\min\\!\\big(0,\\; y_i - \\mu\\big)^2}`,
        subst: `\\varsigma^{-} \\;=\\; ${v(f.semiDev, 2)}\\;\\text{pts}`,
        note: "μ IS THE RECENCY-WEIGHTED LEVEL, NOT THE ARITHMETIC MEAN — THE DEVIATIONS ARE MEASURED FROM WHERE THE DESK ACTUALLY SITS TODAY.",
      },
      {
        tex: `\\varsigma^{-} \\le \\sigma, \\quad \\text{with equality iff every print is at or below } \\mu`,
        note: "VARIANCE PRICES A DESK THAT OVERSHOOTS EXACTLY AS HARSHLY AS ONE THAT COLLAPSES. THE DECISION THIS NUMBER SUPPORTS IS NOT SYMMETRIC, SO NEITHER IS THE STATISTIC.",
      },
    ],
    inputs: [
      { sym: "\\varsigma^{-}", label: "semideviation", value: num(f.semiDev) },
      { sym: "n", label: "prints", value: String(f.n) },
    ],
    result: { tex: "\\varsigma^{-}", value: fmt(f.semiDev, 1), unit: "PTS" },
    gates: [{ text: "n ≥ 3 — below that it reports zero", pass: f.n >= 3 }],
    refs: ["markowitz1959", "sortino1994"],
    related: ["premium.down"],
    source: "src/lib/quant/factors.ts · downsideSemiDev",
  };
}

export function factorShock(ctx: DeriveCtx): Derivation | null {
  const t = traceOf(ctx);
  if (!t) return null;
  const f = t.factors;
  const floor = RELIABILITY_SD.Exam;
  return {
    id: "factor.shock",
    title: "EARNINGS SHOCK",
    symbol: "z_{\\text{shock}}",
    claim: "THE LATEST EXAM AGAINST ITS OWN TRAIL, IN SIGMA UNITS A TIGHT TAPE CANNOT INFLATE.",
    steps: [
      {
        tex: `z_{\\text{shock}} \\;=\\; \\frac{y_{\\text{exam}} - \\bar y^{\\,w}_{\\text{trail}}}{\\max\\!\\big(\\operatorname{MAD}(\\text{trail}),\\; R_{\\text{Exam}}\\big)}, \\qquad R_{\\text{Exam}} = ${floor}`,
        subst:
          f.shockZ != null && f.examTrail != null
            ? `z_{\\text{shock}} \\;=\\; \\frac{${v(f.examTrail + (f.shock ?? 0), 1)} - ${v(f.examTrail, 1)}}{\\max(\\cdot,\\,${floor})} \\;=\\; ${v(f.shockZ, 2)}`
            : undefined,
        note: "THE TRAIL IS A WINSORIZED MEAN OVER AT MOST SIX PRIOR EXAMS: ONE CATASTROPHE IN THE HISTORY MUST NOT MOVE THE BAR THE NEXT PRINT IS JUDGED AGAINST.",
      },
      {
        tex: `\\max(\\operatorname{MAD},\\, R_{\\text{Exam}}) \\;\\ge\\; R_{\\text{Exam}}`,
        note: "FLOORING THE DENOMINATOR BY EXAM RELIABILITY STOPS A DESK THAT HAPPENED TO PRINT 70, 70, 70 FROM REPORTING A 12σ EVENT ON ITS FIRST ORDINARY MISS.",
      },
    ],
    inputs: [
      { sym: "\\bar y^{\\,w}", label: "winsorized trail", value: num(f.examTrail), missing: f.examTrail == null },
      { sym: "\\Delta", label: "shock, points", value: f.shock == null ? "—" : sgn(f.shock, 1), missing: f.shock == null },
      { sym: "z", label: "in sigma", value: f.shockZ == null ? "—" : sgn(f.shockZ, 2) + "σ", missing: f.shockZ == null },
      { sym: "R_{\\text{Exam}}", label: "reliability floor", value: String(floor) },
    ],
    result: { tex: "z_{\\text{shock}}", value: f.shockZ == null ? "—" : sgn(f.shockZ, 1), unit: f.shockZ == null ? undefined : "σ" },
    gates: [{ text: "≥ 3 prior exams to form a trail", pass: f.examTrail != null }],
    refs: ["huber1964", "rousseeuw1993"],
    related: ["premium.shock"],
    source: "src/lib/quant/factors.ts · deskFactors",
  };
}

export function factorAlpha(ctx: DeriveCtx): Derivation | null {
  const t = traceOf(ctx);
  if (!t) return null;
  const f = t.factors;
  return {
    id: "factor.alpha",
    title: "ALPHA COLLAPSE · THE MOAT",
    symbol: "\\Delta\\alpha",
    claim: "YOUR EDGE OVER THE ROOM, AND WHETHER IT IS OPENING OR CLOSING.",
    steps: [
      {
        tex: `\\alpha_i \\;=\\; y_i - \\rho_i, \\qquad \\rho_i = a_i \\;\\text{(class)} \\;\\text{else}\\; g_i \\;\\text{(year level)}`,
        note: "CLASS AVERAGE IS PREFERRED BUT NEVER REQUIRED — MOST SCHOOL REPORTS PUBLISH ONLY A YEAR-LEVEL MEAN, AND DEMANDING THE CLASS FIGURE BLANKS ALPHA ACROSS A WHOLE BOOK.",
      },
      {
        tex: `\\Delta\\alpha \\;=\\; \\alpha_{\\text{last}} - \\frac{1}{m}\\sum_{i<\\text{last}} \\alpha_i`,
        subst:
          f.alphaCollapse != null && f.alphaLatest != null && f.alphaTrail != null
            ? `\\Delta\\alpha \\;=\\; ${v(f.alphaLatest, 1)} - (${v(f.alphaTrail, 1)}) \\;=\\; ${v(f.alphaCollapse, 1)}`
            : undefined,
        note: "TWO DESKS AT THE SAME LEVEL ARE NOT THE SAME POSITION IF ONE'S EDGE JUST EVAPORATED. FAIR VALUE PRICES THEM IDENTICALLY; THIS DOES NOT.",
      },
    ],
    inputs: [
      { sym: "\\alpha_{\\text{last}}", label: "latest edge", value: f.alphaLatest == null ? "—" : sgn(f.alphaLatest, 1), missing: f.alphaLatest == null },
      { sym: "\\bar\\alpha", label: "trailing edge", value: f.alphaTrail == null ? "—" : sgn(f.alphaTrail, 1), missing: f.alphaTrail == null },
      { sym: "\\Delta\\alpha", label: "moat move", value: f.alphaCollapse == null ? "—" : sgn(f.alphaCollapse, 1), missing: f.alphaCollapse == null },
    ],
    result: { tex: "\\Delta\\alpha", value: f.alphaCollapse == null ? "—" : sgn(f.alphaCollapse, 1), unit: f.alphaCollapse == null ? undefined : "PTS" },
    gates: [{ text: "≥ 3 referenced prints", pass: f.alphaCollapse != null }],
    related: ["premium.alpha"],
    source: "src/lib/quant/factors.ts · deskFactors",
  };
}

export function factorMiss(ctx: DeriveCtx): Derivation | null {
  const t = traceOf(ctx);
  if (!t) return null;
  const f = t.factors;
  return {
    id: "factor.miss",
    title: "MISS STREAK · WALK-FORWARD",
    symbol: "m",
    claim: "CONSECUTIVE PRINTS UNDER THE ESTIMATE THAT STOOD BEFORE EACH OF THEM.",
    steps: [
      {
        tex: `m \\;=\\; \\max\\Big\\{ k : y_i < \\hat y_{i\\,|\\,<i} - 0.5 \\;\\; \\forall\\, i > n-k \\Big\\}`,
        subst: `m \\;=\\; ${v(f.missStreak, 0)}, \\qquad \\bar\\delta \\;=\\; ${v(f.avgMissDeficit, 1)}\\;\\text{pts avg deficit}`,
        note: "MEASURED AGAINST A WALK-FORWARD ESTIMATE, NOT A FIXED THRESHOLD: THE STREAK COUNTS FAILURES TO MEET THE STANDARD THE DESK ITSELF HAD SET.",
      },
      {
        tex: `d \\;=\\; \\max\\Big\\{ k : y^{\\text{exam}}_{i} < y^{\\text{exam}}_{i-1} \\;\\; \\forall\\, i > n_E-k \\Big\\}`,
        subst: `d \\;=\\; ${v(f.downStreak, 0)}\\;\\text{consecutive lower exams}`,
      },
    ],
    inputs: [
      { sym: "m", label: "miss streak", value: String(f.missStreak) },
      { sym: "\\bar\\delta", label: "average deficit", value: num(f.avgMissDeficit) },
      { sym: "d", label: "down streak", value: String(f.downStreak) },
    ],
    result: { tex: "m", value: String(f.missStreak) },
    gates: [{ text: "n ≥ 4 — the forecast needs three priors", pass: f.n >= 4 }],
    related: ["premium.down"],
    source: "src/lib/quant/factors.ts · missStreak",
  };
}
