import { C, FONT, microLabel } from "../theme";
import { Derive } from "./ui/Derive";
import type { DeriveCtx } from "../lib/derive";
import type { SubjectDepth } from "../types";

/**
 * THE ORDER BOOK — the year level as a depth ladder.
 *
 * Every rung is a mark band; the number beside it is how many of the year
 * level are estimated to sit there. Above your mark they are ASKS (students
 * still ahead of you), below they are BIDS (students you are ahead of), and
 * your own mark is the TOUCH. The dimmer inner bar is your own class, drawn
 * as a distribution rather than a hard slice — loose streaming genuinely
 * spills a class across levels.
 *
 * This is the panel that makes the difference visible: a placement tells you
 * where you sit among 36, the ladder tells you where those 36 sit.
 */

const SIDE = { ask: C.down, bid: C.up, touch: C.amber } as const;

export function DepthLadder({
  depth,
  color,
  deriveCtx,
}: {
  depth: SubjectDepth;
  color: string;
  /** Omitted in isolation (tests, previews): the ladder just goes unannotated. */
  deriveCtx?: DeriveCtx;
}) {
  const { ladder, latest, streamIndex, streamsPerLevel } = depth;
  const peak = Math.max(...ladder.map((l) => l.count), 1);
  const ahead = ladder.filter((l) => l.side === "ask").reduce((a, l) => a + l.count, 0);
  const behind = ladder.filter((l) => l.side === "bid").reduce((a, l) => a + l.count, 0);
  const total = ladder.reduce((a, l) => a + l.count, 0);

  const fmt = (n: number) => (n < 1 && n > 0 ? "<1" : Math.round(n).toString());
  const band = (lo: number, hi: number, openLo: boolean, openHi: boolean) =>
    openHi ? `${lo}+` : openLo ? `<${hi}` : `${lo}–${hi}`;
  /* A plain call, not a nested component — a component defined in render would
     remount its subtree on every keystroke elsewhere in the drawer. */
  const derive = (id: string, node: React.ReactNode) =>
    deriveCtx ? <Derive id={id} ctx={deriveCtx}>{node}</Derive> : node;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div>
          {derive(
            "depth.ladder",
            <div className="text-2xl font-bold leading-none" style={{ fontFamily: FONT.mono, color: C.text }}>
              #{latest.fieldRank}
              <span className="text-sm" style={{ color: C.faint }}> / {total.toFixed(0)}</span>
            </div>,
          )}
          <div className="mt-1" style={{ ...microLabel, color: C.faint }}>
            ESTIMATED PLACE IN THE YEAR LEVEL
          </div>
        </div>
        <div className="text-right">
          {derive(
            "depth.field",
            <div className="text-2xl font-bold leading-none" style={{ fontFamily: FONT.mono, color: latest.fieldPct >= 50 ? C.up : C.down }}>
              {latest.fieldPct.toFixed(0)}
              <span className="text-sm" style={{ color: C.faint }}>%ILE</span>
            </div>,
          )}
          <div className="mt-1" style={{ ...microLabel, color: C.faint }}>
            {derive("depth.classz", <>CLASS SAYS {latest.classPct.toFixed(0)} · #{latest.rank}/{latest.cohortN}</>)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 mb-2 text-center">
        {[
          { l: "AHEAD OF YOU", v: fmt(ahead), c: C.down },
          // Marked with a % so it does not read as a third head count.
          { l: "YOUR MARK", v: `${latest.score.toFixed(0)}%`, c: C.amber },
          { l: "BEHIND YOU", v: fmt(behind), c: C.up },
        ].map((x) => (
          <div key={x.l} className="border px-1.5 py-1" style={{ background: C.panel2, borderColor: C.line }}>
            <div className="text-sm font-bold leading-none" style={{ fontFamily: FONT.mono, color: x.c }}>{x.v}</div>
            <div className="mt-1" style={{ ...microLabel, fontSize: 9, color: C.faint }}>{x.l}</div>
          </div>
        ))}
      </div>

      <table className="w-full border-collapse" style={{ fontFamily: FONT.mono }}>
        <caption className="sr-only">
          Estimated distribution of the year level by mark, with your position marked
        </caption>
        <thead>
          <tr style={{ ...microLabel, color: C.faint }}>
            <th scope="col" className="text-left font-bold py-1">MARK</th>
            <th scope="col" className="text-right font-bold py-1">HEADS</th>
            <th scope="col" className="text-left font-bold py-1 pl-2">DEPTH</th>
          </tr>
        </thead>
        <tbody>
          {ladder.map((l) => {
            const on = l.side === "touch";
            return (
              <tr
                key={l.lo}
                style={{
                  background: on ? "rgba(232,163,61,0.12)" : undefined,
                  outline: on ? `1px solid ${C.amber}` : undefined,
                }}
              >
                <th
                  scope="row"
                  className="text-left text-[10px] font-bold py-[3px] whitespace-nowrap"
                  style={{ color: on ? C.amber : C.dim }}
                >
                  {on && <span aria-hidden="true">▸ </span>}
                  {band(l.lo, l.hi, l.openLo, l.openHi)}
                </th>
                <td className="text-right text-[10px] font-bold py-[3px] pr-1 tabular-nums" style={{ color: on ? C.amber : C.faint }}>
                  {fmt(l.count)}
                </td>
                <td className="py-[3px] pl-2 w-full">
                  <div className="relative h-2.5" style={{ background: C.panel2 }}>
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{ width: `${(l.count / peak) * 100}%`, background: SIDE[l.side], opacity: on ? 0.9 : 0.5 }}
                    />
                    {/* Your own class, riding inside the field bar. */}
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{ width: `${(l.classCount / peak) * 100}%`, background: color, opacity: 0.85 }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-2 pt-2 border-t text-[10px] uppercase tracking-wider leading-relaxed" style={{ borderColor: C.line, fontFamily: FONT.mono, color: C.faint }}>
        <span className="inline-block w-2 h-2 align-middle mr-1" style={{ background: color }} />
        YOUR CLASS OF {latest.cohortN}
        {streamIndex != null && derive("depth.sigma", <> · STREAM {streamIndex} OF {streamsPerLevel}</>)}
        {" · "}
        {derive(
          "depth.premium",
          <>
            CLASS SITS{" "}
            <span style={{ color: latest.premium + latest.basis >= 0 ? C.up : C.down }}>
              {latest.premium + latest.basis >= 0 ? "+" : ""}{(latest.premium + latest.basis).toFixed(1)}
            </span>{" "}
            PTS VS THE YEAR MEAN OF {latest.yearAvg.toFixed(0)}
          </>,
        )}
      </div>
    </div>
  );
}
