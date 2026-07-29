import { clamp, round1 } from "../../utils";
import type { Interval, NextExamForecast, SubjectStat } from "../../../types";
import type { SignalRead } from "./signalread";

/**
 * applySignals — the post-process that takes the life-signals board and
 * shifts the house `nextExam` by the earned-weighted adjustment, widening
 * its bands by the read's sd multiplier. A sibling of `applyBias`/
 * `correctNextExam` in `../../stats.ts`: it runs AFTER the board is fully
 * priced (price, mark, LOO rewind, ratings, bias correction all settled) and
 * touches nothing but `quant.nextExam`. Mirrors `correctNextExam`'s interval
 * math exactly — recentre the half-widths of ci50/ci90 on the new mean,
 * scaled by the multiplier, preserving whatever asymmetry the original band
 * already had — with the one difference the module spec calls for: the
 * shift is ADDITIVE (the board is nudged toward the state read, not replaced
 * by it) and the recentred mean is rounded to 1dp before it seats the bands,
 * since the shift itself (an earned weight times a signal sum) rarely lands
 * on a clean tenth.
 *
 * Identity per desk — the SAME nextExam object back — when the shift rounds
 * to zero at 1dp (|shift| < 0.05) and the sd multiplier is exactly 1; the sd
 * multiplier is otherwise ungated by the earned weight (the "humility
 * claim": a book can widen its own bands on state alone, at w = 0, without
 * earning a seat to move the mean). Identity for a desk whose board carries
 * no read, or whose `quant` is null: passed through by reference untouched.
 * Identity for the WHOLE array — same reference back — when `!on`, or when
 * no desk on the board actually moves (an unearned or untouched book), the
 * same discipline `applyBias`/`poolBoardJoint` hold their own boards to, so
 * a book that has never touched this feature costs nothing extra and every
 * downstream memo keeps its reference.
 */
function applyRead(nx: NextExamForecast, shift: number, mult: number): NextExamForecast {
  if (Math.abs(shift) < 0.05 && mult === 1) return nx;
  const mean = round1(clamp(nx.mean + shift, 0, 100));
  const band = (iv: Interval): Interval => ({
    lo: clamp(mean - (nx.mean - iv.lo) * mult, 0, 100),
    hi: clamp(mean + (iv.hi - nx.mean) * mult, 0, 100),
  });
  return { mean, sd: round1(nx.sd * mult), ci50: band(nx.ci50), ci90: band(nx.ci90) };
}

export function applySignals<T extends SubjectStat>(
  stats: T[],
  reads: Map<string, SignalRead>,
  w: number,
  on: boolean,
): T[] {
  if (!on) return stats;
  let moved = false;
  const out = stats.map((stat) => {
    const read = reads.get(stat.sub.id);
    if (!read || !stat.quant) return stat;
    const nextExam = applyRead(stat.quant.nextExam, w * read.adj, read.sdMult);
    if (nextExam === stat.quant.nextExam) return stat;
    moved = true;
    return { ...stat, quant: { ...stat.quant, nextExam } };
  });
  return moved ? out : stats;
}
