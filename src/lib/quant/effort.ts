import type { Allocation } from "../../types";

/**
 * The effort read the marking desk charges against (D1 → §15).
 *
 * The spider (`lib/allocate.ts`) is a PLANNING aid: a fixed weekly budget spread
 * over the desks. This module turns that plan — and, if it was recorded, what
 * was actually spent — into one scale-free number per desk: its share of the
 * week against an EVEN share of the same week.
 *
 *   ratio = n · tokens / total,     1.0 = a fair share, 0 = starved
 *
 * Two deliberate choices, both about what this is NOT allowed to claim:
 *
 * · The reference is the EVEN SHARE, not the model's water-filled suggestion.
 *   The suggestion is fitted from `priority`, which is downstream of the advisor,
 *   which is downstream of the mark — marking a desk against it would close a
 *   feedback loop and make the board depend on its own previous render. An even
 *   share is an input, not an output, so the pass stays a pure function of the
 *   book.
 *
 * · The ACTUAL ring is divided by the PLANNED total, never by its own sum. A
 *   week where you meant to do 14h and did 7h should starve every desk, not
 *   renormalize itself back to "perfectly balanced".
 *
 * A desk absent from the plan has no effort read at all (undefined, not zero):
 * a subject seated after the budget was filed has not been under-resourced, it
 * simply has not been budgeted. Same for a desk missing from the actual record.
 */

export interface EffortPressure {
  /** Share of an even week on the PLAN ring. 1 = fair share, 0 = starved. */
  planRatio: number;
  /** Same on the ACTUAL ring, or null when nothing was recorded for this desk. */
  actualRatio: number | null;
  /** Planned hours a week, when the plan carries an hour budget. */
  planHours: number | null;
  actualHours: number | null;
}

/** The desks a plan actually covers, keyed by subject id. Empty ⇒ no charge. */
export type EffortBook = Map<string, EffortPressure>;

export const EMPTY_EFFORT: EffortBook = new Map();

/**
 * Fair-share pressure per desk, from one filed allocation.
 *
 * `n` is the desk count of the PLAN ITSELF, so the reference is the week the
 * student actually drew rather than whatever the live book happens to hold
 * today — an archived desk cannot retroactively starve its neighbours.
 */
export function effortPressure(alloc: Allocation | null | undefined): EffortBook {
  const out: EffortBook = new Map();
  if (!alloc || !(alloc.total > 0)) return out;
  const ids = Object.keys(alloc.planned);
  const n = ids.length;
  if (!n) return out;

  const hpw = alloc.hoursPerWeek;
  const hoursOf = (tokens: number): number | null =>
    hpw != null && hpw > 0 ? (tokens / alloc.total) * hpw : null;
  const ratioOf = (tokens: number) => (n * Math.max(0, tokens)) / alloc.total;
  const actual = alloc.actual ?? null;

  for (const id of ids) {
    const planTok = Math.max(0, alloc.planned[id] ?? 0);
    const hasActual = !!actual && actual[id] != null;
    const actTok = hasActual ? Math.max(0, actual![id]) : null;
    out.set(id, {
      planRatio: ratioOf(planTok),
      actualRatio: actTok == null ? null : ratioOf(actTok),
      planHours: hoursOf(planTok),
      actualHours: actTok == null ? null : hoursOf(actTok),
    });
  }
  return out;
}

/**
 * Pick the allocation the mark should read: the one filed for the round being
 * priced, and only when effort weighting is switched on. Returns null — an
 * exact identity at the marking desk — for an off switch, an absent round, or
 * a book that has never filed a budget.
 */
export function effortFor(
  allocations: Allocation[] | undefined,
  roundKey: string,
  enabled: boolean,
): Allocation | null {
  if (!enabled || !allocations?.length) return null;
  return allocations.find((a) => a.roundKey === roundKey) ?? null;
}
