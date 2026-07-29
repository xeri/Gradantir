/**
 * Derivations for Part I of the paper — fair value, its four members, the
 * predictive distribution, and the exam oracle.
 *
 * Fair value is the unbiased estimate every forecast in the terminal is built
 * on, and the number the MARK discounts from. Its credibility rests entirely
 * on machinery that is invisible in the interface: four forecasters with
 * orthogonal failure modes, weighted by how well they actually predicted
 * prints they had not seen, blended as a mixture so their disagreement widens
 * the band, and intervalled by a Student-t whose degrees of freedom are the
 * honesty mechanism at small n.
 */

import {
  EWMA_HALF_LIFE_DAYS, EXAM_OFFSET_SHRINK, PRIOR_VAR, Q_PER_DAY,
  RELIABILITY_SD, SIGNAL_WEIGHT,
} from "../quant/params";
import { selfPredictive } from "../quant/pool";
import { fmt, sgn, v, type Derivation, type DeriveCtx, type DerivationInput } from "./types";

const traceOf = (ctx: DeriveCtx) => ctx.stat?.quant?.trace?.price ?? null;
const num = (x: number | null | undefined, dp = 1): string => (x == null ? "—" : x.toFixed(dp));

const MEMBER_LABEL: Record<string, string> = {
  kalman: "KALMAN",
  ewma: "EWMA",
  shrunk: "MEAN",
  trend: "TREND",
};

/* ── Fair value ────────────────────────────────────────────────────── */

export function fvValue(ctx: DeriveCtx): Derivation | null {
  const q = ctx.stat?.quant;
  const t = traceOf(ctx);
  if (!q || !t) return null;
  return {
    id: "fv.value",
    title: "FAIR VALUE",
    symbol: "\\mathrm{FV}",
    claim: "WHAT THIS DESK IS PROBABLY WORTH — THE UNBIASED CAPABILITY ESTIMATE OVER EVERY PRINT, COURSEWORK INCLUDED.",
    steps: [
      {
        tex: `\\mathrm{FV} \\;=\\; \\operatorname{clip}_{[0,100]}(\\hat\\mu), \\qquad \\hat\\mu = \\sum_m w_m \\hat\\mu_m`,
        subst: `\\mathrm{FV} \\;=\\; ${v(t.mean, 3)} \\;\\longrightarrow\\; ${v(q.fv, 1)}`,
        note: "FAIR VALUE IS THE BASIS OF EVERY FORECAST IN THIS TERMINAL. IT IS NOT WHAT THE BOARD DISPLAYS AS THE PRICE.",
      },
      {
        tex: `\\hat\\sigma^2 \\;=\\; \\sum_m w_m\\!\\left[\\hat\\sigma_m^2 + (\\hat\\mu_m - \\hat\\mu)^2\\right]`,
        subst: `\\hat\\sigma \\;=\\; ${v(t.sd, 2)}\\;\\text{pts}, \\qquad \\nu = 3 + n = ${v(t.df, 0)}`,
        note: "MOMENT-MATCHED AS A MIXTURE, SO MEMBER DISAGREEMENT ITSELF WIDENS THE BAND — FOUR FORECASTERS SPLITTING IS WEAKER EVIDENCE THAN FOUR AGREEING.",
      },
    ],
    inputs: [
      { sym: "n", label: "prints", value: String(t.n) },
      { sym: "\\hat\\mu", label: "blended mean", value: fmt(t.mean, 3) },
      { sym: "\\hat\\sigma", label: "blended sd", value: fmt(t.sd, 2) },
      { sym: "\\nu", label: "student-t df", value: String(t.df) },
    ],
    result: { tex: "\\mathrm{FV}", value: fmt(q.fv, 1) },
    refs: ["bates1969", "wolpert1992"],
    related: ["fv.ensemble", "fv.interval", "mark.price"],
    source: "src/lib/quant/price.ts · priceSubject",
  };
}

export function fvEnsemble(ctx: DeriveCtx): Derivation | null {
  const q = ctx.stat?.quant;
  const t = traceOf(ctx);
  if (!q || !t) return null;

  const rows = t.members
    .map(
      (m) =>
        `${MEMBER_LABEL[m.name] ?? m.name} & ${fmt(m.mean, 1)} & ${fmt(m.sd, 1)} & ${
          m.validation ? fmt(m.validation.mse, 1) : "\\text{--}"
        } & ${fmt(100 * m.weight, 0)}\\% \\\\`,
    )
    .join(" ");

  return {
    id: "fv.ensemble",
    title: "ENSEMBLE STACKING · WALK-FORWARD VALIDATION",
    symbol: "w_m",
    claim:
      "FOUR FORECASTERS WITH ORTHOGONAL FAILURE MODES, WEIGHTED BY HOW WELL EACH ACTUALLY PREDICTED THE PRINTS IT HAD NOT SEEN.",
    steps: [
      {
        tex: `w_m \\;\\propto\\; \\frac{1}{\\mathrm{MSE}_m + \\varepsilon}, \\qquad \\varepsilon = 4\\;\\text{pts}^2, \\qquad \\mathrm{MSE}_m = \\frac{1}{|F|}\\sum_{i \\in F} \\big(\\hat\\mu_m^{(<i)} - y_i\\big)^2`,
        note: "FOR EACH OF THE LAST 8 PRINTS EVERY MEMBER IS REFIT ON STRICTLY EARLIER PRINTS AND SCORED ON ITS ONE-STEP-AHEAD ERROR. THE REGULARIZER STOPS A LUCKY MEMBER TAKING INFINITE WEIGHT.",
      },
      {
        tex: `\\begin{array}{lrrrr} \\textbf{member} & \\hat\\mu_m & \\hat\\sigma_m & \\mathrm{MSE}_m & w_m \\\\ \\hline ${rows} \\end{array}`,
        note: t.fixedWeights
          ? "BELOW n = 3 THERE IS NOTHING TO VALIDATE AGAINST, SO THE FIXED PRIORS (0.35, 0.25, 0.30, 0.10) APPLY."
          : "ON CLEAN TRENDING DATA THE TREND MEMBER WINS THE WEIGHTS AND THE BLEND RIDES IT; ON A SHUFFLED SERIES IT COLLAPSES TO THE MEDIAN AND THE STABLE MEMBERS TAKE OVER.",
      },
      {
        tex: `\\hat\\mu = \\sum_m w_m \\hat\\mu_m, \\qquad \\hat\\sigma^2 = \\sum_m w_m\\!\\left[\\hat\\sigma_m^2 + (\\hat\\mu_m - \\hat\\mu)^2\\right]`,
        subst: `\\hat\\mu = ${v(t.mean, 3)}, \\qquad \\hat\\sigma = ${v(t.sd, 2)}`,
      },
    ],
    inputs: [
      ...t.members.map(
        (m): DerivationInput => ({
          sym: `w_{\\text{${MEMBER_LABEL[m.name]?.toLowerCase() ?? m.name}}}`,
          label: `${MEMBER_LABEL[m.name] ?? m.name} — ${m.validation ? `${m.validation.folds} folds` : "unvalidated"}`,
          value: `${(100 * m.weight).toFixed(0)}%`,
          missing: m.weight === 0,
        }),
      ),
      { sym: "\\varepsilon", label: "MSE regularizer", value: "4 pts²" },
    ],
    result: { tex: "\\hat\\mu", value: fmt(q.fv, 1) },
    gates: [{ text: "n ≥ 3 — enough tape to validate on", pass: !t.fixedWeights }],
    refs: ["wolpert1992", "bates1969"],
    related: ["fv.kalman", "fv.ewma", "fv.shrunk", "fv.trend"],
    source: "src/lib/quant/ensemble.ts · ensemble",
  };
}

/* ── The four members ──────────────────────────────────────────────── */

function memberOf(ctx: DeriveCtx, name: string) {
  const t = traceOf(ctx);
  return t?.members.find((m) => m.name === name) ?? null;
}

export function fvKalman(ctx: DeriveCtx): Derivation | null {
  const t = traceOf(ctx);
  const m = memberOf(ctx, "kalman");
  if (!t || !m) return null;
  return {
    id: "fv.kalman",
    title: "MEMBER · LOCAL-LEVEL KALMAN FILTER",
    symbol: "\\alpha_t",
    claim: "ABILITY AS A RANDOM WALK OBSERVED THROUGH NOISY ASSESSMENTS — ADAPTIVE, BUT IT CHASES.",
    steps: [
      {
        tex: `\\alpha_t = \\alpha_{t-\\Delta} + w,\\;\\; w \\sim \\mathcal{N}(0, q\\Delta) \\qquad\\qquad \\tilde y_i = \\alpha_{t_i} + v_i,\\;\\; v_i \\sim \\mathcal{N}(0, R_{c_i})`,
        note: `q = ${Q_PER_DAY} pts²/DAY. REAL DAY-GAPS MATTER: A PRINT AFTER A 200-DAY BREAK MEETS AN HONESTLY WIDER PRIOR THAN ONE THREE DAYS AFTER THE LAST.`,
      },
      {
        tex: `P \\leftarrow P + q\\,\\Delta t, \\qquad K = \\frac{P}{P + R_c}, \\qquad m \\leftarrow m + K(\\tilde y - m), \\qquad P \\leftarrow (1-K)P`,
        note: "PREDICT, THEN UPDATE, ONCE PER PRINT. THE GAIN K IS THE SHARE OF EACH SURPRISE THE FILTER BELIEVES.",
      },
      {
        tex: `R_c = \\{\\text{Exam } ${RELIABILITY_SD.Exam}^2,\\; \\text{Test } ${RELIABILITY_SD.Test}^2,\\; \\text{Asgn } ${RELIABILITY_SD.Assignment}^2,\\; \\text{Quiz } ${RELIABILITY_SD.Quiz}^2\\}`,
        subst: `\\hat\\mu_{\\text{kalman}} = ${v(m.mean, 2)}, \\quad \\hat\\sigma = ${v(m.sd, 2)}, \\quad w = ${v(100 * m.weight, 0)}\\%`,
        note: "RELIABILITY ASKS HOW PRECISELY ONE PRINT MEASURES ABILITY — EXAMS WIN, UNDER CONTROLLED CONDITIONS.",
      },
    ],
    inputs: [
      { sym: "\\hat\\mu", label: "member estimate", value: fmt(m.mean, 2) },
      { sym: "\\hat\\sigma", label: "member sd", value: fmt(m.sd, 2) },
      { sym: "q", label: "drift variance /day", value: String(Q_PER_DAY) },
      { sym: "P_0", label: "prior variance", value: `${PRIOR_VAR} (15²)` },
      { sym: "\\mathrm{MSE}", label: "walk-forward error", value: m.validation ? fmt(m.validation.mse, 1) : "—", missing: !m.validation },
      { sym: "w", label: "blend weight", value: `${(100 * m.weight).toFixed(0)}%` },
    ],
    result: { tex: "\\hat\\mu_{\\text{kalman}}", value: fmt(m.mean, 1) },
    refs: ["kalman1960"],
    related: ["fv.ensemble"],
    source: "src/lib/quant/kalman.ts · kalmanFilter",
  };
}

export function fvEwma(ctx: DeriveCtx): Derivation | null {
  const m = memberOf(ctx, "ewma");
  if (!m) return null;
  return {
    id: "fv.ewma",
    title: "MEMBER · RECENCY EWMA",
    symbol: "\\hat\\mu_{\\text{EWMA}}",
    claim: "A 60-DAY HALF-LIFE CROSSED WITH PER-TYPE SIGNAL WEIGHTS — RECENT, BUT JUMPY.",
    steps: [
      {
        tex: `w_i \\;=\\; 2^{-(x_\\ast - x_i)/h}\\cdot u_{c_i}, \\qquad h = ${EWMA_HALF_LIFE_DAYS}\\;\\text{days}`,
        note: "DECAY RUNS ON CALENDAR DAYS FROM TODAY, NOT ON PRINT INDEX: A CLUSTER OF FOUR QUIZZES IN A WEEK IS ONE WEEK OF EVIDENCE, NOT FOUR.",
      },
      {
        tex: `\\hat\\mu_{\\text{EWMA}} \\;=\\; \\frac{\\sum_i w_i \\tilde y_i}{\\sum_i w_i}, \\qquad u = \\{\\text{Test/Asgn } ${SIGNAL_WEIGHT.Test},\\; \\text{Exam } ${SIGNAL_WEIGHT.Exam},\\; \\text{Quiz } ${SIGNAL_WEIGHT.Quiz}\\}`,
        subst: `\\hat\\mu_{\\text{EWMA}} = ${v(m.mean, 2)}, \\quad \\hat\\sigma = ${v(m.sd, 2)}, \\quad w = ${v(100 * m.weight, 0)}\\%`,
        note: "NOTE THE DELIBERATE ASYMMETRY AGAINST THE KALMAN'S Rᶜ. SIGNAL ASKS HOW MUCH A PRINT SHOULD MOVE THE DAY-TO-DAY ESTIMATE — COURSEWORK WINS, BEING FREQUENT, RECENT AND DIAGNOSTIC. BOTH TABLES ARE CORRECT; THEY ANSWER DIFFERENT QUESTIONS.",
      },
    ],
    inputs: [
      { sym: "\\hat\\mu", label: "member estimate", value: fmt(m.mean, 2) },
      { sym: "h", label: "half-life", value: `${EWMA_HALF_LIFE_DAYS}d` },
      { sym: "u_{\\text{cw}}", label: "coursework signal", value: String(SIGNAL_WEIGHT.Test) },
      { sym: "u_{\\text{ex}}", label: "exam signal", value: String(SIGNAL_WEIGHT.Exam) },
      { sym: "\\mathrm{MSE}", label: "walk-forward error", value: m.validation ? fmt(m.validation.mse, 1) : "—", missing: !m.validation },
      { sym: "w", label: "blend weight", value: `${(100 * m.weight).toFixed(0)}%` },
    ],
    result: { tex: "\\hat\\mu_{\\text{EWMA}}", value: fmt(m.mean, 1) },
    refs: ["brown1956"],
    related: ["fv.ensemble"],
    source: "src/lib/quant/ensemble.ts · ewma",
  };
}

export function fvShrunk(ctx: DeriveCtx): Derivation | null {
  const t = traceOf(ctx);
  const m = memberOf(ctx, "shrunk");
  if (!t || !m) return null;
  const pool = t.pool;
  const B = pool ? pool.tau2 / (pool.tau2 + pool.sigma2 / t.n) : null;
  return {
    id: "fv.shrunk",
    title: "MEMBER · CROSS-SUBJECT SHRINKAGE",
    symbol: "B",
    claim: "WITH TWO PRINTS A DESK'S OWN MEAN IS A POOR ESTIMATOR. JAMES–STEIN PRESCRIBES PARTIAL POOLING — THE FORMULA DECIDES HOW MUCH, NOT A HEURISTIC.",
    steps: [
      {
        tex: `B \\;=\\; \\frac{\\tau^2}{\\tau^2 + \\sigma^2/n}, \\qquad \\hat\\mu_{\\text{shrunk}} \\;=\\; B\\,\\bar{\\tilde y} + (1-B)\\,\\bar\\mu_{\\text{book}}`,
        subst:
          pool && B != null
            ? `B \\;=\\; \\frac{${v(pool.tau2, 1)}}{${v(pool.tau2, 1)} + ${v(pool.sigma2, 1)}/${v(t.n, 0)}} \\;=\\; ${v(B, 3)}`
            : undefined,
        note: "B → 0 AS n → 0 (A NEW DESK OPENS AT THE BOOK'S LEVEL); B → 1 AS EVIDENCE ACCUMULATES. IF DESKS GENUINELY SPREAD FAR APART, EVEN ONE PRINT EARNS REAL TRUST.",
      },
      {
        tex: `\\text{pooled on } \\; y_i - \\rho_i + \\bar\\rho_{\\text{book}}`,
        note: "POOLING IS ONLY VALID BETWEEN COMPARABLY-SCALED MEASUREMENTS, AND MARKS ARE NOT. THE POOL RUNS ON DIFFICULTY-CORRECTED SCORES CENTRED ON THE BOOK'S MEAN REFERENCE, SO THE CORRECTION IS GENUINELY CROSS-SUBJECT AND THE SCALE STAYS A PERCENTAGE.",
      },
    ],
    inputs: [
      { sym: "B", label: "trust in local data", value: B == null ? "—" : fmt(B, 3), missing: B == null },
      { sym: "\\tau^2", label: "between-desk variance", value: num(pool?.tau2), missing: !pool },
      { sym: "\\sigma^2", label: "within-desk variance", value: num(pool?.sigma2), missing: !pool },
      { sym: "\\bar\\mu", label: "book grand mean", value: num(pool?.grandMean), missing: !pool },
      { sym: "k", label: "desks in the pool", value: pool ? String(pool.k) : "—", missing: !pool },
      { sym: "w", label: "blend weight", value: `${(100 * m.weight).toFixed(0)}%` },
    ],
    result: { tex: "\\hat\\mu_{\\text{shrunk}}", value: fmt(m.mean, 1) },
    gates: [{ text: "a book to borrow strength from", pass: pool != null }],
    refs: ["jamesstein1961", "efron1975"],
    related: ["fv.ensemble", "fv.detrend"],
    source: "src/lib/quant/shrinkage.ts · shrinkMean",
  };
}

export function fvTrend(ctx: DeriveCtx): Derivation | null {
  const t = traceOf(ctx);
  const m = memberOf(ctx, "trend");
  const f = ctx.stat?.quant?.trace?.mark?.factors ?? null;
  if (!t || !m) return null;
  const gated = f ? f.slope30 !== 0 : null;
  return {
    id: "fv.trend",
    title: "MEMBER · THEIL–SEN UNDER A KENDALL-τ GATE",
    symbol: "\\hat\\beta",
    claim: "A SLOPE MAY ONLY FORECAST IF THE ORDERING OF THE DATA SUPPORTS IT. FLUCTUATING DATA FORECASTS FLAT.",
    steps: [
      {
        tex: `\\beta_{TS} \\;=\\; \\operatorname{median}_{i<j}\\frac{y_j - y_i}{x_j - x_i}`,
        note: "THE MEDIAN OF PAIRWISE SLOPES — A 29% BREAKDOWN POINT, SO NO SINGLE CATASTROPHIC PRINT CAN HIJACK THE LINE.",
      },
      {
        tex: `\\hat\\beta \\;=\\; \\begin{cases}\\beta_{TS}\\,(1-p)^2 & n \\ge 4 \\;\\text{and}\\; p \\le 0.5\\\\ 0 & \\text{otherwise}\\end{cases}, \\qquad p \\;\\text{from Kendall's}\\; \\tau`,
        subst: f ? `\\hat\\beta_{30} \\;=\\; ${v(f.slope30, 2)}\\;\\text{pts}/30\\text{d}` : undefined,
        note: "A SHUFFLED SERIES GETS p ≈ 0.8 ⇒ β̂ = 0, AND THE MEMBER DEGRADES TO THE RUNNING MEDIAN. THIS IS THE ENGINE'S ANSWER TO THE CLASSIC SMALL-n FAILURE OF LEAST SQUARES, WHICH WILL CHEERFULLY EXTRAPOLATE A LINE THROUGH FOUR RANDOM POINTS.",
      },
      {
        tex: `\\operatorname{Var}(S) = \\frac{n(n-1)(2n+5)}{18}, \\qquad z = \\frac{S}{\\sqrt{\\operatorname{Var}(S)}}, \\qquad p = 2\\big(1 - \\Phi(|z|)\\big)`,
        note: "THE GATE IS A SIGNIFICANCE TEST, NOT A HYPERPARAMETER. NOTHING WAS TUNED TO MAKE IT BEHAVE.",
      },
    ],
    inputs: [
      { sym: "\\hat\\beta_{30}", label: "gated slope /30d", value: f ? sgn(f.slope30, 2) : "—", missing: !f },
      { sym: "\\hat\\mu", label: "member estimate", value: fmt(m.mean, 2) },
      { sym: "\\mathrm{MSE}", label: "walk-forward error", value: m.validation ? fmt(m.validation.mse, 1) : "—", missing: !m.validation },
      { sym: "w", label: "blend weight", value: `${(100 * m.weight).toFixed(0)}%` },
    ],
    result: { tex: "\\hat\\mu_{\\text{trend}}", value: fmt(m.mean, 1) },
    gates: [
      { text: "n ≥ 4", pass: t.n >= 4 },
      { text: "τ-gate open (p ≤ 0.5) — otherwise the member is flat", pass: gated === true },
    ],
    refs: ["theil1950", "sen1968", "kendall1938"],
    related: ["fv.ensemble", "premium.mom"],
    source: "src/lib/quant/robust.ts · theilSen · shrunkSlope",
  };
}

/* ── The predictive distribution ───────────────────────────────────── */

export function fvInterval(ctx: DeriveCtx): Derivation | null {
  const q = ctx.stat?.quant;
  const t = traceOf(ctx);
  if (!q || !t) return null;
  const pool = t.pool;
  return {
    id: "fv.interval",
    title: "PREDICTIVE DISTRIBUTION · NIG → STUDENT-t",
    symbol: "t_{\\nu}",
    claim: "MEAN AND VARIANCE ARE BOTH UNKNOWN, SO THE TAILS MUST STAY FAT WHILE THE TAPE IS THIN. CERTAINTY IS EARNED PRINT BY PRINT.",
    steps: [
      {
        tex: `(\\mu_0,\\kappa_0,\\alpha_0,\\beta_0) = \\big(\\bar\\mu_{\\text{book}},\\, 1,\\, 1.5,\\, \\sigma^2_{\\text{book}}\\big)`,
        subst: pool
          ? `= \\big(${v(pool.grandMean, 1)},\\, 1,\\, 1.5,\\, ${v(pool.sigma2, 1)}\\big)`
          : `= \\big(70,\\, 1,\\, 1.5,\\, ${PRIOR_VAR}\\big) \\quad\\text{(empty book)}`,
        note: "A CONJUGATE NORMAL-INVERSE-GAMMA PRIOR: THE ONLY FAMILY THAT STAYS CLOSED UNDER UPDATING WHEN BOTH MOMENTS ARE UNKNOWN.",
      },
      {
        tex: `\\kappa_n = \\kappa_0 + n, \\quad \\mu_n = \\frac{\\kappa_0\\mu_0 + n\\bar y}{\\kappa_n}, \\quad \\alpha_n = \\alpha_0 + \\tfrac{n}{2}, \\quad \\beta_n = \\beta_0 + \\tfrac{S}{2} + \\frac{\\kappa_0 n(\\bar y - \\mu_0)^2}{2\\kappa_n}`,
      },
      {
        tex: `y_{n+1} \\;\\sim\\; t_{\\nu}\\!\\big(\\hat\\mu,\\; \\hat\\sigma\\big), \\qquad \\nu = 2\\alpha_n = 3 + n`,
        subst: `\\hat\\mu = ${v(t.mean, 1)},\\; \\hat\\sigma = ${v(t.sd, 2)},\\; \\nu = 3 + ${v(t.n, 0)} = ${v(t.df, 0)} \\;\\Longrightarrow\\; \\text{90\\% CI } [${v(q.ci90.lo, 1)},\\; ${v(q.ci90.hi, 1)}]`,
        note: "THE CONJUGATE UPDATE SUPPLIES THE DEGREES OF FREEDOM AND THE FAT-TAILED STUDENT-t FORM; THE INTERVAL IS THEN CENTRED ON THE ENSEMBLE'S BLENDED μ̂ (FAIR VALUE) AND ITS SCALE σ̂, NOT THE NIG POSTERIOR'S OWN μ_n. THE df ARE THE HONESTY MECHANISM: AT n = 2 THE TAILS ARE HEAVY AND THE 90% INTERVAL IS WIDE.",
      },
      {
        tex: `F_\\nu(x) = 1 - \\tfrac{1}{2}I_{\\frac{\\nu}{\\nu+x^2}}\\!\\left(\\tfrac{\\nu}{2}, \\tfrac{1}{2}\\right), \\qquad q_p = F^{-1}_\\nu(p) \\;\\text{by bisection}`,
        note: "QUANTILES ARE EXACT — THE REGULARIZED INCOMPLETE BETA VIA A CONTINUED FRACTION, INVERTED BY BISECTION — BECAUSE SERIES APPROXIMATIONS FAIL PRECISELY AT THE SMALL df WHERE THIS ENGINE OPERATES.",
      },
    ],
    inputs: [
      { sym: "\\nu", label: "degrees of freedom", value: String(q.df) },
      { sym: "\\hat\\mu", label: "ensemble centre (fair value)", value: fmt(q.fv, 1) },
      { sym: "\\hat\\sigma", label: "scale", value: fmt(q.sd, 2) },
      { sym: "\\text{CI}_{50}", label: "50% credible", value: `${q.ci50.lo.toFixed(1)}–${q.ci50.hi.toFixed(1)}` },
      { sym: "\\text{CI}_{90}", label: "90% credible", value: `${q.ci90.lo.toFixed(1)}–${q.ci90.hi.toFixed(1)}` },
      { sym: "\\bar\\mu_0", label: "prior mean", value: num(pool?.grandMean), missing: !pool },
    ],
    result: { tex: "\\text{CI}_{90}", value: `${q.ci90.lo.toFixed(1)}–${q.ci90.hi.toFixed(1)}` },
    refs: ["raiffa1961", "student1908", "lentz1976", "abramowitz1964"],
    related: ["fv.p10", "fv.value"],
    source: "src/lib/quant/bayes.ts · nigPredictive · tQuantile",
  };
}

export function fvP10(ctx: DeriveCtx): Derivation | null {
  const q = ctx.stat?.quant;
  const t = traceOf(ctx);
  if (!q || !t) return null;
  return {
    id: "fv.p10",
    title: "DOWNSIDE · TENTH PERCENTILE",
    symbol: "p_{10}",
    claim: "THE OUTCOME A BAD DRAW LOOKS LIKE. MEASURED FROM FAIR VALUE, NOT THE MARK.",
    steps: [
      {
        tex: `p_{10} \\;=\\; \\operatorname{clip}_{[0,100]}\\!\\big(\\hat\\mu + t^{-1}_{\\nu}(0.10)\\cdot\\hat\\sigma\\big)`,
        subst: `p_{10} \\;=\\; ${v(t.mean, 1)} + t^{-1}_{${v(t.df, 0)}}(0.10)\\cdot ${v(t.sd, 2)} \\;=\\; ${v(q.p10, 1)}`,
        note: "THE TAIL IS DRAWN AROUND FAIR VALUE. MEASURING IT FROM THE MARK WOULD NET THE DISCOUNT AGAINST THE VERY TAIL IT ALREADY CHARGED FOR.",
      },
    ],
    inputs: [
      { sym: "\\hat\\mu", label: "fair value", value: fmt(q.fv, 1) },
      { sym: "\\hat\\sigma", label: "scale", value: fmt(q.sd, 2) },
      { sym: "\\nu", label: "df", value: String(q.df) },
      { sym: "\\mathrm{FV}-p_{10}", label: "tail width", value: fmt(q.fv - q.p10, 1) },
    ],
    result: { tex: "p_{10}", value: fmt(q.p10, 1) },
    refs: ["student1908"],
    related: ["fv.interval", "advisor.priority"],
    source: "src/lib/quant/price.ts · priceSubject",
  };
}

export function fvDetrend(ctx: DeriveCtx): Derivation | null {
  const t = traceOf(ctx);
  if (!t) return null;
  const d = t.detrend;
  return {
    id: "fv.detrend",
    title: "DIFFICULTY DETRENDING",
    symbol: "\\tilde y_i",
    claim: "A 60 ON A PAPER THE CLASS AVERAGED 50 IS NOT THE SAME EVENT AS A 60 WHEN THE CLASS AVERAGED 75.",
    steps: [
      {
        tex: `\\tilde y_i \\;=\\; y_i - \\lambda\\,(\\rho_i - \\bar\\rho), \\qquad \\lambda = \\frac{m}{m+2}`,
        subst:
          d.refCount > 0
            ? `\\lambda \\;=\\; \\frac{${v(d.refCount, 0)}}{${v(d.refCount, 0)}+2} \\;=\\; ${v(d.lambda, 3)}, \\qquad \\bar\\rho = ${v(d.meanRef ?? 0, 1)}`
            : undefined,
        note: "λ < 1 KEEPS A SINGLE REFERENCE POINT FROM OVER-CORRECTING. PRINTS WITHOUT A REFERENCE PASS THROUGH UNTOUCHED, AND EVERYTHING DOWNSTREAM RUNS ON ỹ.",
      },
      {
        tex: `\\rho_i \\;=\\; a_i \\;\\text{(class average)} \\;\\;\\text{else}\\;\\; g_i \\;\\text{(year level)}`,
        note: "WHERE A REFERENCE MOVES BECAUSE THE COHORT ITSELF CHANGED, THE CORRECTION IS PARTLY MISATTRIBUTED. THAT IS A STATED LIMITATION, NOT AN OVERSIGHT.",
      },
    ],
    inputs: [
      { sym: "m", label: "referenced prints", value: String(d.refCount) },
      { sym: "\\lambda", label: "correction strength", value: fmt(d.lambda, 3) },
      { sym: "\\bar\\rho", label: "usual reference level", value: num(d.meanRef), missing: d.meanRef == null },
      { sym: "n", label: "prints total", value: String(t.n) },
    ],
    result: { tex: "\\lambda", value: fmt(d.lambda, 3) },
    gates: [{ text: "at least one print carries a class or year-level average", pass: d.refCount > 0 }],
    related: ["fv.shrunk"],
    source: "src/lib/quant/calibration.ts · detrend",
  };
}

/* ── The oracle ────────────────────────────────────────────────────── */

export function oracleCarry(ctx: DeriveCtx): Derivation | null {
  const t = traceOf(ctx);
  const q = ctx.stat?.quant;
  if (!t) return null;
  const o = t.offset;
  return {
    id: "oracle.carry",
    title: "EXAM CALIBRATION · THE BRIDGE AND THE CARRY",
    symbol: "\\hat\\delta",
    claim: "COURSEWORK PREDICTS EXAMS; EXAMS PAY DIFFERENTLY. δ̂ IS THE BRIDGE — AND IT IS NEVER A GRADE WEIGHT.",
    steps: [
      {
        tex: `\\hat\\delta \\;=\\; \\frac{n_E}{n_E + \\kappa}\\left(\\bar y^{\\,w}_{\\text{exam}} - \\bar y^{\\,w}_{\\text{coursework}}\\right), \\qquad \\kappa = ${EXAM_OFFSET_SHRINK}`,
        subst:
          o.raw != null
            ? `\\hat\\delta \\;=\\; \\frac{${v(o.nExams, 0)}}{${v(o.nExams, 0)}+${EXAM_OFFSET_SHRINK}}\\cdot ${v(o.raw, 2)} \\;=\\; ${v(o.delta, 2)}`
            : `\\hat\\delta = 0 \\quad\\text{(one side of the tape is empty)}`,
        note: "ONE EXAM MOVES THE OFFSET A QUARTER OF THE WAY; A TRACK RECORD MOVES IT ALMOST FULLY. THE MEANS ARE WINSORIZED SO A SINGLE DISASTER IN EITHER COLUMN CANNOT SET THE BRIDGE.",
      },
      {
        tex: `\\widehat{\\text{cw}\\to\\text{exam}} \\;=\\; \\hat\\mu_{CW} + \\hat\\delta`,
        note: "δ̂ IS A BRIDGE, SO IT IS CROSSED ONCE, FROM THE COURSEWORK SIDE. THIS CONVERTS \"YOUR ASSIGNMENTS SAY 84 BUT EXAMS PRINT 78\" INTO A CALIBRATED FORECAST — WHAT MAKES COURSEWORK A LEADING INDICATOR WITHOUT EVER BEING A GRADE. ADDING IT TO A CAPABILITY ESTIMATE THAT ALREADY HOLDS THE EXAMS WOULD CROSS IT ONE AND A HALF TIMES.",
      },
      {
        tex: `c \\;=\\; \\widehat{\\text{exam}}_{n+1} - \\mathrm{FV}`,
        subst: q ? `c \\;=\\; ${v(q.nextExam.mean, 1)} - ${v(q.fv, 1)} \\;=\\; ${sgn(q.carry, 1)}\\;\\text{pts}` : undefined,
        note: "THE CARRY THE ANALYST DESK EARNS IS NOT δ̂ — IT IS WHAT THE ORACLE EXPECTS THE NEXT PAPER TO PRINT OVER FAIR VALUE. THE MEMBERS HAVE ALREADY PRICED PART OF δ̂; CHARGING IT AGAIN WOULD PAY THE DESK TWICE FOR THE SAME GAP.",
      },
    ],
    inputs: [
      { sym: "\\hat\\delta", label: "the bridge", value: sgn(o.delta, 2) },
      { sym: "c", label: "carry over fv", value: q ? sgn(q.carry, 2) : "—", missing: !q },
      { sym: "\\delta_{\\text{raw}}", label: "raw gap", value: o.raw == null ? "—" : sgn(o.raw, 2), missing: o.raw == null },
      { sym: "n_E", label: "exams", value: String(o.nExams) },
      { sym: "n_{CW}", label: "coursework prints", value: String(o.nCoursework) },
      { sym: "\\kappa", label: "pseudo-observations", value: String(EXAM_OFFSET_SHRINK) },
    ],
    result: { tex: "\\hat\\delta", value: sgn(o.delta, 1), unit: "PTS" },
    gates: [{ text: "both exams and coursework on the tape", pass: o.raw != null }],
    refs: ["buhlmann1967", "huber1964"],
    related: ["oracle.next", "premium.cw"],
    source: "src/lib/quant/calibration.ts · examOffset",
  };
}

export function oracleNext(ctx: DeriveCtx): Derivation | null {
  const q = ctx.stat?.quant;
  const t = traceOf(ctx);
  if (!q || !t) return null;
  const o = t.oracle;
  /* The pool only has a step to show when it actually moved this desk's call:
     a weight was earned AND a call was staked on the paper in question. */
  const fit = ctx.selfPool;
  const staked = ctx.stat ? ctx.selfStakes?.[ctx.stat.sub.id] : undefined;
  const pool =
    fit && fit.w > 0 && staked && o
      ? {
          w: fit.w,
          n: fit.n,
          deskMean: o.mean,
          you: selfPredictive(staked, fit.selfSd ?? q.nextExam.sd).mean,
        }
      : null;
  return {
    id: "oracle.next",
    title: "THE ORACLE · NEXT EXAM",
    symbol: "\\widehat{\\text{exam}}",
    claim: "TWO READINGS OF WHERE THE NEXT PAPER PRINTS, BLENDED BY PRECISION. A GUIDE WITH HONEST INTERVALS, NOT A PROMISE.",
    steps: [
      {
        tex: `\\hat\\mu_E = \\text{ensemble}(\\text{exams}), \\qquad \\hat\\mu_{C}^{\\to E} = \\text{ensemble}(\\text{coursework}) + \\hat\\delta`,
        subst:
          o
            ? `\\hat\\mu_E = ${o.examSide == null ? "\\varnothing" : v(o.examSide, 1)}, \\qquad \\hat\\mu_{C}^{\\to E} = ${o.cwSide == null ? "\\varnothing" : v(o.cwSide, 1)}`
            : undefined,
        note: "BOTH SIDES ESTIMATE THE SAME QUANTITY — WHERE THE NEXT EXAM LANDS — AND BOTH RUN THROUGH THE FULL ENGINE, SO BOTH INHERIT SHRINKAGE, THE τ GATE AND SMALL-n DEGRADATION. δ̂ IS APPLIED TO THE COURSEWORK SIDE ONLY: A BRIDGE IS CROSSED ONCE.",
      },
      {
        tex: `w_E = \\frac{\\sigma_E^{-2}}{\\sigma_E^{-2} + \\sigma_C^{-2}}, \\qquad \\widehat{\\text{exam}}_{n+1} = \\operatorname{clip}_{[0,100]}\\!\\big(w_E\\,\\hat\\mu_E + (1 - w_E)\\,\\hat\\mu_{C}^{\\to E}\\big)`,
        // The DESK's own blend, from the oracle trace — on a board where the
        // credibility pool has moved the call, `q.nextExam.mean` is no longer
        // this arithmetic's answer, and printing it here would show a sum that
        // does not add up. The pool gets its own step below.
        subst: o ? `w_E = ${v(o.examWeight, 2)} \\;\\Longrightarrow\\; ${v(o.mean, 1)}` : undefined,
        note: "THE TIGHTER SIDE SPEAKS LOUDER, AND THE BLEND IS MOMENT-MATCHED AS A MIXTURE — SO WHEN THE TWO SIDES DISAGREE THE BAND WIDENS RATHER THAN QUIETLY AVERAGING. BUILT ON FAIR-VALUE MACHINERY, NEVER THE MARK: A FORECAST MUST BE UNBIASED.",
      },
      ...(pool
        ? [{
            tex: `\\widehat{\\text{exam}} = (1-w)\\,\\hat\\mu_{\\text{desk}} + w\\,\\mu_{\\text{you}}, \\qquad \\sigma^2 = (1-w)\\sigma_{\\text{desk}}^2 + w\\sigma_{\\text{you}}^2 + w(1-w)(\\mu_{\\text{you}} - \\hat\\mu_{\\text{desk}})^2`,
            subst: `= (1-${v(pool.w, 2)})\\cdot ${v(pool.deskMean, 1)} + ${v(pool.w, 2)}\\cdot ${v(pool.you, 1)} \\;=\\; ${v(q.nextExam.mean, 1)}`,
            note: `THE CREDIBILITY POOL: OVER ${pool.n} SCORED SITTING${pool.n === 1 ? "" : "S"} YOUR OWN CALLS EARNED ${Math.round(pool.w * 100)}% OF THIS FORECAST. THE LAST VARIANCE TERM IS THE POINT — DISAGREE WITH THE DESK AND THE BAND WIDENS, SO A CONTESTED CALL IS NEVER A CONFIDENT ONE.`,
          }]
        : []),
      {
        tex: `\\text{CI}_{\\gamma} \\;=\\; \\widehat{\\text{exam}} \\pm t^{-1}_{\\nu}\\!\\left(\\tfrac{1+\\gamma}{2}\\right)\\hat\\sigma`,
        subst: `\\text{CI}_{50} = [${v(q.nextExam.ci50.lo, 1)},\\,${v(q.nextExam.ci50.hi, 1)}], \\quad \\text{CI}_{90} = [${v(q.nextExam.ci90.lo, 1)},\\,${v(q.nextExam.ci90.hi, 1)}]`,
        note: "ν IS THE THINNER SIDE'S: A FORECAST LEANING ON TWO EXAMS IS NOT MADE CONFIDENT BY A LONG COURSEWORK TAPE IT ONLY HALF TRUSTS.",
      },
    ],
    inputs: [
      { sym: "\\hat\\mu_E", label: "exam side", value: o?.examSide == null ? "—" : fmt(o.examSide, 1), missing: o?.examSide == null },
      { sym: "\\hat\\mu_C^{\\to E}", label: "coursework side", value: o?.cwSide == null ? "—" : fmt(o.cwSide, 1), missing: o?.cwSide == null },
      { sym: "\\hat\\delta", label: "the bridge", value: sgn(t.offset.delta, 1) },
      { sym: "w_E", label: "exam weight", value: o ? fmt(o.examWeight, 2) : "—", missing: !o },
      { sym: "\\hat\\sigma", label: "scale", value: fmt(q.nextExam.sd, 1) },
      { sym: "\\nu", label: "df", value: String(o ? o.df : q.df) },
    ],
    result: { tex: "\\widehat{\\text{exam}}", value: fmt(q.nextExam.mean, 1), unit: "%" },
    gates: [{ text: "at least one exam or coursework print to forecast from", pass: o != null }],
    refs: ["student1908", "raiffa1961"],
    related: ["oracle.carry", "fv.interval", "fv.ensemble"],
    source: "src/lib/quant/oracle.ts · examOracle",
  };
}
