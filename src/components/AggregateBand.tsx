import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { C, FONT, microLabel } from "../theme";
import { Delta } from "./ui/Delta";
import { Derive } from "./ui/Derive";
import { crosshair, gridProps, tickStyleSm } from "./charts/chrome";
import { shortDateY } from "../lib/utils";
import type { DeriveCtx } from "../lib/derive";
import type { PendingRound } from "../lib/rounds";
import type { AggregateForecast, AggregatePoint, ExamAggregate } from "../types";

interface BandPoint {
  label: string;
  /** Realized exam aggregate, % per desk. */
  pct: number | null;
  /** The dashed forward leg — only the last real point and the forecast. */
  pred: number | null;
  sum: number | null;
  outOf: number | null;
}

function BandTip({ active, payload }: { active?: boolean; payload?: { payload?: BandPoint }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const forecast = p.pct == null;
  return (
    <div className="border px-3 py-2" style={{ background: C.strip, borderColor: C.lineBright, fontFamily: FONT.mono, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1" style={{ color: C.faint }}>
        {p.label}{forecast ? " · FORECAST" : ""}
      </div>
      <div className="flex items-baseline justify-between gap-5 text-xs">
        <span style={{ color: C.faint }}>{forecast ? "PRED" : "EXAMS"}</span>
        <span className="font-bold" style={{ color: forecast ? C.accent : C.text }}>
          {p.sum?.toFixed(1)} / {p.outOf}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-5 text-xs">
        <span style={{ color: C.faint }}>PER DESK</span>
        <span className="font-bold" style={{ color: C.amber }}>{(p.pct ?? p.pred)?.toFixed(1)}%</span>
      </div>
    </div>
  );
}

/**
 * The headline instrument, in three tiers: what the exams actually printed,
 * what the oracle says the next round prints, and the tape of both.
 *
 * AGGREGATE itself carries no derivation on purpose — it is a straight sum of
 * realized exams, and having no model is its entire claim. PREDICTION is its
 * forward twin and does.
 */
export function AggregateBand({
  agg,
  forecast,
  history,
  pending,
  onOpenSubject,
  deriveCtx,
}: {
  agg: ExamAggregate | null;
  forecast: AggregateForecast | null;
  history: AggregatePoint[];
  /** The round the oracle is forecasting — learned from the book's own rhythm. */
  pending?: PendingRound | null;
  onOpenSubject: (id: string) => void;
  deriveCtx?: DeriveCtx;
}) {
  const chart: BandPoint[] = history.map((p) => ({
    label: p.label, pct: p.pct, pred: null, sum: p.sum, outOf: p.outOf,
  }));
  if (forecast && chart.length) {
    chart[chart.length - 1].pred = chart[chart.length - 1].pct;
    chart.push({
      label: pending?.label ?? "NEXT",
      pct: null, pred: forecast.pct, sum: forecast.sum, outOf: forecast.outOf,
    });
  }

  return (
    <div className="border mb-4" style={{ background: C.panel, borderColor: C.line }}>
      <div className="px-3 py-1.5 border-b flex items-center justify-between gap-3" style={{ borderColor: C.line }}>
        <span style={{ ...microLabel, color: C.amber }}>AGGREGATE · LAST EXAMS</span>
        {agg && (
          <span style={{ ...microLabel, color: C.faint }}>
            {agg.reported} OF {agg.listed} DESK{agg.listed === 1 ? "" : "S"} REPORTED
            {agg.asOf ? ` · AS OF ${shortDateY(agg.asOf).toUpperCase()}` : ""}
          </span>
        )}
      </div>

      {!agg ? (
        <div className="p-4">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold" style={{ fontFamily: FONT.mono, color: C.faint }}>—</span>
          </div>
          <p className="mt-1.5" style={{ ...microLabel, color: C.faint }}>
            NO EXAMS PRINTED — THE AGGREGATE OPENS WITH YOUR FIRST EXAM RESULT (N)
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-stretch">
          <div className="p-3 pr-6">
            <div className="flex items-baseline gap-2.5">
              <span className="text-4xl sm:text-5xl font-bold leading-none" style={{ fontFamily: FONT.mono, color: C.text }}>
                {agg.sum.toFixed(1)}
              </span>
              <span className="text-lg font-bold" style={{ fontFamily: FONT.mono, color: C.faint }}>/ {agg.outOf}</span>
              <span className="text-2xl font-bold" style={{ fontFamily: FONT.mono, color: C.amber }}>{agg.pct.toFixed(1)}%</span>
              <Delta v={agg.delta} size="lg" />
            </div>
            <div className="mt-1.5" style={{ ...microLabel, color: C.faint }}>
              STRAIGHT SUM OF EVERY DESK&apos;S LAST EXAM — NO MODEL
              {agg.pctDelta != null ? ` · ${agg.pctDelta > 0 ? "+" : ""}${agg.pctDelta.toFixed(1)} PTS/DESK VS PRIOR ROUND` : ""}
            </div>
          </div>

          <div className="p-3 min-w-[220px] flex-1 border-l" style={{ borderColor: C.line }}>
            <div className="space-y-1">
              {agg.perSubject.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpenSubject(p.id)}
                  className="gx-focus w-full flex items-center gap-2 group"
                  aria-label={`Open ${p.ticker}`}
                >
                  <span className="w-10 text-[10px] font-bold tracking-[0.08em] text-left shrink-0" style={{ fontFamily: FONT.mono, color: p.color }}>
                    {p.ticker}
                  </span>
                  <span className="flex-1 h-2" style={{ background: C.panel2 }}>
                    <span className="block h-full transition-all group-hover:brightness-125" style={{ width: `${p.score}%`, background: p.color }} />
                  </span>
                  <span className="w-9 text-[10px] font-bold text-right shrink-0" style={{ fontFamily: FONT.mono, color: C.dim }}>
                    {p.score.toFixed(1)}
                  </span>
                  <span className="w-16 text-[9px] text-right shrink-0 hidden sm:inline" style={{ fontFamily: FONT.mono, color: C.faint }}>
                    {shortDateY(p.date).toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {forecast && (
        <div className="border-t px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1" style={{ borderColor: C.line }}>
          <span style={{ ...microLabel, color: C.accent }}>
            PREDICTION · {pending ? `${pending.label} ROUND · ${pending.termLabel}` : "NEXT EXAM ROUND"}
          </span>
          <Derive id="book.forecast" ctx={deriveCtx ?? {}} className="flex items-baseline gap-x-2">
            <span className="text-xl font-bold leading-none" style={{ fontFamily: FONT.mono, color: C.text }}>
              {forecast.sum.toFixed(1)}
            </span>
            <span className="text-[11px] font-bold" style={{ fontFamily: FONT.mono, color: C.faint }}>/ {forecast.outOf}</span>
            <span className="text-base font-bold" style={{ fontFamily: FONT.mono, color: C.accent }}>{forecast.pct.toFixed(1)}%</span>
          </Derive>
          {forecast.vsLast != null && (
            <span
              className="text-[10px] font-bold tracking-[0.12em]"
              style={{ fontFamily: FONT.mono, color: forecast.vsLast > 0.05 ? C.up : forecast.vsLast < -0.05 ? C.down : C.dim }}
            >
              {forecast.vsLast > 0 ? "▲" : forecast.vsLast < 0 ? "▼" : "·"} {Math.abs(forecast.vsLast).toFixed(1)} PTS/DESK EXPECTED
            </span>
          )}
          <span style={{ ...microLabel, color: C.faint }}>
            90% CI {forecast.ci90.lo.toFixed(1)}–{forecast.ci90.hi.toFixed(1)} · {forecast.count} DESK{forecast.count === 1 ? "" : "S"} PRICED
          </span>
        </div>
      )}

      {chart.length >= 2 && (
        <div className="w-full border-t p-2 pt-3" style={{ borderColor: C.line }}>
          <ResponsiveContainer width="100%" height={168}>
            <ComposedChart data={chart} margin={{ top: 6, right: 16, bottom: 2, left: 0 }}>
              <defs>
                <linearGradient id="aggFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.amber} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" tick={tickStyleSm} stroke={C.lineBright} interval="preserveStartEnd" tickMargin={6} height={26} />
              <YAxis
                domain={[(min: number) => Math.max(0, Math.floor((min - 5) / 5) * 5), (max: number) => Math.min(100, Math.ceil((max + 5) / 5) * 5)]}
                tick={tickStyleSm}
                stroke={C.lineBright}
                width={48}
                tickMargin={6}
                tickFormatter={(v) => v + "%"}
                allowDecimals={false}
              />
              <Tooltip content={<BandTip />} cursor={crosshair} />
              <Area
                type="monotone"
                dataKey="pct"
                stroke={C.amber}
                strokeWidth={2}
                fill="url(#aggFill)"
                isAnimationActive={false}
                dot={{ r: 2.2, fill: C.amber, strokeWidth: 0 }}
                activeDot={{ r: 5, stroke: C.bg, strokeWidth: 1.5 }}
              />
              <Line
                type="monotone"
                dataKey="pred"
                stroke={C.accent}
                strokeWidth={2}
                strokeDasharray="4 4"
                isAnimationActive={false}
                connectNulls
                dot={{ r: 2.4, fill: C.accent, strokeWidth: 0 }}
                activeDot={{ r: 5, stroke: C.bg, strokeWidth: 1.5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap items-center gap-x-3 px-1 text-[9px] uppercase tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
            <span style={{ color: C.amber }}>— EVERY DESK&apos;S LAST EXAM, AT EACH ROUND THIS BOOK PRINTED</span>
            <span style={{ color: C.accent }}>--- {pending ? pending.label : "NEXT"} (ORACLE)</span>
          </div>
        </div>
      )}
    </div>
  );
}
