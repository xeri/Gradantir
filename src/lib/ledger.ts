import type { AppData } from "../types";

/**
 * THE DATA LEDGER — one place that knows what the book is storing about you.
 *
 * Everything here is an INPUT: something you told the book. Nothing the engine
 * computed is in this list, because nothing the engine computes is stored —
 * prices, forecasts, the bias register and every score are recalculated from
 * these rows on every load (see `quant/eval/replay.ts`). That is the whole
 * division: you own the inputs, the model owns the outputs, and the outputs are
 * never allowed to accumulate as though they were evidence.
 *
 * Two consequences the UI relies on:
 *
 * · Every elicited row is individually removable. A mis-clicked duel, one bad
 *   call, a term's budget you filed and regret — each is one ✕, not a wipe. The
 *   duel pile used to have exactly one control, "drop all of it", which is not a
 *   correction, it is a surrender.
 * · The roster and the tape are REPORTED here but not removable here. Deleting a
 *   desk cascades into its prints and its lineage pointers, and that belongs
 *   where the consequence is visible — the drawer and the blotter.
 */

/** Sections whose rows this ledger can delete one at a time. */
export type ElicitedSection =
  | "upcoming" | "allocations" | "duels" | "meanCalls"
  | "topics" | "topicMarks" | "sessions" | "rest" | "disruptions";

/** Everything the ledger reports, removable or not. */
export type SectionKey = ElicitedSection | "subjects" | "entries";

export interface LedgerRow {
  id: string;
  /** The row's own identity — a ticker, a date, a number. */
  primary: string;
  /** What it holds, in terminal-speak. */
  secondary: string;
  /** Sort key, newest first in the UI. */
  at: string;
}

export interface LedgerSection {
  key: SectionKey;
  label: string;
  /** What this section is for, and what removing a row costs. */
  note: string;
  rows: LedgerRow[];
  /** False for the roster and the tape — see the header. */
  removable: boolean;
}

const REMOVABLE: ReadonlySet<SectionKey> = new Set<SectionKey>([
  "upcoming", "allocations", "duels", "meanCalls",
  "topics", "topicMarks", "sessions", "rest", "disruptions",
]);

export const isRemovable = (key: SectionKey): key is ElicitedSection => REMOVABLE.has(key);

/**
 * Every stored section of a book, in the order the ledger draws them: what you
 * elicited first, then what the tape is made of.
 */
export function bookLedger(data: AppData, tickerOf: (id: string) => string): LedgerSection[] {
  const t = tickerOf;
  return [
    {
      key: "upcoming",
      label: "SITTINGS · YOUR CALLS",
      note: "Scheduled papers and every elicitation on them — your prediction, a teacher's, staked chips, syllabus coverage. Removing one drops its calls from the you-vs-desk record.",
      removable: true,
      rows: (data.upcoming ?? []).map((u) => ({
        id: u.id,
        primary: t(u.subjectId),
        at: u.date,
        secondary: [
          u.date,
          u.title || u.type,
          u.selfPred ? `YOU ${u.selfPred.point}${u.selfPred.lo != null && u.selfPred.hi != null ? ` [${u.selfPred.lo}–${u.selfPred.hi}]` : ""}` : null,
          u.teacherPred != null ? `TEACHER ${u.teacherPred}` : null,
          u.chips?.length ? `${u.chips.reduce((a, b) => a + b, 0)} CHIPS` : null,
          u.syllabusCoverage != null ? `COVER ${u.syllabusCoverage}%` : null,
        ].filter(Boolean).join(" · "),
      })),
    },
    {
      key: "allocations",
      label: "EFFORT BUDGETS",
      note: "One study week per reporting term (D1). Removing one takes its effort premia off every mark in that term.",
      removable: true,
      rows: (data.allocations ?? []).map((a) => ({
        id: a.id,
        primary: a.roundKey,
        at: a.createdAt,
        secondary: [
          `${Object.keys(a.planned).length} DESKS`,
          a.hoursPerWeek != null ? `${a.hoursPerWeek.toFixed(1)} H/WK` : null,
          a.actual ? "ACTUAL RECORDED" : "PLAN ONLY",
          `FILED ${a.createdAt}`,
        ].filter(Boolean).join(" · "),
      })),
    },
    {
      key: "duels",
      label: "READINESS DUELS",
      note: "Forced-choice answers (D2). Removing one refits the Elo ranking and the readiness premium it prices.",
      removable: true,
      rows: (data.duels ?? []).map((d) => ({
        id: d.id,
        primary: `${t(d.winnerId)} ▸`,
        at: d.createdAt,
        secondary: `${t(d.aId)} VS ${t(d.bId)} · ${d.createdAt}`,
      })),
    },
    {
      key: "meanCalls",
      label: "AGGREGATE CALLS",
      note: "Your calls on the overall average and the forced ranking (D4). Every revision is kept; removing one drops it from the pool's record.",
      removable: true,
      rows: (data.meanCalls ?? []).map((m) => ({
        id: m.id,
        primary: m.predAvg.toFixed(1),
        at: m.createdAt,
        secondary: `${m.roundKey} · ${m.ranking.map(t).join(" > ") || "NO RANKING"} · ${m.createdAt}`,
      })),
    },
    {
      key: "topics",
      label: "TOPICS",
      note: "The syllabus map inside each desk — the unit study and marks are tracked against. Removing one here does not touch topic marks or sessions already filed against it, same as dropping a print leaves its topic marks alone.",
      removable: true,
      rows: (data.topics ?? []).map((tp) => ({
        id: tp.id,
        primary: t(tp.subjectId),
        at: tp.name,
        secondary: [
          tp.name,
          tp.weightPct != null ? `${tp.weightPct}%` : "EQUAL WEIGHT",
          tp.prereqIds?.length ? `${tp.prereqIds.length} PREREQ` : null,
        ].filter(Boolean).join(" · "),
      })),
    },
    {
      key: "topicMarks",
      label: "TOPIC MARKS",
      note: "Per-topic breakdowns of a graded result. Removing one only drops the breakdown — the result and the topic it named stay on the tape.",
      removable: true,
      rows: (data.topicMarks ?? []).map((m) => {
        const topic = (data.topics ?? []).find((tp) => tp.id === m.topicId);
        const entry = data.entries.find((e) => e.id === m.entryId);
        return {
          id: m.id,
          primary: t(topic?.subjectId ?? entry?.subjectId ?? ""),
          at: entry?.date ?? "",
          secondary: [
            entry?.date ?? null,
            topic?.name ?? m.topicId,
            `${m.scorePct}%`,
            m.errorKind ? m.errorKind.toUpperCase() : null,
          ].filter(Boolean).join(" · "),
        };
      }),
    },
    {
      key: "sessions",
      label: "STUDY SESSIONS",
      note: "Logged study blocks. Removing one drops it from the study-time tally; nothing else references it.",
      removable: true,
      rows: (data.sessions ?? []).map((s) => ({
        id: s.id,
        primary: t(s.subjectId),
        at: s.date,
        secondary: [
          s.date,
          `${s.minutes}MIN`,
          s.kind.toUpperCase(),
          s.topicIds?.length ? `${s.topicIds.length} TOPICS` : null,
        ].filter(Boolean).join(" · "),
      })),
    },
    {
      key: "rest",
      label: "SLEEP",
      note: "Logged nights of sleep. Removing one drops that night from the rest signal.",
      removable: true,
      rows: (data.rest ?? []).map((r) => ({
        id: r.id,
        primary: r.date,
        at: r.date,
        secondary: [r.date, `${r.hours}H`, r.bedtime ? `BED ${r.bedtime}` : null].filter(Boolean).join(" · "),
      })),
    },
    {
      key: "disruptions",
      label: "DISRUPTIONS",
      note: "Logged stretches off the normal routine. Removing one drops it from the disruption signal.",
      removable: true,
      rows: (data.disruptions ?? []).map((d) => ({
        id: d.id,
        primary: d.date,
        at: d.date,
        secondary: [
          d.date,
          d.kind.toUpperCase(),
          d.days != null ? `${d.days}D` : null,
          d.note ?? null,
        ].filter(Boolean).join(" · "),
      })),
    },
    {
      key: "subjects",
      label: "DESKS",
      note: "The roster. Delisting or deleting a desk cascades into its prints and its lineage, so it lives in the desk drawer where you can see what goes with it.",
      removable: false,
      rows: data.subjects.map((s) => ({
        id: s.id,
        primary: s.ticker,
        at: s.name,
        secondary: [s.name, s.archived ? "DELISTED" : null, s.formerly ? `FORMERLY ${t(s.formerly)}` : null].filter(Boolean).join(" · "),
      })),
    },
    {
      key: "entries",
      label: "PRINTS",
      note: "The tape — the only thing the engine audits. Edit or remove a print in the blotter, where its subject and date are in front of you.",
      removable: false,
      rows: data.entries.map((e) => ({
        id: e.id,
        primary: t(e.subjectId),
        at: e.date,
        secondary: `${e.date} · ${e.type} · ${e.score}`,
      })),
    },
  ];
}

/** Drop one elicited row. Any other section is returned untouched. */
export function removeFromBook(data: AppData, key: SectionKey, id: string): AppData {
  switch (key) {
    case "upcoming": return { ...data, upcoming: (data.upcoming ?? []).filter((x) => x.id !== id) };
    case "allocations": return { ...data, allocations: (data.allocations ?? []).filter((x) => x.id !== id) };
    case "duels": return { ...data, duels: (data.duels ?? []).filter((x) => x.id !== id) };
    case "meanCalls": return { ...data, meanCalls: (data.meanCalls ?? []).filter((x) => x.id !== id) };
    // topics/topicMarks/sessions carry foreign keys into each other
    // (topicMarks -> topics + entries, sessions -> topics), but removal
    // here never cascades — the same precedent App.tsx's deleteEntry
    // already sets for entries vs topicMarks. A dropped row's dependents
    // are left pointing at a ghost id rather than swept silently; the next
    // sanitize pass (io.ts) is what actually drops orphaned rows, same as
    // it always has. rest/disruptions reference nothing.
    case "topics": return { ...data, topics: (data.topics ?? []).filter((x) => x.id !== id) };
    case "topicMarks": return { ...data, topicMarks: (data.topicMarks ?? []).filter((x) => x.id !== id) };
    case "sessions": return { ...data, sessions: (data.sessions ?? []).filter((x) => x.id !== id) };
    case "rest": return { ...data, rest: (data.rest ?? []).filter((x) => x.id !== id) };
    case "disruptions": return { ...data, disruptions: (data.disruptions ?? []).filter((x) => x.id !== id) };
    default: return data;
  }
}

/** Drop a whole elicited section. Any other section is returned untouched. */
export function clearSection(data: AppData, key: SectionKey): AppData {
  switch (key) {
    case "upcoming": return { ...data, upcoming: [] };
    case "allocations": return { ...data, allocations: [] };
    case "duels": return { ...data, duels: [] };
    case "meanCalls": return { ...data, meanCalls: [] };
    case "topics": return { ...data, topics: [] };
    case "topicMarks": return { ...data, topicMarks: [] };
    case "sessions": return { ...data, sessions: [] };
    case "rest": return { ...data, rest: [] };
    case "disruptions": return { ...data, disruptions: [] };
    default: return data;
  }
}
