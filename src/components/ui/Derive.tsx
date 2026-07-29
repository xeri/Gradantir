import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { C, FONT, microLabel } from "../../theme";
import { Tex, preloadKatex } from "./Tex";
import { placePopover, type Placement } from "../../lib/derive/place";
import { derivationFor } from "../../lib/derive";
import { CITATIONS } from "../../lib/derive/cite";
import { derivationModeOff, derivationModeOn, subscribeDerivationMode } from "../../lib/derivationMode";
import type { DeriveCtx, Derivation } from "../../lib/derive/types";

/**
 * The derivation popover: hover a generated number, read the mathematics that
 * produced it.
 *
 * Portalled and fixed-positioned because the drawer and the screener are their
 * own scroll containers and would clip an in-flow panel. Placement geometry
 * lives in lib/derive/place.ts so it can be tested without a DOM; everything
 * here is the state machine and the chrome.
 *
 * Interaction contract (WCAG 1.4.13): the panel is dismissible (Escape),
 * hoverable (the pointer can travel into it without it vanishing), and
 * persistent (it stays until dismissed, or the pointer genuinely leaves).
 */

const PANEL_W = 420;
const OPEN_DELAY = 140;
const CLOSE_GRACE = 120;

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

let uid = 0;

function useDerivationMode(): boolean {
  return useSyncExternalStore(subscribeDerivationMode, derivationModeOn, derivationModeOff);
}

/* ── Panel chrome ──────────────────────────────────────────────────── */

function Steps({ d }: { d: Derivation }) {
  return (
    <div className="space-y-2.5">
      {d.steps.map((s, i) => (
        <div key={i}>
          <Tex tex={s.tex} display />
          {s.subst && (
            <div className="mt-1 pl-2 border-l" style={{ borderColor: C.line }}>
              <Tex tex={s.subst} display />
            </div>
          )}
          {s.note && (
            <div className="mt-1 text-[9px] uppercase tracking-[0.12em] leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
              {s.note}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Inputs({ d }: { d: Derivation }) {
  if (!d.inputs.length) return null;
  return (
    <div className="mt-3 pt-2.5 border-t" style={{ borderColor: C.line }}>
      <div style={{ ...microLabel, color: C.faint, marginBottom: 4 }}>INPUTS</div>
      <div className="space-y-0.5">
        {d.inputs.map((x, i) => (
          <div key={i} className="flex items-baseline gap-2 text-[10px]" style={{ fontFamily: FONT.mono }}>
            <span className="w-10 shrink-0" style={{ opacity: x.missing ? 0.45 : 1 }}>
              <Tex tex={x.sym} />
            </span>
            <span className="flex-1 min-w-0 truncate uppercase tracking-[0.1em]" style={{ color: C.faint }}>
              {x.label}
            </span>
            <span
              className="shrink-0 font-bold"
              style={{ color: x.missing ? C.faint : C.dim, textDecoration: x.missing ? "line-through" : undefined }}
            >
              {x.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Gates({ d }: { d: Derivation }) {
  if (!d.gates?.length) return null;
  return (
    <div className="mt-2.5 pt-2.5 border-t" style={{ borderColor: C.line }}>
      <div style={{ ...microLabel, color: C.faint, marginBottom: 4 }}>GATES</div>
      <div className="space-y-0.5">
        {d.gates.map((g, i) => (
          <div key={i} className="flex items-baseline gap-2 text-[10px] uppercase tracking-[0.1em]" style={{ fontFamily: FONT.mono }}>
            <span className="shrink-0 font-bold" style={{ color: g.pass ? C.up : C.down }}>{g.pass ? "✓" : "✗"}</span>
            <span style={{ color: g.pass ? C.dim : C.faint }}>{g.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Refs({ d }: { d: Derivation }) {
  if (!d.refs?.length) return null;
  return (
    <div className="mt-2.5 pt-2.5 border-t" style={{ borderColor: C.line }}>
      <div style={{ ...microLabel, color: C.faint, marginBottom: 4 }}>REFERENCES</div>
      <ol className="space-y-1">
        {d.refs.map((k) => (
          <li key={k} className="text-[9px] leading-relaxed flex gap-1.5" style={{ fontFamily: FONT.mono, color: C.faint }}>
            <span style={{ color: C.amber }}>▸</span>
            <span>
              <span style={{ color: C.dim }}>{CITATIONS[k].authors}</span> ({CITATIONS[k].year}).{" "}
              <span style={{ fontStyle: "italic" }}>{CITATIONS[k].title}</span>. {CITATIONS[k].venue}.
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Panel({
  d,
  depth,
  onBack,
  onDrill,
}: {
  d: Derivation;
  depth: number;
  onBack: () => void;
  onDrill: (id: string) => void;
}) {
  return (
    <>
      <div
        className="flex items-baseline gap-2 px-3 py-1.5 border-b sticky top-0 z-10"
        style={{ borderColor: C.line, background: C.strip }}
      >
        {depth > 0 && (
          <button
            onClick={onBack}
            className="gx-focus inline-flex items-center justify-center min-w-6 min-h-6 text-[10px] font-bold shrink-0 hover:brightness-150"
            style={{ color: C.amber, fontFamily: FONT.mono }}
            aria-label="Back"
          >
            ‹
          </button>
        )}
        <span className="shrink-0" style={{ color: C.amber }}>
          <Tex tex={d.symbol} />
        </span>
        <span className="flex-1 min-w-0 truncate" style={{ ...microLabel, color: C.amber }}>
          {d.title}
        </span>
        <span className="shrink-0 text-[11px] font-bold" style={{ fontFamily: FONT.mono, color: C.text }}>
          {d.result.value}
          {d.result.unit && <span className="ml-1 text-[9px]" style={{ color: C.faint }}>{d.result.unit}</span>}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-[0.1em] leading-relaxed mb-2.5" style={{ color: C.dim, fontFamily: FONT.mono }}>
          {d.claim}
        </p>

        <Steps d={d} />
        <Inputs d={d} />
        <Gates d={d} />

        {d.related && d.related.length > 0 && (
          <div className="mt-2.5 pt-2.5 border-t flex flex-wrap gap-1" style={{ borderColor: C.line }}>
            {d.related.map((rid) => (
              <button
                key={rid}
                onClick={() => onDrill(rid)}
                className="gx-focus inline-flex items-center min-h-6 border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] hover:brightness-150"
                style={{ borderColor: C.line, background: C.panel2, color: C.dim, fontFamily: FONT.mono }}
              >
                {rid.split(".").pop()?.replace(/([A-Z])/g, " $1")} ›
              </button>
            ))}
          </div>
        )}

        <Refs d={d} />

        <div className="mt-2.5 pt-2 border-t text-[9px] tracking-[0.08em]" style={{ borderColor: C.line, color: C.faint, fontFamily: FONT.mono }}>
          {d.source}
        </div>
      </div>
    </>
  );
}

/* ── The trigger ───────────────────────────────────────────────────── */

export function Derive({
  id,
  ctx,
  children,
  /**
   * Inside an interactive ancestor (the subject card is one big <button>, a
   * screener row is a focusable <tr>): render a bare span, hover only, and let
   * clicks fall through to the parent. Derivation mode overrides this — in that
   * mode you are inspecting, not navigating, so the figure takes the click.
   */
  passive = false,
  className = "",
  style,
}: {
  id: string;
  ctx: DeriveCtx;
  children: React.ReactNode;
  passive?: boolean;
  className?: string;
  /** Layout glue when the trigger IS the row, not a word inside one. */
  style?: React.CSSProperties;
}) {
  const mode = useDerivationMode();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [stack, setStack] = useState<string[]>([]);
  const [pos, setPos] = useState<Placement | null>(null);

  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useMemo(() => `gx-derive-${++uid}`, []);

  const interactive = !passive || mode;
  const activeId = stack.length ? stack[stack.length - 1] : id;
  const d = useMemo(() => (open ? derivationFor(activeId, ctx) : null), [open, activeId, ctx]);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = closeTimer.current = null;
  };

  const close = useCallback(() => {
    clearTimers();
    setOpen(false);
    setPinned(false);
    setStack([]);
    setPos(null);
  }, []);

  // Measure and place once the panel exists, then follow scroll and resize.
  // Reposition rather than close: the drawer scrolls under a pinned panel and
  // having it detach or vanish mid-read is worse than having it track.
  useIsoLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const p = panelRef.current;
      if (!a || !p) return;
      // Off-viewport anchor (scrolled away entirely): stop following it.
      if (a.bottom < 0 || a.top > window.innerHeight) return close();
      setPos(
        placePopover(
          { top: a.top, left: a.left, width: a.width, height: a.height },
          { top: 0, left: 0, width: p.offsetWidth, height: p.scrollHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    fit();
    window.addEventListener("scroll", fit, true);
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("scroll", fit, true);
      window.removeEventListener("resize", fit);
    };
  }, [open, activeId, d, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!pinned) return;
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, pinned, close]);

  useEffect(() => clearTimers, []);

  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (open) return;
    void preloadKatex();
    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  };
  const leave = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (pinned) return;
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_GRACE);
  };

  const trigger = (
    <span
      ref={anchorRef}
      className={`gx-derive ${className}`}
      style={style}
      data-open={open ? "1" : undefined}
      /* haspopup, not describedby: the panel carries drill-down and back
         BUTTONS, so it is an interactive dialog to open, not a passive
         description to read out as this figure's accessible name. */
      aria-haspopup={interactive ? "dialog" : undefined}
      aria-controls={interactive && open ? panelId : undefined}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "button" : undefined}
      aria-expanded={interactive ? open : undefined}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onFocus={interactive ? () => { void preloadKatex(); setOpen(true); } : undefined}
      onBlur={interactive ? () => { if (!pinned) setOpen(false); } : undefined}
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation();
              e.preventDefault();
              clearTimers();
              setOpen(true);
              setPinned((p) => !p);
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                setOpen(true);
                setPinned((p) => !p);
              }
            }
          : undefined
      }
    >
      {children}
    </span>
  );

  if (!open || typeof document === "undefined") return trigger;

  return (
    <>
      {trigger}
      {createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={d ? `${d.title} — derivation` : "Derivation"}
          className="gx-fade fixed z-[60] border overflow-y-auto overflow-x-hidden"
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width: PANEL_W,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: pos?.maxHeight,
            background: C.strip,
            borderColor: pinned ? C.amber : C.lineBright,
            boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
            visibility: pos ? "visible" : "hidden",
          }}
          onPointerEnter={() => {
            if (closeTimer.current) clearTimeout(closeTimer.current);
          }}
          onPointerLeave={leave}
          onClick={(e) => e.stopPropagation()}
        >
          {d ? (
            <Panel
              d={d}
              depth={stack.length}
              onBack={() => setStack((s) => s.slice(0, -1))}
              onDrill={(rid) => setStack((s) => [...s, rid])}
            />
          ) : (
            <div className="px-3 py-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
              NO DERIVATION ON FILE FOR THIS FIGURE
            </div>
          )}
          {pinned && (
            <div
              className="px-3 py-1 border-t text-[9px] uppercase tracking-[0.14em] sticky bottom-0"
              style={{ borderColor: C.line, background: C.strip, color: C.faint, fontFamily: FONT.mono }}
            >
              PINNED · ESC TO DISMISS
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
