import type { RestLog, StudySession, SubjectMix } from "../../../types";
import { addDays, pDate, round1 } from "../../utils";
import { ENCODING_PENALTY, QUALITY, SHORT_SLEEP_H, SPACING_RECENT, SPACING_SAME_DAY, SPACING_STALE, STOCK_FLOOR, STOCK_W, halfLifeOf } from "./params";

/**
 * The effective-study-stock read (D5's "hours logged" channel): how much
 * quality-weighted, spacing-and-encoding-adjusted study a desk has actually
 * banked lately, and whether that trailing stock is running hot or cold
 * against its own baseline rate. Pure and clock-free — `asOf` is always
 * passed in, never read off a live clock.
 *
 * k14 is a DECAYED stock: each session's contribution fades from the day it
 * was logged toward asOf, half-life set by the subject's own knowledge/
 * procedure/skill mix. baseline is the per-day rate over whatever of the
 * 14-55d-prior window history actually COVERS — never assumed to be the
 * full 42 days, since days before the student's first log are UNKNOWN, not
 * zero (`covered = clamp(spanDays - 13, 1, 42)`, not a flat 42) — projected
 * into those same decayed-14-day-window units, multiplied by D(H) =
 * Σ_{d=0}^{13} exp(−ln2·d/H), the exact weight a steady daily habit would
 * carry inside the k14 window at that half-life, not a flat ×14. A flat ×14
 * (or a flat ÷42 on a partially-covered window) would compare a decayed
 * number against an undecayed — or diluted — one and read every desk as
 * running cold (or spuriously hot) under a perfectly steady habit; dividing
 * by the window's own actual coverage and projecting through the same decay
 * kernel makes k14 ≈ baseline — and term ≈ 0 — at steady state, for ANY
 * half-life AND any history span past the 28d gate. See stock.test.ts's
 * deviation-property tests: one parameterised across the knowledge/default/
 * skill half-lives, one across a span sweep (28/35/42/49/56d) pinning the
 * partial-coverage case.
 */

export interface StockRead {
  /** Effective minutes, decayed, trailing 14 days ending asOf. */
  k14: number;
  /**
   * Per-day mean over days 15-56 before asOf, projected into the same
   * decayed-14-day-window units as k14 (×D(H), not a flat ×14); null when
   * unmeasurable.
   */
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

/**
 * D(H) = Σ_{d=0}^{13} exp(−ln2·d/H): the exact decayed-window weight a
 * steady one-unit-per-day habit would carry inside the k14 window at half-
 * life H. Projects the (undecayed) baseline per-day rate into k14's own
 * units so the two are directly comparable — see the module doc comment.
 */
const decayWindowWeight = (H: number): number => {
  let s = 0;
  for (let d = 0; d < 14; d++) s += Math.exp((-Math.LN2 * d) / H);
  return s;
};

const IDENTITY: StockRead = { k14: 0, baseline: null, term: 0, recallRatio: null, hoursPerWeek: null };

/**
 * M5 (audit Part I §4). The nights this module's ENCODING_PENALTY actually
 * docked: a night under SHORT_SLEEP_H that was followed, the next day, by at
 * least one logged study session. `rest.ts`'s chronic term excludes these from
 * its recent-window mean, so a single bad night is charged ONCE —
 * mechanistically, against the specific session it degraded — rather than
 * twice, once here inside k14 and again as a baseline shift.
 *
 * Takes the WHOLE book's sessions, not one desk's: the penalty fires on any
 * subject's session the morning after, while `rest` is person-level.
 *
 * Returns rest-row DATES. Per RestLog's own convention the night dated D ends
 * on the morning of D+1, so the night that impaired study-day D is dated D−1 —
 * the same lookup `studyStock` below and `rest.ts`'s acuteTerm both use.
 */
export function encodingChargedNights(sessions: StudySession[], rest: RestLog[]): ReadonlySet<string> {
  const studyDays = new Set(sessions.map((s) => s.date));
  const out = new Set<string>();
  for (const r of rest) {
    if (r.hours < SHORT_SLEEP_H && studyDays.has(addDays(r.date, 1))) out.add(r.date);
  }
  return out;
}

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
    // RestLog's own convention (types.ts, rest.ts's module doc comment): a
    // night dated D is the night ENDING the morning of D+1. The night that
    // impaired encoding on study-day D is therefore logged under D-1, the
    // exact lookup rest.ts's own acuteTerm uses for "the night before an
    // exam" (`examDate - 1`) — never `s.date` itself.
    const night = rest.find((r) => r.date === addDays(s.date, -1));
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
  // A1 fix: `baselineSum` only accumulates over days PRESENT in [14,55] — days
  // before the student's first log are UNKNOWN, not zero. Dividing by a flat
  // 42 regardless of how much of that window history actually reaches
  // dilutes the per-day rate whenever spanDays sits between the 28d gate and
  // full 56d+ coverage, reading k14 as running spuriously hot under a
  // perfectly steady habit. `covered` is the number of days the window
  // ACTUALLY spans (spanDays-13, clamped to [1,42]) — at spanDays=28,
  // covered=15=baselineCount, so baseline lands exactly on k14's own rate.
  const covered = Math.min(42, Math.max(1, spanDays - 13));
  const baseline = spanDays >= 28 && baselineCount >= 3 ? (baselineSum / covered) * decayWindowWeight(H) : null;

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
