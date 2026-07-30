import type {
  Disruption,
  GradeEntry,
  Profile,
  RestLog,
  StudySession,
  Subject,
  Topic,
  TopicMark,
  Upcoming,
} from "../../../types";
import { median } from "../robust";
import { disruptionTerm } from "./disrupt";
import { masteryRead, topicMastery } from "./mastery";
import { ANX_W, CHRONO_W, SIGNAL_ADJ_CAP } from "./params";
import { restRead } from "./rest";
import { studyStock } from "./stock";
import { timeErrorShareOf, traitSdMult } from "./traits";

/**
 * signalRead — the per-desk life-signals combiner (D5's assembly line): folds
 * every channel below (study stock, topic mastery, rest, disruption,
 * anxiety, chronotype, attendance) into one small adjustment and one
 * variance-widening multiplier, both capped, both droppable per-channel for
 * ablation (see `pricesAsOf`'s `{drop}` seam in ../../aggregate.ts, the
 * style precedent). Every channel is a self-report except mastery, which is
 * measured — see mastery.ts's own doc comment.
 *
 * The load-bearing invariant: on an EMPTY book (no signal data logged) and a
 * subject with no traits/mix/belief/attendance set, every path — including
 * one with a live upcoming sitting — collapses to the identity: adj 0,
 * rawSum 0, sdMult 1, terms []. A book that has never touched this feature
 * must read exactly as it did before the feature existed.
 */

export type SignalTermKey =
  | "stock"
  | "mastery"
  | "rest"
  | "disruption"
  | "anxiety"
  | "chronotype"
  | "attendance";

export interface SignalTerm {
  key: SignalTermKey;
  pts: number;
  note: string;
}

export interface SignalRead {
  subjectId: string;
  /** clamp(sum of term pts, -SIGNAL_ADJ_CAP, +SIGNAL_ADJ_CAP), 2dp. */
  adj: number;
  /**
   * The UNCLAMPED, UNFILTERED sum every candidate channel contributed —
   * `adj` before `clamp`, and before `terms` drops anything under the 0.05pt
   * display floor. Exposed so a derivation (or anything else that needs to
   * show its work) can quote the exact figure the clamp actually acted on,
   * rather than re-summing `terms` and silently mis-stating it whenever a
   * sub-floor contribution (routine: a mild attendance shave, an unrounded
   * anxiety term) is part of the true total but not part of the visible rows.
   */
  rawSum: number;
  /** From traitSdMult, >= 1. */
  sdMult: number;
  /** Only terms with |pts| >= 0.05, sorted harshest first. */
  terms: SignalTerm[];
  reasons: string[];
}

/** The life-signals slice of the book a per-desk read is built from. */
export interface SignalBook {
  topics: Topic[];
  topicMarks: TopicMark[];
  sessions: StudySession[];
  rest: RestLog[];
  disruptions: Disruption[];
  profile: Profile | null;
}

const EMPTY_TOPICS: Topic[] = Object.freeze([]) as unknown as Topic[];
const EMPTY_TOPIC_MARKS: TopicMark[] = Object.freeze([]) as unknown as TopicMark[];
const EMPTY_SESSIONS: StudySession[] = Object.freeze([]) as unknown as StudySession[];
const EMPTY_REST: RestLog[] = Object.freeze([]) as unknown as RestLog[];
const EMPTY_DISRUPTIONS: Disruption[] = Object.freeze([]) as unknown as Disruption[];

export const emptySignalBook: SignalBook = Object.freeze({
  topics: EMPTY_TOPICS,
  topicMarks: EMPTY_TOPIC_MARKS,
  sessions: EMPTY_SESSIONS,
  rest: EMPTY_REST,
  disruptions: EMPTY_DISRUPTIONS,
  profile: null,
}) as SignalBook;

/** The soonest live exam sitting for a desk, pre-resolved by the caller (signalBoard) or the board's own consumer. */
export interface NextSitting {
  date: string;
  hour: number | null;
  weight: number | null;
}

/**
 * Rounds the MAGNITUDE (plain Math.round, which ties toward +Infinity) and
 * reapplies the sign, rather than rounding the signed value directly — see
 * rest.ts's negRound2 for why: plain Math.round on a negative x.xx5 ties
 * toward +Infinity, which rounds a CHARGE down (e.g. -0.375 -> -0.37,
 * understating it) instead of to the nearest cent of magnitude. Also
 * normalises -0 to 0 so an untriggered sum never fails a strict `toBe(0)`.
 */
const round2 = (v: number): number => {
  const r = Math.round(Math.abs(v) * 100) / 100;
  if (r === 0) return 0;
  return v < 0 ? -r : r;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** "+x.x" for non-negative, "-x.x" for negative — toFixed already carries the sign for negatives. */
const signed1 = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

/** A term below this magnitude is noise, not a reason — never shown, never counted toward `terms`/`reasons`. */
const NOTE_FLOOR = 0.05;

type Candidate = { pts: number; note: () => string };

export function signalRead(
  sub: Subject,
  book: SignalBook,
  entries: GradeEntry[],
  next: NextSitting | null,
  modelMean: number | null,
  asOf: string,
  opts?: { drop?: ReadonlySet<SignalTermKey> },
): SignalRead {
  const dropped = (k: SignalTermKey) => opts?.drop?.has(k) ?? false;

  const subjTopics = book.topics.filter((t) => t.subjectId === sub.id);
  const subjTopicIds = new Set(subjTopics.map((t) => t.id));
  const subjMarks = book.topicMarks.filter((mk) => subjTopicIds.has(mk.topicId));
  const subjSessions = book.sessions.filter((s) => s.subjectId === sub.id);

  const raw: Partial<Record<SignalTermKey, Candidate>> = {};

  // STOCK — the hours-logged channel, vs the desk's own trailing norm.
  if (!dropped("stock")) {
    const stock = studyStock(subjSessions, book.rest, sub.mix ?? null, asOf);
    raw.stock = { pts: stock.term, note: () => `STUDY ${signed1(stock.term)} · 14D VS OWN NORM` };
  }

  // MASTERY — the one measured channel. Always computed (even when dropped)
  // so its unevenness can still feed traitSdMult per the spec; dropping
  // "mastery" zeroes both the term AND the unevenness contribution below.
  const masteries = topicMastery(subjTopics, subjMarks, subjSessions, entries, sub.traits ?? null, sub.mix ?? null, asOf);
  const mRead = masteryRead(subjTopics, masteries, modelMean, sub.attendancePct ?? null, asOf);
  if (!dropped("mastery")) {
    raw.mastery = {
      pts: mRead.term,
      note: () =>
        `MASTERY ${signed1(mRead.term)} · BOOK SAYS ${(mRead.predictedPaper as number).toFixed(1)} VS DESK ${(modelMean as number).toFixed(1)}`,
    };
  }
  const unevenness = dropped("mastery") ? 0 : mRead.unevenness;

  // REST — deterioration-only self-report; see rest.ts's own doctrine note.
  if (!dropped("rest")) {
    const r = restRead(book.rest, next?.date ?? null, asOf);
    const pts = r.chronicTerm + r.regTerm + r.acuteTerm;
    raw.rest = {
      pts,
      note: () => {
        const parts: string[] = [];
        if (r.chronicTerm !== 0) parts.push("DETERIORATING");
        if (r.regTerm !== 0) parts.push("IRREGULAR");
        if (r.acuteTerm !== 0) parts.push("SHORT NIGHT BEFORE");
        return `REST ${signed1(pts)} · SLEEP ${parts.join("+")}`;
      },
    };
  }

  // DISRUPTION — only priced against a live sitting to recover against.
  if (!dropped("disruption") && next != null) {
    const d = disruptionTerm(book.disruptions, next.date, asOf);
    raw.disruption = {
      pts: d.term,
      note: () => `DISRUPTION ${signed1(d.term)} · ${d.notes[0] ?? ""}`,
    };
  }

  // ANXIETY — the high-arousal Yerkes-Dodson arm, heavy-paper side only.
  const anx = book.profile?.testAnxiety ?? null;
  if (!dropped("anxiety") && anx != null && anx >= 1) {
    const typicalWeight = median(
      entries.filter((e) => e.date <= asOf && e.type === "Exam" && e.worthPct != null).map((e) => e.worthPct as number),
    );
    const pts =
      next?.weight != null && typicalWeight != null && typicalWeight > 0
        ? -ANX_W * Math.max(0, (anx - 3) / 2) * clamp(next.weight / typicalWeight - 1, 0, 1)
        : 0;
    raw.anxiety = { pts, note: () => `ANXIETY ${signed1(pts)} · HEAVY PAPER` };
  }

  // CHRONOTYPE — sitting-time synchrony vs the self-reported chronotype.
  const chronotype = book.profile?.chronotype ?? null;
  if (!dropped("chronotype") && chronotype != null && next?.hour != null) {
    const hour = next.hour;
    let pts = 0;
    let label = "";
    if (chronotype === "owl" && hour <= 9) {
      pts = -CHRONO_W;
      label = "EARLY";
    } else if (chronotype === "lark" && hour >= 15) {
      pts = -CHRONO_W / 2;
      label = "LATE";
    }
    if (pts !== 0) {
      raw.chronotype = { pts, note: () => `CHRONOTYPE ${signed1(pts)} · ${label} SITTING` };
    }
  }

  // ATTENDANCE — only when there are no topics to let masteryRead's own
  // attendance shave handle it instead (see mastery.ts's coveredMassShaved).
  if (!dropped("attendance") && subjTopics.length === 0 && sub.attendancePct != null && sub.attendancePct < 95) {
    const pct = sub.attendancePct;
    const pts = -Math.min(1, ((95 - pct) / 10) * 0.5);
    raw.attendance = { pts, note: () => `ATTENDANCE ${signed1(pts)} · ${pct}% ATTENDED` };
  }

  const keys = Object.keys(raw) as SignalTermKey[];
  const sum = keys.reduce((a, k) => a + raw[k]!.pts, 0);
  const adj = round2(clamp(sum, -SIGNAL_ADJ_CAP, SIGNAL_ADJ_CAP));

  const terms: SignalTerm[] = keys
    .filter((k) => Math.abs(raw[k]!.pts) >= NOTE_FLOOR)
    .map((k) => ({ key: k, pts: raw[k]!.pts, note: raw[k]!.note() }))
    .sort((a, b) => {
      // Harshest first: most-negative first, then positives by |pts| desc.
      if (a.pts < 0 && b.pts < 0) return a.pts - b.pts;
      if (a.pts >= 0 && b.pts >= 0) return b.pts - a.pts;
      return a.pts < 0 ? -1 : 1;
    });

  const sdMult = traitSdMult(sub.traits ?? null, unevenness, timeErrorShareOf(subjMarks), sub.belief ?? null);

  return {
    subjectId: sub.id,
    adj,
    rawSum: sum,
    sdMult,
    terms,
    reasons: terms.map((t) => t.note),
  };
}

/**
 * signalBoard — signalRead across every desk on the book. Runs on the FULL
 * subject list (archived included — the caller filters what the board shows,
 * not this function) and resolves each desk's own soonest live exam sitting
 * from `upcoming`. Entries are filtered to the subject id by a PLAIN filter,
 * not lineage-inherited — a split desk's pre-split signal history stays with
 * the ancestor that logged it; carrying it forward is the caller's concern
 * if it ever wants that, same as `pricesAsOf` documents for its own inputs.
 */
export function signalBoard(
  subjects: Subject[],
  book: SignalBook,
  entries: GradeEntry[],
  upcoming: Upcoming[],
  modelMeans: Map<string, number | null>,
  asOf: string,
): Map<string, SignalRead> {
  const out = new Map<string, SignalRead>();
  for (const sub of subjects) {
    const candidates = upcoming
      .filter((u) => u.subjectId === sub.id && u.type === "Exam" && u.date >= asOf)
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const soonest = candidates[0] ?? null;
    const next: NextSitting | null =
      soonest == null ? null : { date: soonest.date, hour: soonest.hour ?? null, weight: soonest.weight ?? null };
    const modelMean = modelMeans.get(sub.id) ?? null;
    const subEntries = entries.filter((e) => e.subjectId === sub.id);
    out.set(sub.id, signalRead(sub, book, subEntries, next, modelMean, asOf));
  }
  return out;
}
