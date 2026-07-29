import type { MeanCall } from "../types";

/**
 * Aggregate elicitation (D4). The student predicts the overall exam average and
 * forces a strongest→weakest ranking — cheaper and better-calibrated than six
 * independent point forecasts, and pitched at the level where the engine has
 * real skill. Scored on the average's error and the ranking's rank correlation
 * once the round's marks land.
 */

/** Ranks of `order`'s items by their position, keyed by id. 1 = first. */
const positions = (order: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  order.forEach((id, i) => { if (!m.has(id)) m.set(id, i + 1); });
  return m;
};

/**
 * Spearman rank correlation between two orderings, over the items they share.
 * +1 identical, −1 reversed; null when fewer than two items are common.
 */
export function spearman(a: string[], b: string[]): number | null {
  const inB = new Set(b);
  const shared = a.filter((id) => inB.has(id));
  const n = shared.length;
  if (n < 2) return null;
  // Re-rank within the shared set so gaps from unshared items don't distort d².
  const inShared = new Set(shared);
  const rankIn = (order: string[]) => positions(order.filter((id) => inShared.has(id)));
  const ra = rankIn(a), rb = rankIn(b);
  let d2 = 0;
  for (const id of shared) { const d = ra.get(id)! - rb.get(id)!; d2 += d * d; }
  return 1 - (6 * d2) / (n * (n * n - 1));
}

export interface MeanCallScore {
  predAvg: number;
  realizedAvg: number | null;
  /** predAvg − realizedAvg. */
  error: number | null;
  absError: number | null;
  /** Spearman ρ of the forced ranking vs the realized order. */
  rankCorr: number | null;
}

/**
 * Score one aggregate call against the realized marks (subject id → score) for
 * the round's desks. Only ranked desks with a realized mark are used, so a
 * half-landed round scores on what it can.
 */
export function scoreMeanCall(call: MeanCall, realizedById: Record<string, number>): MeanCallScore {
  const have = call.ranking.filter((id) => realizedById[id] != null);
  if (!have.length) {
    return { predAvg: call.predAvg, realizedAvg: null, error: null, absError: null, rankCorr: null };
  }
  const realizedAvg = have.reduce((a, id) => a + realizedById[id], 0) / have.length;
  const error = call.predAvg - realizedAvg;
  const realizedOrder = [...have].sort((a, b) => realizedById[b] - realizedById[a]);
  return {
    predAvg: call.predAvg,
    realizedAvg,
    error,
    absError: Math.abs(error),
    rankCorr: spearman(call.ranking, realizedOrder),
  };
}
