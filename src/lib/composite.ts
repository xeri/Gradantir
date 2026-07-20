import { avg, round1 } from "./utils";
import type { ChartRow } from "./grouping";
import type { CompositeIndex, SubjectStat } from "../types";

/** Equal-weight mean of the subject values present on one chart row. */
export function rowComposite(row: ChartRow, subjectIds: string[]): number | null {
  const vals: number[] = [];
  for (const sid of subjectIds) {
    const v = row[sid];
    if (typeof v === "number") vals.push(v);
  }
  return vals.length ? round1(avg(vals)) : null;
}

export const COMP_KEY = "__comp";

/** Adds a `__comp` composite series to grouped rows in place (skips forecast-only rows). */
export function addComposite(rows: ChartRow[], subjectIds: string[]): void {
  for (const row of rows) {
    const v = rowComposite(row, subjectIds);
    if (v != null) row[COMP_KEY] = v;
  }
}

/**
 * The headline index: mean of each subject's current-term average
 * (falling back to its overall average), with delta vs last term.
 */
export function compositeNow(stats: SubjectStat[]): CompositeIndex {
  const curVals = stats.map((s) => s.curAvg ?? s.overallAvg).filter((v): v is number => v != null);
  const prevVals = stats.map((s) => s.prevAvg).filter((v): v is number => v != null);
  const value = curVals.length ? round1(avg(curVals)) : null;
  const prev = prevVals.length ? round1(avg(prevVals)) : null;
  return { value, delta: value != null && prev != null ? round1(value - prev) : null };
}
