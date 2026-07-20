import { round1, stdev } from "./utils";
import { currentTermKey, periodInfo, prevTermKey } from "./periods";
import { subjectForecast, volatilityLabel } from "./regression";
import { entriesAvg } from "./weights";
import type { AppData, GradeEntry, Settings, Subject, SubjectStat } from "../types";

/** Precompute every per-subject figure the UI shows. Averages honor weights. */
export function computeStats(subjects: Subject[], entries: GradeEntry[], settings: Settings): SubjectStat[] {
  const cur = currentTermKey();
  const prev = prevTermKey();
  return subjects.map((sub) => {
    const es = entries
      .filter((e) => e.subjectId === sub.id)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const scores = es.map((e) => e.score);
    const latest = es[es.length - 1] || null;
    const before = es[es.length - 2] || null;
    const tickDelta = latest && before ? round1(latest.score - before.score) : null;

    const curEntries = es.filter((e) => periodInfo(e.date, "term").key === cur.key);
    const prevEntries = es.filter((e) => periodInfo(e.date, "term").key === prev.key);
    const curAvgRaw = entriesAvg(curEntries, settings);
    const prevAvgRaw = entriesAvg(prevEntries, settings);
    const overallRaw = entriesAvg(es, settings);
    const curAvg = curAvgRaw != null ? round1(curAvgRaw) : null;
    const prevAvg = prevAvgRaw != null ? round1(prevAvgRaw) : null;
    const periodDelta = curAvg != null && prevAvg != null ? round1(curAvg - prevAvg) : null;

    const sd = round1(stdev(scores.slice(-10)));

    let ath: number | null = null, athDate: string | null = null, atl: number | null = null;
    for (const e of es) {
      if (ath == null || e.score > ath) { ath = e.score; athDate = e.date; }
      if (atl == null || e.score < atl) atl = e.score;
    }

    const withClass = es.filter((e) => e.classAvg != null);
    const alpha = withClass.length
      ? round1(withClass.reduce((a, e) => a + (e.score - (e.classAvg as number)), 0) / withClass.length)
      : null;

    return {
      sub, entries: es, scores, latest, tickDelta,
      overallAvg: overallRaw != null ? round1(overallRaw) : null,
      curAvg, prevAvg, periodDelta, curCount: curEntries.length,
      sd, volatility: volatilityLabel(sd),
      forecast: subjectForecast(es),
      ath, athDate, atl,
      fromAth: latest && ath != null ? round1(latest.score - ath) : null,
      alpha, alphaCount: withClass.length,
      curLabel: cur.label, prevLabel: prev.label,
    };
  });
}

export const statsOf = (data: AppData): SubjectStat[] =>
  computeStats(data.subjects, data.entries, data.settings);
