import { GitCompareArrows } from "lucide-react";
import { C, FONT } from "../../theme";
import { Card, Derived } from "./Card";
import { examOffset } from "../../lib/quant/calibration";
import { fmt1, signed } from "./format";
import type { DeriveCtx } from "../../lib/derive";
import type { SubjectStat } from "../../types";

export function GapCard({ stats, onOpenSubject, dctx }: { stats: SubjectStat[]; onOpenSubject: (id: string) => void; dctx?: DeriveCtx }) {
  const rows = stats
    .map((s) => ({ s, off: examOffset(s.entries) }))
    .filter((r) => r.off.raw != null && r.off.nExams > 0 && r.off.nCoursework > 0)
    .sort((a, b) => (a.off.raw ?? 0) - (b.off.raw ?? 0));
  if (!rows.length) return null;
  return (
    <Card
      icon={GitCompareArrows}
      title="COURSEWORK → EXAM GAP"
      accent={C.down}
      help="Desks whose exams undershoot their coursework are a fixable process problem, not a knowledge one. Click to open the desk."
    >
      <div className="space-y-1">
        {rows.map(({ s, off }) => {
          const gap = off.raw!;
          const under = gap < 0;
          return (
            <button
              key={s.sub.id}
              onClick={() => onOpenSubject(s.sub.id)}
              className="gx-focus w-full flex items-center gap-2 border px-2 py-1.5 text-left hover:brightness-125"
              style={{ borderColor: C.line, background: C.panel2 }}
              title={`Open ${s.sub.name}`}
            >
              <span className="w-2 h-2 shrink-0" style={{ background: s.sub.color }} aria-hidden="true" />
              <span className="w-12 text-[11px] font-bold" style={{ color: C.text, fontFamily: FONT.mono }}>{s.sub.ticker}</span>
              <span className="flex-1 text-[10px] uppercase tracking-wider" style={{ color: C.dim, fontFamily: FONT.mono }}>
                EXAMS RUN {fmt1(Math.abs(gap))} PTS {under ? "UNDER" : "OVER"} COURSEWORK
              </span>
              {/* Passive: the row is a <button> that opens the desk, so the
                  figure hovers its note without stealing the click. */}
              <Derived on={dctx ? { id: "gap.exam", ctx: { ...dctx, stat: s }, passive: true } : null}>
                <span className="text-sm font-black tabular-nums" style={{ color: under ? C.down : C.up, fontFamily: FONT.mono }}>{signed(gap)}</span>
              </Derived>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
