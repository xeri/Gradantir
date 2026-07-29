import type { GradeEntry, StudySession, SubjectMix, SubjectTraits, Topic, TopicMark } from "../../../types";
import { pDate, round1 } from "../../utils";
import {
  CARELESS_CREDIT,
  MASTERY_ALPHA,
  MASTERY_FLOOR_FRAC,
  MASTERY_MIN_MARKS,
  MASTERY_SCALE,
  MASTERY_W,
  PREREQ_HEADROOM,
  halfLifeOf,
} from "./params";

/**
 * The mastery read (D5's "crown jewel" channel): the one MEASURED signal in
 * the life-signals layer, everything else here is a self-report. Each
 * syllabus topic carries its own EWMA of marked-paper performance
 * (`topicMastery`), decayed by how long it has sat untouched — a study
 * session that lists the topic refreshes the clock even without a new mark
 * — and, in a cumulative subject, gated so a topic can't sit far above the
 * prerequisites it depends on. `masteryRead` folds those per-topic reads
 * into a whole-paper prediction that prices only the DEVIATION from the
 * house forecast: uncovered syllabus is NEUTRAL, carrying the model's own
 * call rather than a zero, so a thin book never manufactures a charge out
 * of topics nobody has touched yet. Pure and clock-free — `asOf` is always
 * passed in, never read off a live clock.
 */

export interface TopicMastery {
  /** Raw EWMA mastery 0-1 from marks (careless-credited). */
  topicId: string;
  m: number;
  /** Decayed + prereq-gated effective mastery 0-1. */
  mEff: number;
  /** Latest date of a folded mark's entry OR a session listing the topic, <= asOf. */
  lastTouched: string | null;
  /** Number of marks folded in. */
  n: number;
}

export interface MasteryRead {
  topics: TopicMastery[];
  /** Weighted share of syllabus with n >= 1, 0-1; null when the subject has no topics. */
  coverage: number | null;
  /** P*100, see formula; null when no topics or modelMean null. */
  predictedPaper: number | null;
  /** The priced deviation term, points. */
  term: number;
  /** Weighted stdev of mEff across covered topics, 0-1 scale; 0 when < 2 covered topics. */
  unevenness: number;
}

const DAY_MS = 86400000;
const daysBetween = (from: string, to: string): number => Math.round((pDate(to).getTime() - pDate(from).getTime()) / DAY_MS);
const round2 = (v: number) => Math.round(v * 100) / 100;

export function topicMastery(
  topics: Topic[],
  marks: TopicMark[],
  sessions: StudySession[],
  entries: GradeEntry[],
  traits: SubjectTraits | null,
  mix: SubjectMix | null,
  asOf: string,
): TopicMastery[] {
  if (!topics.length) return [];

  const entryById = new Map(entries.map((e) => [e.id, e]));
  const H = halfLifeOf(mix);

  // Pass 1: fold each topic's own marks (ascending entry date; ties by entry id, then mark id).
  const rawByTopic = new Map<string, { m: number; n: number; lastMarkDate: string | null }>();
  for (const topic of topics) {
    const dated = marks
      .filter((mk) => mk.topicId === topic.id)
      .map((mk) => {
        const entry = entryById.get(mk.entryId);
        if (!entry || entry.date > asOf) return null;
        return { mk, entryDate: entry.date, entryId: entry.id };
      })
      .filter((x): x is { mk: TopicMark; entryDate: string; entryId: string } => x !== null)
      .sort((a, b) => {
        if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1;
        if (a.entryId !== b.entryId) return a.entryId < b.entryId ? -1 : 1;
        return a.mk.id < b.mk.id ? -1 : a.mk.id > b.mk.id ? 1 : 0;
      });

    let m = 0;
    let n = 0;
    let lastMarkDate: string | null = null;
    for (const { mk, entryDate } of dated) {
      const v = mk.scorePct / 100;
      const vPrime = mk.errorKind === "careless" ? v + CARELESS_CREDIT * (1 - v) : v;
      m = n === 0 ? vPrime : m + MASTERY_ALPHA * (vPrime - m);
      n++;
      lastMarkDate = entryDate;
    }
    rawByTopic.set(topic.id, { m, n, lastMarkDate });
  }

  // lastTouched also picks up sessions (<= asOf) that list the topic, even without a mark.
  const lastSessionByTopic = new Map<string, string>();
  for (const s of sessions) {
    if (s.date > asOf) continue;
    for (const tid of s.topicIds ?? []) {
      const cur = lastSessionByTopic.get(tid);
      if (!cur || s.date > cur) lastSessionByTopic.set(tid, s.date);
    }
  }

  // Pass 2: decay each topic to its own ungated mEff0 — the prereq gate below reads
  // this pass only, never a gated value, so gating never recurses through a chain.
  const lastTouchedByTopic = new Map<string, string | null>();
  const mEff0ByTopic = new Map<string, number>();
  for (const topic of topics) {
    const raw = rawByTopic.get(topic.id)!;
    const sessDate = lastSessionByTopic.get(topic.id) ?? null;
    let lastTouched = raw.lastMarkDate;
    if (sessDate && (!lastTouched || sessDate > lastTouched)) lastTouched = sessDate;
    lastTouchedByTopic.set(topic.id, lastTouched);

    const dt = lastTouched ? daysBetween(lastTouched, asOf) : 0;
    const decayMult = MASTERY_FLOOR_FRAC + (1 - MASTERY_FLOOR_FRAC) * Math.exp((-Math.LN2 * dt) / H);
    mEff0ByTopic.set(topic.id, raw.m * decayMult);
  }

  const topicIds = new Set(topics.map((t) => t.id));

  // Pass 3: gate against prereqs' mEff0, when traits are set and every named prereq
  // lives in this subject's own topic set.
  return topics.map((topic) => {
    const raw = rawByTopic.get(topic.id)!;
    const mEff0 = mEff0ByTopic.get(topic.id)!;
    let mEff = mEff0;

    const prereqIds = topic.prereqIds ?? [];
    if (traits && prereqIds.length > 0 && prereqIds.every((id) => topicIds.has(id))) {
      const meanPrereq = prereqIds.reduce((a, id) => a + mEff0ByTopic.get(id)!, 0) / prereqIds.length;
      const C = traits.cumulativeness;
      mEff = (1 - C) * mEff0 + C * Math.min(mEff0, meanPrereq + PREREQ_HEADROOM);
    }

    return {
      topicId: topic.id,
      m: raw.m,
      mEff,
      lastTouched: lastTouchedByTopic.get(topic.id) ?? null,
      n: raw.n,
    };
  });
}

/** Weighted population stdev: weights need not be pre-normalised (renormalised here). */
function weightedStdev(items: { w: number; x: number }[]): number {
  if (items.length < 2) return 0;
  const wSum = items.reduce((a, it) => a + it.w, 0);
  if (!(wSum > 0)) return 0;
  const mean = items.reduce((a, it) => a + (it.w / wSum) * it.x, 0);
  const variance = items.reduce((a, it) => a + (it.w / wSum) * (it.x - mean) ** 2, 0);
  return Math.sqrt(variance);
}

const MASTERY_IDENTITY: MasteryRead = { topics: [], coverage: null, predictedPaper: null, term: 0, unevenness: 0 };

export function masteryRead(
  topics: Topic[],
  masteries: TopicMastery[],
  modelMean: number | null,
  attendancePct: number | null,
  asOf: string,
): MasteryRead {
  void asOf; // topics/masteries are already as-of'd by the caller via topicMastery
  if (!topics.length) return MASTERY_IDENTITY;

  // Topic weights: stated weightPct normalised over 100, nulls sharing the residual
  // equally; all-null => equal weights; a stated sum over 100 renormalises (nulls get 0).
  const stated = topics.map((t) => t.weightPct ?? null);
  const nullCount = stated.filter((w) => w === null).length;
  const statedSum = stated.reduce((a: number, w) => a + (w ?? 0), 0);

  let pct: number[];
  if (nullCount === topics.length) {
    pct = topics.map(() => 100 / topics.length);
  } else if (statedSum > 100) {
    pct = stated.map((w) => (w === null ? 0 : (w / statedSum) * 100));
  } else {
    const residual = 100 - statedSum;
    const perNull = nullCount > 0 ? residual / nullCount : 0;
    pct = stated.map((w) => (w === null ? perNull : (w as number)));
  }
  const wts = pct.map((p) => p / 100);

  const masteryByTopic = new Map(masteries.map((tm) => [tm.topicId, tm]));

  let coveredMass = 0;
  let coveredWeightedM = 0;
  let nMarkedTopics = 0;
  let totalMarks = 0;
  const unevenItems: { w: number; x: number }[] = [];

  topics.forEach((topic, i) => {
    const tm = masteryByTopic.get(topic.id);
    const wt = wts[i];
    if (tm && tm.n >= 1) {
      coveredMass += wt;
      coveredWeightedM += wt * tm.mEff;
      nMarkedTopics++;
      totalMarks += tm.n;
      unevenItems.push({ w: wt, x: tm.mEff });
    }
  });

  // Attendance shave: mass that "looks" covered by weight but was under-attended moves
  // to the uncovered (neutral) side — the covered term shrinks in proportion.
  let coveredMassShaved = coveredMass;
  if (attendancePct != null && attendancePct < 95) {
    coveredMassShaved = coveredMass * (1 - ((95 - attendancePct) / 100) * 0.5);
  }
  const uncoveredMassShaved = 1 - coveredMassShaved;
  const coveredContribution = coveredMass > 0 ? coveredWeightedM * (coveredMassShaved / coveredMass) : 0;

  const P = modelMean == null ? null : coveredContribution + uncoveredMassShaved * (modelMean / 100);
  const predictedPaper = P == null ? null : P * 100;

  const term =
    modelMean == null || coveredMass < 0.3 || nMarkedTopics < MASTERY_MIN_MARKS
      ? 0
      : MASTERY_W * Math.tanh(((predictedPaper as number) - modelMean) / MASTERY_SCALE) * Math.min(1, totalMarks / 6);

  return {
    topics: masteries,
    coverage: round2(coveredMass),
    predictedPaper: predictedPaper == null ? null : round1(predictedPaper),
    term: round2(term),
    unevenness: round2(weightedStdev(unevenItems)),
  };
}
