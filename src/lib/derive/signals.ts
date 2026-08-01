/**
 * Derivations for the life-signals layer (§D5, T19) — the walkthrough behind
 * every number the SIGNALS board prints. Four builders, one per figure a
 * student can hover: the combined shift (`signal.adjust`), and the three
 * reads that feed it or sit beside it (`signal.stock`, `signal.mastery`,
 * `signal.voi`).
 *
 * Three things every note here must say honestly, because the layer's own
 * doctrine depends on a student believing them:
 *
 *  · Every term is a DEVIATION from this desk's own trailing norm, never a
 *    level — a constant habit prices every channel to ~0, which is the
 *    identity `signalread.ts` documents as load-bearing.
 *  · The channel sits HOUSE-side: `applySignals` shifts the house's own
 *    `nextExam` BEFORE the §27/§29 credibility pool ever sees it, so it is
 *    neither under `POOL_CEIL` nor on either priced channel's own cap.
 *  · The LEVEL claim (the mean shift) is earned-gated by `w`; the VARIANCE
 *    claim (`sdMult`) is not — a book can widen its own band on state alone,
 *    at w = 0, without earning a seat to move the mean.
 *
 * And per Task 15's finding: once two or more terms jointly bind the
 * ±SIGNAL_ADJ_CAP clamp, the per-term breakdown no longer sums to `adj` —
 * each term is still an honest read on its own, but the total is not their
 * plain sum. `signal.adjust`'s clamp step says so explicitly whenever the
 * clamp is actually binding (tested EXACTLY off `adj` itself — see the
 * function below — never off a re-summed `terms`, which would silently
 * disagree with `signalRead`'s own pre-clamp total whenever a candidate
 * fell under the 0.05pt display floor), rather than implying an additivity
 * the engine does not have.
 *
 * The per-desk TABLE is a different question and now has an exact answer:
 * `shapley.ts` splits the clamped total across the channels that caused it, so
 * those columns DO sum to `adj` (audit Part I §3). The rows on this card are
 * the raw reads, and raw reads still overshoot a bound cap.
 */

import { creditSteps } from "./earned";
import { fmt, sgn, v, type Derivation, type DerivationInput, type DeriveCtx } from "./types";
import { SIGNAL_CAP, SIGNAL_KAPPA, SIGNAL_PRIOR } from "../quant/params";
import {
  MASTERY_MIN_MARKS, MASTERY_SCALE, MASTERY_W, QUALITY, SIGNAL_ADJ_CAP, STOCK_FLOOR, STOCK_W, VOI_EFFORT_SCALE,
  halfLifeOf,
} from "../quant/signals/params";

/** Mirrors `views/signals/index.tsx`'s own `fmtPts` exactly, so a derivation's
 *  result reads byte-identical to the per-desk table cell it underlines. */
const ZERO_EPS = 0.005;
const fmtPts = (x: number): string => (Math.abs(x) < ZERO_EPS ? "0.00" : `${x > 0 ? "+" : ""}${x.toFixed(2)}`);
/** Mirrors the per-desk table's own SHAPLEY cell exactly (an em-dash under
 *  the epsilon, `fmtPts` above it) — the STOCK/MASTERY columns' own
 *  formatter, distinct from `fmtPts` alone (which prints "0.00" at zero
 *  rather than "—"). */
const fmtShare = (x: number): string => (Math.abs(x) < ZERO_EPS ? "—" : fmtPts(x));

/* ── §D5 · the combined shift ───────────────────────────────────────── */

export function signalAdjust(ctx: DeriveCtx): Derivation | null {
  const s = ctx.stat;
  const fit = ctx.signalFit;
  const read = s && ctx.signalReads ? ctx.signalReads.get(s.sub.id) ?? null : null;
  if (!s || !read || !fit) return null;
  const on = ctx.settings?.signalWeighting !== false;

  // adj IS round2(clip(rawSum, -CAP, CAP)) — so this is the EXACT test for
  // whether the clamp actually bound, off the one field signalRead already
  // computed it from. Re-summing `terms` (which drops anything under the
  // 0.05pt display floor) would silently understate the true pre-clamp total
  // and could miss a clamp that a handful of sub-floor terms alone pushed
  // over the line.
  const clampBinds = Math.abs(read.adj) >= SIGNAL_ADJ_CAP;
  const rows = read.terms.length
    ? read.terms.map((t) => `\\text{${t.key.toUpperCase()}} & ${sgn(t.pts, 2)} \\\\`).join(" ")
    : `\\text{(no term clears the 0.05pt floor)} & ${fmt(0, 2)} \\\\`;
  const wAdj = fit.w * read.adj;

  // The ADJ cell and the W·ADJ cell both open this SAME walkthrough, but they
  // show DIFFERENT figures — types.ts's load-bearing invariant is that
  // result.value equals the number the interface displays for THIS figure, so
  // the headline switches on which cell asked (ctx.key), not just the steps.
  const headlineAdj = ctx.key === "adj";
  const resultSym = headlineAdj ? "\\text{adj}" : "w\\cdot\\text{adj}";
  // Both branches use `fmtPts` — exactly the formatting the ADJ and W·ADJ
  // table cells themselves use (views/signals/index.tsx) — never `sgn`,
  // which prints a leading "+0.00" at zero where the interface prints a bare
  // "0.00"; a mismatched sign there would itself violate the invariant this
  // fix exists to restore.
  const resultVal = headlineAdj ? fmtPts(read.adj) : fmtPts(wAdj);

  return {
    id: "signal.adjust",
    title: headlineAdj ? "LIFE SIGNALS · TERMS \u2192 ADJ" : "LIFE SIGNALS · TERMS \u2192 W\u00b7ADJ",
    symbol: resultSym,
    claim: headlineAdj
      ? "THE DESK'S OWN CLAMPED SHIFT \u2014 WHAT YOUR LOGGED STATE ADDS UP TO, BEFORE THE EARNED WEIGHT DECIDES HOW MUCH OF IT ACTUALLY MOVES THE FORECAST."
      : "WHAT YOUR LOGGED STATE IS WORTH ON THE HOUSE'S OWN NEXT-EXAM MEAN, ONCE THE CHANNEL HAS EARNED THE RIGHT TO MOVE IT.",
    steps: [
      {
        tex: `\\begin{array}{lr} \\textbf{term} & \\text{pts} \\\\ \\hline ${rows} \\end{array}`,
        note:
          "EACH TERM IS A DEVIATION FROM THIS DESK'S OWN TRAILING NORM, NEVER A LEVEL \u2014 A CONSTANT HABIT (SAME HOURS, SAME SLEEP, SAME EVERY WEEK) PRICES EVERY CHANNEL TO ZERO. THE LAYER PAYS FOR CHANGE, NOT FOR THE HABIT ITSELF. ONLY TERMS \u2265 0.05PT ARE LISTED \u2014 A SMALLER CONTRIBUTOR CAN STILL SIT INSIDE \u03a3 BELOW WITHOUT EARNING A ROW OF ITS OWN.",
      },
      {
        tex: `\\text{adj} \\;=\\; \\operatorname{clip}_{[-${SIGNAL_ADJ_CAP},\\,${SIGNAL_ADJ_CAP}]}\\!\\big(\\Sigma\\big), \\qquad \\Sigma \\;=\\; \\text{sum of every candidate this desk fired, floor or no floor}`,
        subst: `\\Sigma \\;=\\; ${v(read.rawSum, 2)} \\;\\Longrightarrow\\; \\operatorname{clip}(${v(read.rawSum, 2)}) \\;=\\; ${v(read.adj, 2)}`,
        note: clampBinds
          ? `THE CLAMP IS BINDING HERE \u2014 |\u03a3| CLEARS \u00b1${SIGNAL_ADJ_CAP} PTS, SO THE ROWS ABOVE NO LONGER SUM TO ADJ. EACH TERM IS STILL AN HONEST READ ON ITS OWN, BUT THE CLAMPED TOTAL IS NOT THEIR PLAIN SUM. (THE PER-DESK TABLE'S OWN COLUMNS SPLIT THIS CLAMPED TOTAL BY SHAPLEY VALUE, SO THEY DO SUM TO ADJ \u2014 IT IS THE RAW ROWS ABOVE THAT DO NOT.)`
          : "\u03a3 CAN SIT SLIGHTLY BEYOND THE VISIBLE ROWS' OWN TOTAL \u2014 A CONTRIBUTOR UNDER THE 0.05PT DISPLAY FLOOR (A MILD ATTENDANCE SHAVE, AN UNROUNDED ANXIETY TERM) STILL COUNTS TOWARD \u03a3 EVEN THOUGH IT EARNED NO ROW OF ITS OWN.",
      },
      ...creditSteps(fit, { kappa: SIGNAL_KAPPA, cap: SIGNAL_CAP, toward: SIGNAL_PRIOR, unit: "CRPS" }),
      {
        tex: `\\Delta\\mu \\;=\\; w\\cdot\\text{adj}, \\qquad \\mu' \\;=\\; \\mu + \\Delta\\mu \\quad (\\text{HOUSE-SIDE \u2014 before the self/wire pool})`,
        subst: `\\Delta\\mu \\;=\\; ${v(fit.w, 3)}\\cdot ${v(read.adj, 2)} \\;=\\; ${v(wAdj, 2)}\\;\\text{pts}`,
        note:
          "APPLIED TO THE HOUSE'S OWN nextExam MEAN BEFORE THE \u00a727/\u00a729 CREDIBILITY POOL EVER SEES IT \u2014 NOT UNDER POOL_CEIL, AND ON NEITHER PRICED CHANNEL'S OWN CAP. THE LEVEL CLAIM HERE IS THE ONE THING THE EARNED WEIGHT ABOVE ACTUALLY GATES.",
      },
      {
        tex: `\\sigma' \\;=\\; \\sigma\\cdot\\text{sdMult}, \\qquad \\text{sdMult NEVER GATED BY } w`,
        subst: `\\text{sdMult} \\;=\\; ${v(read.sdMult, 2)}`,
        note:
          "THE HUMILITY CLAIM apply.ts DOCUMENTS: A BOOK CAN WIDEN ITS OWN BAND ON STATE ALONE, AT w = 0, WITHOUT EARNING A SEAT TO MOVE THE MEAN. sdMult \u2265 1 ALWAYS \u2014 THE LAYER WIDENS A FORECAST, IT NEVER TIGHTENS ONE.",
      },
    ],
    inputs: [
      { sym: "\\Sigma", label: "raw sum, pre-clamp", value: sgn(read.rawSum, 2) },
      { sym: "\\text{adj}", label: "clamped shift", value: sgn(read.adj, 2) },
      { sym: "w", label: "earned weight", value: `${Math.round(fit.w * 100)}%` },
      { sym: "w\\cdot\\text{adj}", label: "applied shift", value: fmtPts(wAdj) },
      { sym: "\\text{sdMult}", label: "band multiplier", value: fmt(read.sdMult, 2) },
      { sym: "n", label: "terms clearing the floor", value: String(read.terms.length) },
    ],
    result: { tex: resultSym, value: resultVal, unit: "PTS" },
    gates: [
      { text: "the channel is switched on", pass: on },
      { text: `clamped within \u00b1${SIGNAL_ADJ_CAP} pts`, pass: Math.abs(read.adj) <= SIGNAL_ADJ_CAP },
      { text: `capped under ${Math.round(SIGNAL_CAP * 100)}%`, pass: fit.w <= SIGNAL_CAP },
    ],
    refs: ["buhlmann1967", "eysenck2007"],
    related: ["signal.stock", "signal.mastery", "signal.voi"],
    source: "src/lib/quant/signals/signalread.ts \u00b7 signalRead, apply.ts \u00b7 applyRead",
  };
}

/* ── the study-stock read ──────────────────────────────────────────── */

export function signalStock(ctx: DeriveCtx): Derivation | null {
  const s = ctx.stat;
  const id = s?.sub.id;
  const stock = id != null ? ctx.card?.signalStock?.[id] : undefined;
  if (!s || !stock) return null;
  const H = halfLifeOf(s.sub.mix ?? null);
  const denom = stock.baseline == null ? null : Math.max(stock.baseline, STOCK_FLOOR);
  const phi = id != null ? ctx.card?.signalShapley?.[id]?.stock : undefined;

  // The STOCK column in the per-desk table shows this term's SHAPLEY VALUE \u2014
  // its share of the clamped adj, never the raw channel read below: a
  // different figure, with a different formatter (fmtShare's "\u2014" at zero vs
  // sgn's "+0.00"). `ctx.key === "shapley"` is what that cell passes; anything
  // else (including no key at all, e.g. a direct `signal.stock` lookup with
  // no decomposition on the context) reports the raw read instead.
  const headlineShapley = ctx.key === "shapley" && phi != null;
  const resultSym = headlineShapley ? "\\varphi_{\\text{stock}}" : "\\pi_{\\text{stock}}";
  const resultVal = headlineShapley ? fmtShare(phi as number) : sgn(stock.term, 2);

  return {
    id: "signal.stock",
    title: headlineShapley ? "STUDY STOCK \u00b7 SHARE OF THE SHIFT" : "STUDY STOCK \u00b7 14D VS OWN NORM",
    symbol: resultSym,
    claim: headlineShapley
      ? "THIS CHANNEL'S SHARE OF THE DESK'S CLAMPED SHIFT \u2014 ITS SHAPLEY VALUE, AVERAGED OVER EVERY ORDER THE CHANNELS COULD HAVE ARRIVED IN. EVERY COLUMN'S SHARE SUMS TO ADJ EXACTLY, CAP BINDING OR NOT."
      : "HOW MUCH QUALITY-WEIGHTED STUDY YOU HAVE ACTUALLY BANKED LATELY, AGAINST YOUR OWN TRAILING RATE \u2014 NEVER AGAINST ANOTHER DESK.",
    steps: [
      {
        tex: `k_{14} \\;=\\; \\sum_{i\\,:\\,0\\le\\Delta_i\\le13} \\text{minutes}_i\\cdot Q(\\text{kind}_i)\\cdot\\text{spacing}_i\\cdot\\text{encoding}_i\\cdot e^{-\\ln 2\\,\\Delta_i / H}, \\qquad \\Delta_i \\;=\\; \\text{days, session } i \\text{ to asOf}`,
        note: `EVERY SESSION IS QUALITY-WEIGHTED (RECALL AT ${QUALITY.recall.toFixed(1)}\u00d7, READING AT ${QUALITY.reading.toFixed(1)}\u00d7), SPACED (A REPEAT 1-7D LATER EARNS A SMALL BUMP) AND DOCKED WHEN THE NIGHT BEFORE RAN SHORT \u2014 THEN DECAYED TO asOf ON A HALF-LIFE H = ${fmt(H, 0)}D SET BY THIS SUBJECT'S OWN KNOWLEDGE/PROCEDURE/SKILL MIX.`,
      },
      {
        tex: `\\text{baseline} \\;=\\; \\frac{1}{\\text{covered}}\\Big(\\textstyle\\sum_{i\\,:\\,14\\le\\Delta_i\\le55} \\text{effMin}_i\\Big)\\cdot D(H), \\qquad \\text{covered} \\;=\\; \\operatorname{clamp}(\\text{days of history in that window},\\,1,\\,42)`,
        subst:
          stock.baseline == null
            ? undefined
            : `\\text{baseline} \\;=\\; ${v(stock.baseline, 1)}\\;\\text{min (same decayed units as }k_{14}\\text{)}`,
        note:
          "THE SAME PER-SESSION \u0394\u1d62 (DAYS AGO) AS ABOVE, JUST OVER THE 14-55-DAYS-AGO WINDOW INSTEAD OF 0-13 \u2014 DIVIDED BY HOW MUCH OF THAT 42-DAY WINDOW THIS DESK'S HISTORY ACTUALLY COVERS, NEVER A FLAT 42 (DAYS BEFORE THE FIRST LOG ARE UNKNOWN, NOT ZERO), THEN PROJECTED THROUGH THE SAME DECAY KERNEL AS k\u2081\u2084 \u2014 NOT A FLAT \u00d714 \u2014 SO A PERFECTLY STEADY HABIT READS k\u2081\u2084 \u2248 BASELINE AND TERM \u2248 0 AT ANY HALF-LIFE OR HISTORY LENGTH, RATHER THAN LOOKING HOT OR COLD BY CONSTRUCTION.",
      },
      {
        tex: `\\pi_{\\text{stock}} \\;=\\; ${STOCK_W}\\cdot\\tanh\\!\\left(\\frac{k_{14}-\\text{baseline}}{\\max(\\text{baseline},\\,${STOCK_FLOOR})}\\right)`,
        subst:
          stock.baseline == null || denom == null
            ? undefined
            : `= ${STOCK_W}\\cdot\\tanh\\!\\left(\\frac{${v(stock.k14, 1)} - ${v(stock.baseline, 1)}}{${v(denom, 0)}}\\right) \\;=\\; ${v(stock.term, 2)}`,
        note:
          "A SATURATING (tanh) READ: RUNNING TWICE YOUR OWN NORM IS NOT WORTH TWICE THE CREDIT, AND THE FLOOR IN THE DENOMINATOR KEEPS A NEAR-ZERO BASELINE FROM BLOWING THE RATIO UP ON A THIN WEEK.",
      },
      {
        tex: `\\varphi_k \\;=\\; \\sum_{S\\subseteq N\\setminus\\{k\\}} \\frac{|S|!\\,(n-|S|-1)!}{n!}\\Big[v(S\\cup\\{k\\}) - v(S)\\Big], \\qquad v(S) \\;=\\; \\operatorname{clip}_{[-${SIGNAL_ADJ_CAP},\\,${SIGNAL_ADJ_CAP}]}\\!\\Big(\\textstyle\\sum_{j\\in S}\\pi_j\\Big)`,
        subst: phi != null ? `\\varphi_{\\text{stock}} \\;=\\; ${v(phi, 2)}` : undefined,
        note:
          `THE STOCK COLUMN IN THE PER-DESK TABLE SHOWS THIS SHARE, NOT THE RAW READ ABOVE \u2014 THEY AGREE EXACTLY UNTIL THE \u00b1${SIGNAL_ADJ_CAP} CLAMP BINDS, AT WHICH POINT THE CAP HAS TO BE SPLIT BETWEEN THE CHANNELS THAT CAUSED IT. EVERY COALITION IS ENUMERATED EXACTLY (2\u2077 = 128 AT SEVEN CHANNELS, NEVER SAMPLED), AND THE EFFICIENCY AXIOM MAKES THE COLUMNS SUM TO ADJ \u2014 WHICH THE DROP-ONE MARGINAL THIS REPLACED COULD NOT DO.`,
      },
    ],
    inputs: [
      { sym: "k_{14}", label: "trailing 14d stock", value: fmt(stock.k14, 1) },
      { sym: "\\text{baseline}", label: "prior rate (own coverage)", value: stock.baseline == null ? "\u2014" : fmt(stock.baseline, 1), missing: stock.baseline == null },
      { sym: "H", label: "mix half-life", value: `${fmt(H, 0)}d` },
      { sym: "\\text{recall}", label: "share active-recall", value: stock.recallRatio == null ? "\u2014" : `${Math.round(stock.recallRatio * 100)}%`, missing: stock.recallRatio == null },
      { sym: "h/\\text{wk}", label: "raw hours/wk", value: stock.hoursPerWeek == null ? "\u2014" : `${fmt(stock.hoursPerWeek, 1)}h`, missing: stock.hoursPerWeek == null },
      { sym: "\\pi_{\\text{stock}}", label: "raw channel read", value: sgn(stock.term, 2) },
      { sym: "\\varphi_{\\text{stock}}", label: "share of adj (table column)", value: phi == null ? "\u2014" : fmtShare(phi), missing: phi == null },
    ],
    result: { tex: resultSym, value: resultVal, unit: "PTS" },
    refs: ["shapley1953"],
    gates: [{ text: "\u2265 28 days of history and \u2265 3 sessions in the 14-55d baseline window", pass: stock.baseline != null }],
    related: ["signal.adjust", "signal.mastery"],
    source: "src/lib/quant/signals/stock.ts \u00b7 studyStock",
  };
}

/* ── the mastery read ──────────────────────────────────────────────── */

export function signalMastery(ctx: DeriveCtx): Derivation | null {
  const s = ctx.stat;
  const id = s?.sub.id;
  const mastery = id != null ? ctx.card?.signalMastery?.[id] : undefined;
  if (!s || !mastery) return null;
  const modelMean = id != null ? ctx.card?.signalModelMean?.[id] ?? null : null;

  const marked = mastery.topics.filter((t) => t.n >= 1);
  const nMarked = marked.length;
  const totalMarks = marked.reduce((a, t) => a + t.n, 0);
  const satFrac = Math.min(1, totalMarks / 6);
  // `coverage` is round2(coveredMass) — the ENGINE's own gate (mastery.ts)
  // reads the unrounded coveredMass, so a desk sitting exactly on the 0.3
  // boundary (e.g. raw 0.2951, rounds to 0.30) can show a passing gate here
  // for a term the engine actually zeroed. Narrow, cosmetic, and would need
  // `coveredMass` itself plumbed through MasteryRead to close exactly —
  // ledgered rather than fixed in this pass.
  const covered = mastery.coverage ?? 0;
  // The attendance shave (mastery.ts's `coveredMassShaved`): under-attended
  // mass that LOOKS covered by weight moves to the neutral side. Recomputed
  // here from `attendancePct` (a plain Subject field, not an engine output)
  // exactly as mastery.ts computes it — never a re-run of `masteryRead`.
  const attendancePct = s.sub.attendancePct ?? null;
  const shaved = attendancePct != null && attendancePct < 95;
  const sAtt = shaved ? 1 - ((95 - attendancePct) / 100) * 0.5 : 1;
  const coveredShaved = covered * sAtt;
  const priced = modelMean != null && mastery.predictedPaper != null && covered >= 0.3 && nMarked >= MASTERY_MIN_MARKS;
  const phi = id != null ? ctx.card?.signalShapley?.[id]?.mastery : undefined;

  // Same split as signal.stock: the MASTERY column shows this term's share of
  // the clamped adj, not the raw channel read — different figure, different
  // formatter, selected by `ctx.key === "shapley"`.
  const headlineShapley = ctx.key === "shapley" && phi != null;
  const resultSym = headlineShapley ? "\\varphi_{\\text{mastery}}" : "\\pi_{\\text{mastery}}";
  const resultVal = headlineShapley ? fmtShare(phi as number) : sgn(mastery.term, 2);

  const inputs: DerivationInput[] = [
    { sym: "\\text{coverage}", label: "weighted syllabus marked (raw)", value: mastery.coverage == null ? "\u2014" : `${Math.round(mastery.coverage * 100)}%`, missing: mastery.coverage == null },
  ];
  if (shaved) {
    inputs.push({ sym: "s_{\\text{att}}", label: `attendance shave (${attendancePct}%)`, value: fmt(sAtt, 3) });
    inputs.push({ sym: "\\text{coverage}\\cdot s_{\\text{att}}", label: "priced (shaved) coverage", value: `${Math.round(coveredShaved * 100)}%` });
  }
  inputs.push(
    { sym: "\\text{predictedPaper}", label: "book's whole-paper call", value: mastery.predictedPaper == null ? "\u2014" : fmt(mastery.predictedPaper, 1), missing: mastery.predictedPaper == null },
    { sym: "\\text{modelMean}", label: "house's own call", value: modelMean == null ? "\u2014" : fmt(modelMean, 1), missing: modelMean == null },
    { sym: "n_{\\text{marked}}", label: "topics with a mark", value: String(nMarked) },
    { sym: "\\text{marks}", label: "total marks folded in", value: String(totalMarks) },
    { sym: "\\sigma_{\\text{uneven}}", label: "unevenness across topics", value: fmt(mastery.unevenness, 2) },
    { sym: "\\pi_{\\text{mastery}}", label: "raw channel read", value: sgn(mastery.term, 2) },
    { sym: "\\varphi_{\\text{mastery}}", label: "share of adj (table column)", value: phi == null ? "\u2014" : fmtShare(phi), missing: phi == null },
  );

  return {
    id: "signal.mastery",
    title: headlineShapley ? "MASTERY \u00b7 SHARE OF THE SHIFT" : "MASTERY \u00b7 MEASURED, NOT SELF-REPORTED",
    symbol: resultSym,
    claim: headlineShapley
      ? "THIS CHANNEL'S SHARE OF THE DESK'S CLAMPED SHIFT \u2014 ITS SHAPLEY VALUE, AVERAGED OVER EVERY ORDER THE CHANNELS COULD HAVE ARRIVED IN. EVERY COLUMN'S SHARE SUMS TO ADJ EXACTLY, CAP BINDING OR NOT."
      : "THE ONE SIGNAL THE ENGINE ACTUALLY MEASURES \u2014 MARKED TOPIC PERFORMANCE, ROLLED UP INTO A WHOLE-PAPER PREDICTION AND PRICED ONLY AS ITS DEVIATION FROM THE HOUSE'S OWN CALL.",
    steps: [
      {
        tex: shaved
          ? `P \\;=\\; \\underbrace{(\\text{coverage}\\cdot s_{\\text{att}})\\,\\bar m^{\\text{eff}}_{\\text{cov}}}_{\\text{measured, shaved}} \\;+\\; \\underbrace{\\big(1-\\text{coverage}\\cdot s_{\\text{att}}\\big)\\cdot\\frac{\\text{modelMean}}{100}}_{\\text{unmeasured \u2014 NEUTRAL}}, \\qquad s_{\\text{att}} \\;=\\; 1-\\frac{95-\\text{att\\%}}{100}\\cdot0.5`
          : `P \\;=\\; \\underbrace{\\textstyle\\sum_{\\text{covered}} w_i\\,m^{\\text{eff}}_i}_{\\text{measured syllabus}} \\;+\\; \\underbrace{(1-\\text{coverage})\\cdot\\frac{\\text{modelMean}}{100}}_{\\text{unmeasured \u2014 NEUTRAL, not zero}}`,
        subst:
          mastery.predictedPaper != null
            ? shaved
              ? `s_{\\text{att}} \\;=\\; ${v(sAtt, 3)} \\;\\Longrightarrow\\; \\text{predictedPaper} \\;=\\; 100P \\;=\\; ${v(mastery.predictedPaper, 1)} \\quad\\text{vs}\\quad \\text{modelMean} \\;=\\; ${modelMean == null ? "\\text{n/a}" : v(modelMean, 1)}`
              : `\\text{predictedPaper} \\;=\\; 100P \\;=\\; ${v(mastery.predictedPaper, 1)} \\quad\\text{vs}\\quad \\text{modelMean} \\;=\\; ${modelMean == null ? "\\text{n/a}" : v(modelMean, 1)}`
            : undefined,
        note: shaved
          ? `THIS DESK'S ATTENDANCE (${attendancePct}%) SITS UNDER 95%, SO THE ATTENDANCE SHAVE IS LIVE: MASS THAT LOOKS COVERED BY WEIGHT BUT WAS UNDER-ATTENDED MOVES BACK TO THE NEUTRAL SIDE \u2014 THE PRICED COVERAGE IS coverage\u00d7s_att, NOT THE RAW coverage ROW ABOVE.`
          : "AN UNTOUCHED TOPIC CARRIES THE MODEL'S OWN CALL, NOT A ZERO \u2014 A THIN BOOK NEVER MANUFACTURES A CHARGE OUT OF SYLLABUS NOBODY HAS TOUCHED YET. AN ATTENDANCE SHAVE (INACTIVE ON THIS DESK \u2014 ATTENDANCE IS AT OR ABOVE 95%) WOULD OTHERWISE MOVE MASS THAT LOOKS COVERED BY WEIGHT BUT WAS UNDER-ATTENDED BACK TO THE NEUTRAL SIDE.",
      },
      {
        tex: `\\pi_{\\text{mastery}} \\;=\\; ${MASTERY_W}\\cdot\\tanh\\!\\left(\\frac{\\text{predictedPaper}-\\text{modelMean}}{${MASTERY_SCALE}}\\right)\\cdot\\min\\!\\left(1,\\frac{\\text{marks}}{6}\\right)`,
        subst: priced
          ? `= ${MASTERY_W}\\cdot\\tanh\\!\\left(\\frac{${v(mastery.predictedPaper as number, 1)} - ${v(modelMean as number, 1)}}{${MASTERY_SCALE}}\\right)\\cdot ${v(satFrac, 2)} \\;=\\; ${v(mastery.term, 2)}`
          : undefined,
        note:
          "SATURATING, LIKE THE STOCK CHANNEL, AND ADDITIONALLY DAMPED BY totalMarks (THE SUM OF PER-TOPIC MARKS FOLDED IN, WHICH CAN COME FROM ONE PAPER MARKED AGAINST SEVERAL TOPICS OR SEVERAL PAPERS AGAINST ONE) \u2014 SIX MARKS FOLDED IN BEFORE THE CHANNEL IS TRUSTED AT FULL WEIGHT.",
      },
      {
        tex: `\\varphi_k \\;=\\; \\sum_{S\\subseteq N\\setminus\\{k\\}} \\frac{|S|!\\,(n-|S|-1)!}{n!}\\Big[v(S\\cup\\{k\\}) - v(S)\\Big], \\qquad v(S) \\;=\\; \\operatorname{clip}_{[-${SIGNAL_ADJ_CAP},\\,${SIGNAL_ADJ_CAP}]}\\!\\Big(\\textstyle\\sum_{j\\in S}\\pi_j\\Big)`,
        subst: phi != null ? `\\varphi_{\\text{mastery}} \\;=\\; ${v(phi, 2)}` : undefined,
        note:
          `THE MASTERY COLUMN IN THE PER-DESK TABLE SHOWS THIS SHARE, NOT THE RAW READ ABOVE \u2014 THEY AGREE EXACTLY UNTIL THE \u00b1${SIGNAL_ADJ_CAP} CLAMP BINDS, AT WHICH POINT THE CAP HAS TO BE SPLIT BETWEEN THE CHANNELS THAT CAUSED IT. EVERY COALITION IS ENUMERATED EXACTLY (2\u2077 = 128 AT SEVEN CHANNELS, NEVER SAMPLED), AND THE EFFICIENCY AXIOM MAKES THE COLUMNS SUM TO ADJ \u2014 WHICH THE DROP-ONE MARGINAL THIS REPLACED COULD NOT DO.`,
      },
    ],
    inputs,
    result: { tex: resultSym, value: resultVal, unit: "PTS" },
    refs: ["shapley1953"],
    gates: [
      { text: "\u2265 30% of the weighted syllabus covered by at least one mark", pass: covered >= 0.3 },
      { text: `\u2265 ${MASTERY_MIN_MARKS} marked topics before the channel is trusted`, pass: nMarked >= MASTERY_MIN_MARKS },
      { text: "the house has its own call to compare against", pass: modelMean != null },
    ],
    related: ["signal.adjust", "signal.stock"],
    source: "src/lib/quant/signals/mastery.ts \u00b7 topicMastery, masteryRead",
  };
}

/* ── the VOI ranking ────────────────────────────────────────────────── */

export function signalVoi(ctx: DeriveCtx): Derivation | null {
  const items = ctx.voi;
  if (!items || !items.length) return null;
  const idx = Number(ctx.key ?? "0");
  const item = Number.isInteger(idx) ? items[idx] : undefined;
  if (!item) return null;
  const denom = 1 + item.effortMin / VOI_EFFORT_SCALE;

  return {
    id: "signal.voi",
    title: `VALUE OF INFORMATION \u00b7 ${item.domain.toUpperCase()}`,
    symbol: "\\text{score}",
    claim:
      "WHAT LOGGING THIS ONE THING WOULD BUY BACK IN FORECAST PRECISION, WEIGHED AGAINST HOW LONG IT TAKES \u2014 A DISPLAY-ONLY HEURISTIC, NEVER A FITTED MODEL TERM.",
    steps: [
      {
        tex: `\\text{score} \\;=\\; \\frac{\\text{gainPts}}{1 + \\text{effortMin}/${VOI_EFFORT_SCALE}}`,
        subst: `\\text{score} \\;=\\; \\frac{${v(item.gainPts, 2)}}{1 + ${v(item.effortMin, 0)}/${VOI_EFFORT_SCALE}} \\;=\\; \\frac{${v(item.gainPts, 2)}}{${v(denom, 3)}} \\;=\\; ${v(item.score, 3)}`,
        note:
          "DIMINISHING RETURNS AS EFFORT GROWS, NOT A LITERAL PER-MINUTE RATE \u2014 A TWO-MINUTE ASK AND A TWENTY-MINUTE ASK OF THE SAME GAIN DO NOT RANK TWENTY-FOLD APART.",
      },
      {
        tex: `\\text{gainPts} \\;\\text{is a conservative, display-facing estimate \u2014 never a fitted coefficient}`,
        note:
          "EVERY GAIN CONSTANT ON THIS PANEL CARRIES ITS OWN CONSERVATISM ARGUMENT IN quant/signals/params.ts RATHER THAN A LITERATURE CITATION \u2014 THE SAME DISPENSATION pool.ts'S OWN DISPLAY-ONLY Z90/SELF_DF CONSTANTS TAKE. NOTHING HERE FEEDS stats.ts, aggregate.ts OR THE REGISTER.",
      },
    ],
    inputs: [
      { sym: "\\text{gainPts}", label: "estimated CI90 tighten", value: `\u00b1${item.gainPts.toFixed(1)}` },
      { sym: "\\text{effortMin}", label: "logging effort", value: `${item.effortMin} min` },
      { sym: "\\text{score}", label: "ranked score", value: fmt(item.score, 3) },
      { sym: "\\text{desk}", label: "which desk", value: item.ticker ?? "book-wide" },
    ],
    result: { tex: "\\text{score}", value: fmt(item.score, 3) },
    related: ["signal.adjust", "signal.stock", "signal.mastery"],
    source: "src/lib/quant/signals/voi.ts \u00b7 valueOfInformation",
  };
}
