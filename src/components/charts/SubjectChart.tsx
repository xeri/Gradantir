import { useMemo, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { C, FONT } from "../../theme";
import { Toggle } from "../ui/Toggle";
import { crosshair, gridProps, scoreDomain, scoreTicks, tickStyleSm, yLabel } from "./chrome";
import { round1, shortDateY } from "../../lib/utils";
import type { GradeEntry, PriceResult } from "../../types";

interface Point {
  label: string;
  score: number;
  classAvg: number | null;
  band: [number, number] | null;
  entry: GradeEntry;
}

const TYPE_MARK: Record<string, "square" | "diamond" | "circle" | "tri"> = {
  Exam: "square",
  Test: "diamond",
  Assignment: "circle",
  Quiz: "tri",
};

/** Print marker — the assessment type is encoded in the shape, not just color. */
function TypeDot({ cx, cy, payload, color, onPick }: {
  cx?: number; cy?: number; payload?: Point; color: string; onPick?: (e: GradeEntry) => void;
}) {
  if (cx == null || cy == null || !payload) return <g />;
  const kind = TYPE_MARK[payload.entry.type] ?? "circle";
  const r = 4;
  const common = { fill: C.bg, stroke: color, strokeWidth: 1.8 };
  return (
    <g
      style={{ cursor: onPick ? "pointer" : "default" }}
      onClick={() => onPick?.(payload.entry)}
    >
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      {kind === "square" && <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} {...common} />}
      {kind === "diamond" && <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} transform={`rotate(45 ${cx} ${cy})`} {...common} />}
      {kind === "circle" && <circle cx={cx} cy={cy} r={r} {...common} />}
      {kind === "tri" && <polygon points={`${cx},${cy - r - 1} ${cx + r + 1},${cy + r} ${cx - r - 1},${cy + r}`} {...common} />}
    </g>
  );
}

function PrintTip({ active, payload, color }: { active?: boolean; payload?: { payload?: Point }[]; color: string }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const e = p.entry;
  const alpha = e.classAvg != null ? round1(e.score - e.classAvg) : null;
  return (
    <div className="border px-3 py-2 max-w-56" style={{ background: C.strip, borderColor: C.lineBright, fontFamily: FONT.mono, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1" style={{ color }}>
        {e.type} · {shortDateY(e.date)}
      </div>
      {e.title && <div className="text-[11px] mb-1 truncate" style={{ color: C.dim }}>{e.title}</div>}
      <div className="flex items-baseline justify-between gap-5 text-xs">
        <span style={{ color: C.faint }}>SCORE</span>
        <span className="font-bold" style={{ color: C.text }}>{e.score.toFixed(1)}%</span>
      </div>
      {e.classAvg != null && (
        <div className="flex items-baseline justify-between gap-5 text-xs">
          <span style={{ color: C.faint }}>CLASS</span>
          <span style={{ color: C.dim }}>
            {e.classAvg.toFixed(1)}{" "}
            <span style={{ color: alpha! > 0 ? C.up : alpha! < 0 ? C.down : C.dim }}>
              α{alpha! > 0 ? "+" : ""}{alpha!.toFixed(1)}
            </span>
          </span>
        </div>
      )}
      {e.rank != null && e.cohortN != null && (
        <div className="flex items-baseline justify-between gap-5 text-xs">
          <span style={{ color: C.faint }}>RANK</span>
          <span style={{ color: C.dim }}>#{e.rank} / {e.cohortN}</span>
        </div>
      )}
      <div className="mt-1.5 text-[9px] tracking-[0.14em]" style={{ color: C.faint }}>CLICK THE PRINT TO EDIT IT</div>
    </div>
  );
}

/**
 * The subject's own tape: every print in order, the class line where it exists,
 * and the quant price/target as horizontal marks. Clicking a print edits it.
 */
export function SubjectChart({
  entries,
  color,
  target,
  quant,
  height = 240,
  onPick,
}: {
  entries: GradeEntry[];
  color: string;
  target: number | null;
  quant: PriceResult | null;
  height?: number;
  onPick?: (e: GradeEntry) => void;
}) {
  const [fullScale, setFullScale] = useState(false);
  const [showClass, setShowClass] = useState(true);

  const data = useMemo<Point[]>(
    () =>
      entries.map((e) => ({
        label: shortDateY(e.date),
        score: e.score,
        classAvg: e.classAvg ?? null,
        band: quant ? [quant.ci90.lo, quant.ci90.hi] : null,
        entry: e,
      })),
    [entries, quant],
  );

  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center text-[10px] uppercase tracking-wider" style={{ height: 90, color: C.faint, fontFamily: FONT.mono }}>
        the line starts at two prints
      </div>
    );
  }

  const hasClass = data.some((d) => d.classAvg != null);
  const plotted = [
    ...data.map((d) => d.score),
    ...(showClass ? data.flatMap((d) => (d.classAvg != null ? [d.classAvg] : [])) : []),
    ...(target != null ? [target] : []),
    ...(quant ? [quant.ci90.lo, quant.ci90.hi, quant.price, quant.fv] : []),
  ];
  const [yMin, yMax] = scoreDomain(plotted, fullScale);

  return (
    <div>
      <div className="flex items-center justify-end gap-1 -mt-1 mb-1">
        {hasClass && <Toggle on={showClass} onClick={() => setShowClass(!showClass)}>Class</Toggle>}
        <Toggle on={fullScale} onClick={() => setFullScale(!fullScale)}>0–100</Toggle>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 10, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id="subjFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="label"
            tick={tickStyleSm}
            stroke={C.lineBright}
            tickMargin={6}
            height={26}
            interval={data.length > 8 ? "preserveStartEnd" : 0}
          />
          <YAxis
            domain={[yMin, yMax]}
            ticks={scoreTicks(yMin, yMax)}
            tick={tickStyleSm}
            stroke={C.lineBright}
            width={46}
            tickMargin={4}
            tickFormatter={(v) => String(v)}
            label={yLabel("SCORE %")}
          />
          <Tooltip content={<PrintTip color={color} />} cursor={crosshair} />
          {/* The risk band: the points between fair value and the mark are what
              the desk's own volatility, drift and misses are costing it. */}
          {quant && quant.discount > 0.05 && (
            <ReferenceArea
              y1={quant.price}
              y2={quant.fv}
              fill={C.down}
              fillOpacity={0.07}
              stroke={C.down}
              strokeOpacity={0.25}
              strokeDasharray="1 3"
            />
          )}
          {quant && quant.discount > 0.05 && (
            <ReferenceLine
              y={quant.fv}
              stroke={C.faint}
              strokeDasharray="1 5"
              strokeOpacity={0.9}
              label={{ value: `FV ${quant.fv.toFixed(1)}`, position: "insideTopRight", fill: C.faint, fontSize: 9, fontFamily: FONT.mono }}
            />
          )}
          {quant && (
            <ReferenceLine
              y={quant.price}
              stroke={C.amber}
              strokeDasharray="4 4"
              strokeOpacity={0.8}
              label={{ value: `MARK ${quant.price.toFixed(1)}`, position: "insideBottomRight", fill: C.amber, fontSize: 9, fontFamily: FONT.mono }}
            />
          )}
          {target != null && (
            <ReferenceLine
              y={target}
              stroke={color}
              strokeDasharray="2 6"
              strokeOpacity={0.7}
              label={{ value: `TGT ${target}`, position: "insideTopRight", fill: color, fontSize: 9, fontFamily: FONT.mono }}
            />
          )}
          <Area
            type="monotone"
            dataKey="score"
            stroke={color}
            strokeWidth={2}
            fill="url(#subjFill)"
            isAnimationActive={false}
            dot={(props: object) => <TypeDot {...(props as { cx?: number; cy?: number; payload?: Point })} color={color} onPick={onPick} />}
            activeDot={false}
          />
          {showClass && hasClass && (
            <Line
              type="monotone"
              dataKey="classAvg"
              stroke={C.faint}
              strokeWidth={1.4}
              strokeDasharray="3 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[9px] uppercase tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
        <span>■ EXAM</span>
        <span>◆ TEST</span>
        <span>● ASSIGNMENT</span>
        <span>▲ QUIZ</span>
        {showClass && hasClass && <span style={{ color: C.dim }}>--- CLASS AVG</span>}
      </div>
    </div>
  );
}
