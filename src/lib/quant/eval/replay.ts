import { groupByLineage, inheritedEntries } from "../../lineage";
import { entryTermKey } from "../../periods";
import { buildRounds, pendingRound } from "../../rounds";
import { poolStats, poolableScores } from "../shrinkage";
import { priceSubject } from "../price";
import { ENGINE_VERSION } from "../params";
import { scoreT } from "./scoring";
import type { SchoolCalendar } from "../../calendar";
import type { ForecastLog, GradeEntry, Settings, Subject } from "../../../types";

/**
 * THE REGISTER, DERIVED (§26).
 *
 * The bias register used to be stored: the app logged its own live forecast on
 * every render and persisted the pile to localStorage, exported it, imported it
 * and merged it. That is derived state kept as though it were evidence, and it
 * rots in every way stored derived state does — it records only the days you
 * happened to open the app, it survives a recalibration that invalidates it, and
 * a merged book inherits somebody else's model runs.
 *
 * So it is rebuilt from the tape instead, on the one discipline that makes a
 * forecast register mean anything: WALK-FORWARD, NO LEAKAGE. For each exam round
 * a desk has printed in, the engine is refit on the prints that were strictly
 * earlier — the cross-subject pool rebuilt as-of too, or the desk borrows
 * strength from results that had not happened — and asked for its next-exam
 * call. That call is then scored against the print that actually landed.
 *
 * The consequence worth stating plainly: this register is the same object the
 * live one was trying to be, but reproducible. Two people with the same book get
 * the same bias correction, and nothing about it depends on when anybody was
 * looking. It is also what lets the elicitation channels ask "did you beat the
 * desk?" honestly, since it hands them the desk's call AS OF the day the call
 * was made rather than one made with the answer already on the tape.
 *
 * Pure and clock-free — every "now" it needs is passed in.
 */

/** Prints a desk needs behind it before a forecast means anything. */
const WARMUP = 2;

/** The forecast id the live register used: one call per desk per round. */
const logId = (subjectId: string, roundKey: string, version: string): string =>
  `${subjectId}|${roundKey}|exam|${version}`;

const byDate = (a: GradeEntry, b: GradeEntry): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The exam each round is scored on: the EARLIEST exam print in it. A round with
 * two exams on one desk is one forecast and one outcome — the same rule the
 * stored register's reconcile pass used when it matched the first exam it found.
 */
function targetExams(tape: GradeEntry[], cal: SchoolCalendar): Map<string, GradeEntry> {
  const out = new Map<string, GradeEntry>();
  for (const e of tape) {
    if (e.type !== "Exam") continue;
    const key = entryTermKey(e, cal);
    if (!out.has(key)) out.set(key, e);
  }
  return out;
}

export interface ReplayOpts {
  /** Stamped on every log; a recalibration bumps it so old calls are not mixed in. */
  version?: string;
  calendar?: SchoolCalendar;
}

/**
 * Rebuild the whole register from the book.
 *
 * Resolved calls are emitted for EVERY desk, closed ones included: a forecast a
 * delisted desk's tape once tested is evidence about this model, and throwing it
 * away would make the bias correction depend on which desks you happen to still
 * be trading. The LIVE unresolved call is emitted only for desks still listed —
 * nobody forecasts an exam that will never be sat.
 */
export function replayRegister(
  subjects: Subject[],
  entries: GradeEntry[],
  settings: Settings,
  todayIso: string,
  opts: ReplayOpts = {},
): ForecastLog[] {
  const cal = opts.calendar ?? settings.calendar;
  const version = opts.version ?? ENGINE_VERSION;
  const sorted = [...entries].sort(byDate);
  const logs: ForecastLog[] = [];

  /** The cross-subject prior as it stood before `date` — nothing from the future. */
  const poolBefore = (date: string) =>
    poolStats(poolableScores(groupByLineage(subjects, sorted.filter((e) => e.date < date))));

  for (const sub of subjects) {
    const tape = inheritedEntries(sub, subjects, sorted).slice().sort(byDate);
    if (!tape.length) continue;

    for (const [roundKey, exam] of targetExams(tape, cal)) {
      const past = tape.filter((e) => e.date < exam.date);
      if (past.length < WARMUP) continue;
      // The information set last changed on the previous print, so that is the
      // day the call belongs to. Dating it at the exam instead would credit the
      // model with a staleness read nobody could have had.
      const asOf = past[past.length - 1].date;
      const q = priceSubject(past, poolBefore(exam.date), settings, asOf);
      if (!q) continue;

      const nx = q.nextExam;
      const s = scoreT({ mean: nx.mean, scale: nx.sd, df: q.df }, exam.score);
      logs.push({
        id: logId(sub.id, roundKey, version),
        subjectId: sub.id,
        roundKey,
        target: "exam",
        createdAt: asOf,
        modelVersion: version,
        point: nx.mean,
        sd: nx.sd,
        df: q.df,
        ci90: nx.ci90,
        resolvedEntryId: exam.id,
        resolvedAt: exam.date,
        realized: exam.score,
        error: nx.mean - exam.score,
        crps: s.crps,
        is90: s.is90,
      });
    }

    if (sub.archived) continue;
    const pending = pendingRound(buildRounds(tape, cal), todayIso, cal);
    if (!pending || tape.length < WARMUP) continue;
    const live = priceSubject(tape, poolBefore(todayIso), settings, todayIso);
    if (!live) continue;
    logs.push({
      id: logId(sub.id, pending.key, version),
      subjectId: sub.id,
      roundKey: pending.key,
      target: "exam",
      createdAt: todayIso,
      modelVersion: version,
      point: live.nextExam.mean,
      sd: live.nextExam.sd,
      df: live.df,
      ci90: live.nextExam.ci90,
    });
  }

  return logs;
}
