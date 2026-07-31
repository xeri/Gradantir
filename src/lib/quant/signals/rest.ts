import type { RestLog } from "../../../types";
import { pDate, round1 } from "../../utils";
import {
  REST_ACUTE_CAP,
  REST_ACUTE_W,
  REST_CHRONIC_CAP,
  REST_CHRONIC_MAX_LOSS_H,
  REST_CHRONIC_W,
  REST_MIN_NIGHTS,
  REST_REG_FREE_SD_MIN,
  REST_REG_SPAN_MIN,
  REST_REG_W,
  SHORT_SLEEP_H,
} from "./params";

/**
 * The rest read (D5's "sleep" channel): a self-report, not a measurement, so
 * it is priced conservatively and on a narrow doctrine — DETERIORATION ONLY.
 * chronicTerm fires on recent-vs-own-56-day-baseline WORSENING, never on an
 * absolute deficit: a desk that has always run a steady 6h a night prices at
 * zero on chronic, same as a desk that has always run 9h — only a desk that
 * USED to sleep more and has slipped gets charged. The reasoning is that an
 * habitual short sleeper's own outcome history already reflects whatever
 * short sleep costs them; charging the absolute level again would double-
 * count it. (The absolute deficit is still worth SHOWING the user — mean14
 * is exposed on the read for display/VOI — it is simply never priced.)
 *
 * M5 (audit Part I §4): the chronic term is also DISJOINT from stock.ts's
 * encoding penalty. A night that already docked a study session through
 * ENCODING_PENALTY is dropped from the recent window before the baseline
 * comparison (`chronicMean14`, not `mean14`), so a student who studies every
 * day they sleep badly is charged once — mechanistically, inside k14 — and a
 * student whose sleep slipped on nights they were NOT studying is charged
 * once, as a baseline shift. Neither is charged twice. The caller supplies the
 * charged set; `encodingChargedNights` in stock.ts computes it from the whole
 * book's sessions, since rest is person-level and the penalty fires on any
 * subject's session the morning after.
 *
 * Two conventions this file owns and must not silently redefine elsewhere:
 *
 * 1. Bedtime midnight unwrap (regSd): a "HH:MM" clock time read literally
 *    puts 23:40 and 00:20 nearly 24h apart, when the two bedtimes are really
 *    40 minutes apart. Any bedtime before noon (< 12:00) is treated as a
 *    post-midnight bedtime and shifted +24h, landing the whole set on one
 *    continuous late-evening-through-early-morning scale before the stdev
 *    is taken.
 *
 * 2. Night-before-exam row lookup (acuteTerm): per RestLog's own doc
 *    comment, `date` is the night a reading is FOR — the night ending the
 *    morning of `date + 1`. So "the night before an exam sat on examDate" is
 *    logged under `examDate - 1 day`, not under examDate itself.
 *
 * 3. ONE definition of a short night (E1, audit Part I §4). The acute term
 *    used to gate on a hardcoded 6.5h while stock.ts's encoding penalty gated
 *    on SHORT_SLEEP_H = 6.0, so the layer meant two different things by "a
 *    short night" and only one of them was visible in params.ts. Both now read
 *    SHORT_SLEEP_H. The acute charge is consequently smaller, and fires less
 *    often, than it did before that commit — a deliberate reconciliation, not
 *    a retune.
 *
 * Pure and clock-free — `asOf` is always passed in, never read off a live
 * clock.
 */

export interface RestRead {
  /** Mean hours over nights in (asOf-14, asOf]; null when < REST_MIN_NIGHTS such nights. */
  mean14: number | null;
  /**
   * Recent-window mean over nights NOT already charged through stock.ts's
   * ENCODING_PENALTY; null when fewer than REST_MIN_NIGHTS survive. This, not
   * `mean14`, is what `chronicTerm` prices against (M5) — `mean14` stays
   * unfiltered because the absolute deficit is still worth SHOWING.
   */
  chronicMean14: number | null;
  /** Mean hours over nights in (asOf-56, asOf-14] — the baseline; null when < 2·REST_MIN_NIGHTS such nights. */
  mean56: number | null;
  /** Stdev of unwrapped bedtime minutes over nights in (asOf-56, asOf] with bedtime set; null when < REST_MIN_NIGHTS such nights. */
  regSd: number | null;
  /** Deterioration-only chronic charge, <= 0. */
  chronicTerm: number;
  /** Bedtime-irregularity charge, <= 0. */
  regTerm: number;
  /** Night-before-exam short-sleep charge, <= 0. */
  acuteTerm: number;
  /** Rest rows in (asOf-56, asOf]. */
  nights: number;
}

const DAY_MS = 86400000;
const daysBetween = (from: string, to: string): number => Math.round((pDate(to).getTime() - pDate(from).getTime()) / DAY_MS);
const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Every priced rest term is <= 0. Rounding a signed x.xx5 with plain
 * Math.round rounds toward +Infinity (e.g. -1.125 -> -1.12), which for a
 * penalty rounds the CHARGE down rather than to the nearest cent of
 * magnitude. Rounding the non-negative magnitude first (ordinary "round
 * half up") and then negating keeps -0.75·1.5 = -1.125 landing on -1.13, not
 * -1.12. Also normalises -0 to 0 so an untriggered term never fails a
 * strict `toBe(0)`.
 */
const negRound2 = (magnitude: number): number => {
  const r = round2(magnitude);
  return r === 0 ? 0 : -r;
};

/**
 * Baseline window (Δ14..55, 42 nights wide) needs twice REST_MIN_NIGHTS
 * nights logged before mean56 is trusted — a flat REST_MIN_NIGHTS would let
 * a nearly-empty baseline outvote a fully-populated recent window.
 */
const REST_BASELINE_MIN_NIGHTS = 2 * REST_MIN_NIGHTS;

/**
 * "HH:MM" -> minutes since midnight, unwrapped across the midnight boundary
 * (see the module doc comment, convention 1). A bedtime read before noon is
 * treated as past midnight and pushed +24h so the whole set sits on one
 * continuous scale (e.g. 22:00 -> 1320, 00:20 -> 1460).
 */
function unwrapBedtimeMinutes(bedtime: string): number {
  const [hh, mm] = bedtime.split(":").map(Number);
  const mins = hh * 60 + mm;
  return mins < 12 * 60 ? mins + 24 * 60 : mins;
}

/** Population stdev (n divisor, not n-1) — matches mastery.ts's weightedStdev unweighted. */
function populationStdev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

const IDENTITY: RestRead = {
  mean14: null,
  chronicMean14: null,
  mean56: null,
  regSd: null,
  chronicTerm: 0,
  regTerm: 0,
  acuteTerm: 0,
  nights: 0,
};

export function restRead(
  rest: RestLog[],
  examDate: string | null,
  asOf: string,
  encodingCharged?: ReadonlySet<string>,
): RestRead {
  const live = rest.filter((r) => r.date <= asOf);
  if (!live.length) return IDENTITY;

  const withDelta = live.map((r) => ({ ...r, delta: daysBetween(r.date, asOf) }));
  const inWindow = withDelta.filter((r) => r.delta >= 0 && r.delta <= 55);
  const nights = inWindow.length;

  const recent = withDelta.filter((r) => r.delta >= 0 && r.delta <= 13);
  const baseline = withDelta.filter((r) => r.delta >= 14 && r.delta <= 55);

  const mean14 = recent.length >= REST_MIN_NIGHTS ? recent.reduce((a, r) => a + r.hours, 0) / recent.length : null;
  const mean56 =
    baseline.length >= REST_BASELINE_MIN_NIGHTS ? baseline.reduce((a, r) => a + r.hours, 0) / baseline.length : null;

  // M5: nights already docked mechanistically (a short night followed by a
  // study day, charged through stock.ts's ENCODING_PENALTY) are excluded from
  // the recent-window mean BEFORE it is compared against the baseline. The two
  // terms measure genuinely different things — one a specific badly-encoded
  // session, the other a sustained baseline shift — so they are made disjoint
  // rather than either being deleted.
  const chronicRecent = encodingCharged ? recent.filter((r) => !encodingCharged.has(r.date)) : recent;
  const chronicMean14 =
    chronicRecent.length >= REST_MIN_NIGHTS
      ? chronicRecent.reduce((a, r) => a + r.hours, 0) / chronicRecent.length
      : null;

  const chronicTerm =
    chronicMean14 != null && mean56 != null
      ? negRound2(
          Math.min(
            REST_CHRONIC_W * clamp(mean56 - chronicMean14, 0, REST_CHRONIC_MAX_LOSS_H),
            REST_CHRONIC_CAP,
          ),
        )
      : 0;

  const bedtimeMinutes = inWindow
    .filter((r) => r.bedtime != null)
    .map((r) => unwrapBedtimeMinutes(r.bedtime as string));
  const regSd = bedtimeMinutes.length >= REST_MIN_NIGHTS ? populationStdev(bedtimeMinutes) : null;
  const regTerm =
    regSd == null
      ? 0
      : negRound2(REST_REG_W * clamp((regSd - REST_REG_FREE_SD_MIN) / REST_REG_SPAN_MIN, 0, 1));

  let acuteTerm = 0;
  if (examDate != null) {
    // Night-before-exam row (see module doc comment, convention 2): the row
    // dated exactly one day before examDate.
    const nightBefore = live.find((r) => daysBetween(r.date, examDate) === 1);
    if (nightBefore && nightBefore.hours < SHORT_SLEEP_H) {
      acuteTerm = negRound2(Math.min(REST_ACUTE_W * (SHORT_SLEEP_H - nightBefore.hours), REST_ACUTE_CAP));
    }
  }

  return {
    mean14: mean14 == null ? null : round1(mean14),
    chronicMean14: chronicMean14 == null ? null : round1(chronicMean14),
    mean56: mean56 == null ? null : round1(mean56),
    regSd: regSd == null ? null : round1(regSd),
    chronicTerm,
    regTerm,
    acuteTerm,
    nights,
  };
}
