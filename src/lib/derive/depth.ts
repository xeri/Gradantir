/**
 * Derivations for Part III — market depth, the field behind the class.
 *
 * A placement describes the room you sat in. Where classes are streamed that
 * room is a biased slice of the year level, the same placement means different
 * things in a strong set and a weak one, and a student can hold their rank
 * while the room changes underneath them — a plain percentile reports no
 * change at all. This is the only part of the engine that needs facts about
 * the school it cannot observe, and it is scrupulous about saying so.
 */

import { DEPTH_BASIS_SHRINK, DEPTH_LADDER_STEP, DEPTH_MIN_GROUPS, DEPTH_MIN_PRINTS } from "../quant/params";
import { fmt, sgn, v, type Derivation, type DeriveCtx } from "./types";

export function depthClassZ(ctx: DeriveCtx): Derivation | null {
  const d = ctx.stat?.depth;
  if (!d) return null;
  const l = d.latest;
  return {
    id: "depth.classz",
    title: "PLACEMENT → STANDARD SCORE",
    symbol: "z_{\\text{cls}}",
    claim: "TURN \"24TH OF 36\" BACK INTO THE POSITION THAT PRODUCED IT.",
    steps: [
      {
        tex: `z_i \\;=\\; \\Phi^{-1}\\!\\left(1 - \\frac{r_i - 0.5}{N_i}\\right)`,
        subst: `z \\;=\\; \\Phi^{-1}\\!\\left(1 - \\frac{${v(l.rank, 0)} - 0.5}{${v(l.cohortN, 0)}}\\right) \\;=\\; ${v(l.classZ, 3)}`,
        note: "THE −0.5 IS HAZEN'S PLOTTING POSITION: RANK 1 OF 36 MAPS NEAR THE TOP OF THE DISTRIBUTION, NEVER TO CERTAINTY. WITHOUT IT THE TOP OF EVERY CLASS WOULD SIT AT z = ∞.",
      },
      {
        tex: `p_{\\text{cls}} \\;=\\; 100\\left(1 - \\frac{r - 0.5}{N}\\right)`,
        subst: `p_{\\text{cls}} \\;=\\; ${v(l.classPct, 1)}\\;\\text{— what the report literally says}`,
      },
    ],
    inputs: [
      { sym: "r", label: "placement", value: String(l.rank) },
      { sym: "N", label: "cohort size", value: String(l.cohortN) },
      { sym: "z_{\\text{cls}}", label: "standardised", value: sgn(l.classZ, 3) },
      { sym: "p_{\\text{cls}}", label: "class percentile", value: fmt(l.classPct, 0) },
    ],
    result: { tex: "z_{\\text{cls}}", value: sgn(l.classZ, 2), unit: "σ" },
    refs: ["hazen1914", "abramowitz1964"],
    related: ["depth.fit", "depth.field"],
    source: "src/lib/quant/depth.ts · classZ",
  };
}

export function depthFit(ctx: DeriveCtx): Derivation | null {
  const m = ctx.depthModel;
  if (!m) return null;
  return {
    id: "depth.fit",
    title: "DEPTH FIT · RIDGE-IDENTIFIED DECOMPOSITION",
    symbol: "\\pi_t",
    claim:
      "SEPARATE \"THE CLASS IS STRONG\" FROM \"THE STUDENT IS STRONG\". ONE PENALISED LEAST-SQUARES SOLVE OVER THE WHOLE BOOK.",
    steps: [
      {
        tex: `y_i - g_i \\;=\\; \\underbrace{\\pi_{t(i)}}_{\\text{class}} + \\underbrace{\\beta_{s(i)}}_{\\text{desk}} + \\sigma_{\\text{cls}}\\,z_i + \\varepsilon_i`,
        note: "zᵢ ABSORBS WHERE THE STUDENT SITS INSIDE THE CLASS, SO WHAT REMAINS IS A PROPERTY OF THE CLASS ITSELF.",
      },
      {
        tex: `\\min_{\\pi,\\beta} \\;\\sum_i \\varepsilon_i^2 \\;+\\; \\kappa\\sum_s \\beta_s^2, \\qquad \\kappa = ${DEPTH_BASIS_SHRINK}`,
        note: "π AND β ARE COLLINEAR ALONE — SHIFTING EVERY PREMIUM UP AND EVERY BASIS DOWN FITS IDENTICALLY. THE RIDGE IS WHAT SAYS \"ATTRIBUTE A COMMON SHIFT TO THE CLASS, NOT THE DESKS\", AND IT STOPS A DESK WITH ONE PLACEMENT ABSORBING ITS WHOLE RESIDUAL.",
      },
      {
        tex: `\\text{streamed} \\iff |\\bar\\pi| > 2\\max\\!\\big(\\operatorname{se}(\\bar\\pi),\\; 0.5\\big)`,
        subst: `|${v(m.premiumMean, 2)}| \\;\\text{vs}\\; ${v(2 * Math.max(m.premiumSe, 0.5), 2)} \\;\\Longrightarrow\\; \\textsf{${m.streamed ? "STREAMED BOOK" : "FLAT BOOK"}}`,
        note: "THE PREMIUM MUST CLEAR TWICE ITS OWN STANDARD ERROR — FLOORED AT 0.5 PT SO A TINY SE ON A SHORT BOOK CANNOT DECLARE STREAMING ON NOISE. A STREAMED BOOK ANNOUNCES ITSELF RATHER THAN BEING ASSUMED.",
      },
    ],
    inputs: [
      { sym: "\\bar\\pi", label: "mean peer premium", value: sgn(m.premiumMean, 2) },
      { sym: "\\operatorname{se}", label: "its standard error", value: fmt(m.premiumSe, 2) },
      { sym: "\\sigma_{\\text{cls}}", label: "within-class spread", value: fmt(m.sigmaClass, 1) },
      { sym: "\\mathrm{RMSE}", label: "residual", value: fmt(m.rmse, 2) },
      { sym: "n", label: "ranked prints fitted", value: String(m.n) },
      { sym: "\\kappa", label: "ridge penalty", value: String(DEPTH_BASIS_SHRINK) },
    ],
    result: { tex: "\\bar\\pi", value: sgn(m.premiumMean, 1), unit: "PTS" },
    gates: [
      { text: `≥ ${DEPTH_MIN_PRINTS} ranked prints`, pass: m.n >= DEPTH_MIN_PRINTS },
      { text: `≥ ${DEPTH_MIN_GROUPS} reporting periods`, pass: m.groups.length >= DEPTH_MIN_GROUPS },
      { text: "the premium clears twice its noise floor (2·max(se, ½))", pass: m.streamed },
    ],
    refs: ["hoerl1970"],
    related: ["depth.sigma", "depth.field"],
    source: "src/lib/quant/depth.ts · fitDepth",
  };
}

export function depthSigma(ctx: DeriveCtx): Derivation | null {
  const m = ctx.depthModel;
  const st = ctx.settings?.depth;
  if (!m || !st) return null;
  const assumptionFree = st.streamsPerLevel <= 1 || st.streamTightness === 0;
  return {
    id: "depth.sigma",
    title: "COHORT GEOMETRY · YEAR-LEVEL SPREAD",
    symbol: "\\sigma_{\\text{yr}}",
    claim:
      "CONVERTING A CLASS POSITION TO A FIELD POSITION NEEDS THE YEAR-LEVEL SPREAD, WHICH ONE STUDENT'S REPORTS CANNOT IDENTIFY. IT COMES FROM THREE SETTINGS.",
    steps: [
      {
        tex: `\\sigma_{\\text{cls}} \\;=\\; \\sigma_{\\text{yr}}\\sqrt{1 - \\rho^2\\,(1 - v_S)}`,
        subst: `${v(m.sigmaClass, 2)} \\;=\\; ${v(m.sigmaYear, 2)}\\sqrt{1 - ${v(st.streamTightness, 2)}^2\\,(1 - v_{${st.streamsPerLevel}})}`,
        note: "TIGHTER STREAMING MEANS A CLASS IS A NARROWER SLICE, SO THE SAME WITHIN-CLASS SPREAD IMPLIES A WIDER YEAR LEVEL BEHIND IT.",
      },
      {
        tex: `v_S \\;=\\; 1 - \\frac{1}{S}\\sum_{j=1}^{S} m_j^2, \\qquad m_j = S\\big(\\varphi(a_j) - \\varphi(b_j)\\big)`,
        note: "v_S IS THE WITHIN-BAND VARIANCE LEFT WHEN A STANDARD NORMAL IS CUT INTO S EQUAL-PROBABILITY BANDS. THE mⱼ ARE THE BAND MEANS, FROM THE NORMAL DENSITY AT THE CUT POINTS.",
      },
      {
        tex: `S = 1 \\;\\text{or}\\; \\rho = 0 \\;\\Longrightarrow\\; \\sigma_{\\text{yr}} = \\sigma_{\\text{cls}} \\;\\Longrightarrow\\; p = 100\\left(1 - \\tfrac{r-0.5}{N}\\right)`,
        note: assumptionFree
          ? "THE DEFAULTS ARE LIVE: THE CLASS IS THE FIELD, AND THE LADDER REPRODUCES THE PLAIN HAZEN PERCENTILE EXACTLY. NOTHING IS BEING ASSUMED ABOUT THE SCHOOL."
          : "THE DEFAULTS ASSERT NOTHING ABOUT THE SCHOOL — WITH ONE STREAM OR ZERO TIGHTNESS THE LADDER COLLAPSES TO THE PLAIN PLACEMENT PERCENTILE. THESE SETTINGS HAVE BEEN CHANGED FROM THAT BASELINE.",
      },
    ],
    inputs: [
      { sym: "S", label: "parallel classes", value: String(st.streamsPerLevel) },
      { sym: "\\rho", label: "streaming tightness", value: fmt(st.streamTightness, 2) },
      { sym: "N_{\\text{yr}}", label: "year size", value: String(m.yearSize) },
      { sym: "\\sigma_{\\text{cls}}", label: "within-class σ", value: fmt(m.sigmaClass, 2) },
      { sym: "\\sigma_{\\text{yr}}", label: "year-level σ", value: fmt(m.sigmaYear, 2) },
      { sym: "\\tilde N", label: "median cohort", value: String(m.medianCohort) },
    ],
    result: { tex: "\\sigma_{\\text{yr}}", value: fmt(m.sigmaYear, 1), unit: "PTS" },
    gates: [{ text: "settings are the assumption-free defaults", pass: assumptionFree }],
    refs: ["abramowitz1964"],
    related: ["depth.fit", "depth.ladder"],
    source: "src/lib/quant/depth.ts · withinBandVariance",
  };
}

export function depthField(ctx: DeriveCtx): Derivation | null {
  const d = ctx.stat?.depth;
  const m = ctx.depthModel;
  if (!d || !m) return null;
  const l = d.latest;
  // Which of the two routes readOf actually took for this print. The direct
  // route wins whenever the print carries a year-level mark; only then does the
  // via-class reconstruction NOT describe how fieldZ was obtained. Identify the
  // source print by its (date, rank, cohort, score) fingerprint.
  const src = ctx.stat?.entries.find(
    (e) => e.date === l.date && e.rank === l.rank && e.cohortN === l.cohortN && e.score === l.score,
  );
  const yearKnown = src?.yearAvg != null;
  const routeStep = yearKnown
    ? {
        tex: `z_{\\text{fld}} \\;=\\; \\frac{g - \\mu_{\\text{yr}}}{\\sigma_{\\text{yr}}}`,
        subst: `z_{\\text{fld}} \\;=\\; \\frac{${v(l.score, 0)} - ${v(l.yearAvg, 1)}}{${v(m.sigmaYear, 2)}} \\;=\\; ${v(l.fieldZ, 2)}`,
        note: "THE PRINT CARRIES A YEAR-LEVEL MARK, SO THE FIELD READ IS DIRECT AND NEAR MODEL-FREE — THE STUDENT'S SCORE AGAINST THE WHOLE YEAR'S MEAN. THE FITTED CLASS STRENGTH (π, β) IS THE FALLBACK ROUTE, NOT THIS ONE.",
      }
    : {
        tex: `z_{\\text{fld}} \\;=\\; \\frac{\\pi_t + \\beta_s + \\sigma_{\\text{cls}}\\,z_{\\text{cls}}}{\\sigma_{\\text{yr}}}`,
        subst: `z_{\\text{fld}} \\;=\\; \\frac{${v(l.premium, 2)} + ${v(l.basis, 2)} + ${v(m.sigmaClass, 2)}\\cdot${v(l.classZ, 2)}}{${v(m.sigmaYear, 2)}} \\;=\\; ${v(l.fieldZ, 2)}`,
        note: "NO YEAR-LEVEL MARK ON THIS PRINT: THE FIELD POSITION IS RECONSTRUCTED FROM WHERE THE FITTED CLASS SITS IN THE YEAR (π + β) PLUS WHERE THE STUDENT SITS IN THE CLASS (σ_cls·z_cls).",
      };
  return {
    id: "depth.field",
    title: "FIELD PERCENTILE · THE HONEST ONE",
    symbol: "p_{\\text{fld}}",
    claim: "WHERE YOU SIT IN THE YEAR LEVEL, NOT JUST IN THE ROOM YOU SAT IN.",
    steps: [
      routeStep,
      {
        tex: `p_{\\text{fld}} = 100\\,\\Phi(z_{\\text{fld}}), \\qquad \\hat r_{\\text{fld}} = \\big\\lceil N_{\\text{yr}}\\,(1 - \\Phi(z_{\\text{fld}}))\\big\\rceil`,
        subst: `p_{\\text{fld}} = ${v(l.fieldPct, 1)}, \\qquad \\hat r_{\\text{fld}} = ${v(l.fieldRank, 0)} \\;/\\; ${v(m.yearSize, 0)}`,
        note: "A STEP DOWN IN π WHILE YOUR PLACEMENT HOLDS IS A RECLASSIFICATION: SAME STUDENT, WEAKER FIELD, AND EVERY PLACEMENT SUDDENLY FLATTERS.",
      },
    ],
    inputs: [
      { sym: "z_{\\text{cls}}", label: "inside the class", value: sgn(l.classZ, 2) },
      { sym: "\\pi_t", label: "peer premium", value: sgn(l.premium, 1) },
      { sym: "\\beta_s", label: "desk basis", value: sgn(l.basis, 1) },
      { sym: "z_{\\text{fld}}", label: "in the field", value: sgn(l.fieldZ, 2) },
      { sym: "p_{\\text{cls}}", label: "class percentile", value: fmt(l.classPct, 0) },
      { sym: "p_{\\text{fld}}", label: "field percentile", value: fmt(l.fieldPct, 0) },
    ],
    result: { tex: "p_{\\text{fld}}", value: fmt(l.fieldPct, 0) },
    refs: ["hazen1914"],
    related: ["depth.classz", "depth.fit", "depth.ladder"],
    source: "src/lib/quant/depth.ts · subjectDepth",
  };
}

export function depthLadder(ctx: DeriveCtx): Derivation | null {
  const d = ctx.stat?.depth;
  const m = ctx.depthModel;
  if (!d || !m) return null;
  return {
    id: "depth.ladder",
    title: "ORDER BOOK · HEADS PER RUNG",
    symbol: "N_{\\text{rung}}",
    claim: "THE YEAR-LEVEL DISTRIBUTION RENDERED HEAD BY HEAD, WITH YOUR OWN CLASS OVERLAID AS A SOFT BAND.",
    steps: [
      {
        tex: `N_{\\text{rung}} \\;=\\; N_{\\text{yr}}\\big(\\Phi(z_{\\text{hi}}) - \\Phi(z_{\\text{lo}})\\big), \\qquad \\text{step} = ${DEPTH_LADDER_STEP}\\;\\text{pts}`,
        subst: `N_{\\text{yr}} = ${v(m.yearSize, 0)}, \\qquad \\sigma_{\\text{yr}} = ${v(m.sigmaYear, 2)}`,
        note: "OUTER RUNGS ARE OPEN-ENDED SO THE HEADS SUM EXACTLY TO THE YEAR SIZE — NOBODY IS LOST OFF THE TOP OR BOTTOM OF THE LADDER.",
      },
      {
        tex: `\\text{class overlay} \\;\\sim\\; \\mathcal{N}\\big(g + \\pi_t + \\beta_s,\\; \\sigma_{\\text{cls}}^2\\big)`,
        subst: `\\sigma_{\\text{cls}} = ${v(m.sigmaClass, 2)}, \\qquad \\text{stream } ${d.streamIndex ?? "—"} \\;\\text{of}\\; ${d.streamsPerLevel}`,
        note: "A SOFT BAND, NOT A HARD SLICE, BECAUSE LOOSE STREAMING GENUINELY SPILLS A CLASS ACROSS LEVELS.",
      },
    ],
    inputs: [
      { sym: "N_{\\text{yr}}", label: "year size", value: String(m.yearSize) },
      { sym: "\\sigma_{\\text{yr}}", label: "year-level σ", value: fmt(m.sigmaYear, 2) },
      { sym: "\\sigma_{\\text{cls}}", label: "class σ", value: fmt(m.sigmaClass, 2) },
      { sym: "\\text{step}", label: "rung height", value: `${DEPTH_LADDER_STEP} pts` },
      { sym: "|\\text{rungs}|", label: "rungs drawn", value: String(d.ladder.length) },
    ],
    result: { tex: "N_{\\text{yr}}", value: String(m.yearSize), unit: "HEADS" },
    refs: ["abramowitz1964"],
    related: ["depth.sigma", "depth.field"],
    source: "src/lib/quant/depth.ts · subjectDepth",
  };
}

export function depthPremium(ctx: DeriveCtx): Derivation | null {
  const m = ctx.depthModel;
  if (!m || !m.groups.length) return null;
  const now = m.groups[m.groups.length - 1];
  return {
    id: "depth.premium",
    title: "PEER PREMIUM",
    symbol: "\\pi_t",
    claim: "HOW STRONG THE ROOM AROUND YOU IS, PERIOD BY PERIOD. THE ONE INSTRUMENT ON THE BOARD THAT IS NOT ABOUT YOU.",
    steps: [
      {
        tex: `\\pi_t \\;=\\; \\mathbb{E}\\big[y - g \\;\\big|\\; \\text{period } t\\big] \\;-\\; \\beta_{s} \\;-\\; \\sigma_{\\text{cls}}\\,\\mathbb{E}[z]`,
        subst: `\\pi_{\\text{${now.label}}} \\;=\\; ${v(now.premium, 2)}\\;\\text{pts over the year level}`,
        note: "FITTED, NOT ASSUMED: THE PLACEMENT TERM IS REMOVED FIRST, SO WHAT IS LEFT CANNOT BE THE STUDENT.",
      },
      {
        tex: `\\operatorname{se}(\\bar\\pi) \\;=\\; \\frac{\\sigma_\\pi}{\\sqrt{|T|}}, \\qquad \\text{streamed} \\iff |\\bar\\pi| > 2\\max\\!\\big(\\operatorname{se},\\; 0.5\\big)`,
        subst: `|${v(m.premiumMean, 2)}| \\;\\text{vs}\\; ${v(2 * Math.max(m.premiumSe, 0.5), 2)}`,
      },
    ],
    inputs: [
      { sym: "\\pi_t", label: `latest — ${now.label}`, value: sgn(now.premium, 1) },
      { sym: "n_t", label: "ranked prints behind it", value: String(now.n) },
      { sym: "|T|", label: "periods fitted", value: String(m.groups.length) },
      { sym: "\\bar\\pi", label: "mean premium", value: sgn(m.premiumMean, 2) },
      { sym: "\\operatorname{se}", label: "standard error", value: fmt(m.premiumSe, 2) },
    ],
    result: { tex: "\\pi_t", value: sgn(now.premium, 1), unit: "PTS" },
    gates: [{ text: "the book is streamed on its own evidence", pass: m.streamed }],
    refs: ["hoerl1970"],
    related: ["depth.fit", "depth.field"],
    source: "src/lib/quant/depth.ts · fitDepth",
  };
}
