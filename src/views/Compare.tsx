import { useEffect, useMemo, useState } from "react";
import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip,
} from "recharts";
import { C, FONT, microLabel } from "../theme";
import { Panel } from "../components/ui/Panel";
import { Sel } from "../components/ui/Field";
import { Delta } from "../components/ui/Delta";
import { buildGroupedRows } from "../lib/grouping";
import { makeWeightFn } from "../lib/weights";
import { round1 } from "../lib/utils";
import type { GradeEntry, Settings, Subject } from "../types";

const B_COLOR = "#5C6779";

/** Radar of any term vs any other — the shape of the portfolio, then and now. */
export function Compare({ subjects, entries, settings }: { subjects: Subject[]; entries: GradeEntry[]; settings: Settings }) {
  const termRows = useMemo(
    () => buildGroupedRows(entries, "term", "all", makeWeightFn(settings)),
    [entries, settings],
  );
  const opts = termRows.map((r) => ({ value: r.key!, label: r.label! }));
  const [keyA, setKeyA] = useState(opts.length ? opts[opts.length - 1].value : "");
  const [keyB, setKeyB] = useState(opts.length > 1 ? opts[opts.length - 2].value : "");

  useEffect(() => {
    if (opts.length && !opts.some((o) => o.value === keyA)) setKeyA(opts[opts.length - 1].value);
    if (opts.length > 1 && !opts.some((o) => o.value === keyB)) setKeyB(opts[opts.length - 2].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const rowA = termRows.find((r) => r.key === keyA);
  const rowB = termRows.find((r) => r.key === keyB);
  const labelA = rowA?.label || "—";
  const labelB = rowB?.label || "—";

  const radarData = subjects.map((s) => ({
    axis: s.ticker,
    name: s.name,
    A: (rowA?.[s.id] as number | undefined) ?? null,
    B: (rowB?.[s.id] as number | undefined) ?? null,
  }));
  const plotData = radarData.map((d) => ({ ...d, A: d.A ?? 0, B: d.B ?? 0 }));

  if (!subjects.length || termRows.length === 0) {
    return (
      <Panel>
        <div className="py-8 text-center text-[11px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
          Log some results first — then compare any two terms side by side here.
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid lg:grid-cols-5 gap-3 items-start">
      <Panel className="lg:col-span-3" title="PERIOD OVERLAY" pad={false}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b" style={{ borderColor: C.line }}>
          <span className="w-2.5 h-2.5" style={{ background: C.amber }} />
          <Sel ariaLabel="Period A" value={keyA} onChange={setKeyA} options={opts} />
          <span className="text-[10px] font-bold uppercase" style={{ color: C.faint, fontFamily: FONT.mono }}>vs</span>
          <span className="w-2.5 h-2.5 border" style={{ background: "transparent", borderColor: B_COLOR }} />
          <Sel ariaLabel="Period B" value={keyB} onChange={setKeyB} options={opts} />
        </div>
        <div className="p-2">
          <ResponsiveContainer width="100%" height={380}>
            <RadarChart data={plotData} outerRadius="72%">
              <PolarGrid stroke={C.line} />
              <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fontFamily: FONT.mono, fill: C.text, fontWeight: 700 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={5} tick={{ fontSize: 8, fill: C.faint, fontFamily: FONT.mono }} stroke="transparent" />
              <Radar name={labelB} dataKey="B" stroke={B_COLOR} fill={B_COLOR} fillOpacity={0.12} strokeWidth={1.6} strokeDasharray="5 4" isAnimationActive={false} />
              <Radar name={labelA} dataKey="A" stroke={C.amber} fill={C.amber} fillOpacity={0.16} strokeWidth={2} isAnimationActive={false} />
              <Tooltip
                formatter={(v: number, n: string) => [Number(v).toFixed(1) + "%", n]}
                contentStyle={{ background: C.strip, border: `1px solid ${C.lineBright}`, borderRadius: 0, fontFamily: FONT.mono, fontSize: 11 }}
              />
            </RadarChart>
          </ResponsiveContainer>
          {subjects.length < 3 && (
            <p className="text-[10px] px-2 pb-1 uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
              The shape gets more useful from three subjects up.
            </p>
          )}
        </div>
      </Panel>
      <Panel className="lg:col-span-2" title={`${labelA} VS ${labelB}`} pad={false}>
        <div>
          {radarData.map((d, i) => {
            const delta = d.A != null && d.B != null ? round1(d.A - d.B) : null;
            return (
              <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 border-b last:border-0" style={{ borderColor: C.line }}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 shrink-0" style={{ background: subjects[i].color }} />
                  <span className="text-[11px] font-semibold truncate uppercase tracking-wide" style={{ color: C.dim }}>{d.name}</span>
                </span>
                <span className="flex items-center gap-3 shrink-0 text-xs" style={{ fontFamily: FONT.mono }}>
                  <span className="font-bold" style={{ color: C.text }}>{d.A != null ? d.A.toFixed(1) : "—"}</span>
                  <span style={{ color: C.faint }}>{d.B != null ? d.B.toFixed(1) : "—"}</span>
                  <Delta v={delta} />
                </span>
              </div>
            );
          })}
        </div>
        <p className="px-3 py-2 border-t" style={{ ...microLabel, borderColor: C.line, color: C.faint }}>
          {labelA} first · {labelB} second
        </p>
      </Panel>
    </div>
  );
}
