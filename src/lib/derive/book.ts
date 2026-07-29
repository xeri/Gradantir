/**
 * Derivations for the book-level instruments.
 *
 * Two of the three headline numbers on the overview are model output and one
 * deliberately is not. AGGREGATE is the straight sum of realized exams and has
 * no derivation because it has no model — that is its whole claim. PREDICTION
 * and GX COMPOSITE do, and both aggregate uncertainty the same way.
 */

import { fmt, sgn, v, type Derivation, type DeriveCtx } from "./types";

/** 90% two-sided normal quantile — the aggregate bands are Gaussian by CLT. */
const Z90 = 1.6448536269514722;

export function bookComposite(ctx: DeriveCtx): Derivation | null {
  const idx = ctx.index;
  if (!idx || idx.value == null) return null;
  return {
    id: "book.composite",
    title: "GX COMPOSITE",
    symbol: "\\mathrm{GX}",
    claim: "THE SCALED CAPABILITY INDEX — EVERY PRICED DESK'S MARK, AVERAGED. WHAT AM I WORTH NOW?",
    steps: [
      {
        tex: `\\mathrm{GX} \\;=\\; \\frac{1}{|S|}\\sum_{s \\in S} \\mathrm{PX}_s \\;=\\; \\frac{\\sum_s \\mathrm{PX}_s}{|S|}`,
        subst: `\\mathrm{GX} \\;=\\; \\frac{${v(idx.sum, 1)}}{${v(idx.count, 0)}} \\;=\\; ${v(idx.value, 1)}`,
        note: "THE MARK, NOT FAIR VALUE: THE INDEX IS WHAT THE BOOK WOULD TRADE AT, RISK CHARGED.",
      },
      {
        tex: `\\sigma_{\\Sigma} \\;=\\; \\sqrt{\\sum_{s} \\hat\\sigma_s^2}, \\qquad \\text{CI}_{90} = \\Sigma \\pm ${Z90.toFixed(3)}\\,\\sigma_{\\Sigma}`,
        subst: `\\sigma_{\\Sigma} = ${v(idx.sd, 2)} \\;\\Longrightarrow\\; [\\,${v(idx.ci90.lo, 1)},\\; ${v(idx.ci90.hi, 1)}\\,]`,
        note: "ERRORS IN QUADRATURE: DESK UNCERTAINTIES ARE TREATED AS INDEPENDENT, SO THE BAND GROWS AS √|S| RATHER THAN |S|.",
      },
      {
        tex: `\\mathrm{GX}_{t} \\;=\\; \\mathbb{E}_s\\big[\\mathrm{PX}_s \\;\\big|\\; \\{y_i : x_i \\le t\\}\\big]`,
        note: "THE HISTORY REPRICES AND RE-MARKS THE WHOLE BOOK AT EACH PAST TERM-END USING ONLY THE PRINTS THAT EXISTED THEN. THE LINE IS WHAT THE ENGINE WOULD HAVE SAID AT THE TIME, NOT TODAY'S MODEL PAINTED BACKWARDS.",
      },
    ],
    inputs: [
      { sym: "|S|", label: "priced desks", value: String(idx.count) },
      { sym: "\\Sigma", label: "sum of marks", value: fmt(idx.sum, 1) },
      { sym: "\\text{outOf}", label: "out of", value: String(idx.outOf) },
      { sym: "\\sigma_{\\Sigma}", label: "aggregate sd", value: fmt(idx.sd, 2) },
      { sym: "\\Delta", label: "vs last term", value: idx.delta == null ? "—" : sgn(idx.delta, 1), missing: idx.delta == null },
    ],
    result: { tex: "\\mathrm{GX}", value: fmt(idx.value, 1) },
    related: ["mark.price", "book.forecast"],
    source: "src/lib/composite.ts · quant/aggregate.ts",
  };
}

export function bookForecast(ctx: DeriveCtx): Derivation | null {
  const f = ctx.forecast;
  if (!f) return null;
  return {
    id: "book.forecast",
    title: "PREDICTION · THE NEXT EXAM ROUND",
    symbol: "\\widehat{\\Sigma}",
    claim: "THE AGGREGATE'S FORWARD TWIN — EVERY DESK'S ORACLE, SUMMED, WITH ERRORS IN QUADRATURE.",
    steps: [
      {
        tex: `\\widehat{\\Sigma} \\;=\\; \\sum_{s} \\widehat{\\text{exam}}_{s,n+1} \\;=\\; \\sum_s \\operatorname{clip}_{[0,100]}\\big(w_E\\,\\hat\\mu_{E} + (1-w_E)(\\hat\\mu_{C} + \\hat\\delta)\\big)`,
        subst: `\\widehat{\\Sigma} \\;=\\; ${v(f.sum, 1)} \\;/\\; ${v(f.outOf, 0)} \\;=\\; ${v(f.pct, 1)}\\%`,
        note: "EACH DESK'S ORACLE IS THE PRECISION-WEIGHTED BLEND OF ITS EXAM SIDE AND ITS COURSEWORK SIDE (COURSEWORK CROSSED INTO EXAM TERMS BY δ̂) — NOT μ̂+δ̂, WHICH WOULD ADD THE WHOLE GAP TO A MEAN THAT ALREADY HELD THE EXAMS. BUILT ON FAIR VALUE, NOT THE MARK: A FORECAST MUST BE UNBIASED.",
      },
      {
        tex: `\\sigma_{\\widehat{\\Sigma}} \\;=\\; \\sqrt{\\sum_s \\hat\\sigma_s^2}`,
        subst: `\\sigma = ${v(f.sd, 2)} \\;\\Longrightarrow\\; \\text{CI}_{90} = [\\,${v(f.ci90.lo, 1)},\\; ${v(f.ci90.hi, 1)}\\,]`,
        note: "INDEPENDENCE ACROSS DESKS IS AN ASSUMPTION, AND A GENEROUS ONE: A BAD TERM IS RARELY BAD IN ONLY ONE SUBJECT. THE BAND IS THEREFORE A FLOOR ON THE TRUE UNCERTAINTY.",
      },
    ],
    inputs: [
      { sym: "|S|", label: "desks forecast", value: String(f.count) },
      { sym: "\\widehat{\\Sigma}", label: "predicted sum", value: fmt(f.sum, 1) },
      { sym: "\\sigma", label: "quadrature sd", value: fmt(f.sd, 2) },
      { sym: "\\Delta", label: "vs last round", value: f.vsLast == null ? "—" : sgn(f.vsLast, 1), missing: f.vsLast == null },
    ],
    result: { tex: "\\widehat{\\Sigma}", value: `${f.pct.toFixed(1)}%` },
    related: ["oracle.next", "book.composite"],
    source: "src/lib/quant/aggregate.ts · forecastAggregate",
  };
}
