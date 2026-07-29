/**
 * The derivation layer's data model.
 *
 * A Derivation is a research note about ONE number the engine generated: the
 * equation as the paper writes it, the same equation with this desk's live
 * values substituted, the gates that had to pass for it to be defined, and the
 * literature the method comes from. Nothing here renders — this module is pure
 * data, built lazily on hover, and every field is a string the UI drops into
 * KaTeX or into terminal chrome.
 *
 * The load-bearing invariant: `result.value` MUST equal the number the
 * interface displays for the same figure. A derivation that disagrees with its
 * own output is worse than no derivation at all, and `derive/reconcile.test.ts`
 * asserts it across the real book.
 */

import type { CiteKey } from "./cite";

/** Terminal amber — live values burn out of the dim serif math in this color. */
export const VAL_COLOR = "#E8A33D";

/**
 * Wrap a live value for substitution into a formula. Everything the desk
 * actually contributed is amber; the surrounding algebra stays dim, so a
 * substituted line reads as "the paper, with your numbers in it".
 */
export const v = (x: number | string, dp = 2): string =>
  `\\textcolor{${VAL_COLOR}}{${typeof x === "number" ? fmt(x, dp) : x}}`;

/** Fixed-decimal without a trailing "-0.00", which reads as a bug. */
export function fmt(x: number, dp = 2): string {
  if (!Number.isFinite(x)) return "\\text{n/a}";
  const s = x.toFixed(dp);
  return s === "-" + (0).toFixed(dp) ? (0).toFixed(dp) : s;
}

/** Signed, for deltas and slopes where the sign carries the meaning. */
export const sgn = (x: number, dp = 2): string => (x >= 0 ? "+" : "") + fmt(x, dp);

export interface DerivationStep {
  /** The general form, LaTeX. How the paper writes it. */
  tex: string;
  /** The same expression with this desk's values substituted, LaTeX. */
  subst?: string;
  /** One line of terminal prose under the math — uppercase, terse. */
  note?: string;
}

/** A named quantity that fed the formula, for the inputs table. */
export interface DerivationInput {
  /** LaTeX symbol as it appears in the steps. */
  sym: string;
  label: string;
  value: string;
  /** Null inputs are rendered struck-through: the factor declined to report. */
  missing?: boolean;
}

/** A precondition, and whether this desk met it. */
export interface DerivationGate {
  text: string;
  pass: boolean;
}

export interface Derivation {
  /** Registry key, e.g. "mark.discount". Namespaced by engine module. */
  id: string;
  /** Terminal header, uppercase. */
  title: string;
  /** The symbol being derived, LaTeX. */
  symbol: string;
  /** The one-line claim — what this number asserts, in plain terms. */
  claim: string;
  steps: DerivationStep[];
  inputs: DerivationInput[];
  /** The output, formatted exactly as the interface displays it. */
  result: { tex: string; value: string; unit?: string };
  gates?: DerivationGate[];
  refs?: CiteKey[];
  /** Drill-down chips: sibling derivations, swapped into the panel in place. */
  related?: string[];
  /** Where it is computed: "src/lib/quant/mark.ts · markDesk". */
  source: string;
}

/**
 * Everything a derivation may need. Assembled once by the view layer and
 * passed down; builders take what they need and ignore the rest. `stat` is the
 * desk under the cursor — book-level derivations read `stats` instead.
 */
export interface DeriveCtx {
  stat?: import("../../types").SubjectStat;
  stats?: import("../../types").SubjectStat[];
  index?: import("../../types").CompositeIndex | null;
  aggregate?: import("../../types").ExamAggregate | null;
  forecast?: import("../../types").AggregateForecast | null;
  depthModel?: import("../../types").DepthModel | null;
  signal?: import("../../types").Signal | null;
  /** The whole advisory board; a builder picks its own desk out of it. */
  signals?: import("../../types").Signal[];
  settings?: import("../../types").Settings;
  /**
   * The credibility pool (§27) as it stands, and the call each desk has staked
   * on its next paper — so the oracle's derivation shows the pooled figure the
   * board is actually drawing rather than the desk's own arithmetic, which now
   * stops one step short. Book-level, keyed by subject id, so a view cloning
   * this context with its own `stat` carries them for free. Absent ⇒ the desk's
   * call IS the forecast and the step is skipped.
   */
  selfPool?: import("../quant/pool").SelfWeightModel | null;
  selfStakes?: Record<string, import("../../types").SelfPrediction>;
  /**
   * The scorecard's and the chart board's own traces (see `facts.ts`). These
   * boards assemble their figures from several engines at once and have no
   * `trace.ts` of their own, so the view hands down what it computed rather
   * than letting a builder recompute — and drift from — the number on screen.
   */
  card?: import("./facts").ScorecardFacts;
  chart?: import("./facts").ChartFacts;
  /** Which premium line / analyst / ladder rung the cursor is on. */
  key?: string;
}

/** A builder returns null when this desk cannot support the derivation. */
export type DerivationBuilder = (ctx: DeriveCtx) => Derivation | null;
