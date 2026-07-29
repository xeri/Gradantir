import { clamp, stdev } from "../../utils";
import { groupByLineage, inheritedEntries } from "../../lineage";
import { poolableScores, poolStats } from "../shrinkage";
import { ensemble, type MemberName } from "../ensemble";
import { scoreT, type Scores } from "./scoring";
import type { GradeEntry, Subject } from "../../../types";

/**
 * Walk-forward one-step-ahead backtest. For each print past a short warm-up,
 * refit the ensemble on strictly-earlier prints (with the cross-subject pool
 * rebuilt as-of, so nothing leaks from the future) and score its predictive
 * against the realized score with the proper rules in scoring.ts. Every member
 * forecast, pool and score is a pure function of the truncated book, so the
 * whole thing is deterministic and reproducible.
 *
 * The benchmark is the probabilistic last-value naive: mean = last print,
 * spread = the sd of the tape so far. Skill is 1 − CRPS/CRPS_naive: positive
 * means the engine actually beat "assume it's the same as last time".
 */

const WARMUP = 2; // need ≥2 past prints for a naive spread and a meaningful blend
const NAIVE_SD_FLOOR = 3;

export interface OneStep {
  subjectId: string;
  targetDate: string;
  type: GradeEntry["type"];
  y: number;
  pred: { mean: number; scale: number; df: number };
  s: Scores;
  naive: Scores;
}

export interface SubjectBacktest {
  subjectId: string;
  points: OneStep[];
  crps: number;
  crpsNaive: number;
  /** 1 − CRPS/CRPS_naive. >0 ⇒ beat last-value. */
  skill: number;
  mae: number;
  rmse: number;
  /** mean(pred.mean − y): a persistent sign is the optimism/pessimism bias. */
  bias: number;
  cover50: number;
  cover90: number;
}

export interface BookBacktest {
  subjects: SubjectBacktest[];
  n: number;
  crps: number;
  crpsNaive: number;
  skill: number;
  mae: number;
  rmse: number;
  bias: number;
  cover50: number;
  cover90: number;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function summarize(subjectId: string, points: OneStep[]): SubjectBacktest {
  const crps = mean(points.map((p) => p.s.crps));
  const crpsNaive = mean(points.map((p) => p.naive.crps));
  return {
    subjectId,
    points,
    crps,
    crpsNaive,
    skill: crpsNaive > 0 ? 1 - crps / crpsNaive : 0,
    mae: mean(points.map((p) => p.s.ae)),
    rmse: Math.sqrt(mean(points.map((p) => p.s.se))),
    bias: mean(points.map((p) => p.pred.mean - p.y)),
    cover50: mean(points.map((p) => p.s.cover50)),
    cover90: mean(points.map((p) => p.s.cover90)),
  };
}

export function backtestSubject(
  subjectId: string,
  subjects: Subject[],
  entries: GradeEntry[],
  opts?: { members?: ReadonlySet<MemberName> },
): SubjectBacktest | null {
  const sub = subjects.find((s) => s.id === subjectId);
  if (!sub) return null;
  const tape = inheritedEntries(sub, subjects, entries)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const points: OneStep[] = [];
  for (let i = WARMUP; i < tape.length; i++) {
    const target = tape[i];
    const past = tape.slice(0, i);
    const pool = poolStats(poolableScores(groupByLineage(subjects, entries.filter((e) => e.date < target.date))));
    const ens = ensemble(past, pool, target.date, opts?.members ? { members: opts.members } : undefined);
    if (!ens) continue;
    const pred = { mean: clamp(ens.mean, 0, 100), scale: ens.sd, df: ens.df };
    const naivePred = {
      mean: past[past.length - 1].score,
      scale: Math.max(NAIVE_SD_FLOOR, stdev(past.map((p) => p.score))),
      df: ens.df,
    };
    points.push({
      subjectId,
      targetDate: target.date,
      type: target.type,
      y: target.score,
      pred,
      s: scoreT(pred, target.score),
      naive: scoreT(naivePred, target.score),
    });
  }
  return summarize(subjectId, points);
}

export function backtestBook(
  subjects: Subject[],
  entries: GradeEntry[],
  opts?: { members?: ReadonlySet<MemberName> },
): BookBacktest {
  const subs = subjects
    .map((s) => backtestSubject(s.id, subjects, entries, opts))
    .filter((b): b is SubjectBacktest => b != null && b.points.length > 0);
  const all = subs.flatMap((s) => s.points);
  return {
    subjects: subs,
    n: all.length,
    crps: mean(all.map((p) => p.s.crps)),
    crpsNaive: mean(all.map((p) => p.naive.crps)),
    skill: (() => {
      const c = mean(all.map((p) => p.s.crps));
      const cn = mean(all.map((p) => p.naive.crps));
      return cn > 0 ? 1 - c / cn : 0;
    })(),
    mae: mean(all.map((p) => p.s.ae)),
    rmse: Math.sqrt(mean(all.map((p) => p.s.se))),
    bias: mean(all.map((p) => p.pred.mean - p.y)),
    cover50: mean(all.map((p) => p.s.cover50)),
    cover90: mean(all.map((p) => p.s.cover90)),
  };
}
