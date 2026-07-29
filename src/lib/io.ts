import { PALETTE, TYPES, freshSettings } from "../constants";
import { supersededBy } from "./lineage";
import { clamp, round1, uid } from "./utils";
import type {
  AiPrediction, Allocation, AppData, AssessmentType, Disruption, DisruptionKind, Duel, ErrorKind,
  GradeEntry, MeanCall, RestLog, SelfPrediction, Settings, SessionKind, StudySession,
  Subject, SubjectMix, SubjectTraits, Topic, TopicMark, Upcoming,
} from "../types";

/**
 * v10 adds the life-signals intake: syllabus topics and per-result topic
 * marks, logged study sessions, sleep and disruptions, plus subject-level
 * shape priors (`traits`, `mix`), self-rated `belief`/`attendancePct`, a
 * person-level `profile`, an hour-of-day on a sitting, and the
 * `signalWeighting` switch. The five new arrays are grouped as
 * `SignalIntake` and follow the same v8 doctrine as the forward calendar:
 * always present in the envelope, empty when nothing is logged. A v9 export
 * carries none of this — every new field is optional or defaults to "on" —
 * and imports unchanged.
 *
 * v9 lets a sitting carry the wire's call (`aiPred`, §29) and adds the opt-in
 * `aiWeighting` switch. A v8 export imports unchanged: a missing field is a
 * sitting the wire never called, and a missing switch leaves the channel OFF —
 * the switch is stored only when `true`, the inverse of the other four, because
 * an outside desk must never start pricing itself into a book that predates it.
 *
 * v8 takes the engine's own predictions OUT of the book. The forecast/bias
 * register was stored, exported, imported and merged; it is derived state, and
 * it is now rebuilt from the tape by walk-forward replay on every load (see
 * `quant/eval/replay.ts` and §26). A v6/v7 export carrying `forecasts` still
 * imports cleanly — the key is simply ignored, and the register it described is
 * recomputed, reproducibly, from the same prints.
 *
 * v8 also makes the envelope's SHAPE unconditional: every elicited section is
 * emitted, empty arrays included. What a book contains should not change what
 * fields it has, and a consumer should never have to distinguish "no duels" from
 * "a build that did not know about duels".
 *
 * v7 added the forward calendar (`upcoming`) and the behavioural-elicitation
 * layer — effort allocations, forced-choice duels, aggregate calls. Older
 * exports import unchanged: a book with no calendar carries empty arrays, which
 * every consumer treats as "nothing elicited yet".
 *
 * v5 replaced Settings.termStartMonth with a real school calendar and let an
 * entry pin its own term. Older exports import unchanged: a missing calendar
 * falls back to the published dates, and an unpinned entry follows its date.
 */
export const EXPORT_VERSION = 10;

/** The behavioural-layer arrays, grouped so the sanitizer signature stays short. */
export interface ForwardCalendar {
  upcoming: Upcoming[];
  allocations: Allocation[];
  duels: Duel[];
  meanCalls: MeanCall[];
}

/** The life-signals arrays (v10) — grouped the same way as ForwardCalendar. */
export interface SignalIntake {
  topics: Topic[];
  topicMarks: TopicMark[];
  sessions: StudySession[];
  rest: RestLog[];
  disruptions: Disruption[];
}

export interface ExportEnvelope {
  app: "grade-exchange";
  version: number;
  exportedAt: string;
  /**
   * Every section, always — see the v8 note above. Nothing the engine computed
   * appears here: the export is the INPUTS, and the outputs are recalculated
   * from them.
   */
  data: {
    subjects: Subject[]; entries: GradeEntry[]; settings: Settings;
    upcoming: Upcoming[]; allocations: Allocation[]; duels: Duel[]; meanCalls: MeanCall[];
    topics: Topic[]; topicMarks: TopicMark[]; sessions: StudySession[]; rest: RestLog[]; disruptions: Disruption[];
  };
}

export function serializeExport(data: AppData): string {
  const env: ExportEnvelope = {
    app: "grade-exchange",
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      subjects: data.subjects,
      entries: data.entries,
      settings: data.settings,
      upcoming: data.upcoming ?? [],
      allocations: data.allocations ?? [],
      duels: data.duels ?? [],
      meanCalls: data.meanCalls ?? [],
      topics: data.topics ?? [],
      topicMarks: data.topicMarks ?? [],
      sessions: data.sessions ?? [],
      rest: data.rest ?? [],
      disruptions: data.disruptions ?? [],
    },
  };
  return JSON.stringify(env, null, 2);
}

export interface ImportPayload extends ForwardCalendar, SignalIntake {
  subjects: Subject[];
  entries: GradeEntry[];
  settings: Settings | null;
  /** Entries discarded during validation (bad shape, unknown subject…). */
  dropped: number;
}

export type ImportResult = { ok: true; payload: ImportPayload } | { ok: false; error: string };

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

// Exported so the wire's prompt (`lib/wire/`) quotes the exact contracts this
// file enforces — one source, and the prompt cannot drift from the validator.
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TERM_KEY = /^\d{4}-T[1-4]$/;

export function sanitizeSettings(raw: unknown): Settings {
  const out = freshSettings();
  if (!isRecord(raw)) return out;
  if (typeof raw.weighted === "boolean") out.weighted = raw.weighted;
  // "Keep both" is an answer. Losing it here would re-ask the same question on
  // every single load, which is how a prompt becomes noise and gets clicked
  // through without being read.
  if (Array.isArray(raw.ignoredSplits)) {
    const keys = raw.ignoredSplits.filter((k): k is string => typeof k === "string" && !!k);
    if (keys.length) out.ignoredSplits = [...new Set(keys)];
  }
  // The four pricing switches are stored only when switched OFF: absent means
  // on, so a book exported before a switch existed imports with that channel
  // priced in — which is the identity anyway until something is elicited.
  if (raw.effortWeighting === false) out.effortWeighting = false;
  if (raw.selfWeighting === false) out.selfWeighting = false;
  if (raw.readinessWeighting === false) out.readinessWeighting = false;
  if (raw.aggregateCallWeighting === false) out.aggregateCallWeighting = false;
  // The wire's switch is the inverse: stored only when switched ON. Absent
  // means off, so a book exported before the wire existed — or one that never
  // opted in — keeps the AI channel out of its forecasts entirely.
  if (raw.aiWeighting === true) out.aiWeighting = true;
  if (raw.signalWeighting === false) out.signalWeighting = false;
  if (isRecord(raw.profile)) {
    const p = raw.profile;
    const chronotype = p.chronotype === "lark" || p.chronotype === "owl" ? p.chronotype : null;
    const testAnxiety =
      Number.isInteger(p.testAnxiety) && (p.testAnxiety as number) >= 1 && (p.testAnxiety as number) <= 5
        ? (p.testAnxiety as number)
        : null;
    if (chronotype != null || testAnxiety != null) {
      out.profile = {
        ...(chronotype != null ? { chronotype } : {}),
        ...(testAnxiety != null ? { testAnxiety } : {}),
      };
    }
  }
  // The affinity prior is stored only when a caller actually set a correlation;
  // 0 (or anything out of [0, 1)) leaves it absent — the quadrature default.
  if (typeof raw.subjectCorr === "number" && isFinite(raw.subjectCorr) && raw.subjectCorr > 0 && raw.subjectCorr < 1) {
    out.subjectCorr = Math.round(raw.subjectCorr * 100) / 100;
  }
  if (isRecord(raw.weights)) {
    for (const t of TYPES) {
      const w = raw.weights[t];
      if (typeof w === "number" && isFinite(w) && w > 0 && w <= 100) out.weights[t] = Math.round(w * 100) / 100;
    }
  }
  if (isRecord(raw.calendar)) {
    const c = raw.calendar;
    if (typeof c.settleDays === "number" && isFinite(c.settleDays)) {
      out.calendar.settleDays = clamp(Math.round(c.settleDays), 0, 90);
    }
    // Term dates are trusted per YEAR: a year that parses replaces the
    // published one outright, a year that does not is ignored and the
    // published dates stand. A half-valid import can never half-move a term.
    if (isRecord(c.years)) {
      for (const [year, spans] of Object.entries(c.years)) {
        if (!/^\d{4}$/.test(year) || !Array.isArray(spans) || spans.length !== 4) continue;
        const clean = spans.map((s) =>
          isRecord(s) && typeof s.start === "string" && typeof s.end === "string" &&
          ISO_DATE.test(s.start) && ISO_DATE.test(s.end) && s.start <= s.end
            ? { start: s.start, end: s.end }
            : null,
        );
        if (clean.every((s): s is { start: string; end: string } => s !== null)) {
          // Terms must run in order — an overlapping year is a typo, not a school.
          const ordered = clean.every((s, i) => i === 0 || clean[i - 1]!.end < s.start);
          if (ordered) out.calendar.years[year] = clean;
        }
      }
    }
  }
  if (isRecord(raw.depth)) {
    const d = raw.depth;
    if (Number.isInteger(d.streamsPerLevel) && (d.streamsPerLevel as number) >= 1 && (d.streamsPerLevel as number) <= 200) {
      out.depth.streamsPerLevel = d.streamsPerLevel as number;
    }
    // null is meaningful here: "derive it from streams × cohort size".
    if (d.yearSize === null) out.depth.yearSize = null;
    else if (Number.isInteger(d.yearSize) && (d.yearSize as number) >= 2 && (d.yearSize as number) <= 100000) {
      out.depth.yearSize = d.yearSize as number;
    }
    if (typeof d.streamTightness === "number" && isFinite(d.streamTightness)) {
      out.depth.streamTightness = clamp(Math.round(d.streamTightness * 100) / 100, 0, 1);
    }
  }
  return out;
}

/** A subject's shape priors: all three must be finite to keep any of them. */
function sanitizeTraits(raw: unknown): SubjectTraits | null {
  if (!isRecord(raw)) return null;
  const { cumulativeness, determinism, breadth } = raw;
  if (!finite(cumulativeness) || !finite(determinism) || !finite(breadth)) return null;
  return {
    cumulativeness: clamp(cumulativeness, 0, 1),
    determinism: clamp(determinism, 0, 1),
    breadth: clamp(breadth, 0, 1),
  };
}

/** A subject's assessment mix: non-negative and renormalised to sum 1. */
function sanitizeMix(raw: unknown): SubjectMix | null {
  if (!isRecord(raw)) return null;
  const { knowledge, procedure, skill } = raw;
  if (!finite(knowledge) || !finite(procedure) || !finite(skill)) return null;
  if (knowledge < 0 || procedure < 0 || skill < 0) return null;
  const sum = knowledge + procedure + skill;
  if (sum === 0) return null;
  return { knowledge: knowledge / sum, procedure: procedure / sum, skill: skill / sum };
}

function sanitizeSubject(raw: unknown, index: number): Subject | null {
  if (!isRecord(raw)) return null;
  const { id, name, ticker } = raw;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) return null;
  const tk = typeof ticker === "string" && ticker.trim() ? ticker.trim().toUpperCase().slice(0, 5) : name.trim().slice(0, 4).toUpperCase();
  const color = typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : PALETTE[index % PALETTE.length];
  const target = typeof raw.target === "number" && isFinite(raw.target) ? clamp(round1(raw.target), 0, 100) : null;
  const courseworkPct =
    typeof raw.courseworkPct === "number" && isFinite(raw.courseworkPct) ? clamp(round1(raw.courseworkPct), 0, 100) : null;
  // `formerly` must survive the round trip: dropping it would orphan every
  // successor and hand the engine two desks where the book has one lineage —
  // which is the shape of the doubled-denominator bug. The pointer is checked
  // against the imported roster in `parseImport`, once every id is known.
  const formerly = typeof raw.formerly === "string" && raw.formerly ? raw.formerly : null;
  const traits = sanitizeTraits(raw.traits);
  const mix = sanitizeMix(raw.mix);
  const belief = typeof raw.belief === "number" && isFinite(raw.belief) ? clamp(Math.round(raw.belief), 1, 5) : null;
  const attendancePct =
    typeof raw.attendancePct === "number" && isFinite(raw.attendancePct) ? clamp(round1(raw.attendancePct), 0, 100) : null;
  return {
    id, name: name.trim(), ticker: tk, color, target, courseworkPct,
    ...(raw.archived === true ? { archived: true } : {}),
    ...(formerly ? { formerly } : {}),
    ...(traits ? { traits } : {}),
    ...(mix ? { mix } : {}),
    ...(belief != null ? { belief } : {}),
    ...(attendancePct != null ? { attendancePct } : {}),
  };
}

const pct0to100 = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? clamp(round1(v), 0, 100) : null;

export const RELIABILITY_TAGS = new Set(["official", "returned", "remembered", "estimated", "partial"]);

function sanitizeEntry(raw: unknown, subjectIds: Set<string>): GradeEntry | null {
  if (!isRecord(raw)) return null;
  const { subjectId, date, type, score } = raw;
  if (typeof subjectId !== "string" || !subjectIds.has(subjectId)) return null;
  if (typeof date !== "string" || !ISO_DATE.test(date)) return null;
  if (typeof type !== "string" || !(TYPES as string[]).includes(type)) return null;
  if (typeof score !== "number" || !isFinite(score)) return null;
  const worthPct = typeof raw.worthPct === "number" && isFinite(raw.worthPct) && raw.worthPct > 0 && raw.worthPct <= 100
    ? round1(raw.worthPct)
    : null;
  let cohortN = Number.isInteger(raw.cohortN) && (raw.cohortN as number) >= 1 ? (raw.cohortN as number) : null;
  let rank = Number.isInteger(raw.rank) && (raw.rank as number) >= 1 ? (raw.rank as number) : null;
  // A rank needs a cohort that can contain it; an impossible pair means a typo, so trust neither.
  if (rank != null && cohortN != null && rank > cohortN) { rank = null; cohortN = null; }
  else if (rank != null && cohortN == null) rank = null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    subjectId,
    date,
    type: type as AssessmentType,
    score: clamp(round1(score), 0, 100),
    title: typeof raw.title === "string" ? raw.title.slice(0, 120) : "",
    classAvg: pct0to100(raw.classAvg),
    yearAvg: pct0to100(raw.yearAvg),
    rank,
    cohortN,
    worthPct,
    // A pinned term survives the round trip; garbage in the field is dropped
    // and the entry falls back to what its date says.
    ...(typeof raw.term === "string" && TERM_KEY.test(raw.term) ? { term: raw.term } : {}),
    // Reliability tag survives if valid; anything else falls back to "official".
    ...(typeof raw.reliability === "string" && RELIABILITY_TAGS.has(raw.reliability)
      ? { reliability: raw.reliability as GradeEntry["reliability"] }
      : {}),
    // Boundary and structural-break flags are stored only when truly set; any
    // other value degrades to the ordinary (unset) behaviour.
    ...(raw.censored === true ? { censored: true } : {}),
    ...(raw.regimeBreak === true ? { regimeBreak: true } : {}),
    // Placement scope survives only as the explicit non-default "year"; anything
    // else is the implicit class scope.
    ...(raw.rankScope === "year" ? { rankScope: "year" as const } : {}),
    // A direct cohort spread is kept when it is a sane positive spread.
    ...(typeof raw.cohortSD === "number" && isFinite(raw.cohortSD) && raw.cohortSD > 0 && raw.cohortSD <= 50
      ? { cohortSD: round1(raw.cohortSD) }
      : {}),
    // Only the non-default difficulties are stored — "normal" is the identity.
    ...(raw.difficulty === "easy" || raw.difficulty === "hard" ? { difficulty: raw.difficulty } : {}),
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && isFinite(v);

/** A self-prediction keeps its point (clamped) and only the range ends it gave. */
function sanitizeSelfPred(raw: unknown): SelfPrediction | null {
  if (!isRecord(raw) || !finite(raw.point)) return null;
  const out: SelfPrediction = { point: clamp(round1(raw.point), 0, 100) };
  if (finite(raw.lo)) out.lo = clamp(round1(raw.lo), 0, 100);
  if (finite(raw.hi)) out.hi = clamp(round1(raw.hi), 0, 100);
  return out;
}

/**
 * The wire's call keeps its point (clamped), the range ends it gave, and a
 * trimmed basis. Same shape discipline as a self-prediction — a fresh object,
 * field by field, so nothing an external AI wrote rides in unexamined.
 */
function sanitizeAiPred(raw: unknown): AiPrediction | null {
  if (!isRecord(raw) || !finite(raw.point)) return null;
  const out: AiPrediction = { point: clamp(round1(raw.point), 0, 100) };
  if (finite(raw.lo)) out.lo = clamp(round1(raw.lo), 0, 100);
  if (finite(raw.hi)) out.hi = clamp(round1(raw.hi), 0, 100);
  if (typeof raw.basis === "string" && raw.basis.trim()) out.basis = raw.basis.trim().slice(0, 160);
  return out;
}

/** Chips survive only as a whole array of non-negative finite stakes. */
function sanitizeChips(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  if (!raw.every((c) => finite(c) && (c as number) >= 0)) return undefined;
  return raw.map((c) => round1(c as number));
}

/** A subject→tokens map, keeping only known desks with non-negative amounts. */
function sanitizeTokenMap(raw: unknown, ids: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (ids.has(k) && finite(v) && v >= 0) out[k] = round1(v);
  }
  return out;
}

/** One forward-calendar sitting, held to the grade-entry standard. */
function sanitizeUpcoming(raw: unknown, ids: Set<string>): Upcoming | null {
  if (!isRecord(raw)) return null;
  const { id, subjectId, date, type } = raw;
  if (typeof id !== "string" || !id) return null;
  if (typeof subjectId !== "string" || !ids.has(subjectId)) return null;
  if (typeof date !== "string" || !ISO_DATE.test(date)) return null;
  if (typeof type !== "string" || !(TYPES as string[]).includes(type)) return null;
  const out: Upcoming = {
    id, subjectId, date, type: type as AssessmentType,
    title: typeof raw.title === "string" ? raw.title.slice(0, 120) : "",
  };
  if (finite(raw.weight) && raw.weight > 0 && raw.weight <= 100) out.weight = round1(raw.weight);
  const cov = pct0to100(raw.syllabusCoverage);
  if (cov != null) out.syllabusCoverage = cov;
  const selfPred = sanitizeSelfPred(raw.selfPred);
  if (selfPred) out.selfPred = selfPred;
  if (finite(raw.teacherPred)) out.teacherPred = clamp(round1(raw.teacherPred), 0, 100);
  const chips = sanitizeChips(raw.chips);
  if (chips) out.chips = chips;
  const aiPred = sanitizeAiPred(raw.aiPred);
  if (aiPred) out.aiPred = aiPred;
  const hour = finite(raw.hour) ? clamp(Math.round(raw.hour), 0, 23) : null;
  if (hour != null) out.hour = hour;
  return out;
}

/** One effort budget: a fixed total spread over planned (and maybe actual) tokens. */
function sanitizeAllocation(raw: unknown, ids: Set<string>): Allocation | null {
  if (!isRecord(raw)) return null;
  const { id, roundKey, total, createdAt } = raw;
  if (typeof id !== "string" || !id) return null;
  if (typeof roundKey !== "string" || !TERM_KEY.test(roundKey)) return null;
  if (!finite(total) || total <= 0) return null;
  if (typeof createdAt !== "string" || !ISO_DATE.test(createdAt)) return null;
  const out: Allocation = {
    id, roundKey, total: round1(total), planned: sanitizeTokenMap(raw.planned, ids), createdAt,
  };
  // An unusable hour budget costs the plan its labels, not its existence — the
  // token split is self-contained and still the thing being tracked.
  if (finite(raw.hoursPerWeek) && raw.hoursPerWeek > 0) out.hoursPerWeek = round1(raw.hoursPerWeek);
  if (isRecord(raw.actual)) {
    const actual = sanitizeTokenMap(raw.actual, ids);
    if (Object.keys(actual).length) out.actual = actual;
  }
  return out;
}

/** One readiness duel between two distinct desks the book still contains. */
function sanitizeDuel(raw: unknown, ids: Set<string>): Duel | null {
  if (!isRecord(raw)) return null;
  const { id, aId, bId, winnerId, createdAt } = raw;
  if (typeof id !== "string" || !id) return null;
  if (typeof aId !== "string" || !ids.has(aId)) return null;
  if (typeof bId !== "string" || !ids.has(bId) || bId === aId) return null;
  if (winnerId !== aId && winnerId !== bId) return null;
  if (typeof createdAt !== "string" || !ISO_DATE.test(createdAt)) return null;
  return { id, aId, bId, winnerId: winnerId as string, createdAt };
}

/** One elicited aggregate call: a predicted average and a forced ranking. */
function sanitizeMeanCall(raw: unknown, ids: Set<string>): MeanCall | null {
  if (!isRecord(raw)) return null;
  const { id, roundKey, predAvg, ranking, createdAt } = raw;
  if (typeof id !== "string" || !id) return null;
  if (typeof roundKey !== "string" || !TERM_KEY.test(roundKey)) return null;
  if (!finite(predAvg)) return null;
  if (typeof createdAt !== "string" || !ISO_DATE.test(createdAt)) return null;
  const rank = Array.isArray(ranking)
    ? [...new Set(ranking.filter((r): r is string => typeof r === "string" && ids.has(r)))]
    : [];
  return { id, roundKey, predAvg: clamp(round1(predAvg), 0, 100), ranking: rank, createdAt };
}

export const SESSION_KINDS = new Set(["recall", "practice", "reading", "class", "tutoring"]);
export const ERROR_KINDS = new Set(["careless", "conceptual", "procedural", "time"]);
export const DISRUPTION_KINDS = new Set(["illness", "family", "event", "other"]);
const BEDTIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One syllabus topic. `prereqIds` is trusted here only as "an array of
 * strings" — filtering it to known, same-subject, non-self ids needs the
 * whole roster of topics, so that pass runs a second time in `sanitizeBook`
 * once every topic id is known (mirrors how `Subject.formerly` is checked).
 */
function sanitizeTopic(raw: unknown, subjectIds: Set<string>): Topic | null {
  if (!isRecord(raw)) return null;
  const { id, subjectId, name } = raw;
  if (typeof id !== "string" || !id) return null;
  if (typeof subjectId !== "string" || !subjectIds.has(subjectId)) return null;
  if (typeof name !== "string" || !name.trim()) return null;
  const weightPct = typeof raw.weightPct === "number" && isFinite(raw.weightPct) ? clamp(round1(raw.weightPct), 0, 100) : null;
  const out: Topic = { id, subjectId, name: name.trim() };
  if (weightPct != null) out.weightPct = weightPct;
  if (Array.isArray(raw.prereqIds)) {
    const ids = raw.prereqIds.filter((p): p is string => typeof p === "string" && !!p);
    if (ids.length) out.prereqIds = [...new Set(ids)];
  }
  return out;
}

/**
 * One per-topic breakdown of a graded result. The DUAL FOREIGN KEY is the
 * whole point: `entryId` and `topicId` must each resolve to a row this book
 * actually holds, AND that entry and that topic must agree on subject — a
 * mark cannot silently attach a topic from one desk to a paper sat on
 * another. `entrySubjectOf`/`topicSubjectOf` are subjectId lookups built
 * from the already-sanitized entries/topics, so this can only ever pass
 * against rows that themselves survived.
 */
function sanitizeTopicMark(
  raw: unknown,
  entrySubjectOf: Map<string, string>,
  topicSubjectOf: Map<string, string>,
): TopicMark | null {
  if (!isRecord(raw)) return null;
  const { id, entryId, topicId, scorePct } = raw;
  if (typeof id !== "string" || !id) return null;
  if (typeof entryId !== "string" || !entrySubjectOf.has(entryId)) return null;
  if (typeof topicId !== "string" || !topicSubjectOf.has(topicId)) return null;
  if (entrySubjectOf.get(entryId) !== topicSubjectOf.get(topicId)) return null;
  if (!finite(scorePct)) return null;
  const out: TopicMark = { id, entryId, topicId, scorePct: clamp(round1(scorePct), 0, 100) };
  if (finite(raw.maxMarks) && raw.maxMarks > 0) out.maxMarks = round1(raw.maxMarks);
  if (typeof raw.errorKind === "string" && ERROR_KINDS.has(raw.errorKind)) out.errorKind = raw.errorKind as ErrorKind;
  return out;
}

/** One logged block of study time. `topicIds` is filtered to the SAME subject's own topics. */
function sanitizeSession(raw: unknown, subjectIds: Set<string>, topicsBySubject: Map<string, Set<string>>): StudySession | null {
  if (!isRecord(raw)) return null;
  const { id, subjectId, date, minutes, kind } = raw;
  if (typeof id !== "string" || !id) return null;
  if (typeof subjectId !== "string" || !subjectIds.has(subjectId)) return null;
  if (typeof date !== "string" || !ISO_DATE.test(date)) return null;
  if (!finite(minutes)) return null;
  if (typeof kind !== "string" || !SESSION_KINDS.has(kind)) return null;
  const out: StudySession = { id, subjectId, date, minutes: clamp(Math.round(minutes), 1, 600), kind: kind as SessionKind };
  if (Array.isArray(raw.topicIds)) {
    const known = topicsBySubject.get(subjectId) ?? new Set<string>();
    const topicIds = [...new Set(raw.topicIds.filter((t): t is string => typeof t === "string" && known.has(t)))];
    if (topicIds.length) out.topicIds = topicIds;
  }
  return out;
}

/** One night's sleep. Not FK'd to a subject — nothing here to drop for a bad reference. */
function sanitizeRest(raw: unknown): RestLog | null {
  if (!isRecord(raw)) return null;
  const { id, date, hours } = raw;
  if (typeof id !== "string" || !id) return null;
  if (typeof date !== "string" || !ISO_DATE.test(date)) return null;
  if (!finite(hours)) return null;
  const out: RestLog = { id, date, hours: clamp(round1(hours), 0, 14) };
  if (typeof raw.bedtime === "string" && BEDTIME_RE.test(raw.bedtime)) out.bedtime = raw.bedtime;
  return out;
}

/**
 * Rest logs dedupe by DATE, not id — one night can only have one reading, so
 * a later row for the same date replaces an earlier one outright (last wins).
 * A final id-dedupe pass keeps the shape consistent with every other list
 * even though it should be a no-op once the dates are unique.
 */
function sanitizeRestList(raw: unknown[]): RestLog[] {
  const byDate = new Map<string, RestLog>();
  for (const r of raw) {
    const item = sanitizeRest(r);
    if (item) byDate.set(item.date, item);
  }
  return sanitizeById([...byDate.values()], (r) => r as RestLog);
}

/** A stretch of days off the normal routine. Not FK'd to a subject. */
function sanitizeDisruption(raw: unknown): Disruption | null {
  if (!isRecord(raw)) return null;
  const { id, date, kind } = raw;
  if (typeof id !== "string" || !id) return null;
  if (typeof date !== "string" || !ISO_DATE.test(date)) return null;
  if (typeof kind !== "string" || !DISRUPTION_KINDS.has(kind)) return null;
  const out: Disruption = { id, date, kind: kind as DisruptionKind };
  const days = Number.isInteger(raw.days) ? clamp(raw.days as number, 1, 60) : null;
  if (days != null) out.days = days;
  if (typeof raw.note === "string" && raw.note.trim()) out.note = raw.note.trim().slice(0, 160);
  return out;
}

/**
 * Validate a roster + tape to the standard an import is held to, and return
 * only rows that cannot hurt the engine.
 *
 * This is shared with the localStorage loader on purpose. A stored book is not
 * more trustworthy than an imported one — it is LESS, because it accumulates
 * across every schema this app has ever shipped and nothing re-checks it. A
 * single `null` in `entries`, or a score that came back from JSON as a string,
 * used to reach `computeStats` and throw during render; with no error boundary
 * that white-screens the terminal on every subsequent load, and the only copy
 * of the book is the one in the browser.
 */
/** Dedupe a raw array through a sanitizer, keeping the first of each id. */
function sanitizeById<T extends { id: string }>(raw: unknown[], fn: (r: unknown) => T | null): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const item = fn(r);
    if (item && !seen.has(item.id)) { seen.add(item.id); out.push(item); }
  }
  return out;
}

export function sanitizeBook(
  rawSubjects: unknown[],
  rawEntries: unknown[],
  rawCalendar: Partial<Record<keyof ForwardCalendar, unknown[]>> = {},
  rawSignal: Partial<Record<keyof SignalIntake, unknown[]>> = {},
): { subjects: Subject[]; entries: GradeEntry[] } & ForwardCalendar & SignalIntake {
  const subjects: Subject[] = [];
  const seen = new Set<string>();
  rawSubjects.forEach((s, i) => {
    const sub = sanitizeSubject(s, i);
    if (sub && !seen.has(sub.id)) { seen.add(sub.id); subjects.push(sub); }
  });
  const ids = new Set(subjects.map((s) => s.id));
  // A lineage pointer into a desk this book does not contain is worse than no
  // pointer at all: it silently truncates the successor's tape.
  for (let i = 0; i < subjects.length; i++) {
    const f = subjects[i].formerly;
    if (f && !ids.has(f)) subjects[i] = { ...subjects[i], formerly: null };
  }
  const entries: GradeEntry[] = [];
  const seenE = new Set<string>();
  for (const e of rawEntries) {
    const entry = sanitizeEntry(e, ids);
    if (entry && !seenE.has(entry.id)) { seenE.add(entry.id); entries.push(entry); }
  }
  /* THE LINEAGE INVARIANT, ENFORCED RATHER THAN ASSERTED.
     A desk whose successor has already printed has handed over its tape; both on
     the book at once is the doubled-denominator bug, and `assertRoster` only
     says so under test — in a production build it is compiled out, so the
     aggregate, the composite index and every cross-desk headline go quietly
     wrong and stay wrong. "Relist — trade this desk again" could produce exactly
     that book in two clicks, and it then persisted, exported and imported
     cleanly, because the check above only asks whether `formerly` POINTS
     somewhere, never whether the desk it points at had stopped reporting.
     Delisting is the non-destructive repair: every print and the lineage itself
     survive, and the ancestor simply stops REPORTING — which is the state
     `applySplit` puts it in and the only state the rule allows. */
  for (let i = 0; i < subjects.length; i++) {
    if (subjects[i].archived) continue;
    if (supersededBy(subjects[i], subjects, entries)) subjects[i] = { ...subjects[i], archived: true };
  }
  // Topics validate against the roster like everything else, then get a SECOND
  // pass once every topic id is known: prereqIds are filtered to the SAME
  // subject's own topics, deduped, and a self-reference is dropped — exactly
  // the two-stage check `formerly` gets above, for the same reason (the full
  // roster does not exist until every row has been through the first pass).
  const topics = sanitizeById(rawSignal.topics ?? [], (r) => sanitizeTopic(r, ids));
  const topicsBySubject = new Map<string, Set<string>>();
  for (const t of topics) {
    if (!topicsBySubject.has(t.subjectId)) topicsBySubject.set(t.subjectId, new Set());
    topicsBySubject.get(t.subjectId)!.add(t.id);
  }
  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    if (!t.prereqIds) continue;
    const known = topicsBySubject.get(t.subjectId) ?? new Set<string>();
    const prereqIds = [...new Set(t.prereqIds.filter((p) => known.has(p) && p !== t.id))];
    if (prereqIds.length) topics[i] = { ...t, prereqIds };
    else { const { prereqIds: _drop, ...rest } = t; topics[i] = rest; }
  }
  const entrySubjectOf = new Map(entries.map((e) => [e.id, e.subjectId]));
  const topicSubjectOf = new Map(topics.map((t) => [t.id, t.subjectId]));
  return {
    subjects, entries,
    upcoming: sanitizeById(rawCalendar.upcoming ?? [], (r) => sanitizeUpcoming(r, ids)),
    allocations: sanitizeById(rawCalendar.allocations ?? [], (r) => sanitizeAllocation(r, ids)),
    duels: sanitizeById(rawCalendar.duels ?? [], (r) => sanitizeDuel(r, ids)),
    meanCalls: sanitizeById(rawCalendar.meanCalls ?? [], (r) => sanitizeMeanCall(r, ids)),
    topics,
    topicMarks: sanitizeById(rawSignal.topicMarks ?? [], (r) => sanitizeTopicMark(r, entrySubjectOf, topicSubjectOf)),
    sessions: sanitizeById(rawSignal.sessions ?? [], (r) => sanitizeSession(r, ids, topicsBySubject)),
    rest: sanitizeRestList(rawSignal.rest ?? []),
    disruptions: sanitizeById(rawSignal.disruptions ?? [], sanitizeDisruption),
  };
}

/** Pull the raw behavioural-layer arrays out of a parsed body, defaulting to []. */
function rawCalendarOf(body: Record<string, unknown>): Partial<Record<keyof ForwardCalendar, unknown[]>> {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    upcoming: arr(body.upcoming), allocations: arr(body.allocations),
    duels: arr(body.duels), meanCalls: arr(body.meanCalls),
  };
}

/** Pull the raw life-signals arrays out of a parsed body, defaulting to []. */
function rawSignalOf(body: Record<string, unknown>): Partial<Record<keyof SignalIntake, unknown[]>> {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    topics: arr(body.topics), topicMarks: arr(body.topicMarks), sessions: arr(body.sessions),
    rest: arr(body.rest), disruptions: arr(body.disruptions),
  };
}

/** Parse + validate a JSON export (envelope or bare {subjects, entries}). */
export function parseImport(json: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (!isRecord(raw)) return { ok: false, error: "Unrecognised file — expected a Grade Exchange export." };
  const body = isRecord(raw.data) && raw.app === "grade-exchange" ? raw.data : raw;
  if (!isRecord(body) || !Array.isArray(body.subjects) || !Array.isArray(body.entries)) {
    return { ok: false, error: "Unrecognised file — no subjects/entries found." };
  }
  /* `body.forecasts` is deliberately not read. A v6/v7 export carries the
     engine's own predictions; they are derived state, and importing them would
     let a stale model run — possibly somebody else's — set this book's bias
     correction. The register is replayed from the prints instead (§26). */
  const { subjects, entries, upcoming, allocations, duels, meanCalls, topics, topicMarks, sessions, rest, disruptions } =
    sanitizeBook(body.subjects, body.entries, rawCalendarOf(body), rawSignalOf(body));
  if (!subjects.length) return { ok: false, error: "No valid subjects in that file." };
  const dropped = (body.subjects.length - subjects.length) + (body.entries.length - entries.length);
  const settings = "settings" in body && body.settings != null ? sanitizeSettings(body.settings) : null;
  return {
    ok: true,
    payload: { subjects, entries, settings, upcoming, allocations, duels, meanCalls, topics, topicMarks, sessions, rest, disruptions, dropped },
  };
}

/** The behavioural-layer arrays, spread onto an AppData only when non-empty. */
function calendarPatch(cal: Partial<ForwardCalendar>): Partial<AppData> {
  return {
    ...(cal.upcoming?.length ? { upcoming: cal.upcoming } : {}),
    ...(cal.allocations?.length ? { allocations: cal.allocations } : {}),
    ...(cal.duels?.length ? { duels: cal.duels } : {}),
    ...(cal.meanCalls?.length ? { meanCalls: cal.meanCalls } : {}),
  };
}

/** The life-signals arrays, spread onto an AppData only when non-empty. */
function signalPatch(sig: Partial<SignalIntake>): Partial<AppData> {
  return {
    ...(sig.topics?.length ? { topics: sig.topics } : {}),
    ...(sig.topicMarks?.length ? { topicMarks: sig.topicMarks } : {}),
    ...(sig.sessions?.length ? { sessions: sig.sessions } : {}),
    ...(sig.rest?.length ? { rest: sig.rest } : {}),
    ...(sig.disruptions?.length ? { disruptions: sig.disruptions } : {}),
  };
}

/** Replace the book with the import. */
export function replaceData(payload: ImportPayload): AppData {
  return {
    subjects: payload.subjects,
    entries: payload.entries,
    settings: payload.settings ?? freshSettings(),
    sample: false,
    ...calendarPatch(payload),
    ...signalPatch(payload),
  };
}

/**
 * Two rows describe the same desk if they still agree on EITHER identifier.
 * Renaming a desk on one device and merging its export back is an update, not a
 * new listing; two different students' books agree on neither.
 */
export const sameDesk = (a: Subject, b: Subject) =>
  a.ticker === b.ticker || a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

/**
 * Merge the import into the current book — incoming rows win on id conflicts.
 *
 * "Same id" is NOT the same as "same desk". Every book this app has ever minted
 * starts from `defaultSubjects()`, which hard-codes `s-math`, `s-eng`, `s-phys`
 * and friends, so any two students' books collide on all six ids. Letting the
 * incoming row win outright rewrote the name, ticker, colour and target of a
 * desk you have been trading for a year and dropped somebody else's prints onto
 * your tape — silently, and committed to storage before the modal closed.
 *
 * So a collision only overwrites when the two rows actually describe the same
 * desk. Otherwise the incoming desk is re-listed under a fresh id and its own
 * prints follow it, which keeps re-importing your own export idempotent while
 * making an import of somebody else's book additive instead of destructive.
 */
export function mergeData(current: AppData, payload: ImportPayload): AppData {
  const subMap = new Map(current.subjects.map((s) => [s.id, s]));
  const remap = new Map<string, string>();
  for (const s of payload.subjects) {
    const clash = subMap.get(s.id);
    if (clash && !sameDesk(clash, s)) remap.set(s.id, uid());
  }
  for (const s of payload.subjects) {
    const id = remap.get(s.id) ?? s.id;
    // A remapped desk's lineage pointer has to follow it, or it dangles.
    const formerly = s.formerly ? remap.get(s.formerly) ?? s.formerly : s.formerly;
    subMap.set(id, { ...s, id, ...(formerly !== undefined ? { formerly } : {}) });
  }
  const entMap = new Map(current.entries.map((e) => [e.id, e]));
  // Tracks payload entry id -> its merged id, but only for entries that got a
  // fresh one (their desk was remapped). A topicMark referencing this entry
  // has to follow it the same way `formerly` follows a remapped subject.
  const entryRemap = new Map<string, string>();
  for (const e of payload.entries) {
    const subjectId = remap.get(e.subjectId);
    // A print landing on a re-listed desk needs a fresh id too, or it would
    // overwrite the same-id print already sitting on the original desk.
    if (subjectId) {
      const id = uid();
      entMap.set(id, { ...e, id, subjectId });
      entryRemap.set(e.id, id);
    } else entMap.set(e.id, e);
  }
  // The behavioural layer is personal to a model run and keyed on subject ids.
  // Keep the current book's, and fold in only incoming items every referenced
  // desk of which survived un-remapped (a remapped id would dangle). Incoming
  // wins on an id collision — the same idempotent-re-import rule as forecasts.
  const keepsRefs = (subjectIds: string[]) => subjectIds.every((id) => !remap.has(id));
  const mergeCalendar = <T extends { id: string }>(cur: T[], inc: T[], refs: (t: T) => string[]): T[] => {
    const map = new Map(cur.map((x) => [x.id, x]));
    for (const x of inc) if (keepsRefs(refs(x))) map.set(x.id, x);
    return [...map.values()];
  };
  const cal: ForwardCalendar = {
    upcoming: mergeCalendar(current.upcoming ?? [], payload.upcoming ?? [], (u) => [u.subjectId]),
    allocations: mergeCalendar(current.allocations ?? [], payload.allocations ?? [], (a) => Object.keys(a.planned)),
    duels: mergeCalendar(current.duels ?? [], payload.duels ?? [], (d) => [d.aId, d.bId]),
    meanCalls: mergeCalendar(current.meanCalls ?? [], payload.meanCalls ?? [], (m) => m.ranking),
  };
  // Topics carry `subjectId` directly, so — unlike the behavioural layer above
  // — they follow the SAME rule as entries: a remapped desk's topics get a
  // fresh id too (to avoid colliding with a topic already sitting under the
  // original desk), everything else is a plain id-keyed merge. `topicRemap`
  // is built as its own pass first so a topic's `prereqIds` (always same-
  // subject siblings) can be rewritten consistently regardless of array order.
  const topicRemap = new Map<string, string>();
  for (const t of payload.topics) {
    if (remap.has(t.subjectId)) topicRemap.set(t.id, uid());
  }
  const topicMap = new Map((current.topics ?? []).map((t) => [t.id, t]));
  for (const t of payload.topics) {
    const newSubjectId = remap.get(t.subjectId);
    const id = topicRemap.get(t.id) ?? t.id;
    const subjectId = newSubjectId ?? t.subjectId;
    const prereqIds = t.prereqIds?.map((p) => topicRemap.get(p) ?? p);
    topicMap.set(id, { ...t, id, subjectId, ...(prereqIds !== undefined ? { prereqIds } : {}) });
  }
  // Sessions follow the identical rule, and their `topicIds` remap the same
  // way `prereqIds` does above.
  const sessionMap = new Map((current.sessions ?? []).map((s) => [s.id, s]));
  for (const s of payload.sessions) {
    const newSubjectId = remap.get(s.subjectId);
    const id = newSubjectId ? uid() : s.id;
    const subjectId = newSubjectId ?? s.subjectId;
    const topicIds = s.topicIds?.map((t) => topicRemap.get(t) ?? t);
    sessionMap.set(id, { ...s, id, subjectId, ...(topicIds !== undefined ? { topicIds } : {}) });
  }
  // TopicMarks carry no subjectId of their own — they follow whichever of
  // their two references moved. Either one changing means the row now
  // describes the re-listed desk's data, so it gets a fresh id too, the same
  // as an entry or a topic would.
  //
  // DUAL-FK INVARIANT ACROSS THE REMAP, PROVEN RATHER THAN RE-CHECKED HERE:
  // `sanitizeTopicMark` already guarantees every incoming `m` has an entryId
  // and a topicId whose subjects AGREE (both resolve to the same subjectId
  // within `payload`) — that is the whole point of the dual foreign key. A
  // desk's id is only added to `entryRemap`/`topicRemap` when that desk's OWN
  // id is in `remap` (a same-id-different-desk collision); since the entry's
  // subject and the topic's subject are the SAME subjectId for any row that
  // reached this loop, `entryRemap.get(m.entryId)` and `topicRemap.get(m.topicId)`
  // are defined together or absent together — never one without the other.
  // So a topicMark can never end up with one reference remapped (now pointing
  // at the re-listed desk) and the other left on the original: the wire's
  // deterministic `tm-<entryId>-<topicId>` id makes topic ids collide-proof
  // across DIFFERENT subjects (the subject is baked into the topic's own
  // `t-<ticker>-<slug>` id), and the remap logic above makes them collide-
  // proof across a re-listed SAME subject too — the FK agreement this row
  // was sanitized against survives the merge unchanged.
  const topicMarkMap = new Map((current.topicMarks ?? []).map((m) => [m.id, m]));
  for (const m of payload.topicMarks) {
    const newEntryId = entryRemap.get(m.entryId);
    const newTopicId = topicRemap.get(m.topicId);
    const id = newEntryId !== undefined || newTopicId !== undefined ? uid() : m.id;
    topicMarkMap.set(id, { ...m, id, entryId: newEntryId ?? m.entryId, topicId: newTopicId ?? m.topicId });
  }
  // Disruptions carry no subject reference at all — a plain id-keyed merge,
  // incoming winning on collision, same as the behavioural layer's helper
  // with no refs to check.
  //
  // Rest is NOT plain id-keyed: `sanitizeRestList` guarantees one row per
  // DATE, and a generic id merge would let a re-logged night (fresh id, same
  // date) sit beside the old row instead of replacing it — two readings for
  // one night, straight into live state with no re-sanitize on the way out.
  // Merge by date instead, incoming winning on a date collision, then dedupe
  // by id the same way `sanitizeRestList` finishes.
  const mergeRest = (cur: RestLog[], inc: RestLog[]): RestLog[] => {
    const byDate = new Map<string, RestLog>();
    for (const r of cur) byDate.set(r.date, r);
    for (const r of inc) byDate.set(r.date, r);
    const seen = new Set<string>();
    const out: RestLog[] = [];
    for (const r of byDate.values()) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
    return out;
  };
  const sig: SignalIntake = {
    topics: [...topicMap.values()],
    topicMarks: [...topicMarkMap.values()],
    sessions: [...sessionMap.values()],
    rest: mergeRest(current.rest ?? [], payload.rest ?? []),
    disruptions: mergeCalendar(current.disruptions ?? [], payload.disruptions ?? [], () => []),
  };
  return {
    subjects: [...subMap.values()],
    entries: [...entMap.values()],
    settings: payload.settings ?? current.settings,
    sample: false,
    ...calendarPatch(cal),
    ...signalPatch(sig),
  };
}
