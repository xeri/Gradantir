import { useMemo, useState } from "react";
import {
  Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { C, FONT } from "../theme";
import { Panel } from "../components/ui/Panel";
import { Sel } from "../components/ui/Field";
import { Toggle } from "../components/ui/Toggle";
import { ChartTip } from "../components/ChartTip";
import { GROUPS, TYPES, typePlural } from "../constants";
import { addForecast, addMovingAvg, buildAssessmentRows, buildGroupedRows, type TypeFilter } from "../lib/grouping";
import { COMP_KEY, addComposite } from "../lib/composite";
import { buildOhlc, type OhlcRow } from "../lib/ohlc";
import { makeWeightFn } from "../lib/weights";
import { shortDate } from "../lib/utils";
import type { GradeEntry, GroupPeriod, PeriodMode, Settings, Subject } from "../types";

/* ── line mode ───────────────────────────────────────────────────────────── */

function LineBoard({ subjects, entries, settings }: { subjects: Subject[]; entries: GradeEntry[]; settings: Settings }) {
  const [groupBy, setGroupBy] = useState<PeriodMode>("term");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showMA, setShowMA] = useState(false);
  const [showFC, setShowFC] = useState(true);
  const [showTargets, setShowTargets] = useState(false);
  const [showComp, setShowComp] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const visibleSubs = subjects.filter((s) => !hidden.has(s.id));
  const subMap = useMemo(() => Object.fromEntries(subjects.map((s) => [s.id, s])), [subjects]);
  const isTime = groupBy === "assessment";

  const rows = useMemo(() => {
    const ids = visibleSubs.map((s) => s.id);
    const visEntries = entries.filter((e) => !hidden.has(e.subjectId));
    const wf = makeWeightFn(settings);
    let base = isTime
      ? buildAssessmentRows(visEntries, typeFilter, wf)
      : buildGroupedRows(visEntries, groupBy, typeFilter, wf);
    base = base.map((r) => ({ ...r }));
    if (!isTime && showComp) addComposite(base, ids);
    if (showMA) addMovingAvg(base, ids);
    if (showFC) base = addForecast(base, ids, groupBy);
    return base;
  }, [entries, subjects, groupBy, typeFilter, showMA, showFC, showComp, hidden, settings]);

  let min = 100;
  for (const r of rows)
    for (const s of visibleSubs)
      for (const k of [s.id, s.id + "_ma", s.id + "_fc"]) {
        const v = r[k];
        if (typeof v === "number" && v < min) min = v;
      }
  const yMin = Math.max(0, Math.floor((min - 4) / 10) * 10);
  const tick = { fontSize: 10, fontFamily: FONT.mono, fill: C.faint };

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b" style={{ borderColor: C.line }}>
          <Sel ariaLabel="Group results by" value={groupBy} onChange={(v) => setGroupBy(v as PeriodMode)} options={GROUPS} />
          <Sel
            ariaLabel="Filter by assessment type"
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as TypeFilter)}
            options={[{ value: "all", label: "ALL TYPES" }, ...TYPES.map((t) => ({ value: t, label: typePlural(t).toUpperCase() }))]}
          />
          <span className="w-px h-5 mx-1 hidden sm:block" style={{ background: C.line }} />
          <Toggle on={showFC} onClick={() => setShowFC(!showFC)}>Forecast</Toggle>
          <Toggle on={showMA} onClick={() => setShowMA(!showMA)}>Smooth</Toggle>
          <Toggle on={showTargets} onClick={() => setShowTargets(!showTargets)}>Targets</Toggle>
          {!isTime && <Toggle on={showComp} onClick={() => setShowComp(!showComp)}>Comp</Toggle>}
        </div>
        <div className="flex flex-wrap gap-1.5 px-3 py-2">
          {subjects.map((s) => {
            const on = !hidden.has(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                aria-pressed={on}
                className="gx-focus flex items-center gap-1.5 px-2 py-1 border text-[10px] font-bold tracking-[0.1em] transition-colors"
                style={{
                  fontFamily: FONT.mono,
                  background: on ? "transparent" : "transparent",
                  color: on ? s.color : C.faint,
                  borderColor: on ? s.color : C.line,
                  opacity: on ? 1 : 0.6,
                }}
              >
                <span className="w-1.5 h-1.5" style={{ background: on ? s.color : C.faint }} />
                {s.ticker}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel pad={false}>
        {rows.length < 2 || visibleSubs.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-[11px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
            {visibleSubs.length === 0
              ? "Every ticker is hidden — tap one above to bring it back."
              : "Not enough results here yet. Log more, or widen the filters."}
          </div>
        ) : (
          <div className="p-2 pt-3">
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={rows} margin={{ top: 6, right: 14, bottom: 0, left: -6 }}>
                <CartesianGrid stroke={C.line} vertical={false} />
                {isTime ? (
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => shortDate(Number(v))} tick={tick} stroke={C.line} tickMargin={8} />
                ) : (
                  <XAxis dataKey="label" tick={tick} stroke={C.line} tickMargin={8} interval="preserveStartEnd" />
                )}
                <YAxis domain={[yMin, 100]} tick={tick} stroke="transparent" width={38} tickFormatter={(v) => v + "%"} />
                <Tooltip content={<ChartTip subMap={subMap} isTime={isTime} />} />
                {showTargets &&
                  visibleSubs.filter((s) => s.target != null).map((s) => (
                    <ReferenceLine
                      key={"tg" + s.id}
                      y={s.target!}
                      stroke={s.color}
                      strokeDasharray="2 6"
                      strokeOpacity={0.5}
                      label={{ value: `${s.ticker} ${s.target}`, position: "insideTopRight", fill: s.color, fontSize: 9, fontFamily: FONT.mono }}
                    />
                  ))}
                {visibleSubs.map((s) => (
                  <Line
                    key={s.id}
                    dataKey={s.id}
                    stroke={s.color}
                    strokeWidth={showMA ? 1 : 2}
                    strokeOpacity={showMA ? 0.3 : 1}
                    dot={{ r: 2.2, fill: s.color, strokeWidth: 0 }}
                    activeDot={{ r: 3.6 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
                {showMA &&
                  visibleSubs.map((s) => (
                    <Line key={s.id + "ma"} dataKey={s.id + "_ma"} stroke={s.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  ))}
                {showFC &&
                  visibleSubs.map((s) => (
                    <Line
                      key={s.id + "fc"}
                      dataKey={s.id + "_fc"}
                      stroke={s.color}
                      strokeWidth={1.6}
                      strokeDasharray="5 5"
                      dot={{ r: 2.6, fill: C.panel, stroke: s.color, strokeWidth: 1.4 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                {!isTime && showComp && (
                  <Line dataKey={COMP_KEY} stroke={C.amber} strokeWidth={2.4} strokeDasharray="1 0" dot={false} connectNulls isAnimationActive={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-[10px] px-2 pb-1 uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
              Dashed segments are trend-line estimates — a guide, not a promise.
              {showMA ? " Bold lines are 3-result rolling averages." : ""}
              {showComp && !isTime ? " Amber line is the composite." : ""}
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ── candle mode ─────────────────────────────────────────────────────────── */

interface CandleShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: OhlcRow;
}

/**
 * Custom Recharts bar shape. The bar spans [low, high], so open/close pixel
 * positions are interpolated inside the given rect — no axis access needed.
 */
function CandleShape({ x = 0, y = 0, width = 0, height = 0, payload }: CandleShapeProps) {
  if (!payload) return <g />;
  const { open, close, high, low } = payload;
  const up = close >= open;
  const color = up ? C.up : C.down;
  const cx = x + width / 2;
  const span = high - low;
  const yFor = (v: number) => (span === 0 ? y : y + ((high - v) / span) * height);
  const bodyTop = yFor(Math.max(open, close));
  const bodyH = Math.max(2, Math.abs(yFor(open) - yFor(close)));
  const bodyW = Math.max(5, Math.min(18, width * 0.6));
  return (
    <g>
      <line x1={cx} y1={y} x2={cx} y2={y + height} stroke={color} strokeWidth={1.4} />
      <rect
        x={cx - bodyW / 2}
        y={bodyTop}
        width={bodyW}
        height={bodyH}
        fill={up ? color : C.panel}
        stroke={color}
        strokeWidth={1.4}
      />
    </g>
  );
}

function CandleTip({ active, payload }: { active?: boolean; payload?: { payload?: OhlcRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const up = row.close >= row.open;
  return (
    <div className="border px-3 py-2 text-[11px]" style={{ background: C.strip, borderColor: C.lineBright, fontFamily: FONT.mono }}>
      <div className="font-bold uppercase tracking-[0.14em] mb-1" style={{ color: C.faint }}>{row.label}</div>
      {([
        ["OPEN", row.open], ["HIGH", row.high], ["LOW", row.low], ["CLOSE", row.close],
      ] as const).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-5">
          <span style={{ color: C.faint }}>{k}</span>
          <span className="font-bold" style={{ color: k === "CLOSE" ? (up ? C.up : C.down) : C.text }}>{v.toFixed(1)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-5">
        <span style={{ color: C.faint }}>PRINTS</span>
        <span style={{ color: C.dim }}>{row.count}</span>
      </div>
    </div>
  );
}

function CandleBoard({ subjects, entries }: { subjects: Subject[]; entries: GradeEntry[] }) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [period, setPeriod] = useState<GroupPeriod>("term");
  const sub = subjects.find((s) => s.id === subjectId) ?? subjects[0];
  const rows = useMemo(
    () => (sub ? buildOhlc(entries.filter((e) => e.subjectId === sub.id), period) : []),
    [entries, sub, period],
  );
  const lo = rows.length ? Math.min(...rows.map((r) => r.low)) : 0;
  const yMin = Math.max(0, Math.floor((lo - 4) / 10) * 10);
  const tick = { fontSize: 10, fontFamily: FONT.mono, fill: C.faint };
  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <Sel
            ariaLabel="Candle subject"
            value={sub?.id ?? ""}
            onChange={setSubjectId}
            options={subjects.map((s) => ({ value: s.id, label: s.ticker }))}
          />
          <Sel
            ariaLabel="Candle period"
            value={period}
            onChange={(v) => setPeriod(v as GroupPeriod)}
            options={[{ value: "month", label: "MONTHLY" }, { value: "term", label: "BY TERM" }, { value: "semester", label: "BY SEMESTER" }]}
          />
          {sub && (
            <span className="ml-auto text-[10px] uppercase tracking-[0.14em]" style={{ color: sub.color, fontFamily: FONT.mono }}>
              {sub.ticker} · OPEN/HIGH/LOW/CLOSE PER PERIOD
            </span>
          )}
        </div>
      </Panel>
      <Panel pad={false}>
        {rows.length < 2 ? (
          <div className="h-72 flex items-center justify-center text-[11px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
            Needs results across at least two periods to draw candles.
          </div>
        ) : (
          <div className="p-2 pt-3">
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={rows} margin={{ top: 6, right: 14, bottom: 0, left: -6 }}>
                <CartesianGrid stroke={C.line} vertical={false} />
                <XAxis dataKey="label" tick={tick} stroke={C.line} tickMargin={8} />
                <YAxis domain={[yMin, 100]} tick={tick} stroke="transparent" width={38} tickFormatter={(v) => v + "%"} />
                <Tooltip content={<CandleTip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="range" shape={<CandleShape />} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-[10px] px-2 pb-1 uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
              Open = first result of the period · close = last · wick = high/low. Green closes above its open; red closes below.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ── mode switch ─────────────────────────────────────────────────────────── */

export function Charts({ subjects, entries, settings }: { subjects: Subject[]; entries: GradeEntry[]; settings: Settings }) {
  const [mode, setMode] = useState<"line" | "candles">("line");
  return (
    <div className="space-y-3">
      <div className="flex gap-1" role="tablist" aria-label="Chart mode">
        {(["line", "candles"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className="gx-focus px-3 py-1.5 border text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{
              fontFamily: FONT.mono,
              background: mode === m ? C.panel2 : "transparent",
              color: mode === m ? C.amber : C.faint,
              borderColor: mode === m ? C.lineBright : C.line,
            }}
          >
            {m === "line" ? "LINES" : "CANDLES"}
          </button>
        ))}
      </div>
      {mode === "line" ? (
        <LineBoard subjects={subjects} entries={entries} settings={settings} />
      ) : (
        <CandleBoard subjects={subjects} entries={entries} />
      )}
    </div>
  );
}
