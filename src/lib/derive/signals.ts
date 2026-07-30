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
 * clamp is actually binding, rather than implying an additivity the engine
 * does not have.
 */

import { creditSteps } from "./earned";
import { fmt, sgn, v, type Derivation, type DeriveCtx } from "./types";
import { SIGNAL_CAP, SIGNAL_KAPPA, SIGNAL_PRIOR } from "../quant/params";
import {
  MASTERY_MIN_MARKS, MASTERY_SCALE, MASTERY_W, SIGNAL_ADJ_CAP, STOCK_FLOOR, STOCK_W, VOI_EFFORT_SCALE, halfLifeOf,
} from "../quant/signals/params";

/** Mirrors `views/signals/index.tsx`'s own `fmtPts` exactly, so a derivation's
 *  result reads byte-identical to the per-desk table cell it underlines. */
const ZERO_EPS = 0.005;
const fmtPts = (x: number): string => (Math.abs(x) < ZERO_EPS ? "0.00" : `${x > 0 ? "+" : ""}${x.toFixed(2)}`);

/* ── §D5 · the combined shift ───────────────────────────────────────── */

export function signalAdjust(ctx: DeriveCtx): Derivation | null {
  const s = ctx.stat;
  const fit = ctx.signalFit;
  const read = s && ctx.signalReads ? ctx.signalReads.get(s.sub.id) ?? null : null;
  if (!s || !read || !fit) return null;
  const on = ctx.settings?.signalWeighting !== false;

  const shownSum = read.terms.reduce((a, t) => a + t.pts, 0);
  const clampBinds = Math.abs(shownSum) > SIGNAL_ADJ_CAP + 0.005;
  const rows = read.terms.length
    ? read.terms.map((t) => `\\text{${t.key.toUpperCase()}} & ${sgn(t.pts, 2)} \\\\`).join(" ")
    : `\\text{(no term clears the 0.05pt floor)} & ${fmt(0, 2)} \\\\`;
  const wAdj = fit.w * read.adj;

  return {
    id: "signal.adjust",
    title: "LIFE SIGNALS · TERMS \u2192 W\u00b7ADJ",
    symbol: "w\\cdot\\text{adj}",
    claim:
      "WHAT YOUR LOGGED STATE IS WORTH ON THE HOUSE'S OWN NEXT-EXAM MEAN, ONCE THE CHANNEL HAS EARNED THE RIGHT TO MOVE IT.",
    steps: [
      {
        tex: `\\begin{array}{lr} \\textbf{term} & \\text{pts} \\\\ \\hline ${rows} \\end{array}`,
        note:
          "EACH TERM IS A DEVIATION FROM THIS DESK'S OWN TRAILING NORM, NEVER A LEVEL — A CONSTANT HABIT (SAME HOURS, SAME SLEEP, SAME EVERY WEEK) PRICES EVERY CHANNEL TO ZERO. THE LAYER PAYS FOR CHANGE, NOT FOR THE HABIT ITSELF.",
      },
      {
        tex: `\\text{adj} \\;=\\; \\operatorname{clip}_{[-${SIGNAL_ADJ_CAP},\\,${SIGNAL_ADJ_CAP}]}\\!\\Big(\\textstyle\\sum_k \\pi_k\\Big)`,
        subst: `\\textstyle\\sum_k \\pi_k \\;=\\; ${v(shownSum, 2)} \\;\\Longrightarrow\\; \\operatorname{clip}(${v(shownSum, 2)}) \\;=\\; ${v(read.adj, 2)}`,
        note: clampBinds
          ? "THE CLAMP IS BINDING HERE. ONCE TWO OR MORE TERMS JOINTLY REACH IT, THE ROW ABOVE NO LONGER SUMS TO ADJ — EACH TERM IS STILL AN HONEST READ ON ITS OWN, BUT THE CLAMPED TOTAL IS NOT THEIR PLAIN SUM. (THE PER-DESK TABLE'S OWN MARGINAL COLUMN DIFFERS AGAIN — IT IS adj(FULL) \u2212 adj(DROPPED), NOT THE RAW TERM ABOVE.)"
          : "TERMS UNDER THE 0.05PT DISPLAY FLOOR ARE OMITTED ABOVE BUT STILL COUNTED INTO THE SUM THE CLAMP ACTS ON.",
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
      { sym: "\\textstyle\\sum_k\\pi_k", label: "raw term sum", value: sgn(shownSum, 2) },
      { sym: "\\text{adj}", label: "clamped shift", value: sgn(read.adj, 2) },
      { sym: "w", label: "earned weight", value: `${Math.round(fit.w * 100)}%` },
      { sym: "w\\cdot\\text{adj}", label: "applied shift", value: fmtPts(wAdj) },
      { sym: "\\text{sdMult}", label: "band multiplier", value: fmt(read.sdMult, 2) },
      { sym: "n", label: "terms clearing the floor", value: String(read.terms.length) },
    ],
    result: { tex: "w\\cdot\\text{adj}", value: fmtPts(wAdj), unit: "PTS" },
    gates: [
      { text: "the channel is switched on", pass: on },
      { text: `clamped within \u00b1${SIGNAL_ADJ_CAP} pts`, pass: Math.abs(read.adj) <= SIGNAL_ADJ_CAP },
      { text: `capped under ${Math.round(SIGNAL_CAP * 100)}%`, pass: fit.w <= SIGNAL_CAP },
    ],
    refs: ["buhlmann1967"],
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

  return {
    id: "signal.stock",
    title: "STUDY STOCK \u00b7 14D VS OWN NORM",
    symbol: "\\pi_{\\text{stock}}",
    claim:
      "HOW MUCH QUALITY-WEIGHTED STUDY YOU HAVE ACTUALLY BANKED LATELY, AGAINST YOUR OWN TRAILING RATE \u2014 NEVER AGAINST ANOTHER DESK.",
    steps: [
      {
        tex: `k_{14} \\;=\\; \\sum_i \\text{minutes}_i\\cdot Q(\\text{kind}_i)\\cdot\\text{spacing}_i\\cdot\\text{encoding}_i\\cdot e^{-\\ln 2\\,\\Delta_i / H}`,
        note: `EVERY SESSION IS QUALITY-WEIGHTED (RECALL AT 2.0\u00d7, READING AT 0.8\u00d7), SPACED (A REPEAT 1-7D LATER EARNS A SMALL BUMP) AND DOCKED WHEN THE NIGHT BEFORE RAN SHORT \u2014 THEN DECAYED TO asOf ON A HALF-LIFE H = ${fmt(H, 0)}D SET BY THIS SUBJECT'S OWN KNOWLEDGE/PROCEDURE/SKILL MIX.`,
      },
      {
        tex: `\\text{baseline} \\;=\\; \\frac{1}{42}\\Big(\\textstyle\\sum_{15\\le\\Delta\\le56} \\text{effMin}\\Big)\\cdot D(H), \\qquad D(H) \\;=\\; \\textstyle\\sum_{d=0}^{13} e^{-\\ln2\\,d/H}`,
        subst:
          stock.baseline == null
            ? undefined
            : `\\text{baseline} \\;=\\; ${v(stock.baseline, 1)}\\;\\text{min (same decayed units as }k_{14}\\text{)}`,
        note:
          "THE 42-DAY-PRIOR RATE, PROJECTED THROUGH THE SAME DECAY KERNEL AS k\u2081\u2084 \u2014 NOT A FLAT \u00d714 \u2014 SO A PERFECTLY STEADY HABIT READS k\u2081\u2084 \u2248 BASELINE AND TERM \u2248 0 AT ANY HALF-LIFE, RATHER THAN LOOKING COLD BY CONSTRUCTION.",
      },
      {
        tex: `\\pi_{\\text{stock}} \\;=\\; ${STOCK_W}\\cdot\\tanh\\!\\left(\\frac{k_{14}-\\text{baseline}}{\\max(\\text{baseline},\\,${STOCK_FLOOR})}\\right)`,
        subst:
          stock.baseline == null || denom == null
            ? undefined
            : `= ${STOCK_W}\\cdot\\tanh\\!\\left(\\frac{${v(stock.k14, 1)} - ${v(stock.baseline, 1)}}{${v(denom, 0)}}\\right) \\;=\\; ${v(stock.term, 2)}`,
        note:
          "A SATURATING (tanh) READ: RUNNING TWICE YOUR OWN NORM IS NOT WORTH TWICE THE CREDIT, AND THE FLOOR IN THE DENOMINATOR KEEPS A NEAR-ZERO BASELINE FROM BLOWING THE RATIO UP ON A THIN WEEK. (THE STOCK COLUMN IN THE PER-DESK TABLE SHOWS THIS TERM'S MARGINAL CONTRIBUTION TO ADJ, WHICH CAN DIFFER FROM THIS RAW READ ONCE THE \u00b1${SIGNAL_ADJ_CAP} CLAMP BINDS.)",
      },
    ],
    inputs: [
      { sym: "k_{14}", label: "trailing 14d stock", value: fmt(stock.k14, 1) },
      { sym: "\\text{baseline}", label: "42d-prior rate", value: stock.baseline == null ? "\u2014" : fmt(stock.baseline, 1), missing: stock.baseline == null },
      { sym: "H", label: "mix half-life", value: `${fmt(H, 0)}d` },
      { sym: "\\text{recall}", label: "share active-recall", value: stock.recallRatio == null ? "\u2014" : `${Math.round(stock.recallRatio * 100)}%`, missing: stock.recallRatio == null },
      { sym: "h/\\text{wk}", label: "raw hours/wk", value: stock.hoursPerWeek == null ? "\u2014" : `${fmt(stock.hoursPerWeek, 1)}h`, missing: stock.hoursPerWeek == null },
    ],
    result: { tex: "\\pi_{\\text{stock}}", value: sgn(stock.term, 2), unit: "PTS" },
    gates: [{ text: "\u2265 28 days of history and \u2265 3 sessions in the 15-56d baseline window", pass: stock.baseline != null }],
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
  const covered = mastery.coverage ?? 0;
  const priced = modelMean != null && mastery.predictedPaper != null && covered >= 0.3 && nMarked >= MASTERY_MIN_MARKS;

  return {
    id: "signal.mastery",
    title: "MASTERY \u00b7 MEASURED, NOT SELF-REPORTED",
    symbol: "\\pi_{\\text{mastery}}",
    claim:
      "THE ONE SIGNAL THE ENGINE ACTUALLY MEASURES \u2014 MARKED TOPIC PERFORMANCE, ROLLED UP INTO A WHOLE-PAPER PREDICTION AND PRICED ONLY AS ITS DEVIATION FROM THE HOUSE'S OWN CALL.",
    steps: [
      {
        tex: `P \\;=\\; \\underbrace{\\textstyle\\sum_{\\text{covered}} w_i\\,m^{\\text{eff}}_i}_{\\text{measured syllabus}} \\;+\\; \\underbrace{(1-\\text{coverage})\\cdot\\frac{\\text{modelMean}}{100}}_{\\text{unmeasured \u2014 NEUTRAL, not zero}}`,
        subst:
          mastery.predictedPaper != null
            ? `\\text{predictedPaper} \\;=\\; 100P \\;=\\; ${v(mastery.predictedPaper, 1)} \\quad\\text{vs}\\quad \\text{modelMean} \\;=\\; ${modelMean == null ? "\\text{n/a}" : v(modelMean, 1)}`
            : undefined,
        note:
          "AN UNTOUCHED TOPIC CARRIES THE MODEL'S OWN CALL, NOT A ZERO \u2014 A THIN BOOK NEVER MANUFACTURES A CHARGE OUT OF SYLLABUS NOBODY HAS TOUCHED YET. AN ATTENDANCE SHAVE MOVES MASS THAT LOOKS COVERED BY WEIGHT BUT WAS UNDER-ATTENDED BACK TO THE NEUTRAL SIDE.",
      },
      {
        tex: `\\pi_{\\text{mastery}} \\;=\\; ${MASTERY_W}\\cdot\\tanh\\!\\left(\\frac{\\text{predictedPaper}-\\text{modelMean}}{${MASTERY_SCALE}}\\right)\\cdot\\min\\!\\left(1,\\frac{\\text{marks}}{6}\\right)`,
        subst: priced
          ? `= ${MASTERY_W}\\cdot\\tanh\\!\\left(\\frac{${v(mastery.predictedPaper as number, 1)} - ${v(modelMean as number, 1)}}{${MASTERY_SCALE}}\\right)\\cdot ${v(satFrac, 2)} \\;=\\; ${v(mastery.term, 2)}`
          : undefined,
        note:
          "SATURATING, LIKE THE STOCK CHANNEL, AND ADDITIONALLY DAMPED BY HOW MANY MARKS ACTUALLY SUPPORT IT \u2014 SIX MARKED PAPERS BEFORE THE CHANNEL IS TRUSTED AT FULL WEIGHT.",
      },
    ],
    inputs: [
      { sym: "\\text{coverage}", label: "weighted syllabus marked", value: mastery.coverage == null ? "\u2014" : `${Math.round(mastery.coverage * 100)}%`, missing: mastery.coverage == null },
      { sym: "\\text{predictedPaper}", label: "book's whole-paper call", value: mastery.predictedPaper == null ? "\u2014" : fmt(mastery.predictedPaper, 1), missing: mastery.predictedPaper == null },
      { sym: "\\text{modelMean}", label: "house's own call", value: modelMean == null ? "\u2014" : fmt(modelMean, 1), missing: modelMean == null },
      { sym: "n_{\\text{marked}}", label: "topics with a mark", value: String(nMarked) },
      { sym: "\\text{marks}", label: "total marks folded in", value: String(totalMarks) },
      { sym: "\\sigma_{\\text{uneven}}", label: "unevenness across topics", value: fmt(mastery.unevenness, 2) },
    ],
    result: { tex: "\\pi_{\\text{mastery}}", value: sgn(mastery.term, 2), unit: "PTS" },
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
