import { clamp } from "../../utils";
import { earnedWeight, NO_WEIGHT, type EarnedWeight } from "../earned";
import { scoreT } from "../eval/scoring";
import { SIGNAL_CAP, SIGNAL_KAPPA, SIGNAL_PRIOR } from "../params";
import { SIGNAL_ADJ_CAP } from "./params";
import {
  adjOf, signalRead,
  type NextSitting, type SignalBook, type SignalChannelWeights, type SignalRawTerm,
} from "./signalread";
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
 *
 * The replay and the scoring are two functions (audit Part I §2). `channels.ts`
 * fits the SHAPE of the adjustment — one credibility multiplier per channel —
 * on the same rounds this file scores the SCALE on, and the replay is done once
 * and shared rather than run twice against two copies of the cutoff rules.
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
 * One resolved round, replayed: the desk's per-channel candidate reads as of
 * that round's resolution, beside the register's own stored call and score on
 * the same outcome.
 *
 * `rawTerms` is UNWEIGHTED on purpose. The replay is the expensive half of
 * this file (a book filter and a full `signalRead` per round) and it does not
 * depend on the credibility multipliers at all, so it runs ONCE and both
 * fitters — `channels.ts` searching over `a_k`, and `signalSkill` scoring the
 * result — replay it arithmetically through `adjOf` rather than re-reading the
 * book. A second copy of `bookBefore`'s cutoff discipline is exactly the kind
 * of duplicate that drifts.
 */
export interface SignalRound {
  subjectId: string;
  /** The round's resolution date — the as-of cutoff its read was taken at. */
  cutoff: string;
  /** The desk's per-channel candidate reads as of `cutoff`, UNWEIGHTED. */
  rawTerms: SignalRawTerm[];
  sdMult: number;
  point: number;
  sd: number;
  df: number;
  realized: number;
  /** The register's own CRPS on this outcome — the model side of the ratio. */
  modelCrps: number;
}

/**
 * Replay every resolved exam round in the register through the life-signals
 * book as it stood at that round's resolution.
 */
export function signalRounds(
  register: ForecastLog[],
  book: SignalBook,
  subjects: Subject[],
  entries: GradeEntry[],
): SignalRound[] {
  const subjectsById = new Map(subjects.map((s) => [s.id, s]));
  // crps must be present alongside realized for a resolved log (replayRegister
  // always sets both together) — required here so `log.crps as number` below
  // is an honest cast rather than a silent `undefined` corrupting the score.
  const resolved = register.filter((l) => l.target === "exam" && l.realized != null && l.crps != null);

  const out: SignalRound[] = [];
  for (const log of resolved) {
    const cutoff = log.resolvedAt;
    if (cutoff == null) continue;
    const sub = subjectsById.get(log.subjectId);
    if (!sub) continue;

    const resolvedEntry = log.resolvedEntryId != null ? entries.find((e) => e.id === log.resolvedEntryId) ?? null : null;
    // `hour: null` — Part II §12.4: a resolved sitting's hour is not recorded
    // anywhere on the book (GradeEntry has no hour field), so the chronotype
    // candidate cannot fire in the replay and its own record is structurally
    // empty. channels.ts pins that fact in a test and the scoreboard prints it
    // rather than letting the channel ride an unmeasured multiplier silently.
    const next: NextSitting = { date: cutoff, hour: null, weight: resolvedEntry?.worthPct ?? null };

    const entriesBefore = entries.filter((e) => e.subjectId === log.subjectId && e.date < cutoff);
    const read = signalRead(sub, bookBefore(book, entries, cutoff), entriesBefore, next, log.point, cutoff);

    out.push({
      subjectId: log.subjectId,
      cutoff,
      rawTerms: read.rawTerms,
      sdMult: read.sdMult,
      point: log.point,
      sd: log.sd,
      df: log.df,
      realized: log.realized as number,
      modelCrps: log.crps as number,
    });
  }
  return out;
}

/**
 * The adjusted forecast a round implies at a given weight vector — the SAME
 * arithmetic `applySignals` ships, so the fit scores what the board sells.
 */
export function roundForecast(
  round: SignalRound,
  weights: SignalChannelWeights | null,
): { adj: number; mean: number; scale: number; df: number } {
  const terms = weights
    ? round.rawTerms.map((t) => ({ key: t.key, pts: (weights[t.key] ?? 1) * t.pts })).filter((t) => t.pts !== 0)
    : round.rawTerms;
  const { adj } = adjOf(terms, SIGNAL_ADJ_CAP);
  return { adj, mean: clamp(round.point + adj, 0, 100), scale: round.sd * round.sdMult, df: round.df };
}

/**
 * Fit the weight the life-signals channel has earned, from every replayed
 * round, at the channel credibility `channels.ts` has already fitted.
 *
 * A round the read cannot move at all (adj 0, sdMult 1 — the identity, no
 * evidence logged as of that cutoff, or every channel measured down to
 * nothing) is not a tie, it is not evidence, and is skipped rather than
 * scored. That test runs at the SHIPPED weights, not the authored ones: a
 * channel the record has zeroed genuinely contributes no evidence to the
 * scale fit.
 */
export function signalSkill(
  rounds: SignalRound[],
  weights: SignalChannelWeights | null,
  enabled: boolean,
): SignalSkill {
  if (!enabled) return NO_SIGNAL_SKILL;

  const you: number[] = [];
  const model: number[] = [];
  for (const round of rounds) {
    const fc = roundForecast(round, weights);
    // No evidence logged as of this round's cutoff — not scored, not a tie.
    if (fc.adj === 0 && round.sdMult === 1) continue;
    you.push(scoreT({ mean: fc.mean, scale: fc.scale, df: fc.df }, round.realized).crps);
    model.push(round.modelCrps);
  }

  const fit = earnedWeight(you, model, { kappa: SIGNAL_KAPPA, cap: SIGNAL_CAP, toward: SIGNAL_PRIOR });
  return { ...fit, rounds: you.length };
}
