import type { AssessmentType, GradeEntry, Settings } from "../types";

/** Effective weight of an assessment type under the current settings. */
export const weightFor = (type: AssessmentType, settings: Settings): number =>
  settings.weighted ? (settings.weights[type] ?? 1) : 1;

export type WeightFn = (e: Pick<GradeEntry, "type">) => number;

export const makeWeightFn = (settings: Settings): WeightFn =>
  (e) => weightFor(e.type, settings);

export function weightedAvg(pairs: { v: number; w: number }[]): number | null {
  let sw = 0, sum = 0;
  for (const p of pairs) { sw += p.w; sum += p.v * p.w; }
  return sw > 0 ? sum / sw : null;
}

/** Weighted mean score of a set of entries, or null when empty/zero-weight. */
export function entriesAvg(entries: GradeEntry[], settings: Settings): number | null {
  return weightedAvg(entries.map((e) => ({ v: e.score, w: weightFor(e.type, settings) })));
}

/**
 * Score needed on the next assessment (of `nextType`) for the weighted term
 * average to land on `wish`. Solves (Σws + wn·x) / (Σw + wn) = wish.
 * May return values below 0 (already locked in) or above 100 (out of reach).
 */
export function neededScore(
  termEntries: GradeEntry[],
  settings: Settings,
  wish: number,
  nextType: AssessmentType,
): number {
  let sw = 0, sws = 0;
  for (const e of termEntries) {
    const w = weightFor(e.type, settings);
    sw += w;
    sws += w * e.score;
  }
  const wn = weightFor(nextType, settings) || 1;
  return (wish * (sw + wn) - sws) / wn;
}
