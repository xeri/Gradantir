import { useState } from "react";
import { Swords } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { PricedBanner } from "../../components/ui/PricedBanner";
import { Card, LoggedRow } from "./Card";
import { ago } from "./format";
import { DuelArena } from "../../components/DuelArena";
import { PREMIUM_CAPS } from "../../lib/quant/mark";
import { READINESS_PRIOR } from "../../lib/quant/params";
import type { DeriveCtx } from "../../lib/derive";
import type { ReadinessSkill } from "../../lib/quant/readiness";
import type { Duel, Subject } from "../../types";

/** Answers shown before the list collapses — a term's worth, roughly. */
const SHOWN = 12;

/**
 * What the pile has earned, in one line of terminal-speak. The multiplier is a
 * measured thing and the card says which measurement it came from: a hit-rate
 * against the desk's on the same rounds, or the unscored prior when no round has
 * tested it yet.
 */
function earnedNote(fit: ReadinessSkill, duels: number): string {
  if (!duels) return "NOTHING DUELLED YET — THE LINE IS ABSENT FROM EVERY MARK UNTIL YOU ANSWER SOMETHING.";
  if (fit.n === 0) {
    return `NO ROUND HAS SCORED THE PILE YET, SO IT CARRIES THE UNPROVEN BASELINE (${Math.round(READINESS_PRIOR * 100)}%). ONCE A ROUND OF EXAMS PRINTS, THE ORDERING YOU CALLED IS GRADED AGAINST THE ONE THE DESK CALLED AND THIS MOVES.`;
  }
  const you = Math.round((fit.hitRate ?? 0) * 100);
  const desk = Math.round((fit.modelHitRate ?? 0) * 100);
  const verdict = fit.w > READINESS_PRIOR ? "READS THE ORDER BETTER THAN THE DESK" : "HAS NOT OUT-READ THE DESK";
  return `OVER ${fit.n} SCORED ROUND${fit.n === 1 ? "" : "S"} YOUR PILE CALLED ${you}% OF PAIRS RIGHT AGAINST THE DESK'S ${desk}% — IT ${verdict}, SO IT CARRIES ${Math.round(fit.w * 100)}% OF THE LINE.`;
}

export function ReadinessCard({
  subjects, duels, fit, readinessOn, todayIso, dctx,
  onRecordDuel, onResetDuels, onRemoveDuel, onSetReadinessWeighting,
}: {
  subjects: Subject[];
  duels: Duel[];
  /** What the pile has earned against realized exam orderings. */
  fit: ReadinessSkill;
  readinessOn: boolean;
  todayIso: string;
  dctx?: DeriveCtx;
  onRecordDuel: (a: string, b: string, w: string) => void;
  onResetDuels: () => void;
  onRemoveDuel: (id: string) => void;
  onSetReadinessWeighting: (on: boolean) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const live = subjects.filter((s) => !s.archived);
  const tickerOf = (id: string) => subjects.find((s) => s.id === id)?.ticker ?? id;
  if (live.length < 2) return null;

  /* Newest first: the answer you most likely want to take back is the last one. */
  const ordered = [...duels].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  const shown = showAll ? ordered : ordered.slice(0, SHOWN);

  return (
    <Card
      icon={Swords}
      title="READINESS DUELS"
      accent={C.amber}
      help="Pick the desk you feel more ready for — forced choice, no 1–10 scale to game. The pile fits an Elo readiness ranking, and that ranking retilts the marks: what it charges one desk it credits another."
    >
      <div className="space-y-3">
        <PricedBanner
          on={readinessOn}
          onToggle={onSetReadinessWeighting}
          label="Readiness priced into predictions"
          earned={{
            label: "PILE CARRIES",
            value: duels.length ? `${Math.round(fit.w * 100)}%` : "—",
            tone: fit.n > 0 && fit.w > READINESS_PRIOR ? C.up : C.accent,
            derive: dctx ? { id: "earn.readiness", ctx: dctx } : null,
          }}
          charge={
            <>
              YOUR GUT ORDERING MOVES THE MARKS — THE LEAST-READY DESK TAKES UP TO {PREMIUM_CAPS.ready.toFixed(1)} PTS OFF ITS PRICE
              AND THE READIEST IS CREDITED BACK, DAMPED. IT IS A TILT, NOT A LEVEL: A PILE CANNOT MARK THE WHOLE BOOK DOWN,
              ONLY DECIDE WHICH DESKS CARRY THE RISK. AN UNEVENLY PREPARED BOOK STILL NETS A SMALL CHARGE, WHICH IS DELIBERATE.
              {" "}{earnedNote(fit, duels.length)}
            </>
          }
          off={<>READINESS IS OUT OF THE PRICING — THE ARENA IS A SELF-CHECK ONLY, AND NO MARK ON THE BOARD MOVES WITH IT.</>}
        />

        <DuelArena subjects={live} duels={duels} onRecordDuel={onRecordDuel} onResetDuels={onResetDuels} dctx={dctx} />

        {ordered.length > 0 && (
          <div className="space-y-1 border-t pt-3" style={{ borderColor: C.line }}>
            <div className="flex items-center justify-between gap-2">
              <span style={{ ...microLabel, color: C.faint }}>EVERY ANSWER ON RECORD</span>
              {ordered.length > SHOWN && (
                <button
                  onClick={() => setShowAll((s) => !s)}
                  className="gx-focus text-[10px] uppercase tracking-wider underline underline-offset-2 hover:brightness-150"
                  style={{ color: C.faint, fontFamily: FONT.mono }}
                >
                  {showAll ? "SHOW FEWER" : `SHOW ALL ${ordered.length}`}
                </button>
              )}
            </div>
            {shown.map((d) => (
              <LoggedRow
                key={d.id}
                primary={tickerOf(d.winnerId)}
                tone={C.amber}
                secondary={`OVER ${tickerOf(d.winnerId === d.aId ? d.bId : d.aId)} · ${ago(d.createdAt, todayIso)}`}
                onRemove={() => onRemoveDuel(d.id)}
                removeLabel={`Remove the duel where ${tickerOf(d.winnerId)} beat ${tickerOf(d.winnerId === d.aId ? d.bId : d.aId)}`}
              />
            ))}
            <p className="pt-1 text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
              A MIS-CLICK IS ONE ✕, NOT A WIPE — DROPPING AN ANSWER REFITS THE RANKING AND THE PREMIUM IT PRICES.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
