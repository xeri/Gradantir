import { TYPES } from "../../constants";
import { DISRUPTION_KINDS, ISO_DATE, SESSION_KINDS, TERM_KEY, sameDesk, type ImportPayload } from "../io";
import { WIRE_SECTIONS, type WireSectionKey } from "./schema";
import type { WireRaw } from "./parse";
import type { AppData } from "../../types";

/**
 * The review step between "the AI replied" and "it is in the book" (§29).
 *
 * The TRUTH about what survives is `sanitizeBook`, already applied inside the
 * payload this module receives — nothing here re-decides a row's fate. What
 * the review adds is an account: how many rows each section offered, how many
 * survived, which of those update rows the book already holds, and a
 * best-effort REASON for the casualties, linted from the raw rows for display
 * only. The elicitation sections are flagged so the student confirms the AI
 * only transcribed calls they actually made.
 */

export interface SectionReview {
  key: WireSectionKey;
  title: string;
  /** True for the transcribe-only sections that score the student's skill. */
  elicitation: boolean;
  /** Rows the raw payload offered. */
  found: number;
  /** Rows that survived the sanitizer — the number that will actually land. */
  kept: number;
  /** Kept rows whose id is new to the current book. */
  added: number;
  /** Kept rows whose id already exists — a merge will overwrite them. */
  updated: number;
  dropped: number;
  /** Best-effort explanations for dropped rows. Display only; capped. */
  reasons: string[];
}

export interface WireReview {
  sections: SectionReview[];
  /** How many kept upcoming rows carry the wire's own forecast. */
  aiPredCount: number;
  /** Total kept rows across all sections — zero means nothing to apply. */
  keptTotal: number;
}

const MAX_REASONS = 5;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const finite = (v: unknown): v is number => typeof v === "number" && isFinite(v);

/** Best-effort cross-reference context, built once from the raw payload's own rows. */
interface LintCtx {
  subjectIds: Set<string>;
  /** raw entry id -> its declared (unvalidated) subjectId. */
  entrySubjectOf: Map<string, string>;
  /** raw topic id -> its declared (unvalidated) subjectId. */
  topicSubjectOf: Map<string, string>;
  /** date -> how many otherwise-well-formed raw `rest` rows claim it. */
  restDateCounts: Map<string, number>;
}

/** One cheap, human-readable defect per raw row — the first that applies. */
function lintRow(key: WireSectionKey, raw: unknown, i: number, ctx: LintCtx): string | null {
  const at = `${key}[${i}]`;
  if (!isRecord(raw)) return `${at}: not an object`;
  const id = raw.id;
  const sid = raw.subjectId;
  const { subjectIds } = ctx;
  switch (key) {
    case "subjects":
      if (typeof id !== "string" || !id) return `${at}: missing id`;
      if (typeof raw.name !== "string" || !raw.name.trim()) return `${at}: missing name`;
      return null;
    case "entries":
    case "upcoming": {
      if (key === "upcoming" && (typeof id !== "string" || !id)) return `${at}: a sitting must carry an id`;
      if (typeof sid !== "string" || !sid) return `${at}: missing subjectId`;
      if (!subjectIds.has(sid)) return `${at}: subjectId "${sid}" is not in the payload's subjects`;
      if (typeof raw.date !== "string" || !ISO_DATE.test(raw.date)) return `${at}: date "${String(raw.date)}" is not YYYY-MM-DD`;
      if (typeof raw.type !== "string" || !(TYPES as string[]).includes(raw.type)) return `${at}: type "${String(raw.type)}" is not one of ${TYPES.join("/")}`;
      if (key === "entries" && !finite(raw.score)) return `${at}: score is not a number`;
      return null;
    }
    case "allocations":
      if (typeof id !== "string" || !id) return `${at}: missing id`;
      if (typeof raw.roundKey !== "string" || !TERM_KEY.test(raw.roundKey)) return `${at}: roundKey "${String(raw.roundKey)}" is not YYYY-T1..T4`;
      if (!finite(raw.total) || raw.total <= 0) return `${at}: total must be a positive number`;
      return null;
    case "duels": {
      if (typeof id !== "string" || !id) return `${at}: missing id`;
      const { aId, bId, winnerId } = raw;
      if (typeof aId !== "string" || typeof bId !== "string" || !subjectIds.has(aId) || !subjectIds.has(bId)) return `${at}: a duel over an unknown desk`;
      if (aId === bId) return `${at}: a desk cannot duel itself`;
      if (winnerId !== aId && winnerId !== bId) return `${at}: the winner is neither desk`;
      if (typeof raw.createdAt !== "string" || !ISO_DATE.test(raw.createdAt)) return `${at}: createdAt is not YYYY-MM-DD`;
      return null;
    }
    case "meanCalls":
      if (typeof id !== "string" || !id) return `${at}: missing id`;
      if (typeof raw.roundKey !== "string" || !TERM_KEY.test(raw.roundKey)) return `${at}: roundKey is not YYYY-T1..T4`;
      if (!finite(raw.predAvg)) return `${at}: predAvg is not a number`;
      return null;
    case "topics":
      if (typeof id !== "string" || !id) return `${at}: missing id`;
      if (typeof sid !== "string" || !sid) return `${at}: missing subjectId`;
      if (!subjectIds.has(sid)) return `${at}: subjectId "${sid}" is not in the payload's subjects`;
      if (typeof raw.name !== "string" || !raw.name.trim()) return `${at}: missing name`;
      return null;
    case "topicMarks": {
      if (typeof id !== "string" || !id) return `${at}: missing id`;
      const entryId = raw.entryId;
      const topicId = raw.topicId;
      if (typeof entryId !== "string" || !ctx.entrySubjectOf.has(entryId)) return `${at}: entryId "${String(entryId)}" is not in the payload's entries`;
      if (typeof topicId !== "string" || !ctx.topicSubjectOf.has(topicId)) return `${at}: topicId "${String(topicId)}" is not in the payload's topics`;
      if (ctx.entrySubjectOf.get(entryId) !== ctx.topicSubjectOf.get(topicId)) return `${at}: the entry and the topic disagree on subject`;
      if (!finite(raw.scorePct)) return `${at}: scorePct is not a number`;
      return null;
    }
    case "sessions":
      if (typeof id !== "string" || !id) return `${at}: missing id`;
      if (typeof sid !== "string" || !sid) return `${at}: missing subjectId`;
      if (!subjectIds.has(sid)) return `${at}: subjectId "${sid}" is not in the payload's subjects`;
      if (typeof raw.date !== "string" || !ISO_DATE.test(raw.date)) return `${at}: date "${String(raw.date)}" is not YYYY-MM-DD`;
      if (!finite(raw.minutes)) return `${at}: minutes is not a number`;
      if (typeof raw.kind !== "string" || !SESSION_KINDS.has(raw.kind)) return `${at}: kind "${String(raw.kind)}" is not one of ${[...SESSION_KINDS].join("/")}`;
      return null;
    case "rest": {
      if (typeof id !== "string" || !id) return `${at}: missing id`;
      if (typeof raw.date !== "string" || !ISO_DATE.test(raw.date)) return `${at}: date "${String(raw.date)}" is not YYYY-MM-DD`;
      if (!finite(raw.hours)) return `${at}: hours is not a number`;
      // sanitizeRestList dedupes by DATE, not id (io.ts) — a second
      // otherwise-valid reading for the same night is the actual rule that
      // drops a rest row, so name that instead of falling through to the
      // generic "failed validation" message.
      if ((ctx.restDateCounts.get(raw.date) ?? 0) > 1) return `${at}: a second reading for ${raw.date} — one row per night`;
      return null;
    }
    case "disruptions":
      if (typeof id !== "string" || !id) return `${at}: missing id`;
      if (typeof raw.date !== "string" || !ISO_DATE.test(raw.date)) return `${at}: date "${String(raw.date)}" is not YYYY-MM-DD`;
      if (typeof raw.kind !== "string" || !DISRUPTION_KINDS.has(raw.kind)) return `${at}: kind "${String(raw.kind)}" is not one of ${[...DISRUPTION_KINDS].join("/")}`;
      return null;
  }
}

/**
 * Cross-section dependencies the cascade enforces: a listed section can only
 * reach the merge while every section named here is ALSO included — the
 * SINGLE source of truth for that rule, consumed by both `filterPayload`
 * (what actually merges) and `reviewWire` (what the manifest shows), so the
 * two can never drift apart the way they did the first time: a student
 * could see "N NEW" beside TOPIC MARKS with its own toggle ON, untick
 * TOPICS, and merge zero topic marks with the manifest never having said so.
 *
 * Deliberately does NOT include a section's own toggle — that already
 * behaves like every other section's (a static count next to the toggle
 * that governs it, exactly as `entries`/`duels`/etc. do); only a
 * DEPENDENCY toggle needs to invalidate a sibling section's display.
 */
const SECTION_DEPENDS_ON: Partial<Record<WireSectionKey, WireSectionKey[]>> = {
  topicMarks: ["entries", "topics"],
};

/** Which of `key`'s dependencies (if any) are currently toggled OFF. */
function blockedByDependency(
  key: WireSectionKey,
  include: Partial<Record<WireSectionKey, boolean>>,
): WireSectionKey[] {
  const keep = (k: WireSectionKey): boolean => include[k] !== false;
  return (SECTION_DEPENDS_ON[key] ?? []).filter((dep) => !keep(dep));
}

export function reviewWire(
  parsed: { payload: ImportPayload; raw: WireRaw },
  current: AppData,
  /**
   * The student's current per-section include toggles, so a cascade-blocked
   * section (see `SECTION_DEPENDS_ON`) can show 0 rather than a stale count.
   * Optional and defaults to "nothing excluded yet" — the shape `validate()`
   * calls this with before the student has touched a toggle.
   */
  include: Partial<Record<WireSectionKey, boolean>> = {},
): WireReview {
  const { payload, raw } = parsed;
  const currentIds: Record<WireSectionKey, Set<string>> = {
    subjects: new Set(current.subjects.map((s) => s.id)),
    entries: new Set(current.entries.map((e) => e.id)),
    upcoming: new Set((current.upcoming ?? []).map((u) => u.id)),
    allocations: new Set((current.allocations ?? []).map((a) => a.id)),
    duels: new Set((current.duels ?? []).map((d) => d.id)),
    meanCalls: new Set((current.meanCalls ?? []).map((m) => m.id)),
    topics: new Set((current.topics ?? []).map((t) => t.id)),
    topicMarks: new Set((current.topicMarks ?? []).map((m) => m.id)),
    sessions: new Set((current.sessions ?? []).map((s) => s.id)),
    rest: new Set((current.rest ?? []).map((r) => r.id)),
    disruptions: new Set((current.disruptions ?? []).map((d) => d.id)),
  };
  // Lint resolves subject refs against the RAW payload's own subject ids —
  // the sanitizer's rule ("your entries only reference your subjects").
  const rawSubjectIds = new Set(
    raw.subjects.filter(isRecord).map((s) => s.id).filter((id): id is string => typeof id === "string"),
  );
  // topicMarks lint needs the dual FK resolved against the RAW payload's own
  // entries/topics too — best-effort, display only (the sanitizer is the
  // real gate); a raw row with a non-string id is simply invisible to it.
  const rawEntrySubjectOf = new Map<string, string>();
  for (const e of raw.entries) {
    if (isRecord(e) && typeof e.id === "string" && typeof e.subjectId === "string") rawEntrySubjectOf.set(e.id, e.subjectId);
  }
  const rawTopicSubjectOf = new Map<string, string>();
  for (const t of raw.topics) {
    if (isRecord(t) && typeof t.id === "string" && typeof t.subjectId === "string") rawTopicSubjectOf.set(t.id, t.subjectId);
  }
  // Counted with the SAME admission test `sanitizeRest` applies (id, date,
  // hours all present/valid) — a row that would fail on its own merits never
  // reaches `sanitizeRestList`'s date-dedup map, so it must not count here
  // either, or a merely-malformed row could be mis-blamed on a "duplicate".
  const restDateCounts = new Map<string, number>();
  for (const r of raw.rest) {
    if (isRecord(r) && typeof r.id === "string" && r.id && typeof r.date === "string" && ISO_DATE.test(r.date) && finite(r.hours)) {
      restDateCounts.set(r.date, (restDateCounts.get(r.date) ?? 0) + 1);
    }
  }
  const lintCtx: LintCtx = {
    subjectIds: rawSubjectIds, entrySubjectOf: rawEntrySubjectOf, topicSubjectOf: rawTopicSubjectOf, restDateCounts,
  };

  const sections = WIRE_SECTIONS.map((spec): SectionReview => {
    const rawRows = raw[spec.key];
    // `validationKept` is what the SANITIZER let through — toggle-independent,
    // the same number this file always computed. `blockers` names any
    // DEPENDENCY (not this section's own toggle) currently switched off; when
    // one is, every validated row here is cascade-blocked too, and that is a
    // DIFFERENT reason than "failed validation" — the rows are fine, they
    // just can't land without what they reference.
    const validationKept = payload[spec.key] as { id: string }[];
    const validKeptIds = new Set(validationKept.map((r) => r.id));
    const blockers = blockedByDependency(spec.key, include);
    const cascaded = blockers.length > 0 && validationKept.length > 0;
    const kept = cascaded ? ([] as { id: string }[]) : validationKept;
    const existing = currentIds[spec.key];
    const updated = kept.filter((r) => existing.has(r.id)).length;
    const dropped = cascaded ? rawRows.length : Math.max(0, rawRows.length - validationKept.length);
    const reasons: string[] = [];
    if (cascaded) {
      reasons.push(
        `${spec.key}: ${validationKept.length} row${validationKept.length === 1 ? "" : "s"} excluded — ${blockers.join(" and ")} unticked above`,
      );
    } else if (dropped > 0) {
      for (let i = 0; i < rawRows.length && reasons.length < MAX_REASONS; i++) {
        const row = rawRows[i];
        // A raw row whose id survived was kept — its defects were repaired.
        if (isRecord(row) && typeof row.id === "string" && validKeptIds.has(row.id)) continue;
        const reason = lintRow(spec.key, row, i, lintCtx);
        if (reason) reasons.push(reason);
      }
      if (!reasons.length) reasons.push(`${spec.key}: ${dropped} row${dropped === 1 ? "" : "s"} failed validation`);
    }
    return {
      key: spec.key,
      title: spec.title,
      elicitation: spec.elicitation,
      found: rawRows.length,
      kept: kept.length,
      added: kept.length - updated,
      updated,
      dropped,
      reasons,
    };
  });

  return {
    sections,
    aiPredCount: payload.upcoming.filter((u) => !!u.aiPred).length,
    keptTotal: sections.reduce((a, s) => a + s.kept, 0),
  };
}

/**
 * Apply the review's include switches: an excluded section lands empty, and
 * with the forecast toggle off every `aiPred` is stripped before the merge.
 * `subjects` is deliberately not excludable — every other section references
 * it, and a payload without its roster would orphan all of them.
 */
/**
 * Re-hydrate echoed subjects from the current book before applying.
 *
 * The prompt orders a full-field roster echo, but the sanitizer cannot tell
 * "the model said null" from "the model dropped the key" — and `mergeData`
 * replaces subject rows wholesale, so a stripped echo would cost the book its
 * colors, coursework splits and `formerly` lineage (the doubled-denominator
 * shape io.ts warns about) — and, since T2, its shape priors (`traits`,
 * `mix`) and self-ratings (`belief`, `attendancePct`) too: those are set once
 * and rarely revisited, so losing one to a stripped echo would go unnoticed
 * for a term. For every incoming subject that IS a desk the book already
 * holds, keep the book's color outright (an intake never recolors a desk)
 * and fall back to the book's value wherever the echo is null or silent.
 * Explicit incoming values still win; an id collision that is a different
 * desk passes through untouched for `mergeData` to re-list.
 */
export function rehydrateSubjects(payload: ImportPayload, current: AppData): ImportPayload {
  const held = new Map(current.subjects.map((s) => [s.id, s]));
  const subjects = payload.subjects.map((s) => {
    const cur = held.get(s.id);
    if (!cur || !sameDesk(cur, s)) return s;
    const formerly = s.formerly ?? cur.formerly;
    const traits = s.traits ?? cur.traits;
    const mix = s.mix ?? cur.mix;
    const belief = s.belief ?? cur.belief;
    const attendancePct = s.attendancePct ?? cur.attendancePct;
    return {
      ...s,
      color: cur.color,
      target: s.target ?? cur.target,
      courseworkPct: s.courseworkPct ?? cur.courseworkPct,
      ...(formerly ? { formerly } : {}),
      ...(s.archived || cur.archived ? { archived: true } : {}),
      ...(traits ? { traits } : {}),
      ...(mix ? { mix } : {}),
      ...(belief != null ? { belief } : {}),
      ...(attendancePct != null ? { attendancePct } : {}),
    };
  });
  // B4 review finding: `sanitizeBook` cuts a `formerly` pointing outside the
  // roster (io.ts), but that runs INSIDE `parseImport`, before this function
  // ever restores anything — so a formerly rehydrated from the CURRENT book
  // can point at a desk this payload's own roster does not contain (an
  // ancestor the reply never echoed). On the REPLACE path that ancestor is
  // discarded entirely, and the successor would ship pointing at a desk not
  // in the book — `assertLineageIntact` only warns, silently, in production.
  // Re-running the same dangling-pointer cut over the PAYLOAD's own roster
  // (not the current book's) closes it exactly the way `sanitizeBook` would
  // have, had the pointer existed before parseImport ran.
  const ids = new Set(subjects.map((s) => s.id));
  const cut = subjects.map((s) => (s.formerly && !ids.has(s.formerly) ? { ...s, formerly: null } : s));
  return { ...payload, subjects: cut };
}

export function filterPayload(
  payload: ImportPayload,
  include: Partial<Record<WireSectionKey, boolean>>,
  includeForecasts: boolean,
): ImportPayload {
  const keep = (key: WireSectionKey): boolean => include[key] !== false;
  const upcoming = keep("upcoming")
    ? payload.upcoming.map((u) => {
        if (includeForecasts || !u.aiPred) return u;
        const { aiPred: _aiPred, ...rest } = u;
        return rest;
      })
    : [];
  const topicsKept = keep("topics");
  // A session's `topicIds` references topics the same way a topicMark does —
  // excluding topics must strip the reference, not just the whole section,
  // since `mergeData` merges sessions independently of topics and nothing
  // re-sanitizes the merged book afterward (sanitizeBook runs only on load,
  // storage.ts) — a stale topicId sitting in state would dangle silently.
  const sessions = keep("sessions")
    ? payload.sessions.map((s) => {
        if (topicsKept || !s.topicIds) return s;
        const { topicIds: _topicIds, ...rest } = s;
        return rest;
      })
    : [];
  return {
    ...payload,
    // B1 review finding: `parseImport` (which the wire path reuses wholesale)
    // reads a top-level "settings" key unconditionally, and `sanitizeSettings`
    // builds a COMPLETE, valid Settings object from whatever survives — so a
    // bare `"settings": {}`, or any partial echo, would hand `mergeData` a
    // full replacement for the school calendar, per-type weights,
    // `ignoredSplits`, `subjectCorr`, `depth` and every pricing switch,
    // invisibly: `WireRaw` carries no settings field, the review manifest has
    // no row for it, and no toggle here ever named it. The wire path can
    // never carry a settings replacement — only the file-import path (the
    // student's own export) may still replace them, via `replaceData`/
    // `mergeData` reading `ImportPayload.settings` directly, outside this fn.
    settings: null,
    entries: keep("entries") ? payload.entries : [],
    upcoming,
    allocations: keep("allocations") ? payload.allocations : [],
    duels: keep("duels") ? payload.duels : [],
    meanCalls: keep("meanCalls") ? payload.meanCalls : [],
    // T2 minor: these five used to ride the `...payload` spread through
    // unconditionally — WireSectionKey had no keys for them, so an
    // excluded-section toggle could never actually reach them.
    topics: topicsKept ? payload.topics : [],
    // A topicMark's dual FK only holds when BOTH the entry and the topic it
    // names are themselves being filed in this same merge — excluding
    // `entries` or `topics` (or topicMarks itself) must drop every topicMark,
    // because `mergeData` merges each section independently with no
    // re-sanitize pass on the result: a topicMark surviving here with its
    // entryId/topicId excluded would sit in state referencing a row this
    // very merge chose not to add. `blockedByDependency` is the SAME check
    // `reviewWire` uses to decide what the manifest shows, so the two can
    // never disagree about which rows actually land.
    topicMarks: blockedByDependency("topicMarks", include).length === 0 && keep("topicMarks") ? payload.topicMarks : [],
    sessions,
    rest: keep("rest") ? payload.rest : [],
    disruptions: keep("disruptions") ? payload.disruptions : [],
  };
}
