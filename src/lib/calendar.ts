import { addDays, iso, pDate } from "./utils";

/**
 * THE SCHOOL CALENDAR — the only clock this terminal trusts.
 *
 * A school year is not four calendar quarters. Terms open and close on dates
 * the school publishes, they drift by a week or two every year, and — the part
 * that breaks every naive implementation — RESULTS ARRIVE AFTER THE TERM THEY
 * MEASURE. A Term 1 paper sat in late March is handed back in the April
 * holidays one year and two days into Term 2 the next; the mid-year round is
 * marked over the July break and published a fortnight into Term 3. Bucketing
 * those by "which term is this date in" files the same round under a different
 * term every year, which is exactly the bug this module exists to kill.
 *
 * So the calendar keeps TWO clocks:
 *
 *   TEACHING TERM   where the school physically is today. Drives session
 *                   chrome, week numbers, and holiday-aware ageing.
 *   REPORTING TERM  which term a result REPORTS ON. The grid is the teaching
 *                   grid shifted forward by `settleDays` — results landing in
 *                   a break, or in the opening weeks of the next term, settle
 *                   back into the term that produced them.
 *
 * Every date the term dates change, only `years` changes. Nothing downstream
 * re-derives a term from a month number ever again.
 */

export type TermNumber = 1 | 2 | 3 | 4;

/** One term's teaching window, inclusive, ISO YYYY-MM-DD. */
export interface TermSpan {
  start: string;
  end: string;
}

export interface SchoolCalendar {
  /** Published term dates, keyed by calendar year — four spans, T1…T4. */
  years: Record<string, TermSpan[]>;
  /**
   * Days after a term OPENS during which results still settle into the term
   * before it. Four weeks covers a round marked over the break and published
   * in the opening fortnight of the next term, which is the universal school
   * rhythm; it is deliberately anchored to the next term's start rather than
   * the previous term's end so the seven-week summer break cannot swallow a
   * December round into the following February.
   */
  settleDays: number;
}

export interface TermRef {
  year: number;
  term: TermNumber;
}

/** Where the school physically is on a given day. */
export interface TeachingPosition {
  ref: TermRef;
  /** False on weekends, in the breaks, and over the summer. */
  inSession: boolean;
  /** 1-based teaching week, or null when out of session. */
  week: number | null;
}

/* ── The published dates ──────────────────────────────────────────── */

const span = (start: string, end: string): TermSpan => ({ start, end });

/**
 * Published NZ secondary term dates. Add a year the day the school publishes
 * it — one line, and every board, tape and index re-times itself. Years absent
 * from this table are projected (see `termsOf`), so nothing breaks in the
 * meantime; the projection is right to within a few days.
 */
export const PUBLISHED_TERMS: Record<string, TermSpan[]> = {
  "2024": [
    span("2024-01-23", "2024-04-12"),
    span("2024-04-29", "2024-07-05"),
    span("2024-07-22", "2024-09-27"),
    span("2024-10-14", "2024-12-05"),
  ],
  "2025": [
    span("2025-01-21", "2025-04-11"),
    span("2025-04-28", "2025-06-27"),
    span("2025-07-14", "2025-09-19"),
    span("2025-10-06", "2025-12-03"),
  ],
  "2026": [
    span("2026-01-20", "2026-04-02"),
    span("2026-04-20", "2026-07-03"),
    span("2026-07-20", "2026-09-25"),
    span("2026-10-12", "2026-12-02"),
  ],
  "2027": [
    span("2027-01-26", "2027-04-09"),
    span("2027-04-27", "2027-07-02"),
    span("2027-07-19", "2027-09-24"),
    span("2027-10-11", "2027-12-08"),
  ],
};

/** Four weeks: long enough for a marked round to reach you, short enough that mid-term coursework stays put. */
export const DEFAULT_SETTLE_DAYS = 28;

/** Shape of a term year when the table has nothing to project from at all. */
const GENERIC_ANCHORS: [number, number, number, number][] = [
  // [startMonth, startDay, endMonth, endDay], 1-based months
  [1, 22, 4, 10],
  [4, 28, 7, 3],
  [7, 20, 9, 25],
  [10, 12, 12, 5],
];

export const freshCalendar = (): SchoolCalendar => ({
  years: Object.fromEntries(
    Object.entries(PUBLISHED_TERMS).map(([y, spans]) => [y, spans.map((s) => ({ ...s }))]),
  ),
  settleDays: DEFAULT_SETTLE_DAYS,
});

export const DEFAULT_CALENDAR: SchoolCalendar = freshCalendar();

/* ── Keys and labels ──────────────────────────────────────────────── */

export const termKey = (ref: TermRef): string => `${ref.year}-T${ref.term}`;
export const termLabel = (ref: TermRef): string => `T${ref.term} ${ref.year}`;
/** "T1 26" — the axis form. */
export const termShort = (ref: TermRef): string => `T${ref.term} ${String(ref.year).slice(2)}`;

export function parseTermKey(key: string): TermRef | null {
  const m = /^(\d{4})-T([1-4])$/.exec(key);
  return m ? { year: Number(m[1]), term: Number(m[2]) as TermNumber } : null;
}

/** Walk the term grid; `n` may be negative. Terms roll into the next year. */
export function stepTerm(ref: TermRef, n: number): TermRef {
  const abs = ref.year * 4 + (ref.term - 1) + n;
  const term = (((abs % 4) + 4) % 4) + 1;
  return { year: Math.floor(abs / 4), term: term as TermNumber };
}

/* ── Term windows ─────────────────────────────────────────────────── */

/**
 * Project one published date into another year: same month and day, then
 * snapped to the nearest same weekday. Schools open on Mondays and close on
 * Fridays, and keeping that alignment is what makes a projected year land
 * within a few days of the real one instead of mid-weekend.
 */
function project(dateStr: string, toYear: number): string {
  const src = pDate(dateStr);
  const target = new Date(toYear, src.getMonth(), src.getDate());
  let delta = (src.getDay() - target.getDay() + 7) % 7;
  if (delta > 3) delta -= 7;
  target.setDate(target.getDate() + delta);
  return iso(target);
}

function genericYear(year: number): TermSpan[] {
  return GENERIC_ANCHORS.map(([sm, sd, em, ed]) =>
    span(
      project(`${year}-${String(sm).padStart(2, "0")}-${String(sd).padStart(2, "0")}`, year),
      project(`${year}-${String(em).padStart(2, "0")}-${String(ed).padStart(2, "0")}`, year),
    ),
  );
}

const validSpans = (v: unknown): v is TermSpan[] =>
  Array.isArray(v) &&
  v.length === 4 &&
  v.every(
    (s) =>
      s != null &&
      typeof (s as TermSpan).start === "string" &&
      typeof (s as TermSpan).end === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test((s as TermSpan).start) &&
      /^\d{4}-\d{2}-\d{2}$/.test((s as TermSpan).end) &&
      (s as TermSpan).start <= (s as TermSpan).end,
  );

/**
 * The four terms of a calendar year: published if the school has told us,
 * otherwise projected off the nearest year it has — which preserves that
 * school's own rhythm, not some national average.
 */
export function termsOf(year: number, cal: SchoolCalendar = DEFAULT_CALENDAR): TermSpan[] {
  let byYear = CACHE.get(cal);
  if (!byYear) CACHE.set(cal, (byYear = new Map()));
  const hit = byYear.get(year);
  if (hit) return hit;
  const spans = computeTerms(year, cal);
  byYear.set(year, spans);
  return spans;
}

/**
 * Term windows are read once per (calendar, year) and reused: the history tape
 * reprices the whole book at every round, and each reprice asks the calendar
 * thousands of times.
 */
const CACHE = new WeakMap<SchoolCalendar, Map<number, TermSpan[]>>();

function computeTerms(year: number, cal: SchoolCalendar): TermSpan[] {
  const own = cal.years?.[String(year)];
  if (validSpans(own)) return own;

  let nearest: { year: number; spans: TermSpan[] } | null = null;
  for (const [y, spans] of Object.entries(cal.years ?? {})) {
    const yr = Number(y);
    if (!Number.isInteger(yr) || !validSpans(spans)) continue;
    if (!nearest || Math.abs(yr - year) < Math.abs(nearest.year - year)) nearest = { year: yr, spans };
  }
  if (!nearest) return genericYear(year);
  return nearest.spans.map((s) => span(project(s.start, year), project(s.end, year)));
}

export const spanOf = (ref: TermRef, cal: SchoolCalendar = DEFAULT_CALENDAR): TermSpan =>
  termsOf(ref.year, cal)[ref.term - 1];

/** The day a term's REPORTING window opens: its teaching start plus settlement. */
export const reportOpens = (ref: TermRef, cal: SchoolCalendar = DEFAULT_CALENDAR): string =>
  addDays(spanOf(ref, cal).start, Math.max(0, Math.round(cal.settleDays ?? DEFAULT_SETTLE_DAYS)));

/** The last day results can still be filed against a term — the day before the next opens. */
export const reportCloses = (ref: TermRef, cal: SchoolCalendar = DEFAULT_CALENDAR): string =>
  addDays(reportOpens(stepTerm(ref, 1), cal), -1);

/**
 * WHICH TERM DOES THIS RESULT REPORT ON? The one whose reporting window holds
 * the date — so a paper handed back in the holidays, or in the opening weeks
 * of the next term, is filed against the term that actually examined it.
 */
export function reportingTermOf(dateStr: string, cal: SchoolCalendar = DEFAULT_CALENDAR): TermRef {
  const year = pDate(dateStr).getFullYear();
  // Two years of candidates either side covers every settlement lag and the
  // summer roll, where a January date belongs to the previous year's T4.
  for (let y = year + 1; y >= year - 1; y--) {
    for (let t = 4 as TermNumber; t >= 1; t = (t - 1) as TermNumber) {
      const ref = { year: y, term: t };
      if (reportOpens(ref, cal) <= dateStr) return ref;
    }
  }
  return { year: year - 1, term: 4 };
}

/** Where the school physically is: the teaching term, and whether it is open. */
export function teachingTermOf(dateStr: string, cal: SchoolCalendar = DEFAULT_CALENDAR): TeachingPosition {
  const year = pDate(dateStr).getFullYear();
  for (let y = year + 1; y >= year - 1; y--) {
    const spans = termsOf(y, cal);
    for (let t = 4; t >= 1; t--) {
      const s = spans[t - 1];
      if (dateStr < s.start) continue;
      const ref: TermRef = { year: y, term: t as TermNumber };
      if (dateStr > s.end) return { ref, inSession: false, week: null }; // the break after it
      const day = pDate(dateStr).getDay();
      const weekday = day >= 1 && day <= 5;
      const elapsed = Math.round((pDate(dateStr).getTime() - pDate(s.start).getTime()) / 86400000);
      return { ref, inSession: weekday, week: Math.floor(elapsed / 7) + 1 };
    }
  }
  return { ref: { year: year - 1, term: 4 }, inSession: false, week: null };
}

/** Is school actually open — a weekday inside a term? */
export const inSession = (dateStr: string, cal: SchoolCalendar = DEFAULT_CALENDAR): boolean =>
  teachingTermOf(dateStr, cal).inSession;

/**
 * SCHOOL DAYS between two dates, exclusive of `from`, inclusive of `to`.
 *
 * This is the clock staleness runs on. A desk cannot print over the summer, so
 * the summer must not age it: on calendar time every desk in the book drifts
 * toward caution every January for no reason anyone chose. Ability drift
 * (Kalman, EWMA) deliberately stays on CALENDAR time — you really do forget
 * things over the holidays — but silence is only silence while school is open.
 */
export function sessionDaysBetween(from: string, to: string, cal: SchoolCalendar = DEFAULT_CALENDAR): number {
  if (to <= from) return 0;
  const start = pDate(from);
  const end = pDate(to);
  // Whole-day walk, capped at four years so a corrupt date cannot spin.
  const days = Math.min(Math.round((end.getTime() - start.getTime()) / 86400000), 1461);
  let n = 0;
  const cursor = new Date(start.getTime());
  for (let i = 0; i < days; i++) {
    cursor.setDate(cursor.getDate() + 1);
    if (inSession(iso(cursor), cal)) n++;
  }
  return n;
}
