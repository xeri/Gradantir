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
    case "rest":
      if (typeof id !== "string" || !id) return `${at}: missing id`;
      if (typeof raw.date !== "string" || !ISO_DATE.test(raw.date)) return `${at}: date "${String(raw.date)}" is not YYYY-MM-DD`;
      if (!finite(raw.hours)) return `${at}: hours is not a number`;
      return null;
    case "disruptions":
      if (typeof id !== "string" || !id) return `${at}: missing id`;
      if (typeof raw.date !== "string" || !ISO_DATE.test(raw.date)) return `${at}: date "${String(raw.date)}" is not YYYY-MM-DD`;
      if (typeof raw.kind !== "string" || !DISRUPTION_KINDS.has(raw.kind)) return `${at}: kind "${String(raw.kind)}" is not one of ${[...DISRUPTION_KINDS].join("/")}`;
      return null;
  }
}

export function reviewWire(
  parsed: { payload: ImportPayload; raw: WireRaw },
  current: AppData,
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
  const lintCtx: LintCtx = { subjectIds: rawSubjectIds, entrySubjectOf: rawEntrySubjectOf, topicSubjectOf: rawTopicSubjectOf };

  const sections = WIRE_SECTIONS.map((spec): SectionReview => {
    const rawRows = raw[spec.key];
    const kept = payload[spec.key] as { id: string }[];
    const keptIds = new Set(kept.map((r) => r.id));
    const existing = currentIds[spec.key];
    const updated = kept.filter((r) => existing.has(r.id)).length;
    const dropped = Math.max(0, rawRows.length - kept.length);
    const reasons: string[] = [];
    if (dropped > 0) {
      for (let i = 0; i < rawRows.length && reasons.length < MAX_REASONS; i++) {
        const row = rawRows[i];
        // A raw row whose id survived was kept — its defects were repaired.
        if (isRecord(row) && typeof row.id === "string" && keptIds.has(row.id)) continue;
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
  return {
    ...payload,
    subjects: payload.subjects.map((s) => {
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
    }),
  };
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
  return {
    ...payload,
    entries: keep("entries") ? payload.entries : [],
    upcoming,
    allocations: keep("allocations") ? payload.allocations : [],
    duels: keep("duels") ? payload.duels : [],
    meanCalls: keep("meanCalls") ? payload.meanCalls : [],
    // T2 minor: these five used to ride the `...payload` spread through
    // unconditionally — WireSectionKey had no keys for them, so an
    // excluded-section toggle could never actually reach them.
    topics: keep("topics") ? payload.topics : [],
    topicMarks: keep("topicMarks") ? payload.topicMarks : [],
    sessions: keep("sessions") ? payload.sessions : [],
    rest: keep("rest") ? payload.rest : [],
    disruptions: keep("disruptions") ? payload.disruptions : [],
  };
}
