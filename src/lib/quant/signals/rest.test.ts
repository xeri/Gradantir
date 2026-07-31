import { describe, expect, it } from "vitest";
import type { RestLog } from "../../../types";
import { addDays } from "../../utils";
import {
  REST_ACUTE_CAP, REST_ACUTE_W, REST_CHRONIC_CAP, REST_CHRONIC_W, REST_MIN_NIGHTS, REST_REG_W,
  SHORT_SLEEP_H,
} from "./params";
import { restRead } from "./rest";

/**
 * restRead — the rest channel (D5's "sleep" self-report).
 *
 * The invariant this suite defends: the doctrine is DETERIORATION-ONLY. The
 * chronic term prices recent-vs-own-baseline WORSENING, never an absolute
 * deficit — a desk that has always logged 6h a night, steady, prices at zero
 * on chronic even though 6h is short in absolute terms; only a desk that
 * USED to log more and has slipped gets charged. Every hand value below is
 * computed independently from the documented formula (never by re-deriving
 * the implementation's own arithmetic), and the two conventions the brief
 * calls out by name — the midnight bedtime unwrap, and the night-before-exam
 * row lookup — are each exercised directly.
 */

const ASOF = "2026-06-30";

const R = (date: string, hours: number, bedtime?: string | null): RestLog => ({
  id: "r-" + date,
  date,
  hours,
  ...(bedtime !== undefined ? { bedtime } : {}),
});

/** Build `n` consecutive baseline nights (Δdays 14..14+n-1) all at `hours`. */
const baselineNights = (n: number, hours: number): RestLog[] =>
  Array.from({ length: n }, (_, i) => R(addDays(ASOF, -(14 + i)), hours));

/** Build `n` consecutive recent nights (Δdays 0..n-1) all at `hours`. */
const recentNights = (n: number, hours: number): RestLog[] =>
  Array.from({ length: n }, (_, i) => R(addDays(ASOF, -i), hours));

describe("restRead — identity on empty input", () => {
  it("returns the null/zero identity when there are no rest rows", () => {
    const out = restRead([], null, ASOF);
    expect(out).toEqual({
      mean14: null,
      chronicMean14: null,
      mean56: null,
      regSd: null,
      chronicTerm: 0,
      regTerm: 0,
      acuteTerm: 0,
      nights: 0,
    });
  });

  it("stays at identity even with an examDate set, given no rest rows at all", () => {
    const out = restRead([], addDays(ASOF, 1), ASOF);
    expect(out).toEqual({
      mean14: null,
      chronicMean14: null,
      mean56: null,
      regSd: null,
      chronicTerm: 0,
      regTerm: 0,
      acuteTerm: 0,
      nights: 0,
    });
  });
});

describe("restRead — min-nights gates", () => {
  it("mean14 is null with only 6 nights in the recent window (< REST_MIN_NIGHTS)", () => {
    expect(REST_MIN_NIGHTS).toBe(7);
    const rest = recentNights(6, 7.0);
    const out = restRead(rest, null, ASOF);
    expect(out.mean14).toBeNull();
    expect(out.chronicTerm).toBe(0);
    expect(out.nights).toBe(6);
  });

  it("mean56 is null with only 13 nights in the baseline window (< 2×REST_MIN_NIGHTS)", () => {
    const rest = baselineNights(13, 8.0);
    const out = restRead(rest, null, ASOF);
    expect(out.mean56).toBeNull();
    expect(out.chronicTerm).toBe(0);
    expect(out.nights).toBe(13);
  });
});

describe("restRead — chronic term is deterioration-only", () => {
  it("a 1.5h recent-vs-baseline drop (8.0 -> 6.5) charges -REST_CHRONIC_W·1.5, rounded", () => {
    const rest = [...baselineNights(14, 8.0), ...recentNights(7, 6.5)];
    const out = restRead(rest, null, ASOF);
    expect(out.mean56).toBe(8.0);
    expect(out.mean14).toBe(6.5);
    const expectedMag = REST_CHRONIC_W * 1.5; // 0.75 * 1.5 = 1.125 -> rounds to 1.13
    expect(expectedMag).toBeCloseTo(1.125, 5);
    expect(out.chronicTerm).toBeCloseTo(-1.13, 5);
  });

  it("improving sleep (recent mean ABOVE baseline) prices at exactly 0 — absolute deficit is never priced", () => {
    const rest = [...baselineNights(14, 6.5), ...recentNights(7, 8.0)];
    const out = restRead(rest, null, ASOF);
    expect(out.mean56).toBe(6.5);
    expect(out.mean14).toBe(8.0);
    expect(out.chronicTerm).toBe(0);
  });

  it("a 3h drop clamps the underlying delta at 2h, landing exactly on REST_CHRONIC_CAP", () => {
    const rest = [...baselineNights(14, 8.0), ...recentNights(7, 5.0)];
    const out = restRead(rest, null, ASOF);
    expect(out.mean56).toBe(8.0);
    expect(out.mean14).toBe(5.0);
    expect(out.chronicTerm).toBe(-REST_CHRONIC_CAP);
    expect(out.chronicTerm).toBe(-1.5);
  });
});

describe("restRead — bedtime regularity, with the midnight unwrap", () => {
  it("alternating 22:00/23:00 bedtimes (sd 30min, inside the ±1h band) price regTerm at 0", () => {
    const rest = Array.from({ length: 8 }, (_, i) =>
      R(addDays(ASOF, -i), 7.5, i % 2 === 0 ? "22:00" : "23:00"),
    );
    const out = restRead(rest, null, ASOF);
    expect(out.regSd).toBeCloseTo(30, 1);
    expect(out.regTerm).toBe(0);
  });

  it("alternating 22:00/01:00 bedtimes unwrap across midnight to sd 90min, charging -0.25", () => {
    // Without the unwrap, 22:00 (1320min) and 01:00 (60min) would read ~19h
    // apart; unwrapped, 01:00 -> 25:00 (1500min), truly 90min from a 23:30
    // mean — the unwrap is what makes this "regular-ish" pattern price at
    // all instead of registering as maximal irregularity.
    const rest = Array.from({ length: 8 }, (_, i) =>
      R(addDays(ASOF, -i), 7.5, i % 2 === 0 ? "22:00" : "01:00"),
    );
    const out = restRead(rest, null, ASOF);
    expect(out.regSd).toBeCloseTo(90, 1);
    const expectedMag = REST_REG_W * 0.5; // clamp((90-60)/60,0,1) = 0.5
    expect(out.regTerm).toBeCloseTo(-expectedMag, 5);
    expect(out.regTerm).toBeCloseTo(-0.25, 5);
  });

  it("23:40 and 00:20 unwrap to 40 minutes apart (not ~23h20 read literally)", () => {
    // 23:40 -> 1420min (>= noon, no unwrap). 00:20 -> 20min, < noon -> +24h -> 1460min.
    // |1460 - 1420| = 40. 8 nights split evenly 4/4 mean to exactly 1440, each point
    // 20min from the mean -> population sd = 20 (small: the two clock-times really
    // are close together). Read literally (no unwrap) the mean would sit near 720
    // with a swing of ~700min — this test would fail hard without the unwrap.
    const rest = Array.from({ length: 8 }, (_, i) =>
      R(addDays(ASOF, -i), 7.5, i % 2 === 0 ? "23:40" : "00:20"),
    );
    const out = restRead(rest, null, ASOF);
    expect(out.regSd).toBeCloseTo(20, 1);
  });

  it("absent bedtimes (none logged) leave regSd null and regTerm 0", () => {
    const rest = recentNights(8, 7.5); // no bedtime field at all
    const out = restRead(rest, null, ASOF);
    expect(out.regSd).toBeNull();
    expect(out.regTerm).toBe(0);
  });
});

describe("M5 — the chronic term skips nights the encoding penalty already charged", () => {
  // 7 recent nights at `recent`, 14 baseline nights at `base`: enough to clear
  // REST_MIN_NIGHTS on the recent window and 2×REST_MIN_NIGHTS on the baseline.
  const book = (recent: number, base: number): RestLog[] => [
    ...baselineNights(14, base),
    ...recentNights(7, recent),
  ];

  it("is unchanged when no night was mechanistically charged", () => {
    const rest = book(6, 8);
    const bare = restRead(rest, null, ASOF);
    const withEmpty = restRead(rest, null, ASOF, new Set<string>());
    expect(bare.chronicTerm).toBeLessThan(0);
    expect(withEmpty.chronicTerm).toBe(bare.chronicTerm);
    expect(withEmpty.chronicMean14).toBe(bare.chronicMean14);
  });

  it("goes silent when every deteriorated night was already charged through the encoding penalty", () => {
    const rest = book(6, 8);
    const charged = new Set(recentNights(7, 6).map((r) => r.date));
    const out = restRead(rest, null, ASOF, charged);
    // Nothing left in the recent window to measure a baseline shift against, so
    // the deterioration is charged ONCE — mechanistically, inside k14.
    expect(out.chronicMean14).toBeNull();
    expect(out.chronicTerm).toBe(0);
    // The DISPLAY mean is untouched: the student is still shown the real
    // absolute deficit, it is simply never priced twice.
    expect(out.mean14).toBe(6);
  });

  it("still charges the student whose sleep slipped on nights they did not study", () => {
    // Twelve short recent nights, four of them followed by a study day. Eight
    // survive the exclusion — still over REST_MIN_NIGHTS — so the baseline
    // shift is measurable on the nights no mechanistic charge has touched.
    const recent = recentNights(12, 6);
    const wide = [...baselineNights(14, 8), ...recent];
    const charged = new Set(recent.filter((_, i) => i % 3 === 0).map((r) => r.date));
    expect(charged.size).toBe(4);
    const out = restRead(wide, null, ASOF, charged);
    expect(out.chronicMean14).toBe(6);
    expect(out.chronicTerm).toBeLessThan(0);
  });

  it("leaves the acute and regularity terms alone — they price different evidence", () => {
    const rest = book(6, 8);
    const charged = new Set(recentNights(7, 6).map((r) => r.date));
    const out = restRead(rest, null, ASOF, charged);
    expect(out.regTerm).toBe(0); // no bedtimes logged in this fixture
    expect(out.acuteTerm).toBe(0); // no examDate
    expect(out.nights).toBe(21);
  });
});

describe("restRead — acute term uses the night-before-exam row", () => {
  const EXAM = addDays(ASOF, 1); // exam is tomorrow; "the night before" is ASOF itself

  it("a 5.0h night-before row charges -REST_ACUTE_W·(SHORT_SLEEP_H - 5)", () => {
    const rest = [R(addDays(EXAM, -1), 5.0)];
    const out = restRead(rest, EXAM, ASOF);
    const expectedMag = REST_ACUTE_W * (SHORT_SLEEP_H - 5.0);
    expect(expectedMag).toBeCloseTo(0.8, 5);
    expect(out.acuteTerm).toBeCloseTo(-0.8, 5);
  });

  it("exactly SHORT_SLEEP_H the night before charges nothing (the threshold is exclusive)", () => {
    const rest = [R(addDays(EXAM, -1), SHORT_SLEEP_H)];
    const out = restRead(rest, EXAM, ASOF);
    expect(out.acuteTerm).toBe(0);
  });

  it("E1 — a 6.2h night is no longer acute: one threshold, and it is SHORT_SLEEP_H", () => {
    // The layer used to gate this term on a hardcoded 6.5h while stock.ts's
    // encoding penalty gated on SHORT_SLEEP_H = 6.0, so a 6.2h night was a
    // short night for one term and a full night for the other. It is now a
    // full night for both.
    const rest = [R(addDays(EXAM, -1), 6.2)];
    expect(restRead(rest, EXAM, ASOF).acuteTerm).toBe(0);
  });

  it("no row dated exactly examDate-1 charges nothing, even with other nights logged", () => {
    const rest = [R(addDays(EXAM, -2), 4.0), R(addDays(EXAM, -3), 4.0)];
    const out = restRead(rest, EXAM, ASOF);
    expect(out.acuteTerm).toBe(0);
  });

  it("examDate null never fires the acute term, regardless of rows", () => {
    const rest = [R(addDays(ASOF, 0), 3.0)];
    const out = restRead(rest, null, ASOF);
    expect(out.acuteTerm).toBe(0);
  });

  it("a 3.0h night-before row clamps at -REST_ACUTE_CAP (would be -2.4 uncapped)", () => {
    const rest = [R(addDays(EXAM, -1), 3.0)];
    const out = restRead(rest, EXAM, ASOF);
    const uncapped = REST_ACUTE_W * (SHORT_SLEEP_H - 3.0);
    expect(uncapped).toBeCloseTo(2.4, 5);
    expect(out.acuteTerm).toBe(-REST_ACUTE_CAP);
    expect(out.acuteTerm).toBe(-2);
  });
});
