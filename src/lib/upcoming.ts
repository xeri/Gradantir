import { pDate } from "./utils";
import type { GradeEntry, Upcoming } from "../types";

/**
 * The forward calendar's pure helpers — clock-free (every function that needs
 * "now" is handed it). A sitting is a score-less future paper; here we measure
 * the exam-crush around it and match it to the real mark once it lands.
 */

/** Whole calendar days from a→b: b later than a ⇒ positive. */
const daysBetween = (a: string, b: string): number =>
  Math.round((pDate(b).getTime() - pDate(a).getTime()) / 86400000);

/** Papers competing for prep in the fortnight before a sitting. */
export const CROWD_WINDOW_DAYS = 14;
/** How far a realized mark may sit from the calendar date and still be it. */
export const RESOLVE_WINDOW_DAYS = 21;

/**
 * Crowding: how many OTHER sittings fall in the window of days up to and
 * including this one — the exam-crush covariate. A paper sat the morning after
 * three others got less of your week than one sat in a clear fortnight. Counts
 * across every desk, because the crush is on your time, not one subject's.
 */
export function crowding(target: Upcoming, all: Upcoming[], windowDays = CROWD_WINDOW_DAYS): number {
  return all.filter((u) => {
    if (u.id === target.id) return false;
    const d = daysBetween(u.date, target.date);
    return d >= 0 && d <= windowDays;
  }).length;
}

/**
 * The realized mark a sitting became: same desk, same assessment type, the
 * nearest print within the window. Null until the paper is actually sat.
 */
export function resolveUpcoming(
  u: Upcoming,
  entries: GradeEntry[],
  windowDays = RESOLVE_WINDOW_DAYS,
): GradeEntry | null {
  const gap = (e: GradeEntry) => Math.abs(daysBetween(u.date, e.date));
  const cands = entries
    .filter((e) => e.subjectId === u.subjectId && e.type === u.type && gap(e) <= windowDays)
    .sort((a, b) => gap(a) - gap(b) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return cands[0] ?? null;
}

/** A sitting paired with the mark it resolved to. */
export interface ResolvedUpcoming {
  upcoming: Upcoming;
  realized: GradeEntry;
}

/**
 * Split the calendar into sittings a real mark has landed for (resolved — ready
 * to score) and those still ahead or unsat (pending). Deterministic given the
 * entries and the passed-in today.
 */
export function classifyUpcoming(
  upcoming: Upcoming[],
  entries: GradeEntry[],
  _todayIso: string,
  windowDays = RESOLVE_WINDOW_DAYS,
): { resolved: ResolvedUpcoming[]; pending: Upcoming[] } {
  const resolved: ResolvedUpcoming[] = [];
  const pending: Upcoming[] = [];
  for (const u of upcoming) {
    const realized = resolveUpcoming(u, entries, windowDays);
    if (realized) resolved.push({ upcoming: u, realized });
    else pending.push(u);
  }
  return { resolved, pending };
}

/** The soonest unresolved sitting on or after today, or null. */
export function nextUpcoming(
  upcoming: Upcoming[],
  entries: GradeEntry[],
  todayIso: string,
  windowDays = RESOLVE_WINDOW_DAYS,
): Upcoming | null {
  const pending = upcoming
    .filter((u) => u.date >= todayIso && !resolveUpcoming(u, entries, windowDays))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return pending[0] ?? null;
}
