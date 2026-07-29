import { avg, pDate, round1, shortDate } from "./utils";
import { entryPeriod } from "./periods";
import { DEFAULT_CALENDAR, type SchoolCalendar } from "./calendar";
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
  cal: SchoolCalendar = DEFAULT_CALENDAR,
): ChartRow[] {
  const filtered = typeFilter === "all" ? entries : entries.filter((e) => e.type === typeFilter);
  const map = new Map<string, { key: string; label: string; sums: Record<string, { v: number; w: number }[]> }>();
  for (const e of filtered) {
    const { key, label } = entryPeriod(e, mode, cal);
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

/**
 * The least-squares fit behind one subject's dashed segment.
 *
 * Published rather than recomputed: §24's derivation layer quotes this, and a
 * research note that re-derived the line could disagree with the line drawn.
 */
export interface TrendFit {
  slope: number;
  intercept: number;
  /** Residual sd of the fit — how far the line misses its own points. */
  sigma: number;
  /** Points the fit used (the last ≤10 of the series). */
  used: number;
  /** Points the series has in total. */
  n: number;
  /** x of the projected point, in the units the fit ran on. */
  xNext: number;
  /** slope·xNext + intercept, BEFORE the clip to [0,100]. */
  raw: number;
  /** What the chart actually draws. */
  pred: number;
  /** The fitted window, oldest first. */
  pts: { x: number; y: number }[];
  /** What one step of x means — "DAY" in time mode, "PERIOD" otherwise. */
  unit: string;
}

/** Extends rows with a dashed `<sid>_fc` series ending at a projected next point. */
export function addForecast(
  rows: ChartRow[],
  subjectIds: string[],
  mode: PeriodMode,
  /** Optional out-parameter: each subject's fit, for the derivation layer. */
  fits?: Record<string, TrendFit>,
): ChartRow[] {
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
      const win = pts.slice(-10);
      const { slope, intercept, sigma } = linreg(win);
      const xNext = (tNext - ts[0]) / 864e5;
      const raw = slope * xNext + intercept;
      const pred = clamp(round1(raw), 0, 100);
      pts[pts.length - 1].row[sid + "_fc"] = pts[pts.length - 1].y;
      nextRow[sid + "_fc"] = pred;
      if (fits) {
        fits[sid] = {
          slope, intercept, sigma,
          used: win.length, n: pts.length, xNext, raw, pred,
          pts: win.map((p) => ({ x: p.x, y: p.y })),
          unit: "DAY",
        };
      }
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
    // Re-indexed from 0 inside the window, so the projection is one step past
    // the window's own last point rather than past the whole series.
    const win = pts.map((p, i) => ({ x: i, y: p.y }));
    const { slope, intercept, sigma } = linreg(win);
    const raw = slope * pts.length + intercept;
    const pred = clamp(round1(raw), 0, 100);
    seq[seq.length - 1].row[sid + "_fc"] = seq[seq.length - 1].v;
    nextRow[sid + "_fc"] = pred;
    if (fits) {
      fits[sid] = {
        slope, intercept, sigma,
        used: win.length, n: seq.length, xNext: pts.length, raw, pred,
        pts: win,
        unit: "PERIOD",
      };
    }
    any = true;
  }
  return any ? [...out, nextRow] : out;
}
