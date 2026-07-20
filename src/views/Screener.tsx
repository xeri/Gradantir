import { useState } from "react";
import { C, FONT } from "../theme";
import { Panel } from "../components/ui/Panel";
import { SortHeader, type SortState } from "../components/ui/SortHeader";
import type { SubjectStat } from "../types";

type Num = number | null;
const fmt = (v: Num, dp = 1) => (v == null ? "—" : v.toFixed(dp));
const signed = (v: Num) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`);
const deltaColor = (v: Num) => (v == null ? C.faint : v > 0.05 ? C.up : v < -0.05 ? C.down : C.dim);

interface Col {
  key: string;
  label: string;
  get: (s: SubjectStat) => Num;
  render: (s: SubjectStat) => { text: string; color: string };
}

const COLS: Col[] = [
  { key: "last", label: "LAST", get: (s) => s.latest?.score ?? null, render: (s) => ({ text: fmt(s.latest?.score ?? null), color: C.text }) },
  { key: "chg", label: "CHG", get: (s) => s.tickDelta, render: (s) => ({ text: signed(s.tickDelta), color: deltaColor(s.tickDelta) }) },
  { key: "avg", label: "AVG", get: (s) => s.curAvg, render: (s) => ({ text: fmt(s.curAvg), color: C.text }) },
  { key: "prev", label: "PREV", get: (s) => s.prevAvg, render: (s) => ({ text: fmt(s.prevAvg), color: C.dim }) },
  { key: "dterm", label: "Δ TERM", get: (s) => s.periodDelta, render: (s) => ({ text: signed(s.periodDelta), color: deltaColor(s.periodDelta) }) },
  { key: "sd", label: "σ", get: (s) => s.sd, render: (s) => ({ text: `±${s.sd.toFixed(1)}`, color: s.sd >= 7 ? C.amber : C.dim }) },
  { key: "est", label: "EST", get: (s) => s.forecast?.pred ?? null, render: (s) => ({ text: s.forecast ? `${s.forecast.pred.toFixed(1)}±${s.forecast.sigma.toFixed(1)}` : "—", color: s.forecast ? C.accent : C.faint }) },
  { key: "tgt", label: "TGT", get: (s) => s.sub.target, render: (s) => ({ text: fmt(s.sub.target, 0), color: C.dim }) },
  {
    key: "gap", label: "GAP",
    get: (s) => (s.sub.target != null && s.curAvg != null ? s.curAvg - s.sub.target : null),
    render: (s) => {
      const g = s.sub.target != null && s.curAvg != null ? s.curAvg - s.sub.target : null;
      return { text: signed(g), color: deltaColor(g) };
    },
  },
  { key: "ath", label: "ATH", get: (s) => s.ath, render: (s) => ({ text: fmt(s.ath), color: C.dim }) },
  { key: "dath", label: "ΔATH", get: (s) => s.fromAth, render: (s) => ({ text: signed(s.fromAth), color: s.fromAth != null && s.fromAth >= -0.05 ? C.up : C.dim }) },
  { key: "alpha", label: "α", get: (s) => s.alpha, render: (s) => ({ text: s.alpha == null ? "—" : signed(s.alpha), color: deltaColor(s.alpha) }) },
  { key: "n", label: "N", get: (s) => s.entries.length, render: (s) => ({ text: String(s.entries.length), color: C.faint }) },
];

/** The market-watch table: every subject, every figure, sortable. */
export function Screener({ stats, onOpenSubject }: { stats: SubjectStat[]; onOpenSubject: (id: string) => void }) {
  const [sort, setSort] = useState<SortState>({ key: "ticker", dir: "asc" });

  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "ticker" ? "asc" : "desc" }));

  const rows = [...stats].sort((a, b) => {
    if (sort.key === "ticker") {
      const c = a.sub.ticker.localeCompare(b.sub.ticker);
      return sort.dir === "asc" ? c : -c;
    }
    const col = COLS.find((c) => c.key === sort.key);
    if (!col) return 0;
    const av = col.get(a);
    const bv = col.get(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls always sink
    if (bv == null) return -1;
    return sort.dir === "desc" ? bv - av : av - bv;
  });

  return (
    <Panel title={`SCREENER · ${stats[0]?.curLabel ?? ""}`} pad={false}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr>
              <SortHeader label="TICKER" sortKey="ticker" sort={sort} onSort={onSort} align="left" />
              {COLS.map((c) => (
                <SortHeader key={c.key} label={c.label} sortKey={c.key} sort={sort} onSort={onSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.sub.id}
                onClick={() => onOpenSubject(s.sub.id)}
                className="cursor-pointer border-b last:border-0 hover:bg-white/[0.025]"
                style={{ borderColor: C.line }}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") onOpenSubject(s.sub.id); }}
                aria-label={`Open ${s.sub.name}`}
              >
                <td className="px-2.5 py-2 whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 shrink-0" style={{ background: s.sub.color }} />
                    <span className="text-xs font-bold tracking-[0.08em]" style={{ fontFamily: FONT.mono, color: s.sub.color }}>{s.sub.ticker}</span>
                    <span className="text-[10px] uppercase truncate max-w-28 hidden md:inline" style={{ color: C.faint }}>{s.sub.name}</span>
                  </span>
                </td>
                {COLS.map((c) => {
                  const { text, color } = c.render(s);
                  return (
                    <td key={c.key} className="px-2.5 py-2 text-right text-xs whitespace-nowrap" style={{ fontFamily: FONT.mono, color }}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 border-t text-[10px] tracking-wider" style={{ borderColor: C.line, color: C.faint, fontFamily: FONT.mono }}>
        AVG/PREV HONOR ASSESSMENT WEIGHTS WHEN ENABLED · α = AVERAGE EDGE OVER CLASS · CLICK A ROW FOR THE FULL QUOTE
      </p>
    </Panel>
  );
}
