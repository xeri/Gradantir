import { useMemo } from "react";
import { C, FONT } from "../theme";
import { Delta } from "./ui/Delta";
import { DELISTED_STYLE, DelistedTag } from "./ui/DelistedTag";
import { Derive } from "./ui/Derive";
import { RatingBadge } from "./ui/RatingBadge";
import { REGIME_COLOR } from "./ui/RegimeTag";
import { Sparkline } from "./ui/Sparkline";
import { shortDateY } from "../lib/utils";
import type { DeriveCtx } from "../lib/derive";
import type { SubjectStat } from "../types";

/**
 * One position on the board. The big number is the quant capability price
 * (all prints, coursework-heavy), with the last exam print and the analyst
 * consensus directly beneath. Click-through to the full quote drawer.
 *
 * The card is one big <button>, so its derivation triggers are PASSIVE: hover
 * only, clicks falling through to the drawer. Derivation mode flips that —
 * there, you are inspecting rather than navigating.
 */
export function SubjectCard({
  stat,
  onOpen,
  deriveCtx,
}: {
  stat: SubjectStat;
  onOpen: () => void;
  deriveCtx?: DeriveCtx;
}) {
  const { sub, quant, priceDelta, scores, entries, curAvg, volatility, sd, rating, latest } = stat;
  const dates = entries.map((e) => shortDateY(e.date));
  const closed = sub.archived === true;
  const dctx = useMemo<DeriveCtx | null>(() => (deriveCtx ? { ...deriveCtx, stat } : null), [deriveCtx, stat]);
  const derive = (id: string, node: React.ReactNode) =>
    dctx ? <Derive id={id} ctx={dctx} passive>{node}</Derive> : node;
  return (
    <button
      onClick={onOpen}
      className="gx-focus text-left border p-3 w-full transition-colors hover:brightness-110"
      style={{
        background: C.panel,
        borderColor: C.line,
        ...(closed ? { ...DELISTED_STYLE, borderStyle: "dashed" } : null),
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 shrink-0" style={{ background: closed ? C.faint : sub.color }} />
          <span
            className="text-xs font-bold tracking-[0.1em] shrink-0"
            style={{ fontFamily: FONT.mono, color: closed ? C.dim : sub.color, textDecoration: closed ? "line-through" : undefined }}
          >
            {sub.ticker}
          </span>
          <span className="text-[11px] truncate uppercase tracking-wide" style={{ color: C.faint }}>{sub.name}</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {closed ? <DelistedTag closedAt={latest?.date} /> : derive("rating.score", <RatingBadge rating={rating.rating} short />)}
          <span aria-hidden="true" className="text-[10px]" style={{ color: C.faint, fontFamily: FONT.mono }}>›</span>
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        {derive(
          "mark.price",
          <span className="text-[26px] font-bold leading-none" style={{ fontFamily: FONT.mono, color: C.text }}>
            {quant ? quant.price.toFixed(1) : "—"}
          </span>,
        )}
        <span className="text-[10px]" style={{ color: C.faint, fontFamily: FONT.mono }}>MARK</span>
        <Delta v={priceDelta} size="lg" nullText="NEW" />
      </div>
      {quant && (
        <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em]" style={{ fontFamily: FONT.mono, color: C.faint }}>
          {derive("fv.value", <>FV <span style={{ color: C.dim }}>{quant.fv.toFixed(1)}</span></>)}
          {quant.discount > 0.05 && (
            <>
              {" "}· {derive("mark.discount", <>RISK <span style={{ color: REGIME_COLOR[quant.regime] }}>−{quant.discount.toFixed(1)}</span></>)}
            </>
          )}
          {quant.discount <= 0.05 && <> · <span style={{ color: C.up }}>AT PAR</span></>}
        </div>
      )}
      <div className="mb-1 mt-0.5 text-[10px] uppercase tracking-[0.14em] flex items-center gap-2" style={{ fontFamily: FONT.mono, color: C.dim }}>
        <span>
          LAST EXAM <span style={{ color: quant?.lastExamPct != null ? C.text : C.faint }}>
            {quant?.lastExamPct != null ? `${quant.lastExamPct.toFixed(1)}%` : "—"}
          </span>
        </span>
        {!closed && rating.target != null && rating.upside != null && derive(
          "rating.target",
          <span style={{ color: C.faint }}>
            PT <span style={{ color: C.dim }}>{rating.target.toFixed(1)}</span>{" "}
            <span style={{ color: rating.upside > 0.05 ? C.up : rating.upside < -0.05 ? C.down : C.faint }}>
              {rating.upside > 0 ? "+" : ""}{rating.upside.toFixed(1)}%
            </span>
          </span>,
        )}
      </div>
      <Sparkline scores={scores} color={sub.color} h={54} labels={dates} />
      <div className="flex items-center justify-between mt-1.5 text-[10px] uppercase tracking-wider" style={{ fontFamily: FONT.mono }}>
        <span style={{ color: C.dim }}>AVG {curAvg != null ? curAvg.toFixed(1) : "—"}</span>
        {/* Nobody forecasts an exam you will never sit. */}
        {closed
          ? <span style={{ color: C.faint }}>CLOSED {latest ? shortDateY(latest.date) : "—"}</span>
          : quant && derive("oracle.next", <span style={{ color: C.accent }}>NXT EXAM {quant.nextExam.mean.toFixed(1)}</span>)}
        <span style={{ color: sd >= 7 ? C.amber : C.faint }}>{volatility}</span>
      </div>
    </button>
  );
}
