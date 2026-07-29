import { entryPeriod } from "./periods";
import { DEFAULT_CALENDAR, type SchoolCalendar } from "./calendar";
import type { GradeEntry, GroupPeriod } from "../types";

export interface OhlcRow {
  key: string;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  count: number;
  /** Range fed to the chart's band renderer. */
  range: [number, number];
}

/**
 * Candlestick aggregation for a single subject's entries:
 * open = first result of the period, close = last, high/low = extremes.
 * A one-result period collapses to a doji (open = close = high = low).
 */
export function buildOhlc(
  entries: GradeEntry[],
  mode: GroupPeriod,
  cal: SchoolCalendar = DEFAULT_CALENDAR,
): OhlcRow[] {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const map = new Map<string, { key: string; label: string; scores: number[] }>();
  for (const e of sorted) {
    const { key, label } = entryPeriod(e, mode, cal);
    if (!map.has(key)) map.set(key, { key, label, scores: [] });
    map.get(key)!.scores.push(e.score);
  }
  return [...map.values()]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((r) => {
      const open = r.scores[0];
      const close = r.scores[r.scores.length - 1];
      const high = Math.max(...r.scores);
      const low = Math.min(...r.scores);
      return { key: r.key, label: r.label, open, high, low, close, count: r.scores.length, range: [low, high] as [number, number] };
    });
}
