import { avg, pDate, round1, shortDate } from "./utils";
import { periodInfo } from "./periods";
import { linreg } from "./regression";
import { clamp } from "./utils";
import { weightedAvg, type WeightFn } from "./weights";
import type { AssessmentType, GradeEntry, PeriodMode } from "../types";

/**
 * One x-axis point. Subject values live under their subject id; derived
 * series use suffixed keys: `<sid>_ma` (moving average), `<sid>_fc` (forecast).
 */
export interface ChartRow {
  key?: string;
  label?: string;
  /** Timestamp — present only in "assessment" mode. */
  t?: number;
  [k: string]: number | string | undefined;
}

export type TypeFilter = AssessmentType | "all";

const UNIT_WEIGHT: WeightFn = () => 1;

/** Average results per subject per period (weighted when a WeightFn is given). */
export function buildGroupedRows(
  entries: GradeEntry[],
  mode: PeriodMode,
  typeFilter: TypeFilter,
  wf: WeightFn = UNIT_WEIGHT,
): ChartRow[] {
  const filtered = typeFilter === "all" ? entries : entries.filter((e) => e.type === typeFilter);
  const map = new Map<string, { key: string; label: string; sums: Record<string, { v: number; w: number }[]> }>();
  for (const e of filtered) {
    const { key, label } = periodInfo(e.date, mode);
    if (!map.has(key)) map.set(key, { key, label, sums: {} });
    const r = map.get(key)!;
    (r.sums[e.subjectId] ||= []).push({ v: e.score, w: wf(e) });
  }
  return [...map.values()]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((r) => {
      const o: ChartRow = { key: r.key, label: r.label };
      for (const [sid, arr] of Object.entries(r.sums)) {
        const m = weightedAvg(arr);
        if (m != null) o[sid] = round1(m);
      }
      return o;
    });
}

/** One row per assessment date; same-day results for a subject are averaged. */
export function buildAssessmentRows(
  entries: GradeEntry[],
  typeFilter: TypeFilter,
  wf: WeightFn = UNIT_WEIGHT,
): ChartRow[] {
  const filtered = typeFilter === "all" ? entries : entries.filter((e) => e.type === typeFilter);
  const map = new Map<number, { t: number; label: string; sums: Record<string, { v: number; w: number }[]> }>();
  for (const e of filtered) {
    const t = pDate(e.date).getTime();
    if (!map.has(t)) map.set(t, { t, label: shortDate(t), sums: {} });
    (map.get(t)!.sums[e.subjectId] ||= []).push({ v: e.score, w: wf(e) });
  }
  return [...map.values()]
    .sort((a, b) => a.t - b.t)
    .map((r) => {
      const o: ChartRow = { t: r.t, label: r.label };
      for (const [sid, arr] of Object.entries(r.sums)) {
        const m = weightedAvg(arr);
        if (m != null) o[sid] = round1(m);
      }
      return o;
    });
}

/** Adds `<sid>_ma` rolling-average series in place. */
export function addMovingAvg(rows: ChartRow[], subjectIds: string[], win = 3): void {
  for (const sid of subjectIds) {
    const buf: number[] = [];
    for (const row of rows) {
      const v = row[sid];
      if (typeof v !== "number") continue;
      buf.push(v);
      if (buf.length > win) buf.shift();
      row[sid + "_ma"] = round1(avg(buf));
    }
  }
}

/** Extends rows with a dashed `<sid>_fc` series ending at a projected next point. */
export function addForecast(rows: ChartRow[], subjectIds: string[], mode: PeriodMode): ChartRow[] {
  if (rows.length < 2) return rows;
  const out = rows.map((r) => ({ ...r }));
  if (mode === "assessment") {
    const ts = out.map((r) => r.t as number);
    const gaps = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14 * 864e5;
    const tNext = ts[ts.length - 1] + Math.max(gap, 3 * 864e5);
    const nextRow: ChartRow = { t: tNext, label: "est." };
    let any = false;
    for (const sid of subjectIds) {
      const pts: { x: number; y: number; row: ChartRow }[] = [];
      out.forEach((r) => {
        const v = r[sid];
        if (typeof v === "number") pts.push({ x: ((r.t as number) - ts[0]) / 864e5, y: v, row: r });
      });
      if (pts.length < 3) continue;
      const { slope, intercept } = linreg(pts.slice(-10));
      const pred = clamp(round1(slope * ((tNext - ts[0]) / 864e5) + intercept), 0, 100);
      pts[pts.length - 1].row[sid + "_fc"] = pts[pts.length - 1].y;
      nextRow[sid + "_fc"] = pred;
      any = true;
    }
    return any ? [...out, nextRow] : out;
  }
  const nextRow: ChartRow = { key: "__next", label: "Next (est.)" };
  let any = false;
  for (const sid of subjectIds) {
    const seq: { v: number; row: ChartRow }[] = [];
    out.forEach((r) => {
      const v = r[sid];
      if (typeof v === "number") seq.push({ v, row: r });
    });
    if (seq.length < 3) continue;
    const pts = seq.map((s, i) => ({ x: i, y: s.v })).slice(-10);
    const { slope, intercept } = linreg(pts.map((p, i) => ({ x: i, y: p.y })));
    const pred = clamp(round1(slope * pts.length + intercept), 0, 100);
    seq[seq.length - 1].row[sid + "_fc"] = seq[seq.length - 1].v;
    nextRow[sid + "_fc"] = pred;
    any = true;
  }
  return any ? [...out, nextRow] : out;
}
