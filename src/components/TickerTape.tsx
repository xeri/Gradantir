import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { C, FONT } from "../theme";
import { RATING_COLOR, RATING_SHORT } from "./ui/RatingBadge";
import type { MarketPhase } from "../lib/session";
import type { AggregateForecast, CompositeIndex, DepthModel, ExamAggregate, Rating, SubjectStat } from "../types";

/** Belt speed, px/sec. Fixed, so a two-desk book crawls past no faster than a
 *  twenty-desk one — the tape reads at one pace whatever is printed on it. */
const SPEED = 70;

/** Measure before paint in the browser, but stay quiet under the static
 *  renderer the markup tests use — a layout effect there is a no-op React
 *  warns about, and there is nothing to measure anyway. */
const useMeasure = typeof window === "undefined" ? useEffect : useLayoutEffect;

type TapeItem = { k: string; v: number | null; d: number | null; r?: Rating };

/**
 * One run of quotes. Module-level on purpose: declared inside TickerTape it
 * would be a fresh component type every render, so React would tear down the
 * run and build a new one on every price tick — taking the node the
 * ResizeObserver holds with it.
 */
function Chunk({
  items,
  ariaHidden,
  innerRef,
}: {
  items: TapeItem[];
  ariaHidden?: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div className="flex items-center shrink-0" ref={innerRef} aria-hidden={ariaHidden}>
      {items.map((it, i) => {
        const up = (it.d ?? 0) > 0.05;
        const down = (it.d ?? 0) < -0.05;
        const isIndex = it.k.startsWith("GX ");
        return (
          <span key={i} className="flex items-center gap-1.5 px-4 text-[11px]" style={{ fontFamily: FONT.mono }}>
            <span className="font-bold tracking-[0.1em]" style={{ color: isIndex ? C.amber : C.text }}>{it.k}</span>
            <span style={{ color: C.dim }}>{it.v != null ? Number(it.v).toFixed(1) : "—"}</span>
            {it.d != null && (
              <span style={{ color: up ? C.up : down ? C.down : C.faint }}>
                {up ? "▲" : down ? "▼" : "·"} {Math.abs(it.d).toFixed(1)}
              </span>
            )}
            {it.r && it.r !== "N/A" && (
              <span className="text-[9px] font-bold tracking-[0.1em]" style={{ color: RATING_COLOR[it.r] }}>
                {RATING_SHORT[it.r]}
              </span>
            )}
            <span className="pl-3" style={{ color: "#1C2430" }}>│</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * How many copies of the quote run it takes to cover the viewport, plus one to
 * carry the wrap. A short book used to leave the belt half empty and snap back
 * across the gap; repeating the run until it overflows is what makes the loop
 * seamless at any width. Two is the floor — the wrap needs something to wrap to
 * — and the fallback before the first measurement lands.
 */
export function tapeCopies(chunkPx: number, viewPx: number): number {
  if (!Number.isFinite(chunkPx) || !Number.isFinite(viewPx) || chunkPx <= 0 || viewPx <= 0) return 2;
  return Math.max(2, Math.ceil(viewPx / chunkPx) + 1);
}

/**
 * The signature strip: the three indices — realized exams, the predicted next
 * round, the capability composite — then every priced desk at its price with
 * its consensus rating. After the closing bell it dims but keeps running; the
 * chrome is cosmetic, and the desk never stops taking prints.
 */
export function TickerTape({
  stats,
  agg,
  forecast,
  composite,
  depth,
  phase,
}: {
  stats: SubjectStat[];
  agg: ExamAggregate | null;
  forecast: AggregateForecast | null;
  composite: CompositeIndex | null;
  depth: DepthModel | null;
  phase: MarketPhase;
}) {
  const closed = phase === "closed";
  // The belt is sized off two live measurements: one run of quotes, and the
  // slot it scrolls through. Both change when the book does or the window
  // resizes, so a ResizeObserver watches each rather than measuring once.
  const viewRef = useRef<HTMLDivElement>(null);
  const chunkRef = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState(0);
  const [view, setView] = useState(0);
  // GX PEER quotes the class you are sitting in, and its move is the move that
  // a placement alone cannot show you.
  const peer = depth?.fitted && depth.groups.length ? depth.groups[depth.groups.length - 1] : null;
  const peerPrev = depth?.fitted && depth.groups.length > 1 ? depth.groups[depth.groups.length - 2] : null;
  const items: TapeItem[] = [
    ...(agg ? [{ k: "GX AGG", v: agg.pct, d: agg.pctDelta }] : []),
    ...(forecast ? [{ k: "GX PRED", v: forecast.pct, d: forecast.vsLast }] : []),
    ...(composite ? [{ k: "GX COMP", v: composite.value, d: composite.delta }] : []),
    ...(peer ? [{ k: "GX PEER", v: peer.premium, d: peerPrev ? Math.round((peer.premium - peerPrev.premium) * 10) / 10 : null }] : []),
    ...stats
      .filter((s) => s.quant)
      .map((s) => ({ k: s.sub.ticker, v: s.quant!.price as number | null, d: s.priceDelta, r: s.rating.rating })),
  ];
  useMeasure(() => {
    const v = viewRef.current;
    const c = chunkRef.current;
    if (!v || !c || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setSpan(c.getBoundingClientRect().width);
      setView(v.getBoundingClientRect().width);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    ro.observe(c);
    return () => ro.disconnect();
  }, [items.length]);
  const copies = tapeCopies(span, view);
  return (
    /* role="marquee": a scrolling ticker is a live region whose implicit
       aria-live is "off", so it labels cleanly without a screen reader spamming
       every scroll — an aria-label on a bare div is simply ignored. */
    <div className="flex items-stretch border-b" style={{ background: C.strip, borderColor: C.line }} role="marquee" aria-label="Index and capability price ticker">
      {closed && (
        <span
          className="flex items-center px-3 border-r text-[10px] font-bold tracking-[0.14em] whitespace-nowrap shrink-0"
          style={{ fontFamily: FONT.mono, color: C.faint, borderColor: C.line }}
        >
          MKT CLOSED
        </span>
      )}
      {/* Focusable viewport so keyboard users get the pause that hover gives a
          mouse (WCAG 2.2.2); prefers-reduced-motion stops it outright in CSS. */}
      <div ref={viewRef} className="gx-tape-view gx-focus overflow-hidden flex-1" tabIndex={0} aria-label="Ticker — hold focus here to pause scrolling" style={{ opacity: closed ? 0.55 : 1 }}>
        {/* The wrap distance is one run of quotes, not half the belt: the belt
            carries however many runs it takes to fill the slot, so the span has
            to be stated in pixels once measured. Duration follows from it to
            hold the speed constant. */}
        <div
          className="gx-tape flex py-1"
          style={
            {
              "--gx-tape-span": span ? `${span}px` : "50%",
              "--gx-tape-dur": `${span ? span / SPEED : 42}s`,
            } as React.CSSProperties
          }
        >
          {Array.from({ length: copies }, (_, i) => (
            <Chunk key={i} items={items} ariaHidden={i > 0} innerRef={i === 0 ? chunkRef : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}
