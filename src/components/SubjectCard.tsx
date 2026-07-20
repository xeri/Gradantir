import { C, FONT } from "../theme";
import { Delta } from "./ui/Delta";
import { Sparkline } from "./ui/Sparkline";
import type { SubjectStat } from "../types";

/** One position on the board. Click-through to the full quote drawer. */
export function SubjectCard({ stat, onOpen }: { stat: SubjectStat; onOpen: () => void }) {
  const { sub, latest, tickDelta, scores, curAvg, forecast, volatility, sd } = stat;
  return (
    <button
      onClick={onOpen}
      className="gx-focus text-left border p-3 w-full transition-colors hover:brightness-110"
      style={{ background: C.panel, borderColor: C.line }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 shrink-0" style={{ background: sub.color }} />
          <span className="text-xs font-bold tracking-[0.1em] shrink-0" style={{ fontFamily: FONT.mono, color: sub.color }}>
            {sub.ticker}
          </span>
          <span className="text-[11px] truncate uppercase tracking-wide" style={{ color: C.faint }}>{sub.name}</span>
        </span>
        <span aria-hidden="true" className="text-[10px]" style={{ color: C.faint, fontFamily: FONT.mono }}>›</span>
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[26px] font-bold leading-none" style={{ fontFamily: FONT.mono, color: C.text }}>
          {latest ? latest.score.toFixed(1) : "—"}
        </span>
        <span className="text-[10px]" style={{ color: C.faint, fontFamily: FONT.mono }}>%</span>
        <Delta v={tickDelta} size="lg" nullText="NEW" />
      </div>
      <Sparkline scores={scores} color={sub.color} />
      <div className="flex items-center justify-between mt-1.5 text-[10px] uppercase tracking-wider" style={{ fontFamily: FONT.mono }}>
        <span style={{ color: C.dim }}>AVG {curAvg != null ? curAvg.toFixed(1) : "—"}</span>
        {forecast && <span style={{ color: C.accent }}>EST {forecast.pred.toFixed(1)}</span>}
        <span style={{ color: sd >= 7 ? C.amber : C.faint }}>{volatility}</span>
      </div>
    </button>
  );
}
