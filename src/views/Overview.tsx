import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Minus, Plus, Sparkles, Target, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { C, FONT, microLabel } from "../theme";
import { Panel } from "../components/ui/Panel";
import { Delta } from "../components/ui/Delta";
import { SubjectCard } from "../components/SubjectCard";
import { buildGroupedRows } from "../lib/grouping";
import { COMP_KEY, addComposite } from "../lib/composite";
import { buildWire, type WireItem } from "../lib/headlines";
import { makeWeightFn } from "../lib/weights";
import { shortDateY } from "../lib/utils";
import type { CompositeIndex, GradeEntry, Settings, SubjectStat } from "../types";

const WIRE_ICONS: Record<string, typeof TrendingUp> = {
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  activity: Activity,
  target: Target,
  sparkles: Sparkles,
  zap: Zap,
  minus: Minus,
};

const TONE_COLOR: Record<WireItem["tone"], string> = {
  gain: C.up,
  loss: C.down,
  warn: C.amber,
  info: C.dim,
  accent: C.accent,
};

function CompositeHero({ entries, settings, index, stats }: {
  entries: GradeEntry[];
  settings: Settings;
  index: CompositeIndex;
  stats: SubjectStat[];
}) {
  const history = useMemo(() => {
    const rows = buildGroupedRows(entries, "term", "all", makeWeightFn(settings));
    addComposite(rows, stats.map((s) => s.sub.id));
    return rows.filter((r) => typeof r[COMP_KEY] === "number");
  }, [entries, settings, stats]);
  const curLabel = stats[0]?.curLabel ?? "";
  return (
    <Panel title={`GX COMPOSITE · ${curLabel}`} pad={false}>
      <div className="flex flex-wrap items-stretch">
        <div className="p-3 pr-6">
          <div className="flex items-baseline gap-2.5">
            <span className="text-4xl font-bold" style={{ fontFamily: FONT.mono, color: C.text }}>
              {index.value != null ? index.value.toFixed(1) : "—"}
            </span>
            <Delta v={index.delta} size="lg" />
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
            EQUAL-WEIGHT AVG OF ALL SUBJECTS{index.delta != null ? " · VS LAST TERM" : ""}
          </div>
        </div>
        <div className="flex-1 min-w-[200px] h-24 p-2">
          {history.length >= 2 && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="compFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.amber} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 9, fontFamily: FONT.mono, fill: C.faint }} stroke="transparent" interval="preserveStartEnd" tickMargin={4} />
                <YAxis domain={["dataMin - 2", "dataMax + 2"]} hide />
                <Tooltip
                  cursor={{ stroke: C.lineBright }}
                  contentStyle={{ background: C.strip, border: `1px solid ${C.lineBright}`, borderRadius: 0, fontFamily: FONT.mono, fontSize: 11 }}
                  labelStyle={{ color: C.faint }}
                  formatter={(v: number) => [`${Number(v).toFixed(1)}%`, "COMP"]}
                />
                <Area type="monotone" dataKey={COMP_KEY} stroke={C.amber} strokeWidth={1.8} fill="url(#compFill)" isAnimationActive={false} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Movers({ stats }: { stats: SubjectStat[] }) {
  const withPd = stats.filter((s) => s.periodDelta != null);
  const riser = [...withPd].sort((a, b) => b.periodDelta! - a.periodDelta!)[0];
  const faller = [...withPd].sort((a, b) => a.periodDelta! - b.periodDelta!)[0];
  const prints = stats.reduce((a, s) => a + s.curCount, 0);
  const tiles = [
    { l: "TOP RISER", s: riser && riser.periodDelta! > 0 ? riser : null },
    { l: "UNDER PRESSURE", s: faller && faller.periodDelta! < 0 ? faller : null },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((x, i) => (
        <div key={i} className="border p-2.5" style={{ background: C.panel, borderColor: C.line }}>
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
        </div>
      ))}
      <div className="border p-2.5" style={{ background: C.panel, borderColor: C.line }}>
        <div style={{ ...microLabel, color: C.faint }}>PRINTS THIS TERM</div>
        <div className="text-sm font-bold mt-1" style={{ fontFamily: FONT.mono, color: C.text }}>{prints}</div>
      </div>
    </div>
  );
}

function Wire({ stats, index }: { stats: SubjectStat[]; index: CompositeIndex }) {
  const items = useMemo(() => buildWire(stats, index), [stats, index]);
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

export function Overview({
  stats,
  entries,
  settings,
  index,
  onOpenSubject,
  onAddSubject,
}: {
  stats: SubjectStat[];
  entries: GradeEntry[];
  settings: Settings;
  index: CompositeIndex;
  onOpenSubject: (id: string) => void;
  onAddSubject: () => void;
}) {
  return (
    <div className="grid lg:grid-cols-3 gap-3 items-start">
      <div className="lg:col-span-2 space-y-3">
        <CompositeHero entries={entries} settings={settings} index={index} stats={stats} />
        <Movers stats={stats} />
        <div className="grid sm:grid-cols-2 gap-2">
          {stats.map((s) => (
            <SubjectCard key={s.sub.id} stat={s} onOpen={() => onOpenSubject(s.sub.id)} />
          ))}
          <button
            onClick={onAddSubject}
            className="gx-focus border border-dashed p-3 flex items-center justify-center gap-2 min-h-24 text-[11px] font-bold uppercase tracking-[0.14em] hover:brightness-125"
            style={{ borderColor: C.lineBright, color: C.faint, fontFamily: FONT.mono }}
          >
            <Plus size={14} /> List subject
          </button>
        </div>
      </div>
      <Wire stats={stats} index={index} />
    </div>
  );
}
