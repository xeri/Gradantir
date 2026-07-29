import type { Subject } from "../../../types";
import {
  MASTERY_MIN_MARKS,
  REST_MIN_NIGHTS,
  VOI_EFFORT_SCALE,
  VOI_MARKS_EFFORT_PER,
  VOI_MARKS_GAIN_W,
  VOI_MARKS_SD_SAT,
  VOI_PROFILE_EFFORT,
  VOI_PROFILE_GAIN,
  VOI_REST_EFFORT,
  VOI_REST_GAIN,
  VOI_SESSIONS_EFFORT,
  VOI_SESSIONS_GAIN,
  VOI_TOP_N,
  VOI_TOPICS_EFFORT,
  VOI_TOPICS_GAIN_W,
  VOI_TOPICS_SD_MIN,
  VOI_TRAITS_EFFORT,
  VOI_TRAITS_GAIN_W,
  VOI_Z90,
} from "./params";
import type { SignalBook } from "./signalread";

/**
 * valueOfInformation — the VOI ranker (D5's "what to log next" panel): a
 * pure, DISPLAY-ONLY heuristic that tells a student which missing input
 * would buy the most forecast precision per minute of logging effort. Every
 * heuristic below fires on a simple presence/absence/size test over the
 * signal book — never on a computed forecast, a stat, or a board — so this
 * module can be wired into (or left out of) the VOI panel without moving a
 * single digit anywhere else: `npm run gate` and the committed fixture stay
 * byte-identical regardless of what this function returns, because nothing
 * here feeds stats.ts/aggregate.ts/the register, only a read-only panel.
 *
 * `desks` mirrors `signalBoard`'s own `modelMeans: Map<string, number | null>`
 * convention (signalread.ts) for handing this layer one number per desk
 * without inventing a new per-subject wrapper type: subjectId -> that desk's
 * current forecast sd (the same units as `SubjectStat.quant.nextExam.sd`), or
 * null/absent when the desk has no live forecast to measure a width from. The
 * sd-dependent heuristics (topics, marks, traits) simply do not fire for a
 * desk they have no width for, rather than guessing one — only the flat,
 * width-independent heuristics (rest, sessions, profile) can still fire on
 * such a desk.
 *
 * `todayIso` is accepted per the module's spec but unused: every heuristic
 * here is a presence/absence/size test, not a recency one (unlike, say,
 * `rest.ts`'s own as-of-dated reads) — see `classifyUpcoming`'s own
 * `_todayIso` in `../../upcoming.ts` for the same signature-kept-for-the-
 * interface, unused-in-the-body precedent.
 */

export interface VoiItem {
  subjectId: string | null;
  ticker: string | null;
  domain: string;
  action: string;
  gainPts: number;
  effortMin: number;
  score: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const scoreOf = (gainPts: number, effortMin: number) => gainPts / (1 + effortMin / VOI_EFFORT_SCALE);
/** "±x.x" — the ONLY place a computed gain is turned into copy, so every action string embeds the real, rounded number rather than a hand-typed one. */
const plusMinus1 = (gainPts: number) => `±${gainPts.toFixed(1)}`;

function voiItem(
  subjectId: string | null,
  ticker: string | null,
  domain: string,
  action: (gain: number) => string,
  rawGainPts: number,
  effortMin: number,
): VoiItem {
  const gainPts = round2(rawGainPts);
  return { subjectId, ticker, domain, action: action(gainPts), gainPts, effortMin, score: scoreOf(gainPts, effortMin) };
}

export function valueOfInformation(
  subjects: Subject[],
  book: SignalBook,
  desks: Map<string, number | null>,
  _todayIso: string,
): VoiItem[] {
  const items: VoiItem[] = [];

  // REST — no rest logs at all, book-wide.
  if (book.rest.length === 0) {
    items.push(
      voiItem(
        null,
        null,
        "rest",
        (g) => `LOG ${REST_MIN_NIGHTS} NIGHTS OF SLEEP → TIGHTEN CI90 BY ${plusMinus1(g)}`,
        VOI_REST_GAIN,
        VOI_REST_EFFORT,
      ),
    );
  }

  // PROFILE — no chronotype/anxiety self-rating at all, book-wide.
  if (book.profile == null) {
    items.push(
      voiItem(
        null,
        null,
        "profile",
        (g) => `SET SLEEP/ANXIETY PROFILE → TIGHTEN CI90 BY ${plusMinus1(g)}`,
        VOI_PROFILE_GAIN,
        VOI_PROFILE_EFFORT,
      ),
    );
  }

  for (const sub of subjects) {
    const ticker = sub.ticker;
    const sd = desks.get(sub.id) ?? null;
    const subjTopics = book.topics.filter((t) => t.subjectId === sub.id);

    // SESSIONS — no study sessions logged for this desk at all.
    if (!book.sessions.some((s) => s.subjectId === sub.id)) {
      items.push(
        voiItem(
          sub.id,
          ticker,
          "sessions",
          (g) => `LOG STUDY SESSIONS → TIGHTEN ${ticker} CI90 BY ${plusMinus1(g)}`,
          VOI_SESSIONS_GAIN,
          VOI_SESSIONS_EFFORT,
        ),
      );
    }

    if (subjTopics.length === 0) {
      // TOPICS — no topic breakdown at all, and the desk's own forecast is
      // wide enough (>= VOI_TOPICS_SD_MIN) for a breakdown to be worth asking.
      if (sd != null && sd >= VOI_TOPICS_SD_MIN) {
        items.push(
          voiItem(
            sub.id,
            ticker,
            "topics",
            (g) => `LOG TOPIC BREAKDOWN → TIGHTEN ${ticker} CI90 BY ${plusMinus1(g)}`,
            VOI_TOPICS_GAIN_W * sd * VOI_Z90,
            VOI_TOPICS_EFFORT,
          ),
        );
      }
    } else if (sd != null) {
      // MARKS — topics exist but fewer than MASTERY_MIN_MARKS are marked yet.
      const topicIds = new Set(subjTopics.map((t) => t.id));
      const marks = book.topicMarks.filter((mk) => topicIds.has(mk.topicId)).length;
      if (marks < MASTERY_MIN_MARKS) {
        const needed = MASTERY_MIN_MARKS - marks;
        items.push(
          voiItem(
            sub.id,
            ticker,
            "marks",
            (g) => `MARK ${needed} MORE PAPER${needed === 1 ? "" : "S"} → TIGHTEN ${ticker} CI90 BY ${plusMinus1(g)}`,
            VOI_MARKS_GAIN_W * Math.min(1, sd / VOI_MARKS_SD_SAT),
            VOI_MARKS_EFFORT_PER * needed,
          ),
        );
      }
    }

    // TRAITS — subject traits (cumulativeness/determinism/breadth) never set.
    if (sub.traits == null && sd != null) {
      items.push(
        voiItem(
          sub.id,
          ticker,
          "traits",
          (g) => `SET SUBJECT TRAITS → TIGHTEN ${ticker} CI90 BY ${plusMinus1(g)}`,
          VOI_TRAITS_GAIN_W * sd * VOI_Z90,
          VOI_TRAITS_EFFORT,
        ),
      );
    }
  }

  return items.sort((a, b) => b.score - a.score).slice(0, VOI_TOP_N);
}
