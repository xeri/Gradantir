import {
  DEFAULT_CALENDAR, reportingTermOf, stepTerm, termKey, termLabel, termShort,
  type SchoolCalendar, type TermRef,
} from "./calendar";
import { entryTerm } from "./periods";
import type { GradeEntry } from "../types";

/**
 * ROUNDS — what the book actually printed, term by term.
 *
 * A school does not report every term, and which terms it reports in is not
 * ours to hardcode: this book sits T1, mid-year and end-of-year papers, sits
 * nothing at all in Term 3, and may sit a Term 3 paper next year. So the
 * rounds are READ OFF THE BOOK. A term with prints is a round; a term without
 * one never existed and is never drawn.
 *
 * Names come off the book too. Every desk in a round files the same paper on
 * the same day under the same title — "Mid-Year 2025", "Course work · Mid-Year
 * 2025" — so the shared stem of those titles IS the round's name, and the tape
 * can read MID 25 instead of the anonymous T2 25. Nothing to configure, and a
 * school that names its rounds differently gets its own names for free.
 */

export interface Round {
  /** Term key — "2026-T1". The identity every tape and index joins on. */
  key: string;
  ref: TermRef;
  /** Axis name: the round's own name plus the year — "MID 25". */
  label: string;
  /** Plain term label — "T2 2025". Kept for tooltips and prose. */
  termLabel: string;
  /** The name alone, or null when the book gave the round no title. */
  name: string | null;
  /** Last print in the round — the day the term's tape is struck. */
  date: string;
  first: string;
  n: number;
  exams: number;
}

/* ── Naming ───────────────────────────────────────────────────────── */

const YEAR_TAIL = /[\s,'’·-]*(?:20)?\d{2}\s*$/;

/** "Course work · Mid-Year 2025" → "Mid-Year". Prefixes and years are noise. */
const normalizeTitle = (raw: string): string => {
  const seg = raw.split(/[·|]/).pop() ?? "";
  return seg.trim().replace(YEAR_TAIL, "").trim();
};

/** Longest common prefix of two strings, cut back to a word boundary. */
function commonStem(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  let stem = a.slice(0, i);
  if (i < a.length && i < b.length && /\S/.test(a[i] ?? "") && /\S/.test(b[i] ?? "")) {
    stem = stem.replace(/\S*$/, ""); // half a word is not a name
  }
  return stem.trim();
}

/** Terminal-length name for a round: T1 · MID · EOY · or the school's own word. */
function shorten(stem: string): string | null {
  // "Term 1 exams" and "Term 1" are the same round; the noun adds nothing.
  const s = stem.trim().replace(/[\s-]*\b(exams?|tests?|assessments?|papers?|session|round)\b\s*$/i, "").trim();
  if (s.length < 2) return null;
  const term = /^term\s*([1-4])$/i.exec(s);
  if (term) return `T${term[1]}`;
  if (/^mid/i.test(s)) return "MID";
  if (/^(end|final|eoy|year[- ]?end)/i.test(s)) return "EOY";
  const words = s.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const joined = words.slice(0, 2).join(" ");
  return joined.length > 9 ? words[0].slice(0, 9) : joined;
}

/**
 * The round's name, from the titles of the papers in it. Exams name the round
 * when there are any — coursework rides along with whatever the exam was
 * called — and a round nobody titled stays anonymous.
 */
export function roundName(entries: GradeEntry[]): string | null {
  const exams = entries.filter((e) => e.type === "Exam" && e.title?.trim());
  const pool = (exams.length ? exams : entries.filter((e) => e.title?.trim())).map((e) => normalizeTitle(e.title));
  const titles = pool.filter(Boolean);
  if (!titles.length) return null;
  let stem = titles[0];
  for (let i = 1; i < titles.length && stem; i++) stem = commonStem(stem, titles[i]);
  return shorten(stem);
}

const yy = (year: number): string => String(year).slice(2);

/* ── The tape of rounds ───────────────────────────────────────────── */

/** Every term that printed, oldest first. */
export function buildRounds(entries: GradeEntry[], cal: SchoolCalendar = DEFAULT_CALENDAR): Round[] {
  const byTerm = new Map<string, { ref: TermRef; es: GradeEntry[] }>();
  for (const e of entries) {
    const ref = entryTerm(e, cal);
    const key = termKey(ref);
    const slot = byTerm.get(key);
    if (slot) slot.es.push(e);
    else byTerm.set(key, { ref, es: [e] });
  }
  return [...byTerm.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, { ref, es }]) => {
      const name = roundName(es);
      const dates = es.map((e) => e.date).sort();
      return {
        key,
        ref,
        name,
        label: name ? `${name} ${yy(ref.year)}` : termShort(ref),
        termLabel: termLabel(ref),
        date: dates[dates.length - 1],
        first: dates[0],
        n: es.length,
        exams: es.filter((e) => e.type === "Exam").length,
      };
    });
}

/** Rounds that printed an exam — the AGGREGATE's tape. */
export const examRounds = (rounds: Round[]): Round[] => rounds.filter((r) => r.exams > 0);

/** Term key → the round's name, for any axis already bucketed by term. */
export const roundLabels = (entries: GradeEntry[], cal: SchoolCalendar = DEFAULT_CALENDAR): Map<string, string> =>
  new Map(buildRounds(entries, cal).filter((r) => r.name).map((r) => [r.key, r.label]));

/**
 * Rename term buckets to the rounds that filled them, in place. A board
 * grouped by term should say MID 25, not T2 25 — the school's word for it is
 * the one on the paper.
 */
export function labelRounds<T extends { key?: string; label?: string }>(rows: T[], labels: Map<string, string>): T[] {
  for (const row of rows) {
    const name = row.key ? labels.get(row.key) : undefined;
    if (name) row.label = name;
  }
  return rows;
}

/* ── What prints next ─────────────────────────────────────────────── */

export interface PendingRound {
  ref: TermRef;
  key: string;
  label: string;
  termLabel: string;
}

/**
 * THE NEXT ROUND — learned, never assumed. The terms this school has sat exams
 * in form its rhythm; the next unfilled term in that rhythm is what the oracle
 * is forecasting. Sit one Term 3 paper and Term 3 joins the rhythm by itself.
 * A round already past its filing window is skipped: the desk cannot report
 * into a term the calendar has closed.
 */
export function pendingRound(
  rounds: Round[],
  todayIso: string,
  cal: SchoolCalendar = DEFAULT_CALENDAR,
): PendingRound | null {
  const printed = examRounds(rounds);
  if (!printed.length) return null;
  const last = printed[printed.length - 1];
  const current = reportingTermOf(todayIso, cal);
  const after = stepTerm(last.ref, 1);
  // Never look back: whichever of "the term after the last round" and "the term
  // now open" is later is where the next paper can possibly land.
  const ord = (r: TermRef) => r.year * 4 + r.term;
  const start = ord(after) >= ord(current) ? after : current;

  const rhythm = new Set(printed.map((r) => r.ref.term));
  let target = start;
  for (let i = 0, probe = start; i < 8; i++, probe = stepTerm(probe, 1)) {
    if (rhythm.has(probe.term)) { target = probe; break; }
  }

  // Name it after the same term in the last year that sat it — a mid-year is a
  // mid-year — and fall back to the plain term label.
  const twin = [...printed].reverse().find((r) => r.ref.term === target.term && r.name);
  return {
    ref: target,
    key: termKey(target),
    label: twin?.name ? `${twin.name} ${yy(target.year)}` : termShort(target),
    termLabel: termLabel(target),
  };
}
