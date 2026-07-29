import { CalendarClock, Plus } from "lucide-react";
import { C, FONT } from "../../theme";
import { Btn } from "../../components/ui/Btn";
import { Card, Derived } from "./Card";
import { crowding } from "../../lib/upcoming";
import { fmt1, signed } from "./format";
import type { DeriveCtx } from "../../lib/derive";
import type { StudentT } from "../../lib/quant/bayes";
import type { Upcoming } from "../../types";

export function ForwardCard({
  pending, resolved, allUpcoming, tickerOf, colorOf, modelFor, onAdd, onEdit, onDelete, dctx,
}: {
  pending: Upcoming[];
  resolved: { upcoming: Upcoming; realized: { score: number } }[];
  allUpcoming: Upcoming[];
  tickerOf: (id: string) => string;
  colorOf: (id: string) => string;
  modelFor: (r: { upcoming: Upcoming }) => StudentT | null;
  onAdd: () => void;
  onEdit: (u: Upcoming) => void;
  onDelete: (id: string) => void;
  /**
   * The UNPOOLED board — this card prints the desk's own call, so the note
   * behind it must be the desk's own arithmetic and not the pooled one.
   */
  dctx?: DeriveCtx;
}) {
  const sortedPending = [...pending].sort((a, b) => (a.date < b.date ? -1 : 1));
  const oracleFor = (subjectId: string) => {
    const stat = dctx?.stats?.find((s) => s.sub.id === subjectId);
    return dctx && stat ? { id: "oracle.next", ctx: { ...dctx, stat } } : null;
  };
  return (
    <Card
      icon={CalendarClock}
      title="FORWARD CALENDAR"
      accent={C.up}
      help="Papers you have coming up. CRUSH ×n = how many other sittings fall in the fortnight before it — the exam-week squeeze."
      right={<Btn variant="primary" onClick={onAdd} title="Add a paper you have coming up"><Plus size={12} /> Sitting</Btn>}
    >
      {sortedPending.length === 0 && resolved.length === 0 ? (
        <p className="text-[11px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
          Nothing scheduled. Add the exams you have coming up — the desk forecasts them, and you can stake your own call.
        </p>
      ) : (
        <div className="space-y-1">
          {sortedPending.map((u) => {
            const crush = crowding(u, allUpcoming);
            const model = modelFor({ upcoming: u });
            return (
              <div key={u.id} className="flex items-center gap-2 border px-2 py-1.5" style={{ borderColor: C.line, background: C.panel2 }}>
                <span className="w-2 h-2 shrink-0" style={{ background: colorOf(u.subjectId) }} aria-hidden="true" />
                <span className="w-12 text-[11px] font-bold tabular-nums" style={{ color: C.text, fontFamily: FONT.mono }}>{tickerOf(u.subjectId)}</span>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>{u.date}</span>
                <span className="flex-1 flex flex-wrap items-center gap-x-2 text-[10px] uppercase tracking-wider" style={{ color: C.dim, fontFamily: FONT.mono }}>
                  {u.title && <span>{u.title}</span>}
                  {model && (
                    <Derived on={oracleFor(u.subjectId)}>
                      <span style={{ color: C.accent }} title="The desk's forecast for this sitting">DESK {fmt1(model.mean)}</span>
                    </Derived>
                  )}
                  {u.selfPred && <span style={{ color: C.amber }} title="Your own prediction">YOU {u.selfPred.point}</span>}
                  {u.syllabusCoverage != null && <span title="Share of the syllabus you have covered">COVER {u.syllabusCoverage}%</span>}
                  {crush > 0 && <span style={{ color: crush >= 3 ? C.down : C.amber }} title="Other sittings in the fortnight before this one">CRUSH ×{crush}</span>}
                </span>
                <button onClick={() => onEdit(u)} className="gx-focus text-[10px] uppercase tracking-wider px-1 hover:brightness-150" style={{ color: C.accent, fontFamily: FONT.mono }}>EDIT</button>
                <button onClick={() => onDelete(u.id)} className="gx-focus text-[10px] px-1 hover:brightness-150" style={{ color: C.faint, fontFamily: FONT.mono }} aria-label={`Remove ${tickerOf(u.subjectId)} sitting`} title="Remove this sitting">✕</button>
              </div>
            );
          })}
          {resolved.map(({ upcoming: u, realized }) => (
            <div key={u.id} className="flex items-center gap-2 border px-2 py-1.5" style={{ borderColor: C.line, background: "rgba(47,217,128,0.05)" }}>
              <span className="w-2 h-2 shrink-0" style={{ background: colorOf(u.subjectId) }} aria-hidden="true" />
              <span className="w-12 text-[11px] font-bold tabular-nums" style={{ color: C.text, fontFamily: FONT.mono }}>{tickerOf(u.subjectId)}</span>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>SAT · {u.date}</span>
              <span className="flex-1 flex flex-wrap items-center gap-x-2 text-[10px] uppercase tracking-wider" style={{ color: C.dim, fontFamily: FONT.mono }}>
                <span style={{ color: C.up }}>PRINTED {realized.score}</span>
                {u.selfPred && <span style={{ color: C.amber }}>YOU SAID {u.selfPred.point} ({signed(u.selfPred.point - realized.score)})</span>}
              </span>
              <button onClick={() => onDelete(u.id)} className="gx-focus text-[10px] px-1 hover:brightness-150" style={{ color: C.faint, fontFamily: FONT.mono }} aria-label={`Remove ${tickerOf(u.subjectId)} sitting`} title="Remove this sitting">✕</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
