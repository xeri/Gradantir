import { mdeBound, type ScoredFold } from "./compare";
import type { Scoreboard } from "./index";

/**
 * The on-disk shape of the skill baseline, and the one place that knows it.
 *
 * v1 stored seven scalars, which made a paired comparison impossible: you
 * cannot difference fold-for-fold against numbers that were averaged before
 * they were written down. v2 stores the per-fold vector beside the aggregate,
 * keyed deterministically, so two runs over the same book pair exactly and a
 * fold that appears or disappears is reported rather than silently changing the
 * denominator.
 *
 * The key is `subjectId|targetDate|targetId` and the third component is not
 * decoration: a desk sits an exam and hands in coursework on the same day 24
 * times over the committed fixture, so a (subject, date) key collapses 56 folds
 * into 38 and pairs half the book against the wrong partner. The print id is
 * the only handle that names the scored event exactly once.
 */

/** 4 dp: below the noise floor of any comparison, and stable in a JSON diff. */
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** The one place the fold key is spelled. Both writers below go through it. */
const foldKey = (subjectId: string, targetDate: string, targetId: string): string =>
  `${subjectId}|${targetDate}|${targetId}`;

export interface BaselineAggregate {
  n: number;
  perSubjectSkill: number;
  perSubjectMae: number;
  perSubjectBias: number;
  cover90: number;
  meanMae: number;
  meanNaiveMae: number;
  meanCrps: number;
  meanCrpsNaive: number;
  /** NEGATIVE means the bottom-up aggregate loses to its own naive. */
  meanSkill: number;
  meanCover90: number;
  /** Upper bound on the smallest detectable CRPS improvement, points. */
  mdeBound: number;
}

export interface BaselineSnapshot {
  _comment: string;
  modelVersion: string;
  asOf: string;
  aggregate: BaselineAggregate;
  folds: { k: string; c: string; crps: number; crpsNaive: number; pit: number }[];
}

export interface HistoryRow {
  asOf: string;
  modelVersion: string;
  perSubjectSkill: number;
  cover90: number;
  meanSkill: number;
  note: string;
}

/** Every scored one-step-ahead point, as a comparable fold. */
export function foldsOf(sb: Scoreboard): ScoredFold[] {
  return sb.book.subjects
    .flatMap((s) => s.points)
    .map((p) => ({
      key: foldKey(p.subjectId, p.targetDate, p.targetId),
      cluster: p.subjectId,
      crps: r4(p.s.crps),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function snapshotOf(sb: Scoreboard, comment: string): BaselineSnapshot {
  const points = sb.book.subjects.flatMap((s) => s.points);
  return {
    _comment: comment,
    modelVersion: sb.modelVersion,
    asOf: sb.asOf,
    aggregate: {
      n: sb.book.n,
      perSubjectSkill: r4(sb.book.skill),
      perSubjectMae: r4(sb.book.mae),
      perSubjectBias: r4(sb.book.bias),
      cover90: r4(sb.book.cover90),
      meanMae: r4(sb.mean.mae),
      meanNaiveMae: r4(sb.mean.naiveMae),
      meanCrps: r4(sb.mean.crps),
      meanCrpsNaive: r4(sb.mean.crpsNaive),
      meanSkill: r4(sb.mean.skill),
      meanCover90: r4(sb.mean.cover90),
      mdeBound: r4(mdeBound(foldsOf(sb))),
    },
    folds: points
      .map((p) => ({
        k: foldKey(p.subjectId, p.targetDate, p.targetId),
        c: p.subjectId,
        crps: r4(p.s.crps),
        crpsNaive: r4(p.naive.crps),
        pit: r4(p.s.pit),
      }))
      .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)),
  };
}

/** The committed baseline's folds, in the shape `compareFolds` takes. */
export function baselineFolds(snap: BaselineSnapshot): ScoredFold[] {
  return snap.folds.map((f) => ({ key: f.k, cluster: f.c, crps: f.crps }));
}
