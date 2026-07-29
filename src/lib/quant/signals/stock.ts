import type { RestLog, StudySession, SubjectMix } from "../../../types";
import { pDate, round1 } from "../../utils";
import { ENCODING_PENALTY, QUALITY, SHORT_SLEEP_H, SPACING_RECENT, SPACING_SAME_DAY, SPACING_STALE, STOCK_FLOOR, STOCK_W, halfLifeOf } from "./params";

/**
 * The effective-study-stock read (D5's "hours logged" channel): how much
 * quality-weighted, spacing-and-encoding-adjusted study a desk has actually
 * banked lately, and whether that trailing stock is running hot or cold
 * against its own baseline rate. Pure and clock-free — `asOf` is always
 * passed in, never read off a live clock.
 *
 * k14 is a DECAYED stock (each session's contribution fades from the day it
 * was logged toward asOf, half-life set by the subject's own knowledge/
 * procedure/skill mix). baseline is deliberately UNDECAYED — a flat per-day
 * rate over the 42 days before that, scaled to the same 14-day units — so
 * constant logging does not price as an exact identity: decay tilts k14
 * slightly below a truly flat baseline, and that tilt is itself the honest
 * signal that "banked stock fades" even when the logging habit has not
 * changed. See stock.test.ts's deviation-property test for the bound.
 */

export interface StockRead {
  /** Effective minutes, decayed, trailing 14 days ending asOf. */
  k14: number;
  /** Per-day mean over days 15-56 before asOf, undecayed, ×14; null when unmeasurable. */
  baseline: number | null;
  /** The priced deviation term, points. */
  term: number;
  /** Share of trailing-56d effective minutes from kind "recall"; null when no sessions in window. */
  recallRatio: number | null;
  /** Raw (unweighted) minutes/60/8 over trailing 56d; null when no sessions in window. */
  hoursPerWeek: number | null;
}

const DAY_MS = 86400000;
const daysBetween = (from: string, to: string): number => Math.round((pDate(to).getTime() - pDate(from).getTime()) / DAY_MS);
const round2 = (v: number) => Math.round(v * 100) / 100;

const IDENTITY: StockRead = { k14: 0, baseline: null, term: 0, recallRatio: null, hoursPerWeek: null };

export function studyStock(
  sessions: StudySession[],
  rest: RestLog[],
  mix: SubjectMix | null,
  asOf: string,
): StockRead {
  const live = sessions.filter((s) => s.date <= asOf);
  if (!live.length) return IDENTITY;

  const sorted = [...live].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const H = halfLifeOf(mix);

  const rows = sorted.map((s, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const gap = prev ? daysBetween(prev.date, s.date) : null;
    const spacingMult = gap == null || gap > 7 ? SPACING_STALE : gap === 0 ? SPACING_SAME_DAY : SPACING_RECENT;
    const night = rest.find((r) => r.date === s.date);
    const encodingMult = night && night.hours < SHORT_SLEEP_H ? ENCODING_PENALTY : 1;
    const effMin = s.minutes * QUALITY[s.kind] * spacingMult * encodingMult;
    const delta = daysBetween(s.date, asOf);
    return { effMin, delta, kind: s.kind, minutes: s.minutes };
  });

  let k14 = 0;
  for (const r of rows) {
    if (r.delta >= 0 && r.delta <= 13) k14 += r.effMin * Math.exp((-Math.LN2 * r.delta) / H);
  }

  let baselineSum = 0;
  let baselineCount = 0;
  for (const r of rows) {
    if (r.delta >= 14 && r.delta <= 55) {
      baselineSum += r.effMin;
      baselineCount++;
    }
  }
  const spanDays = daysBetween(sorted[0].date, asOf);
  const baseline = spanDays >= 28 && baselineCount >= 3 ? (baselineSum / 42) * 14 : null;

  const term = baseline == null ? 0 : STOCK_W * Math.tanh((k14 - baseline) / Math.max(baseline, STOCK_FLOOR));

  let recallEff = 0;
  let totalEff = 0;
  let rawMinutes = 0;
  let windowCount = 0;
  for (const r of rows) {
    if (r.delta >= 0 && r.delta <= 55) {
      windowCount++;
      totalEff += r.effMin;
      rawMinutes += r.minutes;
      if (r.kind === "recall") recallEff += r.effMin;
    }
  }

  return {
    k14: round1(k14),
    baseline: baseline == null ? null : round1(baseline),
    term: round2(term),
    recallRatio: windowCount ? round1(recallEff / totalEff) : null,
    hoursPerWeek: windowCount ? round1(rawMinutes / 60 / 8) : null,
  };
}
