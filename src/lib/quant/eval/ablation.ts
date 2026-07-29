import type { SchoolCalendar } from "../../calendar";
import { buildRounds, examRounds } from "../../rounds";
import { inheritedEntries } from "../../lineage";
import { pricesAsOf } from "../aggregate";
import { PREMIUM_CAPS } from "../mark";
import { backtestBook } from "./backtest";
import type { MemberName } from "../ensemble";
import type { GradeEntry, Settings, Subject } from "../../../types";

/**
 * Leave-one-out ablation. Every ensemble member and every itemized premium must
 * beat its own absence out-of-sample, or it is dead weight. `delta` is the
 * out-of-sample loss WITHOUT the piece minus WITH it: delta > 0 means removing
 * it hurt, so the piece earns its place; delta < 0 means removing it helped, so
 * it is actively costing skill and should be pruned.
 */

export interface AblationRow {
  key: string;
  kind: "member" | "premium";
  baseline: number;
  ablated: number;
  delta: number;
  verdict: "keep" | "prune" | "neutral";
}

const EPS = 0.02; // CRPS/pinball points; smaller swings are noise
const MEMBERS: readonly MemberName[] = ["kalman", "ewma", "shrunk", "trend"];
const PREMIUM_KEYS: readonly string[] = [...Object.keys(PREMIUM_CAPS), "steady"];

const verdictOf = (delta: number): AblationRow["verdict"] =>
  delta > EPS ? "keep" : delta < -EPS ? "prune" : "neutral";

/** Member LOO scored on the ensemble's own one-step-ahead CRPS. */
export function ablateMembers(subjects: Subject[], entries: GradeEntry[]): AblationRow[] {
  const baseline = backtestBook(subjects, entries).crps;
  return MEMBERS.map((m) => {
    const others = new Set(MEMBERS.filter((x) => x !== m));
    const ablated = backtestBook(subjects, entries, { members: others }).crps;
    const delta = ablated - baseline;
    return { key: m, kind: "member", baseline, ablated, delta, verdict: verdictOf(delta) };
  });
}

const pinball = (y: number, q: number, tau: number): number => (y - q) * (tau - (y < q ? 1 : 0));

interface MarkFold {
  subjectId: string;
  cutoff: string; // strike the mark as of the prior round
  y: number; // the realized next exam
}

function markFolds(subjects: Subject[], entries: GradeEntry[], cal: SchoolCalendar): MarkFold[] {
  const rounds = examRounds(buildRounds(entries, cal));
  const examAt = (sub: Subject, r: { first: string; date: string }): number | null => {
    const e = inheritedEntries(sub, subjects, entries).find(
      (x) => x.type === "Exam" && x.date >= r.first && x.date <= r.date,
    );
    return e ? e.score : null;
  };
  const folds: MarkFold[] = [];
  for (let i = 0; i < rounds.length - 1; i++) {
    const r = rounds[i];
    const next = rounds[i + 1];
    for (const sub of subjects) {
      const y = examAt(sub, next);
      const hadHistory = inheritedEntries(sub, subjects, entries).some((x) => x.date <= r.date);
      if (y != null && hadHistory) folds.push({ subjectId: sub.id, cutoff: r.date, y });
    }
  }
  return folds;
}

/**
 * Premium LOO scored as a low-τ pinball of the MARK against the realized next
 * exam. The mark is a deliberately conservative, loss-averse quantile forecast
 * (it prices downside), so a low-τ pinball is the honest objective — plain MAE
 * would always favour dropping every premium and marking at fair value.
 */
export function ablatePremia(subjects: Subject[], entries: GradeEntry[], settings: Settings): AblationRow[] {
  const cal = settings.calendar;
  const folds = markFolds(subjects, entries, cal);
  if (!folds.length) return [];
  const TAU = 0.25;

  const scoreWith = (drop?: ReadonlySet<string>): number => {
    // One reprice per cutoff, reused across the subjects sharing it.
    const priceByCutoff = new Map<string, Map<string, number>>();
    let sum = 0;
    let n = 0;
    for (const f of folds) {
      let prices = priceByCutoff.get(f.cutoff);
      if (!prices) {
        prices = pricesAsOf(subjects, entries, settings, f.cutoff, drop ? { drop } : undefined);
        priceByCutoff.set(f.cutoff, prices);
      }
      const mark = prices.get(f.subjectId);
      if (mark == null) continue;
      sum += pinball(f.y, mark, TAU);
      n++;
    }
    return n ? sum / n : 0;
  };

  const baseline = scoreWith();
  return PREMIUM_KEYS.map((key) => {
    const ablated = scoreWith(new Set([key]));
    const delta = ablated - baseline;
    return { key, kind: "premium" as const, baseline, ablated, delta, verdict: verdictOf(delta) };
  });
}
