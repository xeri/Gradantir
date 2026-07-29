import { TYPES } from "../../constants";
import { DISRUPTION_KINDS, ERROR_KINDS, RELIABILITY_TAGS, SESSION_KINDS } from "../io";
import type {
  AiPrediction, Allocation, Disruption, Duel, GradeEntry, MeanCall, RestLog, SelfPrediction,
  StudySession, Subject, Topic, TopicMark, Upcoming,
} from "../../types";

/**
 * The wire's schema registry — the ONE place the intake prompt learns what a
 * book row is (§29).
 *
 * Every field of every importable entity has an entry here, and the maps are
 * locked with `satisfies Record<keyof T, FieldSpec>`: add a field to types.ts
 * and this file stops compiling until the registry — and therefore the prompt
 * an external AI reads — says what the field is, what it must look like, and
 * where in a school report to find it. That lock is the whole maintenance
 * story: the prompt cannot drift from the data model, because the compiler
 * will not let it.
 *
 * Constraint prose quotes the SAME contracts `io.ts` enforces (TYPES, the
 * reliability tags, the ISO date and term-key shapes), imported rather than
 * restated, for the same reason.
 */

export interface FieldSpec {
  /** Short human label for the field. */
  label: string;
  /**
   * Rendered as (REQUIRED). True when the sanitizer drops the row without it —
   * or, for a nullable field like `target`, when the key must always be
   * present so the model states null rather than staying silent.
   */
  required?: boolean;
  /** The validation contract, in prose — rendered verbatim into the prompt. */
  constraint: string;
  /** Where to find it in a report / what to ask for ("ranked 5th of 120"). */
  hint?: string;
  example?: string;
}

export type WireSectionKey =
  | "subjects" | "entries" | "upcoming" | "allocations" | "duels" | "meanCalls"
  | "topics" | "topicMarks" | "sessions" | "rest" | "disruptions";

export interface SectionSpec {
  key: WireSectionKey;
  title: string;
  /** One line on what a row IS. */
  blurb: string;
  /** Deterministic id recipe — what makes a re-paste idempotent. */
  idConvention: string;
  /**
   * True for sections that carry the STUDENT's scored forecasting record —
   * drives the review UI's confirm-you-said-this flagging.
   */
  elicitation: boolean;
  /**
   * The bracketed brand rendered beside the id recipe. Scoped text for
   * sections that are only PARTLY transcribe-only (upcoming is a factual
   * calendar carrying a few elicitation fields) — branding the whole section
   * would teach a literal model to refuse exam timetables.
   */
  transcribeNote?: string;
  fields: Record<string, FieldSpec>;
}

const RELIABILITY_LIST = [...RELIABILITY_TAGS].join(" | ");
const SESSION_KIND_LIST = [...SESSION_KINDS].map((k) => `"${k}"`).join(" | ");
const ERROR_KIND_LIST = [...ERROR_KINDS].map((k) => `"${k}"`).join(" | ");
const DISRUPTION_KIND_LIST = [...DISRUPTION_KINDS].map((k) => `"${k}"`).join(" | ");

export const SUBJECT_FIELDS = {
  id: {
    label: "subject id", required: true,
    constraint: 'string, unique. Reuse the EXACT roster ids given in CURRENT BOOK CONTEXT — never re-list an existing subject under a new id, everything keys off it. For a genuinely new subject mint "s-<short-slug>" (e.g. "s-chem").',
    example: "s-math",
  },
  name: {
    label: "name", required: true,
    constraint: "non-empty string — the full subject name as the school writes it.",
    example: "Mathematics",
  },
  ticker: {
    label: "ticker",
    constraint: "≤5 uppercase letters; omit to let the app derive one from the name.",
    example: "MATH",
  },
  color: {
    label: "color",
    constraint: "'#RRGGBB' hex; omit and the app assigns one from its palette.",
  },
  target: {
    label: "target average", required: true,
    constraint: "number 0–100 or null — the student's stated goal for the subject. Use null when no goal was stated; never invent one.",
    hint: "Reports sometimes carry a 'goal' or 'expected level' box; interviews should ask directly.",
  },
  archived: {
    label: "archived",
    constraint: "true only for a subject the student has dropped; omit otherwise.",
    hint: "A subject that appears in old reports but not the latest one is a candidate — confirm before archiving.",
  },
  formerly: {
    label: "formerly",
    constraint: "id of the subject this one CONTINUES (a rename or split), or omit. The ancestor must also be in `subjects`, archived.",
    hint: "E.g. 'Business & Economics' splitting into two courses: both new desks point at the old id.",
  },
  courseworkPct: {
    label: "coursework share",
    constraint: "number 0–100 or null — the % of the FINAL grade that coursework (non-exam work) carries.",
    hint: "Course outlines and assessment matrices state this ('internal assessment: 60%').",
  },
  traits: {
    label: "shape priors",
    constraint: "object {cumulativeness, determinism, breadth}, each 0–1, or omit — how this subject's OWN material behaves, not the student's performance in it. Omit unless well supported; never invent a value.",
    hint: "cumulativeness: does each result build on everything before it (a language) or stand alone (a one-off unit)? determinism: is grading mechanical (formula marking) or judged (an essay)? breadth: can one assessment cover most of the syllabus?",
  },
  mix: {
    label: "assessment mix",
    constraint: "object {knowledge, procedure, skill}, non-negative — the split of what this subject actually tests. Renormalised to sum 1 on import; omit unless stated or clearly inferable from an assessment matrix.",
  },
  belief: {
    label: "self-rated standing",
    constraint: "integer 1–5 or null — the STUDENT'S OWN confidence in their current standing. Transcribe-only.",
    hint: "Ask directly, subject by subject: 'how do you feel you're doing right now, 1 (worst) to 5 (best)?' — no document states this, only the student can.",
  },
  attendancePct: {
    label: "attendance",
    constraint: "number 0–100 or null — this subject's attendance rate, as reported.",
    hint: "School portals and attendance reports sometimes state a per-subject or overall rate; ask the student directly when nothing is documented.",
  },
} satisfies Record<keyof Subject, FieldSpec>;

export const ENTRY_FIELDS = {
  id: {
    label: "entry id",
    constraint: 'deterministic: "e-<ticker-lowercase>-<date>-<slug>" with a short slug from the title (or a/b/c for same-day results). Same result ⇒ same id, so pasting twice never duplicates.',
    example: "e-math-2026-05-14-midyear",
  },
  subjectId: {
    label: "subject id", required: true,
    constraint: "must be an id present in this payload's `subjects` — an unknown id drops the row.",
  },
  date: {
    label: "date", required: true,
    constraint: 'ISO "YYYY-MM-DD", the date the assessment was SAT. If only a month is known use the 15th and tag reliability "remembered"; note it in meta.warnings.',
  },
  type: {
    label: "type", required: true,
    constraint: `exactly one of ${TYPES.map((t) => `"${t}"`).join(" | ")} (case-sensitive). Map local names: mock/practice exam → "Exam"; topic test → "Test"; essay/project/internal → "Assignment"; short check → "Quiz".`,
  },
  score: {
    label: "score %", required: true,
    constraint: "number 0–100, one decimal. Convert fractions (18/25 → 72) and points (43/60 → 71.7). If only a letter/achievement grade exists, estimate the percent, tag reliability \"estimated\" and say so in meta.warnings.",
    hint: "NZ NCEA with no percent given: Not Achieved ≈ 30–45, Achieved ≈ 50–65, Merit ≈ 65–80, Excellence ≈ 80–95 — pick the band midpoint unless the document argues otherwise.",
  },
  title: {
    label: "title",
    constraint: "≤120 chars — the assessment's name as printed. Empty string if truly unnamed.",
    example: "Mid-year examination",
  },
  classAvg: {
    label: "class average",
    constraint: "number 0–100 or null — the CLASS mean on this assessment.",
    hint: "Gold. Look for 'class average', 'cohort mean', 'x̄', a distribution chart's centre. Extract every one you can find.",
  },
  yearAvg: {
    label: "year average",
    constraint: "number 0–100 or null — the whole YEAR LEVEL's mean, when reported separately from the class.",
  },
  rank: {
    label: "rank",
    constraint: "integer ≥1 or null. Requires cohortN; a rank without a cohort is dropped.",
    hint: "'Ranked 5th of 120', 'position: 5', '5/120' beside a mark. Also worth asking for in interviews — students often remember their rank.",
  },
  cohortN: {
    label: "cohort size",
    constraint: "integer ≥1 or null — how many students the rank is out of.",
  },
  rankScope: {
    label: "rank scope",
    constraint: '"year" when the rank is across the whole year level; omit for class rank (the default).',
  },
  cohortSD: {
    label: "cohort spread",
    constraint: "number in (0, 50] or null — the cohort's standard deviation, when the report prints one.",
    hint: "Rare but priceless: 'σ = 12.4', 'SD 12.4', a stated middle-50% band (≈ SD × 1.35).",
  },
  difficulty: {
    label: "difficulty",
    constraint: '"easy" | "hard" only when the STUDENT or the document explicitly says so; omit for normal.',
  },
  worthPct: {
    label: "worth % of final",
    constraint: "number in (0, 100] or null — the share of the final grade this assessment carries.",
    hint: "Assessment matrices: 'weighting: 30%', '30% of final grade'.",
  },
  reliability: {
    label: "reliability",
    constraint: `one of ${RELIABILITY_LIST}. THE PROVENANCE LADDER — set it on every row: official transcript/portal ⇒ "official"; a marked, handed-back paper ⇒ "returned"; the student's memory ⇒ "remembered"; your own estimate (letter-grade conversion, inferred value) ⇒ "estimated"; a partial/incomplete mark ⇒ "partial". Omitting means "official", so omit ONLY for true transcript rows.`,
  },
  censored: {
    label: "censored",
    constraint: "true only when the mark hit a ceiling or floor (100%, or a capped/moderated mark); omit otherwise.",
  },
  regimeBreak: {
    label: "regime break",
    constraint: "true only when this result starts a new regime — new teacher, new syllabus, new class; omit otherwise.",
    hint: "Reports announce these: 'new teacher this term', a course code change.",
  },
  term: {
    label: "term override",
    constraint: 'reporting term "YYYY-T1..T4" ONLY when the document explicitly files the result under a term its date contradicts; omit otherwise — the calendar answers it.',
  },
} satisfies Record<keyof GradeEntry, FieldSpec>;

export const SELF_PRED_FIELDS = {
  point: { label: "predicted %", required: true, constraint: "number 0–100 — the STUDENT'S OWN stated prediction, in their words. Transcribe-only." },
  lo: { label: "90% low", constraint: "number 0–100 or omit — only if the student stated a range." },
  hi: { label: "90% high", constraint: "number 0–100 or omit." },
} satisfies Record<keyof SelfPrediction, FieldSpec>;

export const AI_PRED_FIELDS = {
  point: { label: "your predicted %", required: true, constraint: "number 0–100 — YOUR forecast for this sitting (forecast module only)." },
  lo: { label: "90% low", constraint: "low end of your 90% interval — wide enough that 9 in 10 land inside." },
  hi: { label: "90% high", constraint: "high end of your 90% interval." },
  basis: { label: "basis", constraint: "≤160 chars — the single strongest piece of evidence behind the call." },
} satisfies Record<keyof AiPrediction, FieldSpec>;

export const UPCOMING_FIELDS = {
  id: {
    label: "sitting id", required: true,
    constraint: 'REQUIRED (unlike an entry): "u-<ticker-lowercase>-<date>-<slug>". To attach data to a sitting listed in CURRENT BOOK CONTEXT, echo ITS id exactly.',
    example: "u-math-2026-09-12-finals",
  },
  subjectId: { label: "subject id", required: true, constraint: "must be an id present in this payload's `subjects`." },
  date: { label: "date", required: true, constraint: 'ISO "YYYY-MM-DD" — the date the paper will be sat.' },
  type: { label: "type", required: true, constraint: `one of ${TYPES.map((t) => `"${t}"`).join(" | ")}.` },
  title: { label: "title", constraint: "≤120 chars.", example: "End-of-year exam" },
  weight: { label: "weight % of final", constraint: "number in (0, 100] or null — from the assessment matrix or exam notice." },
  syllabusCoverage: {
    label: "syllabus covered",
    constraint: "number 0–100 or null — how much of the assessed material the student has covered, ONLY as stated by the student.",
  },
  selfPred: {
    label: "student's own call",
    constraint: "object {point, lo?, hi?} — ONLY when the student explicitly stated their own prediction. This scores THEIR skill: transcribe, never invent.",
  },
  teacherPred: {
    label: "teacher's prediction",
    constraint: "number 0–100 or null — a predicted grade from a teacher/tutor, as documented or reported by the student.",
    hint: "Reports carry these as 'predicted grade', 'expected level', 'tracking towards'.",
  },
  chips: {
    label: "stake chips",
    constraint: "array of 6 non-negative integers summing to 10 — the student's stated probability spread over score bands [<50, 50s, 60s, 70s, 80s, 90+]. ONLY when the student stated one.",
  },
  aiPred: {
    label: "the wire's call",
    constraint: "object {point, lo?, hi?, basis?} — YOUR OWN forecast. Forecast module only; omit entirely otherwise.",
  },
  hour: {
    label: "hour of day",
    constraint: "integer 0–23 or null — the hour the paper starts, 24-hour clock.",
    hint: "Exam timetables print start times.",
  },
} satisfies Record<keyof Upcoming, FieldSpec>;

export const ALLOCATION_FIELDS = {
  id: { label: "allocation id", required: true, constraint: '"alloc-<roundKey>", e.g. "alloc-2026-T3" — the app upserts by round.' },
  roundKey: { label: "round", required: true, constraint: '"YYYY-T1..T4" — the reporting term the budget is for.' },
  total: { label: "total tokens", required: true, constraint: "number >0 — 100 is conventional (the whole week)." },
  hoursPerWeek: { label: "hours per week", constraint: "number >0 or omit — the real weekly study hours the budget stands for." },
  planned: { label: "planned split", required: true, constraint: "object of subjectId → tokens, summing to total — the student's STATED study plan." },
  actual: { label: "actual split", constraint: "same shape or null — what the student says actually happened." },
  createdAt: { label: "filed", required: true, constraint: 'ISO "YYYY-MM-DD" — today, unless a dated plan document says otherwise.' },
} satisfies Record<keyof Allocation, FieldSpec>;

export const DUEL_FIELDS = {
  id: { label: "duel id", required: true, constraint: '"d-<n>", unique within the payload.' },
  aId: { label: "desk A", required: true, constraint: "subject id present in `subjects`." },
  bId: { label: "desk B", required: true, constraint: "subject id present in `subjects`, ≠ aId." },
  winnerId: { label: "more ready", required: true, constraint: "aId or bId — the desk the STUDENT said they feel more ready for. Transcribe-only." },
  createdAt: { label: "filed", required: true, constraint: 'ISO "YYYY-MM-DD" — today, unless the student is reading from a dated note.' },
} satisfies Record<keyof Duel, FieldSpec>;

export const MEAN_CALL_FIELDS = {
  id: { label: "call id", required: true, constraint: '"mc-<roundKey>-<n>".' },
  roundKey: { label: "round", required: true, constraint: '"YYYY-T1..T4" — the term whose exam round the call is about.' },
  predAvg: { label: "predicted average", required: true, constraint: "number 0–100 — the student's STATED prediction of their overall exam average." },
  ranking: { label: "forced ranking", required: true, constraint: "array of subject ids strongest→weakest, as the STUDENT ordered them." },
  createdAt: { label: "filed", required: true, constraint: 'ISO "YYYY-MM-DD" — today, unless documented otherwise.' },
} satisfies Record<keyof MeanCall, FieldSpec>;

export const TOPIC_FIELDS = {
  id: {
    label: "topic id", required: true,
    constraint: 'deterministic: "t-<ticker-lowercase>-<slug>" from the topic name. Same topic ⇒ same id, so re-pasting a syllabus never duplicates it.',
    example: "t-math-quadratics",
  },
  subjectId: { label: "subject id", required: true, constraint: "must be an id present in this payload's `subjects` — an unknown id drops the row." },
  name: { label: "name", required: true, constraint: "non-empty string — the syllabus topic's name, as the syllabus prints it." },
  weightPct: {
    label: "syllabus share",
    constraint: "number 0–100 or omit — this topic's share of the ASSESSED syllabus. Omit for equal weighting across the subject's topics.",
    hint: "Assessment matrices and syllabus documents often state a weighting per strand/topic.",
  },
  prereqIds: {
    label: "prerequisites",
    constraint: "array of topic ids, SAME subject only, or omit — topics this one depends on. Filtered to the subject's own topics on import; a self-reference is dropped.",
    hint: "A syllabus laid out in strands/units often states an explicit sequence ('Topic 3 builds on Topic 1').",
  },
} satisfies Record<keyof Topic, FieldSpec>;

export const TOPIC_MARK_FIELDS = {
  id: {
    label: "topic-mark id", required: true,
    constraint: 'deterministic: "tm-<entryId>-<topicId>" — the EXACT ids of the entry and topic this row breaks down. Same paper, same topic ⇒ same id.',
    example: "tm-e-math-2026-05-14-midyear-t-math-quadratics",
  },
  entryId: {
    label: "entry id", required: true,
    constraint: "must be an id present in this payload's (or the book's) `entries` — the RESULT this breakdown belongs to. An entry not already on the tape drops the row: a mark is never evidence for a paper the book cannot show.",
  },
  topicId: {
    label: "topic id", required: true,
    constraint: "must be an id present in this payload's (or the book's) `topics`, AND that topic's subject must match the entry's subject — a mismatch drops the row (the dual foreign key).",
  },
  scorePct: {
    label: "score on this topic %", required: true,
    constraint: "number 0–100 — this topic's share of the marks on THAT paper (earned/available × 100), not the paper's overall score.",
  },
  maxMarks: {
    label: "marks available",
    constraint: "number >0 or omit — how many raw marks this topic was worth on the paper.",
    hint: "Per-question mark schemes on a returned paper: 'Q3 (Quadratics): 6/8'.",
  },
  errorKind: {
    label: "error kind",
    constraint: `one of ${ERROR_KIND_LIST} or omit — the marker's or the student's OWN diagnosis of why marks were lost, when stated. Never guess one.`,
  },
} satisfies Record<keyof TopicMark, FieldSpec>;

export const SESSION_FIELDS = {
  id: {
    label: "session id", required: true,
    constraint: 'deterministic: "ss-<ticker-lowercase>-<date>-<n>", n counting same-subject same-day sessions from 0. Same block ⇒ same id.',
    example: "ss-math-2026-05-10-0",
  },
  subjectId: { label: "subject id", required: true, constraint: "must be an id present in this payload's `subjects`." },
  date: { label: "date", required: true, constraint: 'ISO "YYYY-MM-DD" — the day the block was studied.' },
  minutes: { label: "minutes", required: true, constraint: "integer 1–600 — the length of the block." },
  kind: { label: "kind", required: true, constraint: `exactly one of ${SESSION_KIND_LIST}.` },
  topicIds: {
    label: "topics covered",
    constraint: "array of topic ids, SAME subject only, or omit — which topics the block covered, only when the student can say.",
  },
} satisfies Record<keyof StudySession, FieldSpec>;

export const REST_FIELDS = {
  id: {
    label: "rest id", required: true,
    constraint: '"r-<date>" — one row per night; a later row for the SAME date REPLACES the earlier one, so re-pasting a fuller export just overwrites the same night rather than duplicating it.',
    example: "r-2026-05-13",
  },
  date: { label: "date", required: true, constraint: 'ISO "YYYY-MM-DD" — the NIGHT this reading is FOR, not the morning it was logged.' },
  hours: { label: "hours slept", required: true, constraint: "number 0–14 — total sleep that night." },
  bedtime: { label: "bedtime", constraint: '"HH:MM", 24-hour clock, or omit — as the sleep export states it.' },
} satisfies Record<keyof RestLog, FieldSpec>;

export const DISRUPTION_FIELDS = {
  id: {
    label: "disruption id", required: true,
    constraint: '"d-<date>-<kind>" — the day it started and its kind.',
    example: "d-2026-04-20-illness",
  },
  date: { label: "date", required: true, constraint: 'ISO "YYYY-MM-DD" — the day the disruption STARTED.' },
  days: { label: "days", constraint: "integer 1–60 or omit — how many days it ran, from `date`." },
  kind: { label: "kind", required: true, constraint: `exactly one of ${DISRUPTION_KIND_LIST}.` },
  note: { label: "note", constraint: "≤160 chars or omit — a short reason, in the student's own words." },
} satisfies Record<keyof Disruption, FieldSpec>;

export const WIRE_SECTIONS: SectionSpec[] = [
  {
    key: "subjects",
    title: "subjects[] — the roster",
    blurb: "One row per subject the student takes (or took). ALWAYS echo the full current roster from CURRENT BOOK CONTEXT — every row verbatim, every field — then append anything new.",
    idConvention: "reuse roster ids; new subjects: s-<slug>",
    elicitation: false,
    fields: SUBJECT_FIELDS,
  },
  {
    key: "entries",
    title: "entries[] — the tape",
    blurb: "One row per RESULT that has landed: every mark, however small. This is the payload's centre of gravity — extract exhaustively, context fields included.",
    idConvention: "e-<ticker>-<date>-<slug>",
    elicitation: false,
    fields: ENTRY_FIELDS,
  },
  {
    key: "upcoming",
    title: "upcoming[] — the forward calendar",
    blurb: "One row per FUTURE assessment: exam timetables, notices, 'test next Friday'. The sittings themselves are facts — extract them like any other; only the marked fields below carry the student's own calls.",
    idConvention: "u-<ticker>-<date>-<slug> (echo an existing sitting's id to attach to it)",
    elicitation: true,
    transcribeNote: "selfPred, chips & syllabusCoverage are TRANSCRIBE-ONLY — see R7",
    fields: UPCOMING_FIELDS,
  },
  {
    key: "allocations",
    title: "allocations[] — effort budgets",
    blurb: "The student's stated study-time split for a term. Transcribe-only.",
    idConvention: "alloc-<roundKey>",
    elicitation: true,
    transcribeNote: "TRANSCRIBE-ONLY — see R7",
    fields: ALLOCATION_FIELDS,
  },
  {
    key: "duels",
    title: "duels[] — readiness comparisons",
    blurb: "Forced choices the student actually made ('more ready for Maths than Physics'). Transcribe-only.",
    idConvention: "d-<n>",
    elicitation: true,
    transcribeNote: "TRANSCRIBE-ONLY — see R7",
    fields: DUEL_FIELDS,
  },
  {
    key: "meanCalls",
    title: "meanCalls[] — aggregate calls",
    blurb: "The student's stated prediction of their overall exam average for a round, plus their own strongest→weakest ordering. Transcribe-only.",
    idConvention: "mc-<roundKey>-<n>",
    elicitation: true,
    transcribeNote: "TRANSCRIBE-ONLY — see R7",
    fields: MEAN_CALL_FIELDS,
  },
  {
    key: "topics",
    title: "topics[] — the syllabus map",
    blurb: "One row per syllabus topic within a subject — the unit study, marks and mastery are tracked against, finer than the subject itself. A subject's own shape (traits/mix) is set on the subject row, not here; this section is the per-topic breakdown.",
    idConvention: "t-<ticker>-<slug>",
    elicitation: false,
    transcribeNote: "transcribe the syllabus; never invent a topic it doesn't assess",
    fields: TOPIC_FIELDS,
  },
  {
    key: "topicMarks",
    title: "topicMarks[] — per-topic breakdowns",
    blurb: "One row per syllabus topic a marked, returned paper breaks a result into — how a paper's marks split across topics, and why marks were lost when known (the per-question-marks recipe is spelled out further down, where documents are the source).",
    idConvention: "tm-<entryId>-<topicId>",
    elicitation: false,
    transcribeNote: "transcribe the marked paper; never invent a mark",
    fields: TOPIC_MARK_FIELDS,
  },
  {
    key: "sessions",
    title: "sessions[] — logged study blocks",
    blurb: "One row per block of study time the student actually put in — length, kind, and which topics it covered when known.",
    idConvention: "ss-<ticker>-<date>-<n>",
    elicitation: false,
    transcribeNote: "transcribe the study log; never invent a session",
    fields: SESSION_FIELDS,
  },
  {
    key: "rest",
    title: "rest[] — logged sleep",
    blurb: "One row per night's sleep, from a sleep app export or the student's own memory (the export-parsing recipe is spelled out further down, where documents are the source).",
    idConvention: "r-<date>",
    elicitation: false,
    transcribeNote: "transcribe the sleep export; never invent a night",
    fields: REST_FIELDS,
  },
  {
    key: "disruptions",
    title: "disruptions[] — routine breaks",
    blurb: "One row per stretch of days that took the student off their normal routine — illness, family, a big event.",
    idConvention: "d-<date>-<kind>",
    elicitation: false,
    transcribeNote: "transcribe what actually happened; never invent a disruption",
    fields: DISRUPTION_FIELDS,
  },
];

/** The nested prediction shapes, rendered under upcoming's table. */
export const NESTED_SPECS: { title: string; fields: Record<string, FieldSpec> }[] = [
  { title: "selfPred {…} — the student's own call", fields: SELF_PRED_FIELDS },
  { title: "aiPred {…} — YOUR call (forecast module only)", fields: AI_PRED_FIELDS },
];
