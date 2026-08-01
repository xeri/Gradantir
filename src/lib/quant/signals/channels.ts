import { clamp } from "../../utils";
import { crpsT } from "../eval/scoring";
import { minimise1d } from "../fit";
import {
  SIGNAL_A_MAX, SIGNAL_A_MIN, SIGNAL_CHANNEL_EPS, SIGNAL_CHANNEL_KAPPA,
  SIGNAL_CHANNEL_MIN_ROUNDS, SIGNAL_CHANNEL_PASSES, SIGNAL_CHANNEL_TOL,
} from "../params";
import { shrinkToward } from "../shrinkage";
import { SIGNAL_TERM_ORDER, type SignalChannelWeights, type SignalTermKey } from "./signalread";
import { roundForecast, type SignalRound } from "./signalskill";

/**
 * channels.ts — per-channel credibility for the life-signals layer (audit
 * Part I §2).
 *
 * Seven signal terms used to share ONE earned weight. A student could not tell
 * whether the mastery channel was carrying the layer while chronotype was
 * noise, and got no benefit if it was. The hand-set constants in ./params.ts
 * stay exactly as they are — they are the PRIOR, the authored claim about how
 * much each mechanism is worth — and what this module adds is measurement:
 *
 *     adj = clamp( Σ_k a_k · pts_k , ±SIGNAL_ADJ_CAP )
 *     a_k = clamp( shrinkToward( ã_k , n_k , 1 , SIGNAL_CHANNEL_KAPPA ), A_MIN, A_MAX )
 *
 * with prior 1: an unmeasured channel pulls exactly the weight it was authored
 * with, and the whole layer on an unscored book is byte-identical to the layer
 * before this module existed.
 *
 * IDENTIFICATION (§2.3) is the part that has to be got right. `w · a_k` is a
 * product and only the product is identified from the data, so fitting both
 * freely would leave the split between them arbitrary and both displayed
 * numbers meaningless. The resolution:
 *
 *   · SHAPE first, at full strength. The fit below searches `a_k` with the
 *     adjustment applied at w = 1, because it is fitting the shape of `adj`,
 *     not its size.
 *   · Then NORMALISE `â_k` to mean exactly 1 over the channels actually
 *     measured. `a_k` now carries only RELATIVE credibility — "MASTERY pulls
 *     1.8× its stated weight, CHRONO pulls 0.3×" — and is directly readable.
 *   · Then SCALE: signalSkill fits `w` on the reshaped `adj`, and absolute
 *     size lives there and only there.
 *
 * OVERFITTING (§2.4): seven parameters on the 6-12 resolved rounds a real book
 * carries would be worthless unshrunk. Three defences, all house style —
 * shrinkage toward the authored prior with its own κ, a minimum round count
 * before a channel is measured at all, and hard clamps on `a_k`.
 *
 * The mean-1 claim holds on `ã`, the normalised fit, and NOT on the shipped
 * `a`: shrinkage pulls each channel toward 1 at its own evidence rate, and
 * seven different `n_k` pull seven different distances. That is the honest
 * behaviour — identification is a statement about what the data can separate,
 * shrinkage is a statement about how much of it to believe — and the tests
 * assert each on the vector it is true of.
 */

export type ChannelVerdict = "CARRIES" | "NEUTRAL" | "COSTS" | "UNMEASURED";

export interface ChannelRow {
  key: SignalTermKey;
  /** Scored rounds in which this channel actually fired. */
  n: number;
  /** The unshrunk, un-normalised minimiser. Null when unmeasured. */
  raw: number | null;
  /** After mean-1 normalisation over measured channels. Null when unmeasured. */
  normalised: number | null;
  /** The shipped multiplier: normalised, shrunk toward 1, clamped. */
  a: number;
  /** Mean CRPS the book would pay to drop this channel entirely. Null when unmeasured. */
  dCrps: number | null;
  verdict: ChannelVerdict;
}

export interface SignalChannelFit {
  /** Every key present — 1 for an unmeasured channel. */
  weights: SignalChannelWeights;
  /** One row per channel, in SIGNAL_TERM_ORDER. */
  rows: ChannelRow[];
  /** Rounds the fit could see — those in which some channel fired. */
  rounds: number;
}

const ONES = (): SignalChannelWeights =>
  Object.fromEntries(SIGNAL_TERM_ORDER.map((k) => [k, 1])) as SignalChannelWeights;

const UNMEASURED_ROWS = (counts?: Map<SignalTermKey, number>): ChannelRow[] =>
  SIGNAL_TERM_ORDER.map((key) => ({
    key, n: counts?.get(key) ?? 0, raw: null, normalised: null, a: 1, dCrps: null, verdict: "UNMEASURED" as const,
  }));

/** `enabled: false` — no channel record is consulted at all. */
export const NO_CHANNEL_FIT: SignalChannelFit = {
  weights: ONES(),
  rows: UNMEASURED_ROWS(),
  rounds: 0,
};

/**
 * Mean CRPS of the replayed rounds at a candidate weight vector, under the
 * SAME arithmetic the board ships (`roundForecast` → `adjOf`). Scoring a blend
 * the board does not apply would silently invalidate the fit, which is §1.4's
 * rule one layer down.
 *
 * `crpsT` rather than `scoreT(...).crps` — the same number, without the nine
 * `tQuantile` bisections per score that coverage and pinball need and a
 * minimiser does not. The coordinate descent below evaluates this a few
 * thousand times per fit and the difference is two orders of magnitude.
 */
function meanCrps(rounds: SignalRound[], weights: SignalChannelWeights): number {
  if (!rounds.length) return 0;
  let total = 0;
  for (const round of rounds) {
    const fc = roundForecast(round, weights);
    total += crpsT({ mean: fc.mean, scale: fc.scale, df: fc.df }, round.realized);
  }
  return total / rounds.length;
}

export function fitSignalChannels(rounds: SignalRound[], enabled: boolean): SignalChannelFit {
  if (!enabled) return NO_CHANNEL_FIT;

  // Only a round some channel actually fired in carries information about the
  // shape of the adjustment. An identity round is not a tie, the same rule
  // signalSkill's own skip applies to the scale fit.
  const scored = rounds.filter((r) => r.rawTerms.length > 0);
  const counts = new Map<SignalTermKey, number>(SIGNAL_TERM_ORDER.map((k) => [k, 0]));
  for (const r of scored) {
    for (const t of r.rawTerms) if (t.pts !== 0) counts.set(t.key, (counts.get(t.key) as number) + 1);
  }

  const measured = SIGNAL_TERM_ORDER.filter((k) => (counts.get(k) as number) >= SIGNAL_CHANNEL_MIN_ROUNDS);
  if (!scored.length || !measured.length) {
    return { weights: ONES(), rows: UNMEASURED_ROWS(counts), rounds: scored.length };
  }

  // ── SHAPE: coordinate descent, each step a bracketed 1-D search ──────────
  const fitted: SignalChannelWeights = ONES();
  for (let pass = 0; pass < SIGNAL_CHANNEL_PASSES; pass++) {
    for (const k of measured) {
      const atPrior = meanCrps(scored, { ...fitted, [k]: 1 });
      const best = minimise1d((x) => meanCrps(scored, { ...fitted, [k]: x }), SIGNAL_A_MIN, SIGNAL_A_MAX);
      // Part II §12.6's rule: an objective that cannot discriminate has no
      // minimiser, and a search over a flat returns an arbitrary point of it.
      // The tie is defined here rather than inherited from wherever the grid
      // happened to land — the channel keeps its authored prior.
      fitted[k] = atPrior - best.fx > SIGNAL_CHANNEL_TOL ? best.x : 1;
    }
  }

  // ── IDENTIFICATION: mean 1 over the measured channels ────────────────────
  const meanFitted = measured.reduce((a, k) => a + (fitted[k] as number), 0) / measured.length;
  const normalised: SignalChannelWeights = ONES();
  if (meanFitted > 0) for (const k of measured) normalised[k] = (fitted[k] as number) / meanFitted;

  // ── CREDIBILITY: shrink each toward the prior at its own evidence rate ───
  const weights = ONES();
  for (const k of measured) {
    const n = counts.get(k) as number;
    weights[k] = clamp(
      shrinkToward(normalised[k] as number, n, 1, SIGNAL_CHANNEL_KAPPA),
      SIGNAL_A_MIN,
      SIGNAL_A_MAX,
    );
  }

  // ── THE SCOREBOARD: what would this book pay to drop each channel? ───────
  const base = meanCrps(scored, weights);
  const rows: ChannelRow[] = SIGNAL_TERM_ORDER.map((key) => {
    const n = counts.get(key) as number;
    if (!measured.includes(key)) {
      return { key, n, raw: null, normalised: null, a: 1, dCrps: null, verdict: "UNMEASURED" as const };
    }
    const dCrps = meanCrps(scored, { ...weights, [key]: 0 }) - base;
    const verdict: ChannelVerdict =
      dCrps > SIGNAL_CHANNEL_EPS ? "CARRIES" : dCrps < -SIGNAL_CHANNEL_EPS ? "COSTS" : "NEUTRAL";
    return {
      key,
      n,
      raw: fitted[key] as number,
      normalised: normalised[key] as number,
      a: weights[key] as number,
      dCrps,
      verdict,
    };
  });

  return { weights, rows, rounds: scored.length };
}
