/**
 * Derivations for D5's scoreboard — where the engine is graded, and where you
 * are (§26, §15b).
 *
 * Every number on the first two cards is a PROPER SCORE or a function of one,
 * and the distinction matters enough to be worth stating in each note rather
 * than once in a footnote: mean absolute error can be gamed by an overconfident
 * forecaster and CRPS cannot, so the engine is tuned against CRPS and reports
 * MAE only where the interface needs a figure in score points. Anything scored
 * here is scored WALK-FORWARD — refit on strictly-earlier prints, then asked
 * about a print it has never seen — which is the only protocol under which a
 * self-graded model means anything at all.
 *
 * The scores are read off the traces the card already computed (`facts.ts`);
 * nothing here recomputes a backtest.
 */

import { fmt, sgn, v, type Derivation, type DeriveCtx } from "./types";

/** The naive spread floor the backtest gives its last-value benchmark. */
const NAIVE_SD_FLOOR = 3;
/** Prints the walk-forward needs before it will score anything. */
const WARMUP = 2;

const pct0 = (x: number): string => `${Math.round(x * 100)}%`;

/* ── The desk graded against itself ─────────────────────────────────── */

export function skillCrps(ctx: DeriveCtx): Derivation | null {
  const b = ctx.card?.book;
  if (!b) return null;
  const ratio = b.crpsNaive > 0 ? b.crps / b.crpsNaive : 0;
  return {
    id: "skill.crps",
    title: "PER-SUBJECT SKILL · CRPSS",
    symbol: "\\mathrm{CRPSS}",
    claim:
      "HOW MUCH OF THE FORECAST ERROR THE ENGINE REMOVES OVER \"ASSUME IT PRINTS WHAT IT PRINTED LAST TIME\". ZERO MEANS NO EDGE.",
    steps: [
      {
        tex: `\\mathrm{CRPS}(F, y) \\;=\\; \\int_{-\\infty}^{\\infty}\\big(F(x) - \\mathbf{1}\\{x \\ge y\\}\\big)^2\\,dx`,
        note: "THE CONTINUOUS RANKED PROBABILITY SCORE: THE SQUARED AREA BETWEEN THE PREDICTIVE CDF AND THE STEP THE OUTCOME ACTUALLY WAS. IT IS STRICTLY PROPER — THE FORECASTER MINIMISES IT ONLY BY REPORTING WHAT IT ACTUALLY BELIEVES — AND IT REDUCES TO ABSOLUTE ERROR FOR A POINT FORECAST, SO THE TWO ARE ON THE SAME SCALE.",
      },
      {
        tex: `\\mathrm{CRPS}_{t_\\nu}(\\omega) \\;=\\; \\omega\\,(2F_\\nu(\\omega) - 1) \\;+\\; \\frac{2 f_\\nu(\\omega)(\\nu + \\omega^2)}{\\nu - 1} \\;-\\; \\frac{2\\sqrt{\\nu}}{\\nu-1}\\cdot\\frac{B(\\tfrac12, \\nu - \\tfrac12)}{B(\\tfrac12, \\tfrac{\\nu}{2})^2}`,
        note: "CLOSED FORM FOR THE LOCATION-SCALE STUDENT-t THIS ENGINE FORECASTS WITH, ω = (y − μ̂)/σ̂. NO SAMPLING ANYWHERE, SO THE WHOLE SCOREBOARD IS DETERMINISTIC AND REPRODUCIBLE.",
      },
      {
        tex: `\\mathrm{CRPSS} \\;=\\; 1 - \\frac{\\overline{\\mathrm{CRPS}}_{\\text{model}}}{\\overline{\\mathrm{CRPS}}_{\\text{naive}}}, \\qquad \\text{naive} = \\mathcal{N}\\!\\big(y_{n},\\; \\max(s_n, ${NAIVE_SD_FLOOR})\\big)`,
        subst: `\\mathrm{CRPSS} \\;=\\; 1 - \\frac{${v(b.crps, 3)}}{${v(b.crpsNaive, 3)}} \\;=\\; 1 - ${v(ratio, 3)} \\;=\\; ${v(b.skill, 3)}`,
        note: "THE BENCHMARK IS PROBABILISTIC, NOT A BARE LAST VALUE: A NAIVE POINT FORECAST WOULD SCORE INFINITELY BADLY UNDER A PROPER RULE AND THE SKILL SCORE WOULD FLATTER THE ENGINE. THE SPREAD FLOOR STOPS A FLAT TAPE HANDING THE BENCHMARK A FREE WIN.",
      },
      {
        tex: `\\text{for } i = ${WARMUP} \\ldots n:\\quad \\hat F_i \\;=\\; \\text{fit}\\big(\\{y_j\\}_{j<i},\\; \\text{pool}_{<t_i}\\big), \\qquad \\text{score } \\hat F_i \\text{ at } y_i`,
        subst: `n_{\\text{scored}} \\;=\\; ${v(b.n, 0)}\\;\\text{prints over}\\;${v(b.subjects.length, 0)}\\;\\text{desks}`,
        note: "PREQUENTIAL / ROLLING-ORIGIN: THE CROSS-SUBJECT SHRINKAGE POOL IS ALSO REBUILT AS-OF EACH TARGET DATE, SO NOTHING — NOT EVEN ANOTHER SUBJECT'S LATER PRINT — LEAKS BACKWARDS INTO A FORECAST.",
      },
    ],
    inputs: [
      { sym: "\\overline{\\mathrm{CRPS}}", label: "model score", value: fmt(b.crps, 3) },
      { sym: "\\overline{\\mathrm{CRPS}}_0", label: "naive score", value: fmt(b.crpsNaive, 3) },
      { sym: "\\mathrm{MAE}", label: "mean abs error", value: fmt(b.mae, 2) },
      { sym: "\\mathrm{RMSE}", label: "root mean sq error", value: fmt(b.rmse, 2) },
      { sym: "n", label: "scored prints", value: String(b.n) },
    ],
    result: { tex: "\\mathrm{CRPSS}", value: `${(b.skill * 100).toFixed(0)}%` },
    gates: [
      { text: `≥ ${WARMUP} earlier prints before a desk is scored at all`, pass: b.n > 0 },
      { text: "a positive score means the engine beat last-value", pass: b.skill > 0 },
    ],
    refs: ["gneiting2007", "jordan2019", "tashman2000"],
    related: ["skill.mae", "skill.bias", "skill.coverage", "fv.ensemble"],
    source: "src/lib/quant/eval/backtest.ts · backtestBook",
  };
}

export function skillMae(ctx: DeriveCtx): Derivation | null {
  const m = ctx.card?.mean;
  if (!m) return null;
  const ratio = m.naiveMae > 0 ? m.mae / m.naiveMae : null;
  const R = m.points.length;
  return {
    id: "skill.mae",
    title: "AGGREGATE FORECAST ERROR",
    symbol: "\\mathrm{MAE}",
    claim:
      "THE PROJECT'S CENTRAL EMPIRICAL CLAIM, MEASURED: THE BOOK'S MEAN IS FORECASTABLE EVEN WHERE A SINGLE DESK'S NEXT MARK IS NOT.",
    steps: [
      {
        tex: `\\bar{y}_r \\;=\\; \\frac{1}{|S_r|}\\sum_{s \\in S_r} y_{s,r}, \\qquad \\hat{\\bar y}_r \\;=\\; \\frac{1}{|S_r|}\\sum_{s \\in S_r} \\hat\\mu_{s,r}`,
        note: "ONE POINT PER EXAM ROUND, NOT PER PRINT. EACH DESK IS FORECAST FROM ITS OWN STRICTLY-EARLIER PRINTS AND THE FORECASTS ARE THEN AVERAGED — AVERAGING FIRST AND FORECASTING THE AVERAGE WOULD BE A DIFFERENT, EASIER PROBLEM.",
      },
      {
        tex: `\\mathrm{MAE} \\;=\\; \\frac{1}{R}\\sum_{r=1}^{R} \\big|\\hat{\\bar y}_r - \\bar y_r\\big|`,
        subst: `\\mathrm{MAE} \\;=\\; ${v(m.mae, 2)}\\;\\text{pts over}\\;${v(R, 0)}\\;\\text{rounds}`,
        note: "ABSOLUTE, NOT SQUARED: WITH A HANDFUL OF ROUNDS A SINGLE BAD TERM WOULD DOMINATE AN RMSE AND THE HEADLINE WOULD BE ABOUT THAT TERM RATHER THAN ABOUT THE ENGINE.",
      },
      {
        tex: `\\mathrm{MAE}_{\\text{naive}} \\;=\\; \\frac{1}{R}\\sum_{r} \\big|\\bar y_{r-1} - \\bar y_r\\big|, \\qquad \\text{ratio} \\;=\\; \\frac{\\mathrm{MAE}}{\\mathrm{MAE}_{\\text{naive}}}`,
        subst:
          ratio == null
            ? undefined
            : `\\text{ratio} \\;=\\; \\frac{${v(m.mae, 2)}}{${v(m.naiveMae, 2)}} \\;=\\; ${v(ratio, 2)}`,
        note: "THE LOCAL-LEVEL NAIVE — LAST ROUND'S REALIZED MEAN — IS THE HONEST BAR. A SCALED RATIO BELOW 1 IS AN EDGE; ABOVE 1 THE ENGINE IS DOING WORSE THAN REMEMBERING.",
      },
    ],
    inputs: [
      { sym: "R", label: "scored rounds", value: String(R) },
      { sym: "\\mathrm{MAE}_0", label: "naive error", value: fmt(m.naiveMae, 2) },
      { sym: "\\text{ratio}", label: "vs naive", value: ratio == null ? "—" : fmt(ratio, 2), missing: ratio == null },
    ],
    result: { tex: "\\mathrm{MAE}", value: m.mae.toFixed(1), unit: "PTS" },
    gates: [
      { text: "≥ 1 round with a prior round to serve as the naive", pass: R > 0 },
      { text: "beats the local-level naive", pass: m.mae < m.naiveMae },
    ],
    refs: ["hyndman2006", "dawid1984"],
    related: ["skill.crps", "book.forecast", "earn.aggregate"],
    source: "src/lib/quant/eval/skill.ts · meanSkill",
  };
}

export function skillBias(ctx: DeriveCtx): Derivation | null {
  const b = ctx.card?.book;
  if (!b) return null;
  const se = b.n > 0 ? b.rmse / Math.sqrt(b.n) : null;
  return {
    id: "skill.bias",
    title: "OPTIMISM BIAS",
    symbol: "\\beta",
    claim: "THE PART OF THE ERROR THAT DOES NOT AVERAGE OUT — A SIGN THAT PERSISTS IS A MODEL FAULT, NOT BAD LUCK.",
    steps: [
      {
        tex: `\\beta \\;=\\; \\frac{1}{n}\\sum_{i=1}^{n} \\big(\\hat\\mu_i - y_i\\big)`,
        subst: `\\beta \\;=\\; ${v(sgn(b.bias, 2), 0)}\\;\\text{pts over}\\;${v(b.n, 0)}\\;\\text{scored prints}`,
        note: "SIGNED, NOT ABSOLUTE. POSITIVE MEANS THE ENGINE HAS BEEN PREDICTING ABOVE WHAT PRINTED — THE MISCALIBRATION THE MEAN-ERROR TERM OF MURPHY'S DECOMPOSITION ISOLATES, AND THE ONE A DAMPED TREND MEMBER EXISTS TO CURE.",
      },
      {
        tex: `\\mathrm{MSE} \\;=\\; \\underbrace{\\beta^2}_{\\text{bias}} \\;+\\; \\underbrace{\\mathrm{Var}(\\hat\\mu - y)}_{\\text{variance}}`,
        subst: `\\mathrm{RMSE} = ${v(b.rmse, 2)}, \\qquad \\beta^2 / \\mathrm{MSE} = ${v(b.rmse > 0 ? (b.bias * b.bias) / (b.rmse * b.rmse) : 0, 3)}`,
        note: "THE SHARE OF SQUARED ERROR THE BIAS OWNS. A SMALL SHARE MEANS THE ENGINE IS NOISY BUT CENTRED, WHICH IS THE CONDITION UNDER WHICH AVERAGING ACROSS DESKS BUYS THE AGGREGATE ITS SKILL.",
      },
      {
        tex: `\\text{s.e.}(\\beta) \\;\\approx\\; \\frac{\\mathrm{RMSE}}{\\sqrt{n}}`,
        subst: se == null ? undefined : `\\text{s.e.} \\approx \\frac{${v(b.rmse, 2)}}{\\sqrt{${v(b.n, 0)}}} \\;=\\; ${v(se, 2)}`,
        note: "READ THE BIAS AGAINST THIS. ON A BOOK THIS SIZE A COUPLE OF POINTS OF APPARENT OPTIMISM IS ROUTINELY WITHIN ONE STANDARD ERROR OF ZERO, AND THE INTERFACE COLOURS IT AMBER RATHER THAN RED FOR EXACTLY THAT REASON.",
      },
    ],
    inputs: [
      { sym: "n", label: "scored prints", value: String(b.n) },
      { sym: "\\mathrm{RMSE}", label: "root mean sq error", value: fmt(b.rmse, 2) },
      { sym: "\\mathrm{MAE}", label: "mean abs error", value: fmt(b.mae, 2) },
      { sym: "\\text{s.e.}", label: "standard error", value: se == null ? "—" : fmt(se, 2), missing: se == null },
    ],
    result: { tex: "\\beta", value: sgn(b.bias, 1), unit: "PTS" },
    gates: [
      { text: "|β| < 1.5 pts — no material one-sided drift", pass: Math.abs(b.bias) < 1.5 },
      { text: "|β| within one standard error of zero", pass: se != null && Math.abs(b.bias) < se },
    ],
    refs: ["murphy1973"],
    related: ["skill.crps", "skill.coverage"],
    source: "src/lib/quant/eval/backtest.ts · summarize",
  };
}

export function skillCoverage(ctx: DeriveCtx): Derivation | null {
  const b = ctx.card?.book;
  if (!b) return null;
  // Wald standard error of a coverage proportion — the band the reading needs.
  const se = b.n > 0 ? Math.sqrt(Math.max(b.cover90 * (1 - b.cover90), 0) / b.n) : null;
  return {
    id: "skill.coverage",
    title: "90% COVERAGE · CALIBRATION",
    symbol: "\\widehat{c}_{90}",
    claim: "THE BANDS ARE A PROMISE. THIS IS THE AUDIT OF IT — HOW OFTEN THE MARK ACTUALLY LANDED INSIDE THE 90% INTERVAL.",
    steps: [
      {
        tex: `\\widehat{c}_{90} \\;=\\; \\frac{1}{n}\\sum_{i=1}^{n} \\mathbf{1}\\big\\{ q_{0.05}^{(i)} \\le y_i \\le q_{0.95}^{(i)} \\big\\}`,
        subst: `\\widehat{c}_{90} \\;=\\; ${v(b.cover90, 3)} \\quad\\text{over}\\quad n = ${v(b.n, 0)}`,
        note: "EACH INTERVAL IS THIS PRINT'S OWN, DRAWN FROM THE PREDICTIVE THAT WAS FITTED BEFORE IT. A NOMINAL 90% BAND SHOULD CONTAIN 90% OF OUTCOMES; MATERIALLY LESS IS OVERCONFIDENCE, MATERIALLY MORE IS A BAND SO WIDE IT SAYS NOTHING.",
      },
      {
        tex: `\\text{PIT}_i \\;=\\; \\hat F_i(y_i) \\;\\sim\\; \\mathcal{U}(0,1) \\quad\\text{iff the forecaster is calibrated}`,
        subst: `\\widehat{c}_{50} = ${v(b.cover50, 3)}, \\qquad \\widehat{c}_{90} = ${v(b.cover90, 3)}`,
        note: "COVERAGE AT TWO NOMINAL LEVELS IS A COARSE READ OF THE PROBABILITY INTEGRAL TRANSFORM. CALIBRATION IS NECESSARY BUT NOT SUFFICIENT — THE CLIMATOLOGICAL FORECAST 'ANYTHING FROM 0 TO 100' IS PERFECTLY CALIBRATED AND USELESS, WHICH IS WHY CRPS (WHICH PRICES SHARPNESS TOO) IS THE OBJECTIVE AND THIS IS THE CHECK.",
      },
      {
        tex: `\\text{s.e.}(\\widehat{c}) \\;=\\; \\sqrt{\\frac{\\widehat{c}\\,(1-\\widehat{c})}{n}}`,
        subst: se == null ? undefined : `\\text{s.e.} \\;=\\; ${v(se, 3)} \\;\\Longrightarrow\\; \\pm ${v(1.96 * se, 3)}\\;\\text{at 95\\%}`,
        note: "THE PRINTS ARE NOT INDEPENDENT — CONSECUTIVE FORECASTS SHARE MOST OF THEIR TRAINING TAPE — SO THIS BINOMIAL BAND IS OPTIMISTIC. TREAT IT AS A FLOOR ON THE UNCERTAINTY IN THE COVERAGE ITSELF.",
      },
    ],
    inputs: [
      { sym: "n", label: "scored prints", value: String(b.n) },
      { sym: "\\widehat{c}_{50}", label: "50% coverage", value: pct0(b.cover50) },
      { sym: "\\text{s.e.}", label: "standard error", value: se == null ? "—" : fmt(se, 3), missing: se == null },
    ],
    result: { tex: "\\widehat{c}_{90}", value: pct0(b.cover90) },
    gates: [
      { text: "≥ 85% — the band is not systematically too narrow", pass: b.cover90 >= 0.85 },
      { text: "nominal 90% inside one standard error", pass: se != null && Math.abs(b.cover90 - 0.9) <= se },
    ],
    refs: ["gneitingCalib2007", "lichtenstein1982"],
    related: ["skill.crps", "skill.bias", "fv.interval"],
    source: "src/lib/quant/eval/scoring.ts · scoreT",
  };
}

export function skillAblation(ctx: DeriveCtx): Derivation | null {
  const rows = ctx.card?.ablation;
  const row = rows?.find((r) => r.kind + "." + r.key === ctx.key || r.key === ctx.key);
  if (!row) return null;
  const isMember = row.kind === "member";
  const rule = isMember ? "\\mathrm{CRPS}" : "\\mathrm{PL}_{0.25}";
  return {
    id: "skill.ablation",
    title: `EARNS ITS PLACE? · ${row.key.toUpperCase()}`,
    symbol: "\\Delta",
    claim: "A PIECE OF THE MODEL MUST BEAT ITS OWN ABSENCE OUT-OF-SAMPLE, OR IT IS DECORATION THAT COSTS ACCURACY.",
    steps: [
      {
        tex: `\\Delta_k \\;=\\; L^{(-k)} - L^{(\\text{full})}`,
        subst: `\\Delta_{\\text{${row.key}}} \\;=\\; ${v(row.ablated, 3)} - ${v(row.baseline, 3)} \\;=\\; ${v(row.delta, 3)}`,
        note: "LEAVE-ONE-OUT, BUT OVER MODEL COMPONENTS RATHER THAN OBSERVATIONS: THE WHOLE WALK-FORWARD IS RERUN WITH THE PIECE REMOVED. POSITIVE Δ MEANS REMOVAL HURT, SO THE PIECE PAYS FOR ITSELF.",
      },
      isMember
        ? {
            tex: `L^{(-k)} \\;=\\; \\frac{1}{n}\\sum_i \\mathrm{CRPS}\\big(\\hat F_i^{(-k)},\\, y_i\\big)`,
            note: "AN ENSEMBLE MEMBER IS JUDGED ON THE ENSEMBLE'S OWN OBJECTIVE. THE REMAINING MEMBERS ARE REWEIGHTED, NOT FROZEN — THE QUESTION IS WHETHER THE BLEND IS BETTER WITH IT, NOT WHETHER ITS SHARE OF THE WEIGHT WAS WASTED.",
          }
        : {
            tex: `L^{(-k)} \\;=\\; \\frac{1}{n}\\sum_i \\rho_{0.25}\\big(y_i - \\mathrm{PX}_i^{(-k)}\\big), \\qquad \\rho_\\tau(u) = u\\,(\\tau - \\mathbf{1}\\{u < 0\\})`,
            note: "A PREMIUM IS JUDGED BY LOW-τ PINBALL, NOT BY MAE. THE MARK IS DELIBERATELY A CONSERVATIVE QUANTILE FORECAST — IT PRICES DOWNSIDE — AND MAE WOULD SCORE IT AGAINST THE MEDIAN, WHICH ALWAYS FAVOURS DROPPING EVERY CHARGE AND MARKING AT FAIR VALUE. τ = 0.25 IS THE FUNCTIONAL THE MARK ACTUALLY CLAIMS TO BE.",
          },
      {
        tex: `\\text{verdict} \\;=\\; \\begin{cases} \\textsf{keep} & \\Delta > \\varepsilon \\\\ \\textsf{prune} & \\Delta < -\\varepsilon \\\\ \\textsf{neutral} & \\text{otherwise}\\end{cases}, \\qquad \\varepsilon = 0.02`,
        subst: `|\\Delta| = ${v(Math.abs(row.delta), 3)} \\;\\Longrightarrow\\; \\textsf{${row.verdict}}`,
        note: "THE DEAD BAND IS NOT DECORATION: WITH A FEW DOZEN FOLDS A SWING THIS SMALL IS NOISE, AND CALLING IT A RESULT WOULD BE THE SAME OVERFITTING THE ABLATION EXISTS TO CATCH.",
      },
    ],
    inputs: [
      { sym: "L^{(\\text{full})}", label: "with the piece", value: fmt(row.baseline, 3) },
      { sym: "L^{(-k)}", label: "without it", value: fmt(row.ablated, 3) },
      { sym: rule, label: "scoring rule", value: isMember ? "CRPS" : "PINBALL τ=0.25" },
      { sym: "\\varepsilon", label: "dead band", value: "0.020" },
    ],
    result: { tex: "\\Delta", value: sgn(row.delta, 1) },
    gates: [{ text: "Δ > ε — removing it costs out-of-sample skill", pass: row.verdict === "keep" }],
    refs: ["stone1974", "gneiting2011"],
    related: ["skill.crps", "mark.price"],
    source: "src/lib/quant/eval/ablation.ts · ablateMembers · ablatePremia",
  };
}

/* ── You against the desk ───────────────────────────────────────────── */

export function elicitMae(ctx: DeriveCtx): Derivation | null {
  const e = ctx.card?.elicit?.self;
  if (!e || !e.n) return null;
  const edge = e.youMae != null && e.modelMae != null ? e.modelMae - e.youMae : null;
  return {
    id: "elicit.mae",
    title: "YOUR MARK ERROR · VS THE DESK",
    symbol: "\\mathrm{MAE}_{\\text{you}}",
    claim: "YOUR POINT CALLS AND THE DESK'S, JUDGED BY THE SAME RULE ON THE SAME SITTINGS. LOWER WINS.",
    steps: [
      {
        tex: `\\mathrm{MAE}_{\\text{you}} \\;=\\; \\frac{1}{n}\\sum_{i} \\big| p_i - y_i \\big|, \\qquad \\mathrm{MAE}_{\\text{desk}} \\;=\\; \\frac{1}{n}\\sum_{i} \\big| \\hat\\mu_i - y_i \\big|`,
        subst: `\\mathrm{MAE}_{\\text{you}} = ${v(e.youMae ?? 0, 2)}, \\qquad \\mathrm{MAE}_{\\text{desk}} = ${v(e.modelMae ?? 0, 2)} \\quad (n = ${v(e.n, 0)})`,
        note: "THE SAME OUTCOMES, PAIRED SITTING BY SITTING. COMPARING YOUR EASY PAPERS AGAINST THE DESK'S HARD ONES WOULD MAKE THE RATIO MEANINGLESS, SO THE PAIRING IS ENFORCED UPSTREAM RATHER THAN AVERAGED OVER.",
      },
      {
        tex: `\\text{edge} \\;=\\; \\mathrm{MAE}_{\\text{desk}} - \\mathrm{MAE}_{\\text{you}}`,
        subst: edge == null ? undefined : `\\text{edge} \\;=\\; ${v(sgn(edge, 2), 0)}\\;\\text{pts per sitting}`,
        note: "POSITIVE MEANS YOU HAVE BEEN THE BETTER FORECASTER ON THIS PILE. IT IS NOT YET A LICENCE — WHAT IT BUYS GOES THROUGH THE CREDIBILITY RULE, WHICH SHRINKS IT HARD FOR SMALL n.",
      },
      {
        tex: `\\arg\\min_{c} \\; \\mathbb{E}\\,\\big|c - Y\\big| \\;=\\; \\operatorname{median}(Y)`,
        note: "ABSOLUTE ERROR IS THE PROPER RULE FOR A MEDIAN, NOT A MEAN — SO THIS COLUMN ASKS FOR YOUR MOST LIKELY MARK, AND A CALL SHADED TOWARD A HOPED-FOR ONE IS PENALISED EXACTLY AS AN INACCURATE MEDIAN.",
      },
    ],
    inputs: [
      { sym: "n", label: "scored sittings", value: String(e.n) },
      { sym: "\\mathrm{MAE}_{\\text{desk}}", label: "the desk", value: e.modelMae == null ? "—" : fmt(e.modelMae, 2), missing: e.modelMae == null },
      { sym: "\\text{edge}", label: "your edge", value: edge == null ? "—" : sgn(edge, 2), missing: edge == null },
    ],
    result: { tex: "\\mathrm{MAE}_{\\text{you}}", value: e.youMae == null ? "—" : e.youMae.toFixed(1), unit: "PTS" },
    gates: [{ text: "you have beaten the desk on this pile", pass: edge != null && edge > 0 }],
    refs: ["hyndman2006", "savage1971"],
    related: ["elicit.crps", "earn.self", "oracle.next"],
    source: "src/lib/elicit.ts · elicitationScoreboard",
  };
}

export function elicitCrps(ctx: DeriveCtx): Derivation | null {
  const e = ctx.card?.elicit?.self;
  if (!e || e.youCrps == null) return null;
  const edge = e.modelCrps != null ? e.modelCrps - e.youCrps : null;
  return {
    id: "elicit.crps",
    title: "YOUR RANGE · CRPS VS THE DESK",
    symbol: "\\overline{\\mathrm{CRPS}}_{\\text{you}}",
    claim: "A STATED RANGE IS A DISTRIBUTION, SO IT IS SCORED AS ONE — SHARPNESS AND HONESTY PRICED TOGETHER.",
    steps: [
      {
        tex: `\\sigma_{\\text{you}} \\;=\\; \\max\\!\\left(\\frac{\\text{hi} - \\text{lo}}{2 z_{0.95}},\\; 0.5\\right), \\qquad z_{0.95} = 1.645`,
        note: "YOUR RANGE IS READ AS A ~90% INTERVAL AND TURNED INTO A PREDICTIVE. THE FLOOR STOPS AN IMPOSSIBLY TIGHT RANGE FROM SCORING AS INFINITE CONFIDENCE — WHICH WOULD BE PUNISHED SO SEVERELY THAT ONE MISS WOULD END THE CHANNEL.",
      },
      {
        tex: `\\overline{\\mathrm{CRPS}} \\;=\\; \\frac{1}{n}\\sum_i \\mathrm{CRPS}\\big(t_{\\nu}(p_i, \\sigma_i),\\, y_i\\big), \\qquad \\nu = 30`,
        subst: `\\overline{\\mathrm{CRPS}}_{\\text{you}} = ${v(e.youCrps, 3)}, \\qquad \\overline{\\mathrm{CRPS}}_{\\text{desk}} = ${v(e.modelCrps ?? 0, 3)}`,
        note: "A NEARLY-NORMAL ν: A STATED RANGE CARRIES A LOCATION AND A WIDTH BUT NO CLAIM ABOUT TAILS, SO IT IS NOT GIVEN THE ENGINE'S HEAVY ONES.",
      },
      {
        tex: `\\mathrm{CRPS} \\;=\\; \\underbrace{\\mathbb{E}|X - y|}_{\\text{accuracy}} \\;-\\; \\tfrac{1}{2}\\underbrace{\\mathbb{E}|X - X'|}_{\\text{sharpness}}`,
        subst: edge == null ? undefined : `\\text{edge} \\;=\\; ${v(sgn(edge, 3), 0)}`,
        note: "THE KERNEL FORM IS WHY THIS COLUMN CANNOT BE GAMED THE WAY THE MAE COLUMN CAN: WIDENING YOUR RANGE BUYS ACCURACY AND PAYS FOR IT IN SHARPNESS, SO THE OPTIMAL STRATEGY IS TO STATE THE UNCERTAINTY YOU ACTUALLY HAVE.",
      },
    ],
    inputs: [
      { sym: "n", label: "ranged calls", value: String(e.n) },
      { sym: "\\overline{\\mathrm{CRPS}}_{\\text{desk}}", label: "the desk", value: e.modelCrps == null ? "—" : fmt(e.modelCrps, 3), missing: e.modelCrps == null },
      { sym: "\\nu", label: "range df", value: "30" },
    ],
    result: { tex: "\\overline{\\mathrm{CRPS}}_{\\text{you}}", value: e.youCrps.toFixed(1) },
    gates: [{ text: "your range scored better than the desk's predictive", pass: edge != null && edge > 0 }],
    refs: ["matheson1976", "gneiting2007"],
    related: ["elicit.mae", "elicit.coverage", "earn.self"],
    source: "src/lib/elicit.ts · scoreSelfPred",
  };
}

export function elicitCoverage(ctx: DeriveCtx): Derivation | null {
  const e = ctx.card?.elicit?.self;
  if (!e || e.coverage == null) return null;
  return {
    id: "elicit.coverage",
    title: "YOUR 90% RANGES · CALIBRATION",
    symbol: "c_{\\text{you}}",
    claim: "HOW OFTEN YOUR OWN STATED RANGE ACTUALLY CONTAINED THE MARK. THE MOST DIAGNOSTIC NUMBER YOU CAN GENERATE ABOUT YOURSELF.",
    steps: [
      {
        tex: `c_{\\text{you}} \\;=\\; \\frac{1}{n}\\sum_i \\mathbf{1}\\{\\,\\text{lo}_i \\le y_i \\le \\text{hi}_i\\,\\}`,
        subst: `c_{\\text{you}} \\;=\\; ${v(e.coverage, 3)} \\quad\\text{against a nominal}\\; 0.90`,
        note: "STATED AS ~90% INTERVALS, SO 90% IS THE TARGET. THE ROBUST FINDING IN THE ELICITATION LITERATURE IS THAT PEOPLE'S 90% INTERVALS CONTAIN THE TRUTH NEARER 50% OF THE TIME — OVERCONFIDENCE IS THE DEFAULT, NOT THE EXCEPTION.",
      },
      {
        tex: `c \\ll 0.9 \\Rightarrow \\text{too narrow}, \\qquad c \\approx 1 \\text{ with wide } (\\text{hi}-\\text{lo}) \\Rightarrow \\text{uninformative}`,
        note: "BOTH FAILURES ARE REAL AND ONLY ONE IS COMFORTABLE. THE CRPS COLUMN IS WHAT DISTINGUISHES THEM: IT PRICES A RANGE THAT IS RIGHT BECAUSE IT IS WIDE EXACTLY AS BADLY AS ONE THAT IS WRONG BECAUSE IT IS TIGHT.",
      },
    ],
    inputs: [
      { sym: "n", label: "ranged calls", value: String(e.n) },
      { sym: "\\text{nominal}", label: "target coverage", value: "90%" },
      { sym: "c - 0.9", label: "miscalibration", value: sgn(e.coverage - 0.9, 2) },
    ],
    result: { tex: "c_{\\text{you}}", value: pct0(e.coverage) },
    gates: [{ text: "within 10 pts of the nominal 90%", pass: Math.abs(e.coverage - 0.9) <= 0.1 }],
    refs: ["gneitingCalib2007", "lichtenstein1982"],
    related: ["elicit.crps", "skill.coverage"],
    source: "src/lib/elicit.ts · scoreSelfPred",
  };
}

export function elicitBrier(ctx: DeriveCtx): Derivation | null {
  const c = ctx.card?.elicit?.chips;
  if (!c || !c.n || c.youBrier == null) return null;
  const edge = c.modelBrier != null ? c.modelBrier - c.youBrier : null;
  return {
    id: "elicit.brier",
    title: "CHIP STAKE · BRIER VS THE DESK",
    symbol: "\\mathrm{BS}_{\\text{you}}",
    claim: "TEN CHIPS ACROSS SIX BANDS IS A PROBABILITY DISTRIBUTION. IT IS SCORED LIKE ONE.",
    steps: [
      {
        tex: `p_j \\;=\\; \\frac{c_j}{\\sum_k c_k}, \\qquad \\mathrm{BS} \\;=\\; \\sum_{j=1}^{6} \\big(p_j - \\mathbf{1}\\{j = k^{*}\\}\\big)^2`,
        subst: `\\mathrm{BS}_{\\text{you}} = ${v(c.youBrier, 3)} \\quad\\text{over}\\quad n = ${v(c.n, 0)}`,
        note: "THE MULTI-CATEGORY QUADRATIC SCORE, 0 PERFECT AND 2 WORST. STRICTLY PROPER: THE STAKE THAT MINIMISES IT IS THE ONE MATCHING YOUR ACTUAL BELIEFS, SO SPREADING CHIPS TO HEDGE COSTS EXACTLY WHAT THE HEDGE IS WORTH.",
      },
      {
        tex: `p^{\\text{desk}}_j \\;=\\; \\frac{\\hat F(b_j) - \\hat F(a_j)}{\\hat F(100) - \\hat F(0)}`,
        subst: c.modelBrier == null ? undefined : `\\mathrm{BS}_{\\text{desk}} \\;=\\; ${v(c.modelBrier, 3)}`,
        note: "THE DESK'S PREDICTIVE IS DISCRETIZED OVER THE SAME SIX BANDS AND RENORMALIZED TO [0,100], SO BOTH FORECASTERS ARE ANSWERING LITERALLY THE SAME MULTIPLE-CHOICE QUESTION.",
      },
      {
        tex: `\\overline{\\mathrm{BS}} \\;=\\; \\underbrace{\\overline{(p - \\bar y)^2}}_{\\text{reliability}} \\;-\\; \\underbrace{\\overline{(\\bar y_k - \\bar y)^2}}_{\\text{resolution}} \\;+\\; \\underbrace{\\bar y (1 - \\bar y)}_{\\text{uncertainty}}`,
        subst: edge == null ? undefined : `\\text{edge} \\;=\\; ${v(sgn(edge, 3), 0)}`,
        note: "MURPHY'S PARTITION. A STAKE CAN LOSE ON RELIABILITY (BADLY CALIBRATED) OR ON RESOLUTION (NEVER COMMITS), AND THE HEADLINE ALONE CANNOT TELL YOU WHICH — WHICH IS WHY THE COVERAGE AND MAE LINES ARE SHOWN BESIDE IT RATHER THAN COLLAPSED INTO ONE SCORE.",
      },
    ],
    inputs: [
      { sym: "n", label: "scored stakes", value: String(c.n) },
      { sym: "\\mathrm{BS}_{\\text{desk}}", label: "the desk", value: c.modelBrier == null ? "—" : fmt(c.modelBrier, 3), missing: c.modelBrier == null },
      { sym: "|\\mathcal{B}|", label: "score bands", value: "6" },
    ],
    result: { tex: "\\mathrm{BS}_{\\text{you}}", value: c.youBrier.toFixed(1) },
    gates: [{ text: "your stake beat the desk's own band probabilities", pass: edge != null && edge > 0 }],
    refs: ["brier1950", "murphy1973"],
    related: ["elicit.mae", "elicit.coverage"],
    source: "src/lib/elicit.ts · scoreChips",
  };
}

export function elicitTeacher(ctx: DeriveCtx): Derivation | null {
  const t = ctx.card?.elicit?.teacher;
  if (!t || !t.n || t.youMae == null) return null;
  const edge = t.modelMae != null ? t.modelMae - t.youMae : null;
  return {
    id: "elicit.teacher",
    title: "TEACHER FORECAST · VS THE DESK",
    symbol: "\\mathrm{MAE}_{\\text{tchr}}",
    claim: "THE ONE FORECASTER IN THE BUILDING WHO HAS SEEN THE PAPER. SCORED LIKE EVERY OTHER.",
    steps: [
      {
        tex: `\\mathrm{MAE}_{\\text{tchr}} \\;=\\; \\frac{1}{n}\\sum_i \\big| g_i - y_i \\big|`,
        subst: `= ${v(t.youMae, 2)}\\;\\text{pts against the desk's}\\;${v(t.modelMae ?? 0, 2)} \\quad (n = ${v(t.n, 0)})`,
        note: "A PREDICTED GRADE IS AN EXPERT POINT FORECAST FROM A SOURCE WITH INFORMATION THE TAPE STRUCTURALLY CANNOT HOLD — WHAT THE COURSE IS ABOUT TO EXAMINE. IT IS ALSO SUBJECT TO ITS OWN INCENTIVES, WHICH IS WHY IT IS MEASURED RATHER THAN TRUSTED.",
      },
      {
        tex: `\\text{edge} \\;=\\; \\mathrm{MAE}_{\\text{desk}} - \\mathrm{MAE}_{\\text{tchr}}`,
        subst: edge == null ? undefined : `\\text{edge} \\;=\\; ${v(sgn(edge, 2), 0)}\\;\\text{pts}`,
        note: "REPORTED, NEVER PRICED. THE TEACHER'S CALL WEIGHS NOTHING IN ANY FORECAST ON THIS BOARD — IT HAS NO CHANNEL OF ITS OWN, BY DESIGN, BECAUSE THE STUDENT CANNOT AUDIT IT AND THE ENGINE WILL NOT PRICE WHAT IT CANNOT SCORE INDEPENDENTLY.",
      },
    ],
    inputs: [
      { sym: "n", label: "scored forecasts", value: String(t.n) },
      { sym: "\\mathrm{MAE}_{\\text{desk}}", label: "the desk", value: t.modelMae == null ? "—" : fmt(t.modelMae, 2), missing: t.modelMae == null },
    ],
    result: { tex: "\\mathrm{MAE}_{\\text{tchr}}", value: t.youMae.toFixed(1), unit: "PTS" },
    gates: [{ text: "the teacher has out-forecast the desk", pass: edge != null && edge > 0 }],
    refs: ["savage1971", "hyndman2006"],
    related: ["elicit.mae", "oracle.next"],
    source: "src/lib/elicit.ts · elicitationScoreboard",
  };
}

export function elicitAi(ctx: DeriveCtx): Derivation | null {
  const a = ctx.card?.elicit?.ai;
  if (!a || !a.n || a.youMae == null) return null;
  const edge = a.modelMae != null ? a.modelMae - a.youMae : null;
  return {
    id: "elicit.ai",
    title: "AI FORECAST · VS THE DESK",
    symbol: "\\mathrm{MAE}_{\\text{ai}}",
    claim: "AN OUTSIDE DESK THAT READ THE SAME BOOK. SCORED LIKE EVERY OTHER FORECASTER — AND PRICED ONLY AT WHAT THAT SCORE HAS EARNED.",
    steps: [
      {
        tex: `\\mathrm{MAE}_{\\text{ai}} \\;=\\; \\frac{1}{n}\\sum_i \\big| a_i - y_i \\big|`,
        subst: `= ${v(a.youMae, 2)}\\;\\text{pts against the desk's}\\;${v(a.modelMae ?? 0, 2)} \\quad (n = ${v(a.n, 0)})`,
        note: "THE WIRE'S CALLS ARRIVE THROUGH THE INTAKE PROMPT (§29) AND RESOLVE AGAINST THE SAME REALIZED MARKS AS EVERY OTHER FORECASTER'S. THE MODEL BEHIND THEM IS WHATEVER THE STUDENT PASTED THE PROMPT INTO — A STRONGER ONE TENDS TO EARN A BETTER LINE HERE.",
      },
      {
        tex: `\\text{edge} \\;=\\; \\mathrm{MAE}_{\\text{desk}} - \\mathrm{MAE}_{\\text{ai}}`,
        subst: edge == null ? undefined : `\\text{edge} \\;=\\; ${v(sgn(edge, 2), 0)}\\;\\text{pts}`,
        note: "UNLIKE THE TEACHER'S, THIS CHANNEL CAN BE PRICED — BUT ONLY THROUGH THE EARNED WEIGHT, WHICH STARTS AT ZERO, IS CAPPED ON ITS OWN AND CEILINGED JOINTLY WITH YOURS. AN OUTSIDE DESK NEVER GETS A SEAT IT DID NOT WIN ON RESOLVED SITTINGS.",
      },
    ],
    inputs: [
      { sym: "n", label: "scored forecasts", value: String(a.n) },
      { sym: "\\mathrm{MAE}_{\\text{desk}}", label: "the desk", value: a.modelMae == null ? "—" : fmt(a.modelMae, 2), missing: a.modelMae == null },
    ],
    result: { tex: "\\mathrm{MAE}_{\\text{ai}}", value: a.youMae.toFixed(1), unit: "PTS" },
    gates: [{ text: "the wire has out-forecast the desk", pass: edge != null && edge > 0 }],
    refs: ["savage1971", "hyndman2006"],
    related: ["elicit.mae", "elicit.teacher", "earn.ai", "oracle.next"],
    source: "src/lib/elicit.ts · elicitationScoreboard",
  };
}
