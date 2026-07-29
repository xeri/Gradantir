import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bar, BarChart, Brush, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { C, FONT, microLabel } from "../theme";
import { useEscapeLayer } from "../lib/escapeStack";
import { Panel } from "../components/ui/Panel";
import { Sel } from "../components/ui/Field";
import { Toggle } from "../components/ui/Toggle";
import { Derive } from "../components/ui/Derive";
import { ChartTip } from "../components/ChartTip";
import {
  ChartFrame, crosshair, gridProps, scoreDomain, scoreTicks, tickStyle, tickStyleSm, xLabel, yLabel,
} from "../components/charts/chrome";
import { GROUPS, TYPES, typePlural } from "../constants";
import { addForecast, addMovingAvg, buildAssessmentRows, buildGroupedRows, type ChartRow, type TrendFit, type TypeFilter } from "../lib/grouping";
import type { ChartFacts, DeriveCtx } from "../lib/derive";
import { COMP_KEY, addComposite } from "../lib/composite";
import { buildOhlc, type OhlcRow } from "../lib/ohlc";
import { entryPeriod } from "../lib/periods";
import { labelRounds, roundLabels } from "../lib/rounds";
import { DEFAULT_CALENDAR, type SchoolCalendar } from "../lib/calendar";
import { makeWeightFn } from "../lib/weights";
import { round1, shortDate, shortDateY } from "../lib/utils";
import type { GradeEntry, GroupPeriod, PeriodMode, Settings, Subject } from "../types";

/** X value the reader has clicked to freeze a readout on. */
type Pin = string | number | null;

const BRUSH_MIN_ROWS = 7;
/** Rolling-average window — `addMovingAvg`'s own default, named so the
 *  derivation layer can quote the same k the line was drawn with. */
const MA_WIN = 3;

function brushProps(rows: unknown[], isTime: boolean) {
  if (rows.length < BRUSH_MIN_ROWS) return null;
  return {
    dataKey: isTime ? ("t" as const) : ("label" as const),
    height: 22,
    stroke: C.lineBright,
    fill: C.strip,
    travellerWidth: 8,
    tickFormatter: (v: string | number) => (isTime ? shortDate(Number(v)) : String(v)),
  };
}

/* ── line mode ───────────────────────────────────────────────────────────── */

/**
 * Frozen readout for one x — every visible series, ranked, with its move.
 *
 * This is also the chart board's only derivation surface, and deliberately so.
 * A popover cannot live inside a Recharts tooltip (the tooltip IS the transient
 * thing the popover would have to outlive), so the reader pins the point they
 * want to interrogate and inspects it here. Three of these figures are model
 * output rather than tape — the trend estimate, the rolling mean and the
 * composite — and only those three carry a note (§24).
 */
function PinStrip({
  row,
  prev,
  subjects,
  showComp,
  showMA,
  maWin,
  rows,
  idx,
  trend,
  label,
  deriveCtx,
  onOpenSubject,
  onClear,
}: {
  row: ChartRow;
  prev: ChartRow | undefined;
  subjects: Subject[];
  showComp: boolean;
  showMA: boolean;
  maWin: number;
  /** The whole board, so a rolling mean can quote the window it averaged. */
  rows: ChartRow[];
  idx: number;
  trend: Record<string, TrendFit>;
  label: string;
  deriveCtx?: DeriveCtx;
  onOpenSubject: (id: string) => void;
  onClear: () => void;
}) {
  const cells = subjects
    .map((s) => {
      const raw = row[s.id];
      const est = row[s.id + "_fc"];
      // On the grafted "Next (est.)" row nothing printed — the only number
      // there is the projection, which is exactly the one worth inspecting.
      const v = typeof raw === "number" ? raw : typeof est === "number" ? est : null;
      if (v == null) return null;
      const p = prev?.[s.id];
      const ma = row[s.id + "_ma"];
      return {
        id: s.id,
        ticker: s.ticker,
        name: s.name,
        color: s.color,
        v,
        d: typeof raw === "number" && typeof p === "number" ? round1(v - p) : null,
        projected: typeof raw !== "number",
        ma: showMA && typeof ma === "number" ? ma : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.v - a.v);

  const comp = showComp ? row[COMP_KEY] : undefined;
  const compValues = subjects
    .map((s) => ({ ticker: s.ticker, v: row[s.id] }))
    .filter((x): x is { ticker: string; v: number } => typeof x.v === "number");

  /** The last `win` printed values for a subject, ending at the pinned row. */
  const maWindow = (sid: string): number[] => {
    const out: number[] = [];
    for (let i = idx; i >= 0 && out.length < maWin; i--) {
      const x = rows[i][sid];
      if (typeof x === "number") out.unshift(x);
    }
    return out;
  };

  /* Passive: every cell is a <button> that opens the desk, so the figure hovers
     its note without stealing the click (derivation mode overrides that). */
  const wrap = (node: ReactNode, id: string, key: string, chart: ChartFacts) =>
    deriveCtx ? <Derive id={id} ctx={{ ...deriveCtx, key, chart }} passive>{node}</Derive> : <>{node}</>;

  return (
    <div className="border-t" style={{ borderColor: C.lineBright }}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b" style={{ borderColor: C.line, background: C.strip }}>
        <span style={{ ...microLabel, color: C.amber }}>
          PINNED · {label}
          {typeof comp === "number" && (
            <>
              {" · COMP "}
              {deriveCtx ? (
                <Derive id="chart.composite" ctx={{ ...deriveCtx, chart: { comp: { values: compValues, value: comp }, label } }}>
                  {comp.toFixed(1)}
                </Derive>
              ) : (
                comp.toFixed(1)
              )}
            </>
          )}
        </span>
        <button onClick={onClear} className="gx-focus text-[9px] font-bold tracking-[0.16em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
          CLEAR (ESC)
        </button>
      </div>
      {cells.length === 0 ? (
        <p className="px-3 py-2 text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
          Nothing printed at this point.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {cells.map((c) => (
            <button
              key={c.id}
              onClick={() => onOpenSubject(c.id)}
              title={`Open ${c.name}`}
              className="gx-focus flex items-baseline justify-between gap-2 px-3 py-1.5 border-r border-b last:border-r-0 hover:brightness-125"
              style={{ borderColor: C.line, fontFamily: FONT.mono }}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 shrink-0" style={{ background: c.color }} />
                <span className="text-[10px] font-bold tracking-[0.1em]" style={{ color: c.color }}>{c.ticker}</span>
              </span>
              <span className="flex items-baseline gap-1.5 shrink-0">
                {c.projected
                  ? wrap(
                      <span className="text-xs font-bold" style={{ color: C.faint }}>{c.v.toFixed(1)}</span>,
                      "chart.trend",
                      c.id,
                      { trend, ticker: c.ticker, color: c.color },
                    )
                  : <span className="text-xs font-bold" style={{ color: C.text }}>{c.v.toFixed(1)}</span>}
                {c.projected && <span className="text-[9px] tracking-[0.14em]" style={{ color: C.faint }}>EST</span>}
                {c.ma != null &&
                  wrap(
                    <span className="text-[10px]" style={{ color: C.dim }}>~{c.ma.toFixed(1)}</span>,
                    "chart.ma",
                    c.id,
                    { ma: { win: maWin, values: maWindow(c.id), value: c.ma }, ticker: c.ticker },
                  )}
                {c.d != null && (
                  <span className="text-[10px]" style={{ color: c.d > 0 ? C.up : c.d < 0 ? C.down : C.faint }}>
                    {c.d > 0 ? "+" : ""}{c.d.toFixed(1)}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LineBoard({
  subjects, entries, settings, onOpenSubject, deriveCtx,
}: {
  subjects: Subject[];
  entries: GradeEntry[];
  settings: Settings;
  onOpenSubject: (id: string) => void;
  deriveCtx?: DeriveCtx;
}) {
  const [groupBy, setGroupBy] = useState<PeriodMode>("term");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showMA, setShowMA] = useState(false);
  const [showFC, setShowFC] = useState(true);
  const [showTargets, setShowTargets] = useState(false);
  const [showComp, setShowComp] = useState(false);
  const [fullScale, setFullScale] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [emph, setEmph] = useState<string | null>(null);
  const [pin, setPin] = useState<Pin>(null);

  const visibleSubs = subjects.filter((s) => !hidden.has(s.id));
  const subMap = useMemo(() => Object.fromEntries(subjects.map((s) => [s.id, s])), [subjects]);
  const isTime = groupBy === "assessment";

  const { rows, trend } = useMemo(() => {
    const ids = visibleSubs.map((s) => s.id);
    const visEntries = entries.filter((e) => !hidden.has(e.subjectId));
    const wf = makeWeightFn(settings);
    let base = isTime
      ? buildAssessmentRows(visEntries, typeFilter, wf)
      : labelRounds(buildGroupedRows(visEntries, groupBy, typeFilter, wf, settings.calendar), roundLabels(entries, settings.calendar));
    base = base.map((r) => ({ ...r }));
    if (!isTime && showComp) addComposite(base, ids);
    if (showMA) addMovingAvg(base, ids, MA_WIN);
    // The fits come back out with the rows: §24 quotes the line that was
    // drawn rather than refitting one that might not be the same line.
    const fits: Record<string, TrendFit> = {};
    if (showFC) base = addForecast(base, ids, groupBy, fits);
    return { rows: base, trend: fits };
  }, [entries, subjects, groupBy, typeFilter, showMA, showFC, showComp, hidden, settings]);

  /* the pin only means anything while its x is still on the board */
  useEffect(() => setPin(null), [groupBy, typeFilter]);
  useEscapeLayer(() => setPin(null), pin != null);

  const plotted: number[] = [];
  for (const r of rows)
    for (const s of visibleSubs)
      for (const k of [s.id, s.id + "_ma", s.id + "_fc"]) {
        const v = r[k];
        if (typeof v === "number") plotted.push(v);
      }
  if (showTargets) for (const s of visibleSubs) if (s.target != null) plotted.push(s.target);
  const [yMin, yMax] = scoreDomain(plotted, fullScale);

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const solo = (id: string) => setHidden(new Set(subjects.filter((s) => s.id !== id).map((s) => s.id)));

  const pinnedIdx = pin == null ? -1 : rows.findIndex((r) => (isTime ? r.t === Number(pin) : r.label === pin));
  const pinnedRow = pinnedIdx >= 0 ? rows[pinnedIdx] : undefined;
  /* the forecast row is grafted on after the last real print — mark the seam */
  const seam = showFC && rows.length > 1 && rows[rows.length - 1].label === (isTime ? "est." : "Next (est.)")
    ? rows[rows.length - 2]
    : null;
  const brush = brushProps(rows, isTime);
  const lastValue = (sid: string): number | null => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const v = rows[i][sid];
      if (typeof v === "number") return v;
    }
    return null;
  };

  const toolbar = (
    <>
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
      <Toggle on={fullScale} onClick={() => setFullScale(!fullScale)}>0–100</Toggle>
    </>
  );

  const legend = (
    <>
      {subjects.map((s) => {
        const on = !hidden.has(s.id);
        const v = on ? lastValue(s.id) : null;
        return (
          <button
            key={s.id}
            onClick={() => toggle(s.id)}
            onDoubleClick={() => solo(s.id)}
            onPointerEnter={() => setEmph(s.id)}
            onPointerLeave={() => setEmph(null)}
            onFocus={() => setEmph(s.id)}
            onBlur={() => setEmph(null)}
            aria-pressed={on}
            title={`${s.name} — click to ${on ? "hide" : "show"}, double-click to solo`}
            className="gx-focus flex items-center gap-1.5 px-2 py-1 border text-[10px] font-bold tracking-[0.1em] transition-all"
            style={{
              fontFamily: FONT.mono,
              background: emph === s.id ? C.panel2 : "transparent",
              color: on ? s.color : C.faint,
              borderColor: on ? s.color : C.line,
              opacity: on ? 1 : 0.5,
            }}
          >
            <span className="w-1.5 h-1.5" style={{ background: on ? s.color : C.faint }} />
            {s.ticker}
            {v != null && <span style={{ color: C.dim }}>{v.toFixed(1)}</span>}
          </button>
        );
      })}
      {hidden.size > 0 && (
        <button
          onClick={() => setHidden(new Set())}
          className="gx-focus px-2 py-1 border text-[10px] font-bold tracking-[0.1em]"
          style={{ fontFamily: FONT.mono, color: C.amber, borderColor: C.line }}
        >
          ALL
        </button>
      )}
    </>
  );

  const empty = rows.length < 2 || visibleSubs.length === 0;

  return (
    <ChartFrame
      title="MARK HISTORY"
      toolbar={toolbar}
      legend={legend}
      reserve={brush ? 40 : 0}
      controls={
        <span className="hidden md:inline text-[9px] tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
          CLICK TO PIN · DBL-CLICK TICKER TO SOLO
        </span>
      }
      footnote={
        <>
          Dashed segments are trend-line estimates — a guide, not a promise.
          {showMA ? " Bold lines are 3-result rolling averages." : ""}
          {showComp && !isTime ? " Amber line is the composite." : ""}
          {brush ? " Drag the rail below the axis to zoom the window." : ""}
        </>
      }
    >
      {(h) =>
        empty ? (
          <div className="flex items-center justify-center text-[11px] uppercase tracking-wider" style={{ height: h, color: C.faint, fontFamily: FONT.mono }}>
            {visibleSubs.length === 0
              ? "Every ticker is hidden — tap one above to bring it back."
              : "Not enough results here yet. Log more, or widen the filters."}
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={h}>
              <ComposedChart
                data={rows}
                margin={{ top: 10, right: 18, bottom: 22, left: 4 }}
                onClick={(st: { activeLabel?: string | number }) => {
                  const l = st?.activeLabel;
                  if (l == null) return;
                  setPin((p) => (String(p) === String(l) ? null : l));
                }}
                style={{ cursor: "crosshair" }}
              >
                <CartesianGrid {...gridProps} />
                {isTime ? (
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="point"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(v) => shortDate(Number(v))}
                    tick={tickStyle}
                    stroke={C.lineBright}
                    tickMargin={8}
                    height={44}
                    label={xLabel("ASSESSMENT DATE")}
                  />
                ) : (
                  <XAxis
                    dataKey="label"
                    tick={tickStyle}
                    stroke={C.lineBright}
                    tickMargin={8}
                    height={44}
                    interval={rows.length > 14 ? "preserveStartEnd" : 0}
                    label={xLabel(groupBy.toUpperCase())}
                  />
                )}
                <YAxis
                  domain={[yMin, yMax]}
                  ticks={scoreTicks(yMin, yMax)}
                  tick={tickStyle}
                  stroke={C.lineBright}
                  width={58}
                  tickMargin={6}
                  tickFormatter={(v) => v + "%"}
                  label={yLabel("SCORE %")}
                />
                <Tooltip content={<ChartTip subMap={subMap} isTime={isTime} />} cursor={crosshair} />
                {seam && (
                  <ReferenceLine
                    x={isTime ? (seam.t as number) : (seam.label as string)}
                    stroke={C.lineBright}
                    strokeDasharray="2 4"
                    label={{ value: "NOW", position: "top", fill: C.faint, fontSize: 9, fontFamily: FONT.mono }}
                  />
                )}
                {pinnedRow && (
                  <ReferenceLine
                    x={isTime ? (pinnedRow.t as number) : (pinnedRow.label as string)}
                    stroke={C.amber}
                    strokeWidth={1}
                    strokeOpacity={0.7}
                  />
                )}
                {showTargets &&
                  visibleSubs.filter((s) => s.target != null).map((s) => (
                    <ReferenceLine
                      key={"tg" + s.id}
                      y={s.target!}
                      stroke={s.color}
                      strokeDasharray="2 6"
                      strokeOpacity={emph && emph !== s.id ? 0.2 : 0.55}
                      label={{ value: `${s.ticker} ${s.target}`, position: "insideTopRight", fill: s.color, fontSize: 9, fontFamily: FONT.mono }}
                    />
                  ))}
                {visibleSubs.map((s) => {
                  const dim = emph != null && emph !== s.id;
                  const lit = emph === s.id;
                  return (
                    <Line
                      key={s.id}
                      name={s.ticker}
                      dataKey={s.id}
                      stroke={s.color}
                      strokeWidth={lit ? 3 : showMA ? 1 : 2}
                      strokeOpacity={dim ? 0.15 : showMA ? 0.3 : 1}
                      dot={{ r: lit ? 3.2 : 2.2, fill: s.color, strokeWidth: 0 }}
                      activeDot={{
                        r: 5,
                        stroke: C.bg,
                        strokeWidth: 1.5,
                        style: { cursor: "pointer" },
                        onClick: () => onOpenSubject(s.id),
                      }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  );
                })}
                {showMA &&
                  visibleSubs.map((s) => (
                    <Line
                      key={s.id + "ma"}
                      dataKey={s.id + "_ma"}
                      stroke={s.color}
                      strokeWidth={emph === s.id ? 3 : 2}
                      strokeOpacity={emph != null && emph !== s.id ? 0.15 : 1}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                {showFC &&
                  visibleSubs.map((s) => (
                    <Line
                      key={s.id + "fc"}
                      dataKey={s.id + "_fc"}
                      stroke={s.color}
                      strokeWidth={1.6}
                      strokeOpacity={emph != null && emph !== s.id ? 0.15 : 1}
                      strokeDasharray="5 5"
                      dot={{ r: 2.6, fill: C.panel, stroke: s.color, strokeWidth: 1.4 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                {!isTime && showComp && (
                  <Line dataKey={COMP_KEY} name="COMP" stroke={C.amber} strokeWidth={2.4} dot={false} connectNulls isAnimationActive={false} />
                )}
                {brush && <Brush {...brush} />}
              </ComposedChart>
            </ResponsiveContainer>
            {pinnedRow && (
              <PinStrip
                row={pinnedRow}
                prev={pinnedIdx > 0 ? rows[pinnedIdx - 1] : undefined}
                subjects={visibleSubs}
                showComp={showComp && !isTime}
                showMA={showMA}
                maWin={MA_WIN}
                rows={rows}
                idx={pinnedIdx}
                trend={trend}
                label={isTime ? shortDate(Number(pinnedRow.t)) : String(pinnedRow.label)}
                deriveCtx={deriveCtx}
                onOpenSubject={onOpenSubject}
                onClear={() => setPin(null)}
              />
            )}
          </>
        )
      }
    </ChartFrame>
  );
}

/* ── candle mode ─────────────────────────────────────────────────────────── */

interface CandleShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: OhlcRow;
  pinnedKey?: string | null;
}

/**
 * Custom Recharts bar shape. The bar spans [low, high], so open/close pixel
 * positions are interpolated inside the given rect — no axis access needed.
 */
function CandleShape({ x = 0, y = 0, width = 0, height = 0, payload, pinnedKey }: CandleShapeProps) {
  if (!payload) return <g />;
  const { open, close, high, low } = payload;
  const up = close >= open;
  const color = up ? C.up : C.down;
  const pinned = pinnedKey != null && payload.label === pinnedKey;
  const cx = x + width / 2;
  const span = high - low;
  const yFor = (v: number) => (span === 0 ? y : y + ((high - v) / span) * height);
  const bodyTop = yFor(Math.max(open, close));
  const bodyH = Math.max(2, Math.abs(yFor(open) - yFor(close)));
  const bodyW = Math.max(6, Math.min(26, width * 0.6));
  return (
    <g style={{ cursor: "pointer" }} opacity={pinnedKey != null && !pinned ? 0.45 : 1}>
      <line x1={cx} y1={y} x2={cx} y2={y + height} stroke={color} strokeWidth={pinned ? 2 : 1.4} />
      <rect
        x={cx - bodyW / 2}
        y={bodyTop}
        width={bodyW}
        height={bodyH}
        fill={up ? color : C.panel}
        stroke={color}
        strokeWidth={pinned ? 2.2 : 1.4}
      />
      {pinned && <rect x={cx - bodyW / 2 - 3} y={y - 3} width={bodyW + 6} height={height + 6} fill="none" stroke={C.amber} strokeDasharray="2 3" />}
    </g>
  );
}

function CandleTip({ active, payload }: { active?: boolean; payload?: { payload?: OhlcRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const up = row.close >= row.open;
  return (
    <div className="border px-3 py-2 text-[11px]" style={{ background: C.strip, borderColor: C.lineBright, fontFamily: FONT.mono, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
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
      <div className="mt-1 pt-1 border-t text-[9px] tracking-[0.14em]" style={{ borderColor: C.line, color: C.faint }}>CLICK TO PIN THE PERIOD</div>
    </div>
  );
}

function VolumeTip({ active, payload }: { active?: boolean; payload?: { payload?: OhlcRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="border px-2.5 py-1.5 text-[11px]" style={{ background: C.strip, borderColor: C.lineBright, fontFamily: FONT.mono }}>
      <span style={{ color: C.faint }}>{row.label} · </span>
      <span className="font-bold" style={{ color: C.text }}>{row.count}</span>
      <span style={{ color: C.faint }}> PRINT{row.count === 1 ? "" : "S"}</span>
    </div>
  );
}

const VOL_H = 96;

function CandleBoard({
  subjects, entries, calendar = DEFAULT_CALENDAR, onOpenSubject,
}: {
  subjects: Subject[];
  entries: GradeEntry[];
  calendar?: SchoolCalendar;
  onOpenSubject: (id: string) => void;
}) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [period, setPeriod] = useState<GroupPeriod>("term");
  const [fullScale, setFullScale] = useState(false);
  const [showClose, setShowClose] = useState(true);
  const [pinKey, setPinKey] = useState<string | null>(null);

  const sub = subjects.find((s) => s.id === subjectId) ?? subjects[0];
  const subEntries = useMemo(() => (sub ? entries.filter((e) => e.subjectId === sub.id) : []), [entries, sub]);
  const rows = useMemo(
    () => (sub ? labelRounds(buildOhlc(subEntries, period, calendar), roundLabels(entries, calendar)) : []),
    [subEntries, entries, sub, period, calendar],
  );

  useEffect(() => setPinKey(null), [subjectId, period]);
  useEscapeLayer(() => setPinKey(null), !!pinKey);

  const plotted = rows.flatMap((r) => [r.low, r.high]);
  const [yMin, yMax] = scoreDomain(plotted, fullScale);
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const brush = brushProps(rows, false);

  const pinned = rows.find((r) => r.label === pinKey) ?? null;
  const pinnedPrints = pinned
    ? subEntries.filter((e) => entryPeriod(e, period, calendar).key === pinned.key).sort((a, b) => (a.date < b.date ? -1 : 1))
    : [];

  const empty = rows.length < 2;

  return (
    <ChartFrame
      title={sub ? `${sub.ticker} · CANDLES` : "CANDLES"}
      reserve={VOL_H + (brush ? 40 : 0)}
      controls={
        sub && (
          <button
            onClick={() => onOpenSubject(sub.id)}
            className="gx-focus hidden sm:inline text-[9px] font-bold tracking-[0.14em] px-2 py-1 border hover:brightness-125"
            style={{ color: sub.color, borderColor: C.line, fontFamily: FONT.mono }}
          >
            OPEN QUOTE ›
          </button>
        )
      }
      toolbar={
        <>
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
            options={[{ value: "month", label: "MONTHLY" }, { value: "term", label: "BY TERM" }, { value: "semester", label: "BY SEMESTER" }, { value: "year", label: "YEARLY" }]}
          />
          <span className="w-px h-5 mx-1 hidden sm:block" style={{ background: C.line }} />
          <Toggle on={showClose} onClick={() => setShowClose(!showClose)}>Close line</Toggle>
          <Toggle on={fullScale} onClick={() => setFullScale(!fullScale)}>0–100</Toggle>
        </>
      }
      footnote="Open = first result of the period · close = last · wick = high/low. Green closes above its open; red closes below. The lower panel counts prints per period."
    >
      {(h) =>
        empty ? (
          <div className="flex items-center justify-center text-[11px] uppercase tracking-wider" style={{ height: h, color: C.faint, fontFamily: FONT.mono }}>
            Needs results across at least two periods to draw candles.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={Math.max(200, h - VOL_H)}>
              <ComposedChart
                data={rows}
                syncId="candles"
                margin={{ top: 10, right: 18, bottom: 0, left: 4 }}
                onClick={(st: { activeLabel?: string | number }) => {
                  const l = st?.activeLabel;
                  if (l == null) return;
                  setPinKey((p) => (p === String(l) ? null : String(l)));
                }}
                style={{ cursor: "crosshair" }}
              >
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" tick={tickStyle} stroke={C.lineBright} tickMargin={8} height={26} />
                <YAxis
                  domain={[yMin, yMax]}
                  ticks={scoreTicks(yMin, yMax)}
                  tick={tickStyle}
                  stroke={C.lineBright}
                  width={58}
                  tickMargin={6}
                  tickFormatter={(v) => v + "%"}
                  label={yLabel("SCORE %")}
                />
                <Tooltip content={<CandleTip />} cursor={{ fill: "rgba(232,163,61,0.07)" }} />
                {sub?.target != null && (
                  <ReferenceLine
                    y={sub.target}
                    stroke={sub.color}
                    strokeDasharray="2 6"
                    strokeOpacity={0.6}
                    label={{ value: `TARGET ${sub.target}`, position: "insideTopRight", fill: sub.color, fontSize: 9, fontFamily: FONT.mono }}
                  />
                )}
                <Bar dataKey="range" shape={(p: object) => <CandleShape {...(p as CandleShapeProps)} pinnedKey={pinKey} />} isAnimationActive={false} />
                {showClose && (
                  <Line dataKey="close" stroke={sub?.color ?? C.amber} strokeWidth={1.4} strokeOpacity={0.55} dot={false} isAnimationActive={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>

            <ResponsiveContainer width="100%" height={VOL_H}>
              <BarChart data={rows} syncId="candles" margin={{ top: 4, right: 18, bottom: 22, left: 4 }}>
                <CartesianGrid {...gridProps} vertical={false} />
                <XAxis dataKey="label" tick={tickStyleSm} stroke={C.lineBright} tickMargin={6} height={40} label={xLabel(period.toUpperCase())} />
                <YAxis
                  domain={[0, maxCount]}
                  allowDecimals={false}
                  tick={tickStyleSm}
                  stroke={C.lineBright}
                  width={58}
                  tickMargin={6}
                  label={yLabel("PRINTS")}
                />
                <Tooltip content={<VolumeTip />} cursor={{ fill: "rgba(232,163,61,0.07)" }} />
                <Bar
                  dataKey="count"
                  fill={sub?.color ?? C.amber}
                  fillOpacity={0.45}
                  isAnimationActive={false}
                  maxBarSize={26}
                />
                {brush && <Brush {...brush} />}
              </BarChart>
            </ResponsiveContainer>

            {pinned && (
              <div className="border-t" style={{ borderColor: C.lineBright }}>
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b" style={{ borderColor: C.line, background: C.strip }}>
                  <span style={{ ...microLabel, color: C.amber }}>
                    PINNED · {pinned.label} · O {pinned.open.toFixed(1)} H {pinned.high.toFixed(1)} L {pinned.low.toFixed(1)} C {pinned.close.toFixed(1)}
                  </span>
                  <button onClick={() => setPinKey(null)} className="gx-focus text-[9px] font-bold tracking-[0.16em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
                    CLEAR (ESC)
                  </button>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3">
                  {pinnedPrints.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-baseline justify-between gap-2 px-3 py-1.5 border-r border-b text-[11px]"
                      style={{ borderColor: C.line, fontFamily: FONT.mono }}
                    >
                      <span className="truncate" style={{ color: C.dim }}>
                        <span style={{ color: C.faint }}>{shortDateY(e.date)}</span> {e.title || e.type}
                      </span>
                      <span className="font-bold shrink-0" style={{ color: C.text }}>{e.score.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )
      }
    </ChartFrame>
  );
}

/* ── mode switch ─────────────────────────────────────────────────────────── */

export function Charts({
  subjects, entries, settings, onOpenSubject, deriveCtx,
}: {
  subjects: Subject[];
  entries: GradeEntry[];
  settings: Settings;
  onOpenSubject: (id: string) => void;
  deriveCtx?: DeriveCtx;
}) {
  const [mode, setMode] = useState<"line" | "candles">("line");
  return (
    <div className="space-y-3">
      {/* radiogroup, not tablist: this picks a rendering mode, and there are no
          tabpanels or arrow-key roving to make a real tabs widget. A tablist
          with no tabpanels is a broken pattern to a screen reader. */}
      <div className="flex gap-1" role="radiogroup" aria-label="Chart mode">
        {(["line", "candles"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
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
        <LineBoard subjects={subjects} entries={entries} settings={settings} onOpenSubject={onOpenSubject} deriveCtx={deriveCtx} />
      ) : subjects.length === 0 ? (
        <Panel>
          <div className="py-8 text-center text-[11px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
            List a subject to draw candles.
          </div>
        </Panel>
      ) : (
        <CandleBoard subjects={subjects} entries={entries} calendar={settings.calendar} onOpenSubject={onOpenSubject} />
      )}
    </div>
  );
}
