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
export type ElicitedSection = "upcoming" | "allocations" | "duels" | "meanCalls";

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

const REMOVABLE: ReadonlySet<SectionKey> = new Set<SectionKey>(["upcoming", "allocations", "duels", "meanCalls"]);

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
    default: return data;
  }
}
