import { useEffect, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { useEscapeLayer } from "../../lib/escapeStack";

/* ── axis furniture ──────────────────────────────────────────────────────── */

export const tickStyle = { fontSize: 11, fontFamily: FONT.mono, fill: C.faint } as const;
export const tickStyleSm = { fontSize: 10, fontFamily: FONT.mono, fill: C.faint } as const;

const axisLabelStyle = {
  fontSize: 9,
  fontFamily: FONT.mono,
  fill: C.faint,
  fontWeight: 700,
  letterSpacing: "0.18em",
} as const;

export const yLabel = (value: string) => ({
  value,
  angle: -90,
  position: "insideLeft" as const,
  offset: 10,
  style: axisLabelStyle,
});

export const xLabel = (value: string) => ({
  value,
  position: "insideBottom" as const,
  offset: -2,
  style: axisLabelStyle,
});

/** Ticks every 5 or 10 depending on how much of the scale is showing. */
export function scoreTicks(lo: number, hi: number): number[] {
  const step = hi - lo > 45 ? 10 : 5;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

/** Snap a domain out to round numbers with breathing room, capped at 0–100. */
export function scoreDomain(values: number[], full: boolean): [number, number] {
  if (full || values.length === 0) return [0, 100];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return [Math.max(0, Math.floor((lo - 4) / 5) * 5), Math.min(100, Math.ceil((hi + 4) / 5) * 5)];
}

export const gridProps = { stroke: C.line, strokeDasharray: "1 4" } as const;

export const crosshair = { stroke: C.lineBright, strokeWidth: 1, strokeDasharray: "4 4" } as const;

/* ── the frame ───────────────────────────────────────────────────────────── */

export type ChartSize = "m" | "l" | "xl";

const SIZES: ChartSize[] = ["m", "l", "xl"];
const RATIO: Record<ChartSize, number> = { m: 0.44, l: 0.6, xl: 0.78 };
const MINH: Record<ChartSize, number> = { m: 320, l: 430, xl: 560 };
const MAXH: Record<ChartSize, number> = { m: 480, l: 680, xl: 940 };

function useViewportHeight(): number {
  const [vh, setVh] = useState(() => (typeof window === "undefined" ? 900 : window.innerHeight));
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vh;
}

/**
 * Panel that owns a chart's plot height. The reader picks M/L/XL, or blows the
 * board up to fill the window — the render callback gets the pixels to fill.
 * `reserve` is chrome inside the plot area (a volume sub-chart, a brush) that
 * should shrink with the frame rather than push it taller.
 */
export function ChartFrame({
  title,
  controls,
  toolbar,
  legend,
  footnote,
  reserve = 0,
  defaultSize = "l",
  children,
}: {
  title: string;
  controls?: ReactNode;
  toolbar?: ReactNode;
  legend?: ReactNode;
  footnote?: ReactNode;
  reserve?: number;
  defaultSize?: ChartSize;
  children: (height: number) => ReactNode;
}) {
  const [size, setSize] = useState<ChartSize>(defaultSize);
  const [full, setFull] = useState(false);
  const vh = useViewportHeight();

  useEscapeLayer(() => setFull(false), full);

  useEffect(() => {
    if (!full) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [full]);

  const height = full
    ? Math.max(320, vh - 250 - reserve)
    : Math.round(Math.min(MAXH[size], Math.max(MINH[size], vh * RATIO[size])));

  const body = (
    <section className="border flex flex-col min-h-0" style={{ background: C.panel, borderColor: full ? C.lineBright : C.line }}>
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b shrink-0" style={{ borderColor: C.line }}>
        <h3 className="flex items-center gap-2 shrink-0" style={{ ...microLabel, color: C.amber }}>
          <span aria-hidden="true" className="w-1.5 h-1.5" style={{ background: C.amber }} />
          {title}
        </h3>
        <div className="flex items-center gap-2">
          {controls}
          {!full && (
            <div className="flex" role="group" aria-label="Chart height">
              {SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  aria-pressed={size === s}
                  title={`${s.toUpperCase()} height`}
                  className="gx-focus px-1.5 py-0.5 border -ml-px first:ml-0 text-[9px] font-bold tracking-[0.12em]"
                  style={{
                    fontFamily: FONT.mono,
                    background: size === s ? C.panel2 : "transparent",
                    color: size === s ? C.amber : C.faint,
                    borderColor: size === s ? C.lineBright : C.line,
                  }}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setFull(!full)}
            aria-label={full ? "Exit full screen" : "Expand chart to full screen"}
            title={full ? "Collapse (Esc)" : "Expand"}
            className="gx-focus p-1 border"
            style={{ borderColor: C.line, color: full ? C.amber : C.faint }}
          >
            {full ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </header>

      {toolbar && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b shrink-0" style={{ borderColor: C.line }}>
          {toolbar}
        </div>
      )}
      {legend && (
        <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b shrink-0" style={{ borderColor: C.line }}>
          {legend}
        </div>
      )}

      <div className="p-2 pt-3 min-h-0">{children(height)}</div>

      {footnote && (
        <p className="text-[10px] px-3 pb-2 uppercase tracking-wider leading-relaxed shrink-0" style={{ color: C.faint, fontFamily: FONT.mono }}>
          {footnote}
        </p>
      )}
    </section>
  );

  if (!full) return body;
  /* z-40: below the drawer (45) and the modals (50). Every "open subject"
     affordance inside an expanded chart opens the drawer, and a drawer that
     mounts behind this 94%-opaque backdrop is invisible but still blocks every
     keyboard shortcut. */
  return (
    <div className="fixed inset-0 z-40 p-2 sm:p-4 overflow-y-auto" style={{ background: "rgba(5,7,10,0.94)" }} role="dialog" aria-modal="true" aria-label={title}>
      {body}
    </div>
  );
}
