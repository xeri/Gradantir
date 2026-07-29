import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity, AlertTriangle, Banknote, EyeOff, Flame, Gauge, Hourglass, Minus, Plus,
  Scale, Shield, Siren, Sparkles, Target, TrendingDown, TrendingUp, Zap,
} from "lucide-react";
import { C, FONT, microLabel } from "../theme";
import { Panel } from "../components/ui/Panel";
import { Delta } from "../components/ui/Delta";
import { SubjectCard } from "../components/SubjectCard";
import { Derive } from "../components/ui/Derive";
import { crosshair, gridProps, scoreDomain, scoreTicks, tickStyleSm, yLabel } from "../components/charts/chrome";
import { buildWire, type WireItem } from "../lib/headlines";
import { round1, shortDateY } from "../lib/utils";
import type { DeriveCtx } from "../lib/derive";
import type { AggregatePoint, CompositeIndex, DepthGroup, DepthModel, Signal, SubjectStat } from "../types";

const WIRE_ICONS: Record<string, typeof TrendingUp> = {
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  activity: Activity,
  target: Target,
  sparkles: Sparkles,
  zap: Zap,
  minus: Minus,
  "alert-triangle": AlertTriangle,
  banknote: Banknote,
  "eye-off": EyeOff,
  flame: Flame,
  gauge: Gauge,
  hourglass: Hourglass,
  scale: Scale,
  shield: Shield,
  siren: Siren,
};

const TONE_COLOR: Record<WireItem["tone"], string> = {
  gain: C.up,
  loss: C.down,
  warn: C.amber,
  info: C.dim,
  accent: C.accent,
};

interface CompPoint {
  label: string;
  v: number;
  /** Move from the previous term — the tooltip's second line. */
  d: number | null;
}

function CompTip({ active, payload }: { active?: boolean; payload?: { payload?: CompPoint }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="border px-3 py-2" style={{ background: C.strip, borderColor: C.lineBright, fontFamily: FONT.mono, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1" style={{ color: C.faint }}>{p.label}</div>
      <div className="flex items-baseline justify-between gap-5 text-xs">
        <span style={{ color: C.faint }}>COMP</span>
        <span className="font-bold" style={{ color: C.text }}>{p.v.toFixed(1)}%</span>
      </div>
      {p.d != null && (
        <div className="flex items-baseline justify-between gap-5 text-xs">
          <span style={{ color: C.faint }}>MOVE</span>
          <span className="font-bold" style={{ color: p.d > 0 ? C.up : p.d < 0 ? C.down : C.dim }}>
            {p.d > 0 ? "+" : ""}{p.d.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}

function CompositeHero({ index, history: raw, stats, onOpenCharts, deriveCtx }: {
  index: CompositeIndex | null;
  history: AggregatePoint[];
  stats: SubjectStat[];
  onOpenCharts: () => void;
  deriveCtx?: DeriveCtx;
}) {
  const history = useMemo<CompPoint[]>(
    () => raw.map((p, i) => ({ label: p.label, v: p.pct, d: i > 0 ? round1(p.pct - raw[i - 1].pct) : null })),
    [raw],
  );

  const curLabel = stats[0]?.curLabel ?? "";
  const vals = history.map((p) => p.v);
  const [yMin, yMax] = scoreDomain(vals, false);
  const hi = vals.length ? Math.max(...vals) : null;
  const lo = vals.length ? Math.min(...vals) : null;
  const mean = vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;

  return (
    <Panel
      title={`GX COMPOSITE · ${curLabel}`}
      pad={false}
      right={
        <button
          onClick={onOpenCharts}
          className="gx-focus inline-flex items-center min-h-6 text-[9px] font-bold tracking-[0.16em] px-2 py-1 border hover:brightness-125"
          style={{ color: C.faint, borderColor: C.line, fontFamily: FONT.mono }}
        >
          FULL BOARD ›
        </button>
      }
    >
      <div className="flex flex-wrap items-stretch border-b" style={{ borderColor: C.line }}>
        <div className="p-3 pr-6">
          <div className="flex items-baseline gap-2.5">
            {deriveCtx ? (
              <Derive id="book.composite" ctx={deriveCtx}>
                <span className="text-4xl font-bold" style={{ fontFamily: FONT.mono, color: C.text }}>
                  {index?.value != null ? index.value.toFixed(1) : "—"}
                </span>
              </Derive>
            ) : (
              <span className="text-4xl font-bold" style={{ fontFamily: FONT.mono, color: C.text }}>
                {index?.value != null ? index.value.toFixed(1) : "—"}
              </span>
            )}
            <Delta v={index?.delta ?? null} size="lg" />
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
            MEAN MARK, ALL PRICED DESKS{index?.delta != null ? " · VS LAST TERM" : ""}
          </div>
          {index && (
            <div className="mt-1 text-[10px] uppercase tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
              {index.sum.toFixed(1)} / {index.outOf} ·{" "}
              {deriveCtx ? (
                <Derive id="book.composite" ctx={deriveCtx}>
                  90% CI {index.ci90.lo.toFixed(1)}–{index.ci90.hi.toFixed(1)}
                </Derive>
              ) : (
                <>90% CI {index.ci90.lo.toFixed(1)}–{index.ci90.hi.toFixed(1)}</>
              )}
            </div>
          )}
        </div>
        {history.length >= 2 && (
          <div className="flex items-center gap-5 px-4 py-3 border-l" style={{ borderColor: C.line }}>
            {[
              { l: "HIGH", v: hi, c: C.up },
              { l: "LOW", v: lo, c: C.down },
              { l: "MEAN", v: mean, c: C.dim },
              { l: "ROUNDS", v: raw.filter((p) => !p.live).length, c: C.dim },
            ].map((x) => (
              <div key={x.l}>
                <div style={{ ...microLabel, color: C.faint }}>{x.l}</div>
                <div className="text-sm font-bold mt-0.5" style={{ fontFamily: FONT.mono, color: x.c }}>
                  {x.v != null ? (x.l === "ROUNDS" ? x.v : Number(x.v).toFixed(1)) : "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {history.length >= 2 ? (
        <div className="p-2 pt-3">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={history} margin={{ top: 6, right: 16, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="compFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.amber} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" tick={tickStyleSm} stroke={C.lineBright} tickMargin={6} height={28} interval="preserveStartEnd" />
              <YAxis
                domain={[yMin, yMax]}
                ticks={scoreTicks(yMin, yMax)}
                tick={tickStyleSm}
                stroke={C.lineBright}
                width={52}
                tickMargin={6}
                tickFormatter={(v) => v + "%"}
                label={yLabel("COMPOSITE")}
              />
              <Tooltip content={<CompTip />} cursor={crosshair} />
              {mean != null && (
                <ReferenceLine
                  y={mean}
                  stroke={C.lineBright}
                  strokeDasharray="2 5"
                  label={{ value: "MEAN", position: "insideTopLeft", fill: C.faint, fontSize: 9, fontFamily: FONT.mono }}
                />
              )}
              <Area
                type="monotone"
                dataKey="v"
                stroke={C.amber}
                strokeWidth={2}
                fill="url(#compFill)"
                isAnimationActive={false}
                dot={{ r: 2.4, fill: C.amber, strokeWidth: 0 }}
                activeDot={{ r: 5, stroke: C.bg, strokeWidth: 1.5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="px-3 py-4 text-[11px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
          The composite line opens once two terms have printed.
        </p>
      )}
    </Panel>
  );
}

function Movers({ stats, onOpenSubject }: { stats: SubjectStat[]; onOpenSubject: (id: string) => void }) {
  const withPd = stats.filter((s) => s.periodDelta != null);
  const riser = [...withPd].sort((a, b) => b.periodDelta! - a.periodDelta!)[0];
  const faller = [...withPd].sort((a, b) => a.periodDelta! - b.periodDelta!)[0];
  const prints = stats.reduce((a, s) => a + s.curCount, 0);
  const tiles = [
    { l: "TOP RISER", s: riser && riser.periodDelta! > 0 ? riser : null },
    { l: "UNDER PRESSURE", s: faller && faller.periodDelta! < 0 ? faller : null },
  ];
  /* grid-cols-3 at 375px leaves each tile ~92px of text width, and "PRINTS THIS
     TERM" needs ~125px at this letter-spacing — every label wrapped mid-phrase.
     Matches the sm: breakpoint already used further down this view. */
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {tiles.map((x, i) => {
        const body = (
          <>
            <div style={{ ...microLabel, color: C.faint }}>{x.l}</div>
            {x.s ? (
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-sm font-bold tracking-[0.08em]" style={{ fontFamily: FONT.mono, color: x.s.sub.color }}>
                  {x.s.sub.ticker}
                </span>
                <Delta v={x.s.periodDelta} />
              </div>
            ) : (
              <div className="text-[11px] mt-1.5 uppercase" style={{ color: C.faint, fontFamily: FONT.mono }}>flat board</div>
            )}
          </>
        );
        return x.s ? (
          <button
            key={i}
            onClick={() => onOpenSubject(x.s!.sub.id)}
            className="gx-focus border p-2.5 text-left hover:brightness-125"
            style={{ background: C.panel, borderColor: C.line }}
          >
            {body}
          </button>
        ) : (
          <div key={i} className="border p-2.5" style={{ background: C.panel, borderColor: C.line }}>{body}</div>
        );
      })}
      <div className="border p-2.5" style={{ background: C.panel, borderColor: C.line }}>
        <div style={{ ...microLabel, color: C.faint }}>PRINTS THIS TERM</div>
        <div className="text-sm font-bold mt-1" style={{ fontFamily: FONT.mono, color: C.text }}>{prints}</div>
      </div>
    </div>
  );
}

function WorkOn({ signals, onOpenSubject, deriveCtx, stats }: {
  signals: Signal[];
  onOpenSubject: (id: string) => void;
  deriveCtx?: DeriveCtx;
  stats: SubjectStat[];
}) {
  const top = signals.slice(0, 3);
  return (
    <Panel title="WORK ON" pad={false} className="h-fit">
      {top.length === 0 || top[0].priority < 10 ? (
        <p className="px-3 py-3 text-[11px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
          Nothing urgent — the book is behaving.
        </p>
      ) : (
        <ul>
          {top.map((sig) => (
            <li key={sig.id} className="border-b last:border-0" style={{ borderColor: C.line }}>
              <button
                onClick={() => onOpenSubject(sig.id)}
                className="gx-focus w-full text-left px-3 py-2 hover:brightness-110"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold tracking-[0.08em]" style={{ fontFamily: FONT.mono, color: C.text }}>
                    {sig.ticker}
                  </span>
                  {/* Passive: this row is a <button>, so the click still opens the desk. */}
                  {deriveCtx ? (
                    <Derive
                      id="advisor.priority"
                      ctx={{ ...deriveCtx, stat: stats.find((s) => s.sub.id === sig.id), signal: sig }}
                      passive
                      className="text-[10px] font-bold"
                      style={{ fontFamily: FONT.mono, color: sig.priority >= 50 ? C.down : sig.priority >= 25 ? C.amber : C.dim }}
                    >
                      {sig.priority.toFixed(0)}
                    </Derive>
                  ) : (
                    <span className="text-[10px] font-bold" style={{ fontFamily: FONT.mono, color: sig.priority >= 50 ? C.down : sig.priority >= 25 ? C.amber : C.dim }}>
                      {sig.priority.toFixed(0)}
                    </span>
                  )}
                </span>
                <span className="block h-1 mt-1" style={{ background: C.panel2 }}>
                  <span
                    className="block h-full"
                    style={{ width: `${sig.priority}%`, background: sig.priority >= 50 ? C.down : sig.priority >= 25 ? C.amber : C.faint }}
                  />
                </span>
                {sig.reasons[0] && (
                  <span className="block mt-1 text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
                    {sig.reasons[0]}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Wire({ stats, index, signals }: { stats: SubjectStat[]; index: CompositeIndex | null; signals: Signal[] }) {
  const items = useMemo(() => buildWire(stats, index, 14, signals), [stats, index, signals]);
  return (
    <Panel title="WIRE" pad={false} className="h-fit">
      <ul>
        {items.map((it) => {
          const Icon = WIRE_ICONS[it.icon] ?? Sparkles;
          return (
            <li key={it.id} className="flex gap-2.5 px-3 py-2 border-b last:border-0 text-[11px] leading-snug" style={{ borderColor: C.line }}>
              <Icon size={13} className="shrink-0 mt-0.5" style={{ color: TONE_COLOR[it.tone] }} />
              <span style={{ fontFamily: FONT.mono }}>
                <span className="font-bold mr-1.5" style={{ color: TONE_COLOR[it.tone] }}>{it.tag}</span>
                <span style={{ color: C.dim }}>{it.text}</span>
                {it.date && <span className="ml-1.5" style={{ color: C.faint }}>{shortDateY(it.date).toUpperCase()}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/**
 * PEER PREMIUM — how strong the room around you is, period by period.
 *
 * The one instrument on the board that is not about you. A step down here
 * while your placements hold is a reclassification: same student, weaker
 * field, and every placement suddenly flatters.
 */
function PeerPremium({ depth, onOpenSettings, deriveCtx }: { depth: DepthModel; onOpenSettings: () => void; deriveCtx?: DeriveCtx }) {
  const groups = depth.groups;
  const now = groups[groups.length - 1];
  const prev = groups.length > 1 ? groups[groups.length - 2] : null;
  const move = prev ? round1(now.premium - prev.premium) : null;
  const span = Math.max(...groups.map((g: DepthGroup) => Math.abs(g.premium)), 1);

  return (
    <Panel
      title="PEER PREMIUM"
      right={
        deriveCtx ? (
          <Derive id="depth.fit" ctx={deriveCtx} style={{ ...microLabel, color: C.faint }}>
            {depth.streamed ? "STREAMED BOOK" : "FLAT BOOK"}
          </Derive>
        ) : (
          <span style={{ ...microLabel, color: C.faint }}>
            {depth.streamed ? "STREAMED BOOK" : "FLAT BOOK"}
          </span>
        )
      }
    >
      <div className="flex items-baseline gap-2.5">
        {deriveCtx ? (
          <Derive id="depth.premium" ctx={deriveCtx}>
            <span className="text-3xl font-bold leading-none" style={{ fontFamily: FONT.mono, color: C.text }}>
              {now.premium > 0 ? "+" : ""}{now.premium.toFixed(1)}
            </span>
          </Derive>
        ) : (
          <span className="text-3xl font-bold leading-none" style={{ fontFamily: FONT.mono, color: C.text }}>
            {now.premium > 0 ? "+" : ""}{now.premium.toFixed(1)}
          </span>
        )}
        <Delta v={move} size="lg" nullText="NEW" />
      </div>
      <div className="mt-1.5" style={{ ...microLabel, color: C.faint }}>
        PTS YOUR CLASS SITS ABOVE THE YEAR LEVEL · {now.label}
      </div>

      <div className="flex items-end gap-1 mt-3 h-16">
        {groups.map((g: DepthGroup) => {
          const h = Math.max(4, (Math.abs(g.premium) / span) * 100);
          const last = g.key === now.key;
          return (
            /* h-full matters: a percentage height needs a definite parent. */
            <div key={g.key} className="flex-1 h-full flex flex-col justify-end items-center" title={`${g.label}: ${g.premium > 0 ? "+" : ""}${g.premium} pts`}>
              <span
                className="w-full"
                style={{
                  height: `${h}%`,
                  background: last ? C.amber : g.premium >= 0 ? C.up : C.down,
                  opacity: last ? 1 : 0.45,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {groups.map((g: DepthGroup) => (
          <span key={g.key} className="flex-1 text-center text-[9px] tracking-wider" style={{ fontFamily: FONT.mono, color: C.faint }}>
            {/* "T2 2026" → "T2 26": seven terms span years, so the year matters. */}
            {g.label.replace(/ 20(\d{2})$/, " $1")}
          </span>
        ))}
      </div>

      <p className="mt-2.5 pt-2 border-t text-[10px] uppercase tracking-wider leading-relaxed" style={{ borderColor: C.line, color: C.faint, fontFamily: FONT.mono }}>
        {depth.streamed
          ? "YOUR PLACEMENTS ARE MEASURED AGAINST A CLASS THAT IS NOT THE FIELD. THE LADDER IN EACH QUOTE PRICES THE FIELD ITSELF."
          : "YOUR CLASSES SIT WITHIN NOISE OF THE YEAR LEVEL — A PLACEMENT READS STRAIGHT ACROSS."}
        {" "}FITTED ON {depth.n} PLACEMENTS · σ CLASS {depth.sigmaClass} · RESIDUAL {depth.rmse}.{" "}
        <button onClick={onOpenSettings} className="gx-focus underline" style={{ color: C.dim }}>COHORT GEOMETRY →</button>
      </p>
    </Panel>
  );
}

export function Overview({
  stats,
  booked,
  index,
  history,
  depth,
  signals,
  delistedCount,
  showDelisted,
  onToggleDelisted,
  onOpenSubject,
  onAddSubject,
  onOpenSettings,
  onOpenCharts,
  deriveCtx,
}: {
  /** What the board draws — delisted desks included only when asked. */
  stats: SubjectStat[];
  /** The desks reporting today. The narrative panels read this, never `stats`. */
  booked: SubjectStat[];
  index: CompositeIndex | null;
  history: AggregatePoint[];
  depth: DepthModel | null;
  signals: Signal[];
  delistedCount: number;
  showDelisted: boolean;
  onToggleDelisted: () => void;
  onOpenSubject: (id: string) => void;
  onAddSubject: () => void;
  onOpenSettings: () => void;
  onOpenCharts: () => void;
  /** Book-level facts the derivation popovers read. */
  deriveCtx?: DeriveCtx;
}) {
  return (
    <div className="grid lg:grid-cols-3 gap-3 items-start">
      <div className="lg:col-span-2 space-y-3">
        <CompositeHero index={index} history={history} stats={booked} onOpenCharts={onOpenCharts} deriveCtx={deriveCtx} />
        <Movers stats={booked} onOpenSubject={onOpenSubject} />
        <div className="grid sm:grid-cols-2 gap-2">
          {stats.map((s) => (
            <SubjectCard key={s.sub.id} stat={s} onOpen={() => onOpenSubject(s.sub.id)} deriveCtx={deriveCtx} />
          ))}
          <button
            onClick={onAddSubject}
            className="gx-focus border border-dashed p-3 flex items-center justify-center gap-2 min-h-24 text-[11px] font-bold uppercase tracking-[0.14em] hover:brightness-125"
            style={{ borderColor: C.lineBright, color: C.faint, fontFamily: FONT.mono }}
          >
            <Plus size={14} /> List subject
          </button>
        </div>
        {delistedCount > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
            <span>
              {delistedCount} DELISTED DESK{delistedCount === 1 ? "" : "S"} — STILL PRICED INTO EVERY SUM AND CHART, NO LONGER TRADING
            </span>
            <button onClick={onToggleDelisted} className="gx-focus underline hover:brightness-125" style={{ color: showDelisted ? C.amber : C.dim }}>
              {showDelisted ? "HIDE THEM (D)" : "SHOW THEM (D)"}
            </button>
            <button onClick={onOpenSettings} className="gx-focus hover:brightness-125">MANAGE →</button>
          </div>
        )}
      </div>
      <div className="space-y-3">
        <WorkOn signals={signals} onOpenSubject={onOpenSubject} deriveCtx={deriveCtx} stats={stats} />
        {depth?.fitted && depth.groups.length > 0 && <PeerPremium depth={depth} onOpenSettings={onOpenSettings} deriveCtx={deriveCtx} />}
        <Wire stats={booked} index={index} signals={signals} />
      </div>
    </div>
  );
}
