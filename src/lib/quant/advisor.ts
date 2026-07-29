import { clamp, pDate, round1 } from "../utils";
import { DEFAULT_CALENDAR, sessionDaysBetween, type SchoolCalendar } from "../calendar";
import { detrend } from "./calibration";
import { shrunkSlope, theilSen } from "./robust";
import type { GradeEntry, PriceResult, Signal, Subject } from "../../types";

/**
 * "What should I work on?" — a priority score built from four normalized
 * stress factors: distance under target, downside tail risk, a significant
 * negative trend, and print staleness.
 */

const W_GAP = 0.35;
const W_DOWNSIDE = 0.3;
const W_SLOPE = 0.2;
const W_STALE = 0.15;
const REASON_FLOOR = 0.15;

/** School days of silence charged at nothing, and the span to full urgency. */
export const STALE_FREE_DAYS = 12;
export const STALE_SPAN_DAYS = 30;

const clamp01 = (v: number) => clamp(v, 0, 1);

export function advise(
  inputs: { sub: Subject; quant: PriceResult; entries: GradeEntry[] }[],
  todayIso: string,
  cal: SchoolCalendar = DEFAULT_CALENDAR,
): Signal[] {
  const today = pDate(todayIso).getTime();
  const signals = inputs.map(({ sub, quant, entries }) => {
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const gap = sub.target != null ? round1(sub.target - quant.price) : null;
    // Tail width is a property of the FORECAST, so it is measured from fair
    // value: p10 is drawn around fv, and subtracting it from the marked price
    // would net the risk discount against the tail it already charged for.
    const downside = round1(Math.max(0, quant.fv - quant.p10));
    const pts = detrend(sorted).map(({ entry, adjusted }) => ({
      x: Math.round((pDate(entry.date).getTime() - today) / 86400000),
      y: adjusted,
    }));
    const slope30 = round1(shrunkSlope(theilSen(pts)) * 30);
    // School days, not calendar days: a holiday is not neglect.
    const staleDays = sorted.length
      ? sessionDaysBetween(sorted[sorted.length - 1].date, todayIso, cal)
      : 0;

    const g = gap != null && gap > 0 ? clamp01(gap / 15) : 0;
    const d = clamp01(downside / 12);
    const s = clamp01(-slope30 / 5);
    // Free for a fortnight of teaching, saturating at six weeks of silence —
    // the calendar-day thresholds converted to the session clock.
    const t = clamp01((staleDays - STALE_FREE_DAYS) / STALE_SPAN_DAYS);
    const priority = round1(100 * clamp01(W_GAP * g + W_DOWNSIDE * d + W_SLOPE * s + W_STALE * t));

    const factors: { component: number; weighted: number; text: string }[] = [
      { component: g, weighted: W_GAP * g, text: `${gap?.toFixed(1)} PTS UNDER TARGET` },
      { component: d, weighted: W_DOWNSIDE * d, text: `DOWNSIDE RISK ${downside.toFixed(0)} PTS` },
      { component: s, weighted: W_SLOPE * s, text: `SLIDING ${(-slope30).toFixed(1)} PTS/30D` },
      { component: t, weighted: W_STALE * t, text: `NO PRINTS IN ${staleDays} SESSION DAYS` },
    ];
    const reasons = factors
      .filter((f) => f.component > REASON_FLOOR)
      .sort((a, b) => b.weighted - a.weighted)
      .map((f) => f.text);

    return { id: sub.id, ticker: sub.ticker, priority, reasons, gap, downside, slope30, staleDays };
  });
  return signals.sort((a, b) => b.priority - a.priority || (a.ticker < b.ticker ? -1 : 1));
}
