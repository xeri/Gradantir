import { MONTHS, pDate, todayStr } from "./utils";
import {
  DEFAULT_CALENDAR, parseTermKey, reportingTermOf, stepTerm, termKey, termLabel,
  type SchoolCalendar, type TermRef,
} from "./calendar";
import type { GradeEntry, PeriodMode } from "../types";

export interface PeriodKey {
  key: string;
  label: string;
}

/**
 * Bucket a date into a period. Terms come from the school calendar's REPORTING
 * grid — the term a result reports on, not the term its ink happens to dry in
 * (see `lib/calendar.ts`) — and semesters are two of those.
 */
export function periodInfo(
  dateStr: string,
  mode: PeriodMode | string,
  cal: SchoolCalendar = DEFAULT_CALENDAR,
): PeriodKey {
  const dt = pDate(dateStr);
  const y = dt.getFullYear();
  const m = dt.getMonth();
  switch (mode) {
    case "month":
      return { key: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} ${String(y).slice(2)}` };
    case "term": {
      const ref = reportingTermOf(dateStr, cal);
      return { key: termKey(ref), label: termLabel(ref) };
    }
    case "semester": {
      const ref = reportingTermOf(dateStr, cal);
      const s = ref.term <= 2 ? 1 : 2;
      return { key: `${ref.year}-S${s}`, label: `S${s} ${ref.year}` };
    }
    case "year": {
      // The school year is the one its terms belong to, so a January result
      // filed against last year's T4 stays in last year.
      const ref = reportingTermOf(dateStr, cal);
      return { key: `${ref.year}`, label: `${ref.year}` };
    }
    default:
      return { key: dateStr, label: dateStr };
  }
}

/**
 * THE filing question, asked of an entry rather than a date: a hand-set
 * `entry.term` always wins, because the person holding the paper knows which
 * term it examined and the calendar is only inferring it.
 */
export function entryTerm(entry: GradeEntry, cal: SchoolCalendar = DEFAULT_CALENDAR): TermRef {
  const pinned = entry.term ? parseTermKey(entry.term) : null;
  return pinned ?? reportingTermOf(entry.date, cal);
}

export const entryTermKey = (entry: GradeEntry, cal: SchoolCalendar = DEFAULT_CALENDAR): string =>
  termKey(entryTerm(entry, cal));

/** Period bucket for one entry — honors a pinned term in every term-based mode. */
export function entryPeriod(
  entry: GradeEntry,
  mode: PeriodMode | string,
  cal: SchoolCalendar = DEFAULT_CALENDAR,
): PeriodKey {
  if (!entry.term) return periodInfo(entry.date, mode, cal);
  const ref = entryTerm(entry, cal);
  switch (mode) {
    case "term":
      return { key: termKey(ref), label: termLabel(ref) };
    case "semester": {
      const s = ref.term <= 2 ? 1 : 2;
      return { key: `${ref.year}-S${s}`, label: `S${s} ${ref.year}` };
    }
    case "year":
      return { key: `${ref.year}`, label: `${ref.year}` };
    default:
      return periodInfo(entry.date, mode, cal);
  }
}

const refInfo = (ref: TermRef): PeriodKey => ({ key: termKey(ref), label: termLabel(ref) });

/** The term now taking results — the one whose reporting window is open. */
export const currentTermKey = (cal: SchoolCalendar = DEFAULT_CALENDAR, todayIso = todayStr()): PeriodKey =>
  refInfo(reportingTermOf(todayIso, cal));

export const prevTermKey = (cal: SchoolCalendar = DEFAULT_CALENDAR, todayIso = todayStr()): PeriodKey =>
  refInfo(stepTerm(reportingTermOf(todayIso, cal), -1));
