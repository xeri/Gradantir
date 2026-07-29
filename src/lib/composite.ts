import { avg, round1 } from "./utils";
import type { ChartRow } from "./grouping";

/**
 * The chart-row composite overlay: the raw equal-weight average of the scores
 * actually plotted on a row. The headline index is elsewhere — GX COMPOSITE is
 * the model price index (`quant/aggregate.ts`); this is the honest raw line
 * drawn over the board.
 */

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
