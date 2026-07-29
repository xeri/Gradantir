import { clamp } from "../../utils";
import { earnedWeight, NO_WEIGHT, type EarnedWeight } from "../earned";
import { scoreT } from "../eval/scoring";
import { SIGNAL_CAP, SIGNAL_KAPPA, SIGNAL_PRIOR } from "../params";
import { signalRead, type NextSitting, type SignalBook } from "./signalread";
import type { ForecastLog, GradeEntry, Subject } from "../../../types";

/**
 * signalSkill — the walk-forward scorer that earns the life-signals channel
 * its weight, the same credibility rule `pool.ts`'s self channel and
 * `readiness.ts`'s duel pile obey (`../earned.ts`).
 *
 * For every resolved exam round in the register, the life-signals book is
 * read AS OF that round's resolution — sessions, rest nights, disruptions
 * and topic marks are only visible to the read if they were logged strictly
 * BEFORE `resolvedAt`, so a round can never be scored with hindsight it
 * could not have had. The adjustment that read produces is folded onto the
 * desk's own stored `log.point`/`log.sd` and scored by the same proper rule
 * (CRPS, `scoreT`) against the SAME realized mark the desk's own stored
 * `log.crps` was scored against, so the two sides are directly comparable —
 * outcome-for-outcome, rule-for-rule.
 *
 * A round the read cannot move at all (adj 0, sdMult 1 — the identity, no
 * evidence logged yet as of that cutoff) is not a tie, it is not evidence,
 * and is skipped rather than scored.
 *
 * The invariant this file defends: the committed fixture carries no signal
 * data, so every round's as-of read collapses to the identity, every round
 * is skipped, `rounds` stays 0, and `earnedWeight`'s own n=0 path returns
 * `w = SIGNAL_PRIOR` — never asserted here, just what the shared credibility
 * rule already does at zero evidence. That is what keeps the fixture byte-
 * identical through this channel. `enabled: false` is a different, harder
 * floor: `w = 0` exactly, mirroring how every other channel expresses "off".
 */

export interface SignalSkill extends EarnedWeight {
  /** Scored (non-skipped) pairs. */
  rounds: number;
}

/** `enabled: false` — no track record is consulted at all. */
export const NO_SIGNAL_SKILL: SignalSkill = { ...NO_WEIGHT, rounds: 0 };

/**
 * The book as it stood strictly before `cutoff`: sessions/rest/disruptions
 * kept only when their own `date` is earlier than `cutoff` (a reading dated
 * ON `cutoff` is excluded, not just ones after it — the round is scored AS
 * OF its resolution, and a same-day log is not yet on file at that instant).
 * TopicMarks are filtered by their ENTRY's date, looked up by `entryId` in
 * the full `entries` list — a mark whose entry has landed on/after cutoff
 * (or whose entry cannot be found at all) is excluded. Topics themselves are
 * structure, not time-stamped evidence, and pass through unfiltered, as does
 * `profile` (its only time-sensitive field, chronotype, is only ever read
 * through `next.hour`, which the caller nulls out below).
 */
function bookBefore(book: SignalBook, entries: GradeEntry[], cutoff: string): SignalBook {
  const entryDateById = new Map(entries.map((e) => [e.id, e.date]));
  return {
    topics: book.topics,
    topicMarks: book.topicMarks.filter((mk) => {
      const entryDate = entryDateById.get(mk.entryId);
      return entryDate != null && entryDate < cutoff;
    }),
    sessions: book.sessions.filter((s) => s.date < cutoff),
    rest: book.rest.filter((r) => r.date < cutoff),
    disruptions: book.disruptions.filter((d) => d.date < cutoff),
    profile: book.profile,
  };
}

/**
 * Fit the weight the life-signals channel has earned, from every resolved
 * exam round in the register.
 */
export function signalSkill(
  register: ForecastLog[],
  book: SignalBook,
  subjects: Subject[],
  entries: GradeEntry[],
  enabled: boolean,
): SignalSkill {
  if (!enabled) return NO_SIGNAL_SKILL;

  const subjectsById = new Map(subjects.map((s) => [s.id, s]));
  const resolved = register.filter((l) => l.target === "exam" && l.realized != null);

  const you: number[] = [];
  const model: number[] = [];

  for (const log of resolved) {
    const cutoff = log.resolvedAt;
    if (cutoff == null) continue;
    const sub = subjectsById.get(log.subjectId);
    if (!sub) continue;

    const resolvedEntry = log.resolvedEntryId != null ? entries.find((e) => e.id === log.resolvedEntryId) ?? null : null;
    const next: NextSitting = { date: cutoff, hour: null, weight: resolvedEntry?.worthPct ?? null };

    const entriesBefore = entries.filter((e) => e.subjectId === log.subjectId && e.date < cutoff);
    const read = signalRead(sub, bookBefore(book, entries, cutoff), entriesBefore, next, log.point, cutoff);

    // No evidence logged as of this round's cutoff — not scored, not a tie.
    if (read.adj === 0 && read.sdMult === 1) continue;

    const realized = log.realized as number;
    const youT = { mean: clamp(log.point + read.adj, 0, 100), scale: log.sd * read.sdMult, df: log.df };
    you.push(scoreT(youT, realized).crps);
    model.push(log.crps as number);
  }

  const fit = earnedWeight(you, model, { kappa: SIGNAL_KAPPA, cap: SIGNAL_CAP, toward: SIGNAL_PRIOR });
  return { ...fit, rounds: you.length };
}
