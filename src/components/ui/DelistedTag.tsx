import { C, FONT } from "../../theme";
import { shortDateY } from "../../lib/utils";

/**
 * The delisting stamp. A closed desk is greyed out of the live palette
 * entirely — no amber, no gain/loss color — so a board carrying delisted rows
 * reads at a glance as "these are not trading".
 */
export function DelistedTag({ closedAt, size = "sm" }: { closedAt?: string | null; size?: "sm" | "lg" }) {
  return (
    <span
      className={`inline-block border font-bold whitespace-nowrap ${size === "lg" ? "px-2 py-1 text-[11px] tracking-[0.16em]" : "px-1.5 py-0.5 text-[9px] tracking-[0.12em]"}`}
      style={{ fontFamily: FONT.mono, color: C.faint, borderColor: C.lineBright, background: `${C.faint}12` }}
      title={closedAt ? `Closed ${shortDateY(closedAt)} — still counted in history` : undefined}
    >
      DELISTED{closedAt ? ` ${shortDateY(closedAt)}` : ""}
    </span>
  );
}

/** Row/card treatment for a closed desk: dimmed, desaturated, non-shouting. */
/* Delisting is signalled by the strike-through and the DELISTED tag, not by
   dimming the numbers into illegibility. At opacity 0.55 + saturate(0.35) the
   tag itself composited to 1.8:1 and the row ticker to 2.2:1 — a closed desk
   still carries real results, and a review of your own book was the one thing
   you could not actually read. This keeps it visibly quieter without going
   under the floor. */
export const DELISTED_STYLE = { opacity: 0.82, filter: "saturate(0.6)" } as const;
