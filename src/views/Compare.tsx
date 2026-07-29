import { useMemo, useState } from "react";
import {
  Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip,
} from "recharts";
import { C, FONT, microLabel } from "../theme";
import { Panel } from "../components/ui/Panel";
import { Derive } from "../components/ui/Derive";
import { Sel } from "../components/ui/Field";
import { Delta } from "../components/ui/Delta";
import { ChartFrame } from "../components/charts/chrome";
import { buildGroupedRows } from "../lib/grouping";
import { labelRounds, roundLabels } from "../lib/rounds";
import { makeWeightFn } from "../lib/weights";
import { round1 } from "../lib/utils";
import type { DeriveCtx } from "../lib/derive";
import type { Settings, SubjectStat } from "../types";

const B_COLOR = "#5C6779";
const PRICE_KEY = "__price";
const FC_KEY = "__fc";

const SYNTH_OPTS = [
  { value: PRICE_KEY, label: "NOW · MARK" },
  { value: FC_KEY, label: "ORACLE · NEXT EXAM" },
];

interface Vertex {
  id: string;
  axis: string;
  name: string;
  color: string;
  A: number | null;
  B: number | null;
}

/**
 * Recharts can't color a radar polygon per vertex, so subject identity lives
 * on the axis: each tick label takes its subject's line color, and the label
 * itself is the hit target for opening that subject's quote.
 */
function ColoredTick({
  x, y, payload, textAnchor, vertices, emph, onHover, onOpen,
}: {
  x?: number; y?: number; textAnchor?: string;
  payload?: { value?: string };
  vertices: Vertex[];
  emph: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const v = vertices.find((d) => d.axis === payload?.value);
  const lit = v != null && emph === v.id;
  return (
    <g
      style={{ cursor: v ? "pointer" : "default" }}
      onPointerEnter={() => v && onHover(v.id)}
      onPointerLeave={() => onHover(null)}
      onClick={() => v && onOpen(v.id)}
    >
      {/* generous transparent hit area — the glyphs alone are a pinpoint */}
      <rect x={(x ?? 0) - 34} y={(y ?? 0) - 13} width={68} height={26} fill="transparent" />
      <text
        x={x} y={y} dy={4}
        textAnchor={textAnchor as "start" | "middle" | "end" | undefined}
        style={{ fontSize: lit ? 13 : 12, fontFamily: FONT.mono, fontWeight: 700, fill: v?.color ?? C.text }}
      >
        {payload?.value}
      </text>
      {lit && <line x1={(x ?? 0) - 16} y1={(y ?? 0) + 9} x2={(x ?? 0) + 16} y2={(y ?? 0) + 9} stroke={v!.color} strokeWidth={1.5} />}
    </g>
  );
}

function RadarTip({
  active, payload, labelA, labelB, vertices,
}: {
  active?: boolean;
  payload?: { payload?: { axis?: string } }[];
  labelA: string;
  labelB: string;
  vertices: Vertex[];
}) {
  const axis = payload?.[0]?.payload?.axis;
  const v = vertices.find((d) => d.axis === axis);
  if (!active || !v) return null;
  const d = v.A != null && v.B != null ? round1(v.A - v.B) : null;
  return (
    <div className="border px-3 py-2" style={{ background: C.strip, borderColor: C.lineBright, fontFamily: FONT.mono, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1.5" style={{ color: v.color }}>{v.name}</div>
      {([[labelA, v.A], [labelB, v.B]] as const).map(([l, val], i) => (
        <div key={i} className="flex items-baseline justify-between gap-5 text-xs py-0.5">
          <span style={{ color: C.faint }}>{l}</span>
          <span className="font-bold" style={{ color: C.text }}>{val != null ? val.toFixed(1) + "%" : "—"}</span>
        </div>
      ))}
      {d != null && (
        <div className="flex items-baseline justify-between gap-5 text-xs pt-1 mt-1 border-t" style={{ borderColor: C.line }}>
          <span style={{ color: C.faint }}>DELTA</span>
          <span className="font-bold" style={{ color: d > 0 ? C.up : d < 0 ? C.down : C.dim }}>{d > 0 ? "+" : ""}{d.toFixed(1)}</span>
        </div>
      )}
      <div className="mt-1.5 text-[9px] tracking-[0.14em]" style={{ color: C.faint }}>CLICK THE TICKER TO OPEN THE QUOTE</div>
    </div>
  );
}

/**
 * Which research note a lens opens. The two SYNTHETIC lenses are model output
 * and carry the engine's own derivations; a term column is a weighted average of
 * prints and carries none, by the same rule that leaves the term averages on
 * every other board alone (§24).
 */
const LENS_DERIVE: Record<string, string> = { [PRICE_KEY]: "mark.price", [FC_KEY]: "oracle.next" };

interface LensRef { id: string; ctx: DeriveCtx }

/** A lens figure, with its note when the lens is one the engine computed. */
function Lens({ on, children }: { on: LensRef | null; children: React.ReactNode }) {
  return on ? <Derive id={on.id} ctx={on.ctx} passive>{children}</Derive> : <>{children}</>;
}

/** Radar of any two lenses — terms, the live price, or the oracle's next exam. */
export function Compare({
  stats, settings, onOpenSubject, deriveCtx,
}: {
  stats: SubjectStat[];
  settings: Settings;
  onOpenSubject: (id: string) => void;
  deriveCtx?: DeriveCtx;
}) {
  const subjects = stats.map((s) => s.sub);
  const entries = useMemo(() => stats.flatMap((s) => s.entries), [stats]);
  const termRows = useMemo(
    () => labelRounds(
      buildGroupedRows(entries, "term", "all", makeWeightFn(settings), settings.calendar),
      roundLabels(entries, settings.calendar),
    ),
    [entries, settings],
  );
  const termOpts = termRows.map((r) => ({ value: r.key!, label: r.label! }));
  const opts = [...SYNTH_OPTS, ...termOpts];
  const [keyA, setKeyA] = useState(termOpts.length ? termOpts[termOpts.length - 1].value : PRICE_KEY);
  const [keyB, setKeyB] = useState(termOpts.length > 1 ? termOpts[termOpts.length - 2].value : PRICE_KEY);
  const [emph, setEmph] = useState<string | null>(null);

  /* Resolve the lens DURING RENDER, not in an effect keyed on `entries`.
     The term keys these hold come from `buildGroupedRows`, which also depends
     on the calendar — so editing the school calendar in settings left keyA
     naming a term that no longer exists. The <select> went blank, every vertex
     resolved null, and the radar collapsed to the centre with "—" in the panel
     while the effect sat waiting for an `entries` change that never came. */
  const fallbackA = termOpts.length ? termOpts[termOpts.length - 1].value : PRICE_KEY;
  const fallbackB = termOpts.length > 1 ? termOpts[termOpts.length - 2].value : PRICE_KEY;
  const effA = opts.some((o) => o.value === keyA) ? keyA : fallbackA;
  const effB = opts.some((o) => o.value === keyB) ? keyB : fallbackB;

  const sideValue = (s: SubjectStat, key: string): number | null => {
    if (key === PRICE_KEY) return s.quant?.price ?? null;
    if (key === FC_KEY) return s.quant ? s.quant.nextExam.mean : null;
    const row = termRows.find((r) => r.key === key);
    const v = row?.[s.sub.id];
    return typeof v === "number" ? v : null;
  };
  const sideLabel = (key: string) => opts.find((o) => o.value === key)?.label || "—";
  const labelA = sideLabel(effA);
  const labelB = sideLabel(effB);
  const aColor = effA === FC_KEY ? C.accent : C.amber;
  const bColor = effB === FC_KEY ? C.accent : B_COLOR;

  const lensRef = (lensKey: string, subjectId: string): LensRef | null => {
    const id = LENS_DERIVE[lensKey];
    const stat = stats.find((s) => s.sub.id === subjectId);
    return id && stat && deriveCtx ? { id, ctx: { ...deriveCtx, stat } } : null;
  };

  const vertices: Vertex[] = stats.map((s) => ({
    id: s.sub.id,
    axis: s.sub.ticker,
    name: s.sub.name,
    color: s.sub.color,
    A: sideValue(s, effA),
    B: sideValue(s, effB),
  }));
  const plotData = vertices.map((d) => ({ ...d, A: d.A ?? 0, B: d.B ?? 0 }));
  const maxAbsDelta = Math.max(1, ...vertices.map((d) => (d.A != null && d.B != null ? Math.abs(d.A - d.B) : 0)));

  if (!subjects.length || (termRows.length === 0 && !stats.some((s) => s.quant))) {
    return (
      <Panel>
        <div className="py-8 text-center text-[11px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
          Log some results first — then overlay any two terms, the live price, or the oracle here.
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid lg:grid-cols-5 gap-3 items-start">
      <div className="lg:col-span-3">
        <ChartFrame
          title="PERIOD OVERLAY"
          defaultSize="m"
          toolbar={
            <>
              <span className="w-2.5 h-2.5" style={{ background: aColor }} />
              <Sel ariaLabel="Lens A" value={effA} onChange={setKeyA} options={opts} />
              <span className="text-[10px] font-bold uppercase" style={{ color: C.faint, fontFamily: FONT.mono }}>vs</span>
              <span className="w-2.5 h-2.5 border" style={{ background: "transparent", borderColor: bColor }} />
              <Sel ariaLabel="Lens B" value={effB} onChange={setKeyB} options={opts} />
            </>
          }
          footnote={
            subjects.length < 3
              ? "The shape gets more useful from three subjects up. Hover a spoke for the numbers; click a ticker to open its quote."
              : "Hover a spoke for the numbers; click a ticker to open its quote."
          }
        >
          {(h) => (
            <ResponsiveContainer width="100%" height={h}>
              <RadarChart data={plotData} outerRadius="70%" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
                <PolarGrid gridType="polygon" stroke={C.line} />
                <PolarAngleAxis
                  dataKey="axis"
                  tick={(props) => (
                    <ColoredTick {...props} vertices={vertices} emph={emph} onHover={setEmph} onOpen={onOpenSubject} />
                  )}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tickCount={6}
                  tick={{ fontSize: 9, fill: C.faint, fontFamily: FONT.mono }}
                  tickFormatter={(v) => `${v}`}
                  stroke="transparent"
                />
                <Radar name={labelB} dataKey="B" stroke={bColor} fill={bColor} fillOpacity={0.12} strokeWidth={1.8} strokeDasharray="5 4" isAnimationActive={false} />
                <Radar name={labelA} dataKey="A" stroke={aColor} fill={aColor} fillOpacity={0.18} strokeWidth={2.4} strokeDasharray={effA === FC_KEY ? "5 4" : undefined} isAnimationActive={false} />
                <Legend
                  verticalAlign="bottom"
                  height={26}
                  formatter={(value: string) => (
                    <span style={{ fontFamily: FONT.mono, fontSize: 10, letterSpacing: "0.12em", color: C.dim }}>{value}</span>
                  )}
                />
                <Tooltip content={<RadarTip labelA={labelA} labelB={labelB} vertices={vertices} />} />
              </RadarChart>
            </ResponsiveContainer>
          )}
        </ChartFrame>
      </div>

      <Panel className="lg:col-span-2" title={`${labelA} VS ${labelB}`} pad={false}>
        <div>
          {vertices.map((d) => {
            const delta = d.A != null && d.B != null ? round1(d.A - d.B) : null;
            const w = delta != null ? (Math.abs(delta) / maxAbsDelta) * 50 : 0;
            const lit = emph === d.id;
            return (
              <button
                key={d.id}
                onClick={() => onOpenSubject(d.id)}
                onPointerEnter={() => setEmph(d.id)}
                onPointerLeave={() => setEmph(null)}
                onFocus={() => setEmph(d.id)}
                onBlur={() => setEmph(null)}
                className="gx-focus w-full text-left px-3 py-2 border-b last:border-0 hover:brightness-125"
                style={{ borderColor: C.line, background: lit ? C.panel2 : "transparent" }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 shrink-0" style={{ background: d.color }} />
                    <span className="text-[11px] font-semibold truncate uppercase tracking-wide" style={{ color: C.dim }}>{d.name}</span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0 text-xs" style={{ fontFamily: FONT.mono }}>
                    {/* Passive: the row is a <button> that opens the quote, so a
                        model lens hovers its derivation without eating the click. */}
                    <Lens on={lensRef(effA, d.id)}>
                      <span className="font-bold" style={{ color: C.text }}>{d.A != null ? d.A.toFixed(1) : "—"}</span>
                    </Lens>
                    <Lens on={lensRef(effB, d.id)}>
                      <span style={{ color: C.faint }}>{d.B != null ? d.B.toFixed(1) : "—"}</span>
                    </Lens>
                    <Delta v={delta} />
                  </span>
                </span>
                {/* diverging rail: the move away from lens B, centred */}
                <span className="relative block h-1.5 mt-1.5" style={{ background: C.panel2 }} aria-hidden="true">
                  <span className="absolute inset-y-0 left-1/2 w-px" style={{ background: C.lineBright }} />
                  {delta != null && delta !== 0 && (
                    <span
                      className="absolute inset-y-0"
                      style={{
                        width: `${w}%`,
                        left: delta > 0 ? "50%" : undefined,
                        right: delta < 0 ? "50%" : undefined,
                        background: delta > 0 ? C.up : C.down,
                      }}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <p className="px-3 py-2 border-t" style={{ ...microLabel, borderColor: C.line, color: C.faint }}>
          {labelA} first · {labelB} second · rail shows the move
          {(LENS_DERIVE[effA] || LENS_DERIVE[effB]) && deriveCtx ? " · underlined figures open their derivation" : ""}
        </p>
      </Panel>
    </div>
  );
}
