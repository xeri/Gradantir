import { DEFAULT_CALENDAR, reportingTermOf, termKey, type SchoolCalendar } from "./calendar";
import { entryTermKey } from "./periods";
import type { GradeEntry, Subject } from "../types";

/**
 * LISTING — was a desk part of the book at a given moment?
 *
 * Archiving is a DELISTING, not a deletion. An archived desk keeps every print
 * it ever made: it still feeds the pooled prior, the depth fit and every
 * historical sum it was present for. What it stops doing is REPORTING. A desk
 * closes at its last print and stays on the board for the whole term that
 * print reports on — a subject dropped after the December round belongs to
 * that December's aggregate and to no term after it.
 *
 * This is deliberately separate from VISIBILITY (`sub.archived`, which the
 * boards read to decide whether to draw a row). A desk archived mid-term
 * vanishes from the screen at once but still counts toward the term it printed
 * in — the two axes answer different questions.
 */

/**
 * The term each delisted desk closed in — the last term it reported into. A
 * live desk is absent from the map; an archived desk that never printed maps
 * to null, because it was never on the book at all.
 *
 * Listing questions live in TERM space, not date space, and reading the close
 * off the entries rather than off a date honors a hand-pinned term: a paper
 * filed back into T2 closes the desk in T2.
 */
export type CloseTerms = Map<string, string | null>;

export function closeTerms(
  subjects: Subject[],
  entries: GradeEntry[],
  cal: SchoolCalendar = DEFAULT_CALENDAR,
): CloseTerms {
  const out: CloseTerms = new Map();
  for (const s of subjects) if (s.archived) out.set(s.id, null);
  for (const e of entries) {
    if (!out.has(e.subjectId)) continue;
    const key = entryTermKey(e, cal);
    const cur = out.get(e.subjectId);
    if (cur == null || key > cur) out.set(e.subjectId, key);
  }
  return out;
}

/** The close TERM of one desk — undefined while it is still trading. */
export function closeTermOf(
  sub: Subject,
  entries: GradeEntry[],
  cal: SchoolCalendar = DEFAULT_CALENDAR,
): string | null | undefined {
  if (!sub.archived) return undefined;
  let last: string | null = null;
  for (const e of entries) {
    /* THIS DESK'S OWN PRINTS ONLY. Callers pass `SubjectStat.entries`, which is
       the LINEAGE tape — it carries the ancestor's prints too. Reading a close
       term off those lets an archived successor that never reported inherit its
       ancestor's, so it stays "booked" in the tape, the aggregate and the
       composite on the strength of results it did not print. */
    if (e.subjectId !== sub.id) continue;
    const key = entryTermKey(e, cal);
    if (last == null || key > last) last = key;
  }
  return last;
}

/**
 * Was the desk on the book at `asOfIso`? Live desks always are. A closed desk
 * is, through the whole term its final print reports on. Term keys sort
 * lexicographically ("2024-T4" < "2025-T1"), so the comparison is the whole
 * rule.
 */
export function listedAt(
  closedTerm: string | null | undefined,
  asOfIso: string,
  cal: SchoolCalendar = DEFAULT_CALENDAR,
): boolean {
  if (closedTerm === undefined) return true;
  if (closedTerm === null) return false;
  return closedTerm >= termKey(reportingTermOf(asOfIso, cal));
}

/** The book as it stood at `asOfIso` — live desks plus the not-yet-closed. */
export function listedAsOf<T extends { sub: Subject; entries: GradeEntry[] }>(
  rows: T[],
  asOfIso: string,
  cal: SchoolCalendar = DEFAULT_CALENDAR,
): T[] {
  return rows.filter((r) => listedAt(closeTermOf(r.sub, r.entries, cal), asOfIso, cal));
}
