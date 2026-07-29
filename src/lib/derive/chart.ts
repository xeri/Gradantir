/**
 * Derivations for D2 — the chart board.
 *
 * Most of what a chart draws is the tape itself and carries no note, by the
 * same rule that leaves term averages alone: a dotted underline has to mean
 * "there is real machinery here". Three of the series are not the tape. The
 * dashed segment is an extrapolated least-squares fit, the bold line is a
 * filter with a well-documented failure mode, and the amber line is an index.
 * Each of those is a claim about data that does not exist yet or about
 * structure that may not be there, so each says so out loud.
 */

import { fmt, sgn, v, type Derivation, type DeriveCtx } from "./types";

export function chartTrend(ctx: DeriveCtx): Derivation | null {
  const id = ctx.key ?? ctx.stat?.sub.id;
  const f = id ? ctx.chart?.trend?.[id] : undefined;
  if (!f) return null;
  const ticker = ctx.chart?.ticker ?? ctx.stat?.sub.ticker ?? "";
  const first = f.pts[0];
  const last = f.pts[f.pts.length - 1];
  const span = last.x - first.x;
  const clipped = Math.abs(f.raw - f.pred) > 0.051;
  return {
    id: "chart.trend",
    title: `TREND ESTIMATE${ticker ? ` · ${ticker}` : ""}`,
    symbol: "\\hat y_{n+1}",
    claim: "A STRAIGHT LINE THROUGH THE RECENT PRINTS, EXTENDED ONE STEP. A GUIDE, NOT A PROMISE — AND NOT THE ENGINE'S FORECAST.",
    steps: [
      {
        tex: `(\\hat\\beta_0, \\hat\\beta_1) \\;=\\; \\arg\\min_{\\beta} \\sum_{i} \\big(y_i - \\beta_0 - \\beta_1 x_i\\big)^2 \\;\\Longrightarrow\\; \\hat\\beta_1 = \\frac{\\sum (x_i - \\bar x)(y_i - \\bar y)}{\\sum (x_i - \\bar x)^2}`,
        subst: `\\hat\\beta_1 = ${v(sgn(f.slope, 3), 0)}\\;\\text{pts}/\\text{${f.unit.toLowerCase()}}, \\qquad \\hat\\beta_0 = ${v(f.intercept, 2)}`,
        note: `ORDINARY LEAST SQUARES OVER THE LAST ${f.used} OF ${f.n} PLOTTED POINTS. EQUAL WEIGHTS AND A HARD WINDOW — NOT A DECAY — SO THE LINE IS EXACTLY AS OLD AS THE WINDOW SAYS AND NOTHING BEFORE IT IS SMUGGLED IN.`,
      },
      {
        tex: `\\hat y_{n+1} \\;=\\; \\operatorname{clip}_{[0,100]}\\!\\big(\\hat\\beta_0 + \\hat\\beta_1 x_{n+1}\\big)`,
        subst: `\\hat y \\;=\\; ${v(f.intercept, 2)} ${f.slope >= 0 ? "+" : "-"} ${v(Math.abs(f.slope), 3)}\\cdot${v(f.xNext, 0)} \\;=\\; ${v(f.raw, 2)} \\;\\longrightarrow\\; ${v(f.pred, 1)}`,
        note: clipped
          ? "THE RAW PROJECTION LEFT THE 0–100 BOARD AND HAS BEEN CLIPPED. THAT IS THE LINE TELLING YOU IT HAS BEEN EXTENDED PAST WHERE IT MEANS ANYTHING."
          : "EXTRAPOLATION IS THE WEAKEST THING A REGRESSION DOES. THE POINT SITS OUTSIDE THE RANGE OF x THE LINE WAS FITTED ON, WHERE THE ONLY THING HOLDING IT UP IS THE ASSUMPTION THAT THE STRAIGHT LINE KEEPS BEING TRUE.",
      },
      {
        tex: `\\hat\\sigma \\;=\\; \\sqrt{\\frac{1}{m-2}\\sum_i \\big(y_i - \\hat y_i\\big)^2}`,
        subst: `\\hat\\sigma = ${v(f.sigma, 2)}\\;\\text{pts} \\quad\\text{over}\\quad m = ${v(f.used, 0)}\\;\\text{points}`,
        note: "THE RESIDUAL SPREAD AROUND THE LINE ITSELF, WHICH IS A FLOOR ON THE ERROR OF THE PROJECTION — THE TRUE PREDICTION INTERVAL IS WIDER STILL, BECAUSE THE COEFFICIENTS ARE ESTIMATED AND THE POINT IS OUTSIDE THE FITTED RANGE. THE ENGINE'S OWN NEXT-EXAM BAND IS THE HONEST INTERVAL; THIS LINE IS DRAWN WITHOUT ONE ON PURPOSE, SO IT IS NEVER MISTAKEN FOR IT.",
      },
      {
        tex: `\\hat y_{n+1} \\;\\ne\\; \\widehat{\\text{exam}}_{n+1}`,
        note: "THIS IS A LINE THROUGH THE CHART'S OWN AGGREGATED POINTS. THE ORACLE ON THE QUOTE IS A SHRUNK, DETRENDED, DAMPED ENSEMBLE OVER THE RAW TAPE AND WILL DISAGREE WITH IT — WHERE THEY DIVERGE, THE ORACLE IS THE ONE THAT HAS BEEN BACKTESTED.",
      },
    ],
    inputs: [
      { sym: "m", label: "points fitted", value: String(f.used) },
      { sym: "n", label: "points plotted", value: String(f.n) },
      { sym: "\\hat\\beta_1", label: `slope /${f.unit.toLowerCase()}`, value: sgn(f.slope, 3) },
      { sym: "\\hat\\sigma", label: "residual sd", value: fmt(f.sigma, 2) },
      { sym: "\\Delta x", label: "window span", value: `${fmt(span, 0)} ${f.unit.toLowerCase()}` },
      { sym: "\\text{raw}", label: "before the clip", value: fmt(f.raw, 2) },
    ],
    result: { tex: "\\hat y_{n+1}", value: f.pred.toFixed(1) },
    gates: [
      { text: "≥ 3 plotted points before a line is drawn at all", pass: f.n >= 3 },
      { text: "the projection stayed inside the 0–100 board", pass: !clipped },
    ],
    refs: ["legendre1805"],
    related: ["oracle.next", "fv.trend", "fv.interval"],
    source: "src/lib/grouping.ts · addForecast · regression.ts · linreg",
  };
}

export function chartMovingAvg(ctx: DeriveCtx): Derivation | null {
  const ma = ctx.chart?.ma;
  if (!ma) return null;
  const ticker = ctx.chart?.ticker ?? "";
  const terms = ma.values.map((x) => v(x, 1)).join(" + ");
  return {
    id: "chart.ma",
    title: `ROLLING MEAN${ticker ? ` · ${ticker}` : ""}`,
    symbol: "\\text{MA}_k",
    claim: "THE SAME PRINTS WITH THE HIGH FREQUENCIES REMOVED. IT ADDS NO INFORMATION — IT ONLY MAKES THE LOW FREQUENCIES VISIBLE.",
    steps: [
      {
        tex: `\\text{MA}_k(t) \\;=\\; \\frac{1}{\\min(k, t)}\\sum_{j = \\max(1,\\,t-k+1)}^{t} y_j, \\qquad k = ${ma.win}`,
        subst: `= \\frac{${terms}}{${v(ma.values.length, 0)}} \\;=\\; ${v(ma.value, 1)}`,
        note: `EQUAL WEIGHTS, AND EXPANDING RATHER THAN UNDEFINED AT THE START — THE FIRST POINTS AVERAGE WHAT EXISTS. A ${ma.win}-POINT WINDOW ON A BOOK THIS SPARSE IS ABOUT A TERM.`,
      },
      {
        tex: `\\text{MA}_k \\;\\text{is a low-pass filter:}\\quad |H(\\omega)| = \\left|\\frac{\\sin(k\\omega/2)}{k\\,\\sin(\\omega/2)}\\right|`,
        note: "THE SLUTSKY–YULE EFFECT IS THE REASON THIS LINE IS OFF BY DEFAULT: A MOVING AVERAGE OF INDEPENDENT NOISE PRODUCES SMOOTH, PERSISTENT, ENTIRELY SPURIOUS CYCLES. A CONVINCING WAVE IN A SMOOTHED LINE IS EVIDENCE OF THE FILTER BEFORE IT IS EVIDENCE OF THE STUDENT.",
      },
      {
        tex: `\\mathbb{E}\\big[\\text{MA}_k(t)\\big] \\;=\\; \\mu_{t - (k-1)/2} \\quad\\text{under a linear trend}`,
        subst: `\\text{lag} \\;=\\; \\frac{${ma.win} - 1}{2} \\;=\\; ${v((ma.win - 1) / 2, 1)}\\;\\text{points}`,
        note: "A TRAILING WINDOW IS ALSO A DELAY: ON A RISING TAPE THE SMOOTH LINE SITS BELOW THE TRUTH BY HALF A WINDOW, WHICH IS WHY NOTHING IN THE ENGINE PRICES OFF IT. THE FORECASTERS USE EWMA AND A KALMAN FILTER, BOTH OF WHICH ARE BUILT TO TRACK RATHER THAN TO LOOK CALM.",
      },
    ],
    inputs: [
      { sym: "k", label: "window", value: String(ma.win) },
      { sym: "m", label: "points averaged", value: String(ma.values.length) },
      { sym: "\\text{lag}", label: "induced delay", value: `${fmt((ma.win - 1) / 2, 1)} pts` },
    ],
    result: { tex: "\\text{MA}_k", value: ma.value.toFixed(1) },
    gates: [{ text: "a full window of prints behind this point", pass: ma.values.length >= ma.win }],
    refs: ["slutzky1937", "brown1956"],
    related: ["fv.ewma", "fv.kalman", "chart.trend"],
    source: "src/lib/grouping.ts · addMovingAvg",
  };
}

export function chartComposite(ctx: DeriveCtx): Derivation | null {
  const c = ctx.chart?.comp;
  if (!c || !c.values.length) return null;
  const n = c.values.length;
  const rows = c.values.map((x) => `\\text{${x.ticker}} & ${fmt(x.v, 1)} \\\\`).join(" ");
  const sd = Math.sqrt(c.values.reduce((a, x) => a + (x.v - c.value) ** 2, 0) / Math.max(1, n - 1));
  return {
    id: "chart.composite",
    title: `COMPOSITE OVERLAY${ctx.chart?.label ? ` · ${ctx.chart.label}` : ""}`,
    symbol: "\\bar y_t",
    claim: "THE RAW EQUAL-WEIGHT AVERAGE OF WHAT ACTUALLY PRINTED ON THIS ROW — NOT THE MODEL INDEX AT THE TOP OF THE TERMINAL.",
    steps: [
      {
        tex: `\\bar y_t \\;=\\; \\frac{1}{|S_t|}\\sum_{s \\in S_t} y_{s,t}`,
        subst: `\\bar y \\;=\\; \\frac{${c.values.map((x) => v(x.v, 1)).join(" + ")}}{${v(n, 0)}} \\;=\\; ${v(c.value, 1)}`,
        note: "EQUAL WEIGHTS, AND ONLY OVER THE DESKS THAT PRINTED IN THIS PERIOD — A DESK WITH NO RESULT IS ABSENT FROM THE AVERAGE RATHER THAN CARRIED FORWARD, SO THE LINE CAN STEP WHEN THE SET OF DESKS CHANGES.",
      },
      {
        tex: `\\begin{array}{lr} \\textbf{desk} & y_{s,t} \\\\ \\hline ${rows} \\end{array}`,
        note: "THE ROW, ITEMIZED. THE COMPOSITION IS THE CAVEAT: A JUMP IN THIS LINE BETWEEN TWO PERIODS CAN BE A BOOK THAT IMPROVED OR A BOOK THAT SIMPLY SAT DIFFERENT PAPERS.",
      },
      {
        tex: `s \\;=\\; \\sqrt{\\frac{1}{|S_t| - 1}\\sum_s (y_{s,t} - \\bar y_t)^2}`,
        subst: n > 1 ? `s \\;=\\; ${v(sd, 2)}\\;\\text{pts}` : undefined,
        note: "THE CROSS-SECTIONAL SPREAD BEHIND THE POINT. A COMPOSITE OF SIX DESKS SITTING WITHIN A POINT OF EACH OTHER AND ONE OF SIX SPREAD OVER FORTY POINTS ARE THE SAME DOT ON THE CHART AND ENTIRELY DIFFERENT TERMS.",
      },
      {
        tex: `\\bar y_t \\;\\ne\\; \\mathrm{GX}_t`,
        note: "THE HEADLINE GX COMPOSITE IS THE MEAN MODEL MARK — RISK CHARGED, REPRICED AS OF EACH TERM-END. THIS LINE IS THE UNMODELLED TAPE. THEY ARE DRAWN IN THE SAME COLOUR BECAUSE THEY ANSWER THE SAME QUESTION AND KEPT DISTINCT BECAUSE THEY ANSWER IT DIFFERENTLY.",
      },
    ],
    inputs: [
      { sym: "|S_t|", label: "desks printing", value: String(n) },
      { sym: "s", label: "cross-sectional sd", value: n > 1 ? fmt(sd, 2) : "—", missing: n <= 1 },
      { sym: "\\min", label: "weakest desk", value: fmt(Math.min(...c.values.map((x) => x.v)), 1) },
      { sym: "\\max", label: "strongest desk", value: fmt(Math.max(...c.values.map((x) => x.v)), 1) },
    ],
    result: { tex: "\\bar y_t", value: c.value.toFixed(1) },
    gates: [{ text: "≥ 2 desks printed in this period", pass: n >= 2 }],
    refs: ["kish1965"],
    related: ["book.composite", "book.forecast"],
    source: "src/lib/composite.ts · rowComposite",
  };
}
