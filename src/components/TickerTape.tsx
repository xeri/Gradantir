import { C, FONT } from "../theme";
import type { CompositeIndex, SubjectStat } from "../types";

/** The signature strip: composite first, then every listed ticker, on loop. */
export function TickerTape({ stats, index }: { stats: SubjectStat[]; index: CompositeIndex }) {
  const items = [
    { k: "GX COMP", v: index.value, d: index.delta },
    ...stats.filter((s) => s.latest).map((s) => ({ k: s.sub.ticker, v: s.latest!.score as number | null, d: s.tickDelta })),
  ];
  const Chunk = ({ ariaHidden }: { ariaHidden?: boolean }) => (
    <div className="flex items-center" aria-hidden={ariaHidden}>
      {items.map((it, i) => {
        const up = (it.d ?? 0) > 0.05;
        const down = (it.d ?? 0) < -0.05;
        return (
          <span key={i} className="flex items-center gap-1.5 px-4 text-[11px]" style={{ fontFamily: FONT.mono }}>
            <span className="font-bold tracking-[0.1em]" style={{ color: i === 0 ? C.amber : C.text }}>{it.k}</span>
            <span style={{ color: C.dim }}>{it.v != null ? Number(it.v).toFixed(1) : "—"}</span>
            {it.d != null && (
              <span style={{ color: up ? C.up : down ? C.down : C.faint }}>
                {up ? "▲" : down ? "▼" : "·"} {Math.abs(it.d).toFixed(1)}
              </span>
            )}
            <span className="pl-3" style={{ color: "#1C2430" }}>│</span>
          </span>
        );
      })}
    </div>
  );
  return (
    <div className="overflow-hidden border-b" style={{ background: C.strip, borderColor: C.line }} aria-label="Latest results ticker">
      <div className="gx-tape flex py-1">
        <Chunk />
        <Chunk ariaHidden />
      </div>
    </div>
  );
}
