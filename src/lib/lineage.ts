import { DEFAULT_CALENDAR, type SchoolCalendar } from "./calendar";
import { closeTermOf, listedAt } from "./listing";
import { uid } from "./utils";
import type { GradeEntry, Subject } from "../types";

/**
 * LINEAGE — one desk becoming another, or becoming two.
 *
 * Schools reorganise their subjects. Business & Economics splits into Business
 * and Economics; Social Studies becomes Geography and History; Science narrows
 * to Physics. The tape does not restart when that happens — the student's
 * history is continuous even though the desk's name is not.
 *
 * The rule is that the prints live on the ANCESTOR, once. A successor carries
 * `formerly` and only its own post-split prints. Nothing is ever copied, which
 * is the whole point: a copied tape is counted twice by every cross-desk sum in
 * the book, and the damage is not cosmetic. Two identical subject means shrink
 * the between-subject variance in the pooled prior, so a duplicated desk makes
 * the engine *more confident* in a book it understands less well.
 *
 * Two tape rules follow, and they must not be mixed up:
 *
 *   AGGREGATES and ROSTERS read a desk's OWN entries. A round contains exactly
 *   the desks that printed into it — the ancestor before the split, the
 *   successors after, never both.
 *
 *   PER-DESK PRICING reads INHERITED entries. A desk that split last term
 *   still prices off the years behind it instead of off a single point.
 */

/* ── the chain ─────────────────────────────────────────────────────── */

/**
 * Every desk this one descends from, nearest first. Cycle-safe: a book hand
 * edited into a loop returns the desks it can reach rather than hanging.
 */
export function ancestorsOf(sub: Subject, subjects: Subject[]): Subject[] {
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const out: Subject[] = [];
  const seen = new Set<string>([sub.id]);
  let cur = sub;
  while (cur.formerly) {
    const parent = byId.get(cur.formerly);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    out.push(parent);
    cur = parent;
  }
  return out;
}

/**
 * The oldest desk in the chain — the lineage's identity. Two successors of one
 * split share a root, which is what lets a cross-desk sum count them once.
 */
export function lineageRootOf(sub: Subject, subjects: Subject[]): Subject {
  const chain = ancestorsOf(sub, subjects);
  return chain.length ? chain[chain.length - 1] : sub;
}

/** Desks that descend directly from `sub`. */
export const successorsOf = (sub: Subject, subjects: Subject[]): Subject[] =>
  subjects.filter((s) => s.formerly === sub.id);

const byDate = (a: GradeEntry, b: GradeEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/**
 * A desk's tape INCLUDING everything it inherited — for pricing, charting and
 * forecasting one desk. Never for summing across desks.
 */
export function inheritedEntries(
  sub: Subject,
  subjects: Subject[],
  entries: GradeEntry[],
): GradeEntry[] {
  const ids = new Set([sub.id, ...ancestorsOf(sub, subjects).map((s) => s.id)]);
  return entries.filter((e) => ids.has(e.subjectId)).sort(byDate);
}

/**
 * The book's prints grouped by LINEAGE — every print exactly once, under the
 * tape it belongs to. BEA's prints and its successors' land in one group.
 *
 * This is what cross-sectional statistics must pool over. The empirical-Bayes
 * prior treats each group as one independent subject, so grouping by desk would
 * split a single tape into three thin ones the moment it split, and copying the
 * tape onto each successor would instead present it as three identical
 * subjects — which shrinks the between-subject variance and makes the engine
 * spuriously confident. Grouping by lineage is stable across a split: the same
 * prints, in the same group, before and after.
 */
export function groupByLineage(subjects: Subject[], entries: GradeEntry[]): GradeEntry[][] {
  const rootOf = new Map(subjects.map((s) => [s.id, lineageRootOf(s, subjects).id]));
  const groups = new Map<string, GradeEntry[]>();
  for (const s of subjects) groups.set(rootOf.get(s.id) as string, []);
  for (const e of entries) {
    const root = rootOf.get(e.subjectId);
    if (root != null) groups.get(root)?.push(e);
  }
  return [...groups.values()].map((es) => es.sort(byDate));
}

/* ── the single membership rule ────────────────────────────────────── */

export interface RosterRow {
  sub: Subject;
  /** The desk's OWN prints on or before the cutoff, oldest first. */
  entries: GradeEntry[];
}

/**
 * The book as it stood at `asOfIso`: every desk that was listed then AND had
 * actually printed by then, carrying its own prints only.
 *
 * This is the ONE place that decides who is in a round. Both aggregate tapes
 * and the live headline read it, so the rule cannot drift between them — which
 * is exactly how a denominator goes wrong without anyone noticing.
 */
export function rosterAt(
  subjects: Subject[],
  entries: GradeEntry[],
  asOfIso: string,
  cal: SchoolCalendar = DEFAULT_CALENDAR,
): RosterRow[] {
  const own = new Map<string, GradeEntry[]>(subjects.map((s) => [s.id, []]));
  for (const e of entries) {
    if (e.date > asOfIso) continue;
    own.get(e.subjectId)?.push(e);
  }
  const rows: RosterRow[] = [];
  for (const sub of subjects) {
    const es = (own.get(sub.id) ?? []).sort(byDate);
    // A desk that has not printed yet is not on the book — this is what keeps
    // a successor out of its ancestor's rounds.
    if (!es.length) continue;
    // `closeTermOf` reads the FULL tape, not the truncated one: a desk's
    // closing term is a fact about the desk, not about where we are standing.
    const full = entries.filter((e) => e.subjectId === sub.id);
    if (!listedAt(closeTermOf(sub, full, cal), asOfIso, cal)) continue;
    rows.push({ sub, entries: es });
  }
  assertRoster(rows, subjects);
  return rows;
}

/**
 * The invariant that makes a doubled denominator impossible rather than merely
 * fixed: a round may never seat a desk and any desk it descends from.
 *
 * Loud under test, a warning in dev, silent in production — a student opening
 * their grades should never eat a stack trace over a bookkeeping rule.
 */
const env = (import.meta as { env?: { MODE?: string; DEV?: boolean } }).env;

export function assertRoster<T extends { sub: Subject }>(rows: T[], subjects: Subject[]): void {
  const seated = new Set(rows.map((r) => r.sub.id));
  for (const r of rows) {
    for (const a of ancestorsOf(r.sub, subjects)) {
      if (!seated.has(a.id)) continue;
      const msg =
        `lineage violation: ${r.sub.ticker} and its ancestor ${a.ticker} are both ` +
        `on the book at once — ${a.ticker}'s prints would be counted twice`;
      if (env?.MODE === "test") throw new Error(msg);
      if (env?.DEV) console.warn(msg);
      return;
    }
  }
}

/**
 * The successor that has taken this desk's tape over, or null.
 *
 * A desk stops reporting the moment a descendant prints under its own name —
 * from then on the descendant carries the lineage. This is the same rule
 * `crossSectionAt` applies below, lifted out so the two places that must ENFORCE
 * it can share it: the loader/importer, which repairs a book that arrives
 * violating it, and the drawer, which must not offer to relist a desk whose
 * history has moved on.
 *
 * `assertRoster` states the invariant and is compiled out of a production build.
 * That makes it a development aid, not a guard — something has to keep the book
 * true for the student who never runs the tests, and this is it.
 *
 * Cycle-safe by construction: it reads `ancestorsOf`, which already is.
 */
export function supersededBy(
  sub: Subject,
  subjects: Subject[],
  entries: GradeEntry[],
): Subject | null {
  const printed = new Set<string>();
  for (const e of entries) printed.add(e.subjectId);
  for (const s of subjects) {
    if (s.id === sub.id || !printed.has(s.id)) continue;
    // Transitive on purpose: a chain whose middle desk never printed still
    // hands the lineage to whatever DID print at the end of it.
    if (ancestorsOf(s, subjects).some((a) => a.id === sub.id)) return s;
  }
  return null;
}

/**
 * The desks that take part in a CROSS-SECTION at `asOfIso` — the "versus the
 * book" comparisons: relative volatility, lag, percentile ranks.
 *
 * A desk qualifies once it has printed under its own name, and stops the moment
 * a successor starts printing, because from then on the successor carries its
 * tape. Without the second half BEA would be ranked beside ECON and BUS while
 * all three hold the same prints, entering one tape three times into every
 * comparison drawn from it.
 *
 * Delisted desks stay in — a closed desk is still evidence about the field.
 * Whether it sets the BAR is a separate question, answered by `rateBook`.
 */
export function crossSectionAt(
  subjects: Subject[],
  entries: GradeEntry[],
  asOfIso: string,
): Subject[] {
  const printed = new Set<string>();
  for (const e of entries) if (e.date <= asOfIso) printed.add(e.subjectId);
  return subjects.filter(
    (s) => printed.has(s.id) && !successorsOf(s, subjects).some((suc) => printed.has(suc.id)),
  );
}

/**
 * A desk that descends from one not present has lost its history silently —
 * the tape it prices on is a fraction of the truth and nothing on screen says
 * so. This is the easy mistake: filtering `!archived` before handing the book
 * to the engine drops the ancestors along with the merely-closed desks.
 *
 * Compute on the FULL book and filter the RESULTS. This makes the alternative
 * fail loudly instead of quietly mispricing every desk that ever split.
 */
export function assertLineageIntact(subjects: Subject[]): void {
  const ids = new Set(subjects.map((s) => s.id));
  for (const s of subjects) {
    if (!s.formerly || ids.has(s.formerly)) continue;
    const msg =
      `lineage broken: ${s.ticker} descends from a desk that is not in this book, so ` +
      `its inherited history is missing. Compute on the full book and filter the results.`;
    if (env?.MODE === "test") throw new Error(msg);
    if (env?.DEV) console.warn(msg);
    return;
  }
}

/* ── detection ─────────────────────────────────────────────────────── */

export interface SplitPlan {
  /** Stable identity for this suggestion, so a dismissal can be remembered. */
  key: string;
  members: Subject[];
  /** Prints the members report identically — the ancestor's real tape. */
  shared: GradeEntry[];
  /** First date the members disagree, i.e. when the split took effect. */
  divergesAt: string | null;
  /** A guess at what the ancestor was called, offered as a prefill. */
  suggestedTicker: string;
}

/** Same day, same kind, same mark — one print wearing two names. */
const sig = (e: GradeEntry) => `${e.date}|${e.type}|${e.score}`;

/** Below this, two desks scoring alike is a coincidence, not a lineage. */
const MIN_SHARED = 3;

/**
 * Find desks whose early tapes are identical — one desk that was split into
 * several without its history being split with it.
 *
 * Deliberately conservative. A false positive silently deletes a subject from
 * someone's book, so the bar is a run of at least three prints matching on date,
 * type AND score. Desks that already declare a lineage are never re-flagged.
 */
export function detectSplits(
  subjects: Subject[],
  entries: GradeEntry[],
  ignored: string[] = [],
): SplitPlan[] {
  const dismissed = new Set(ignored);
  // A desk already in a lineage — either end of it — is settled business.
  const declared = new Set<string>();
  for (const s of subjects) {
    if (!s.formerly) continue;
    declared.add(s.id);
    declared.add(s.formerly);
  }
  const candidates = subjects.filter((s) => !declared.has(s.id));

  const tape = new Map<string, GradeEntry[]>();
  for (const s of candidates) tape.set(s.id, []);
  for (const e of entries) tape.get(e.subjectId)?.push(e);
  for (const es of tape.values()) es.sort(byDate);

  const used = new Set<string>();
  const plans: SplitPlan[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (used.has(a.id)) continue;
    const aTape = tape.get(a.id) ?? [];
    if (aTape.length < MIN_SHARED) continue;

    const group = [a];
    let shared = aTape;

    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (used.has(b.id)) continue;
      const bSigs = new Set((tape.get(b.id) ?? []).map(sig));
      const common = shared.filter((e) => bSigs.has(sig(e)));
      if (common.length < MIN_SHARED) continue;
      // Every one of the shared prints must be a genuine overlap in time, not
      // one desk's whole tape sitting inside a gap in another's.
      group.push(b);
      shared = common;
    }

    if (group.length < 2) continue;

    const rawSigs = new Set(shared.map(sig));
    const diverge = group
      .flatMap((s) => tape.get(s.id) ?? [])
      .filter((e) => !rawSigs.has(sig(e)))
      .map((e) => e.date)
      .sort();
    const divergesAt = diverge[0] ?? null;

    /* THE OVERLAP RULE the paragraph above promises, actually applied. `shared`
       so far is a whole-tape signature intersection with no sense of time, so
       two desks that genuinely split in 2024 and then coincidentally both print
       68 on a Test in 2026 count that 2026 print as shared history — and the
       merge below collapses it, destroying one of the two real results.
       Shared history ends where the desks diverge, by definition.

       Filtering here cannot move `divergesAt`: everything dropped is dated at
       or after it, so the earliest divergence is unchanged and one pass is a
       fixed point. */
    if (divergesAt != null) shared = shared.filter((e) => e.date < divergesAt);
    // What is left has to still look like a split rather than a coincidence.
    if (shared.length < MIN_SHARED) continue;

    const key = group.map((s) => s.id).sort().join("+");
    if (dismissed.has(key)) continue;
    for (const s of group) used.add(s.id);
    plans.push({
      key,
      members: group,
      shared,
      divergesAt,
      suggestedTicker: group.map((s) => s.ticker[0]).join("").slice(0, 4) || "OLD",
    });
  }
  return plans;
}

/* ── the merge ─────────────────────────────────────────────────────── */

/**
 * Collapse a detected split into one ancestor: the shared prints move to a new
 * archived desk, each member keeps only what it reported on its own, and every
 * member points back at the ancestor.
 */
export function applySplit<T extends { subjects: Subject[]; entries: GradeEntry[] }>(
  data: T,
  plan: SplitPlan,
  ancestorTicker: string,
  ancestorName?: string,
): T {
  const memberIds = new Set(plan.members.map((s) => s.id));
  const eldest = plan.members[0];
  const ancestor: Subject = {
    id: uid(),
    name: ancestorName?.trim() || `${ancestorTicker.trim()} (former)`,
    ticker: ancestorTicker.trim().toUpperCase().slice(0, 5) || "OLD",
    color: eldest.color,
    target: null,
    courseworkPct: eldest.courseworkPct ?? null,
    archived: true,
    formerly: eldest.formerly ?? null,
  };

  const sharedSigs = new Set(plan.shared.map(sig));
  const entries: GradeEntry[] = [];
  for (const e of data.entries) {
    if (!memberIds.has(e.subjectId)) { entries.push(e); continue; }
    if (!sharedSigs.has(sig(e))) { entries.push(e); continue; }
    /* A shared print belongs to the ancestor, and only one copy survives — but
       "one copy" means the ELDEST MEMBER'S ROWS, not the first row per
       date|type|score signature. Keying the survivor on the signature quietly
       deletes a desk's legitimate repeat (two quizzes, same day, same mark are
       one signature and two real results). `shared` is built by intersecting
       down from the eldest's tape, so every shared signature is present there. */
    if (e.subjectId === eldest.id) entries.push({ ...e, subjectId: ancestor.id });
  }
  entries.sort(byDate);

  const subjects = data.subjects.map((s) =>
    memberIds.has(s.id) ? { ...s, formerly: ancestor.id } : s,
  );
  // The ancestor lists just before its eldest successor, so the book reads in
  // the order the desks actually existed.
  const at = subjects.findIndex((s) => s.id === eldest.id);
  subjects.splice(at < 0 ? subjects.length : at, 0, ancestor);

  return { ...data, subjects, entries };
}
