import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { C, FONT } from "../../theme";
import { Toggle } from "./Toggle";
import { Derive } from "./Derive";
import type { DeriveCtx } from "../../lib/derive";

/**
 * "X PRICED INTO PREDICTIONS" — the switch, and the warning under it.
 *
 * Three cards elicit something the engine then prices: the effort spider (§15b),
 * the readiness duels (§15c) and the aggregate call (§28). Each one has an
 * obligation the rest of the interface does not: it has to say, before you touch
 * it, how hard what you are about to type will move a number you will later read
 * as though it were measured. A card that quietly prices an opinion is how a
 * student ends up trusting their own guess back at themselves.
 *
 * So the copy discipline lives in one component rather than three:
 *
 * · The switch is ABOVE the instrument, because it changes what the instrument
 *   MEANS rather than what it shows.
 * · The warning states the actual point cost in points, and goes amber when the
 *   channel is live and grey when it is not.
 * · When it is off, the banner says what the card still is — a planning aid — so
 *   turning the pricing off never makes the card look broken.
 * · `earned` quotes what the input has earned against the desk, in one figure, so
 *   the weight is never a mystery number.
 */

export interface PricedBannerProps {
  /** Whether the channel reaches the board at all. */
  on: boolean;
  onToggle: (on: boolean) => void;
  /** The switch's own label — "Effort priced into predictions". */
  label: string;
  /**
   * What this costs when it is on: the real points, in terminal-speak. Shown in
   * amber beside the alert triangle.
   */
  charge: ReactNode;
  /** What the card still does when it is off. */
  off: ReactNode;
  /**
   * Right-hand figure: what the record has earned this input. `derive` opens
   * the credibility rule behind it — the one number on these cards a reader has
   * no other way to check.
   */
  earned?: { label: string; value: string; tone?: string; derive?: { id: string; ctx: DeriveCtx } | null } | null;
  /** Extra controls on the switch row — a "clear" action, usually. */
  action?: ReactNode;
}

export function PricedBanner({ on, onToggle, label, charge, off, earned, action }: PricedBannerProps) {
  return (
    <>
      <div
        className="flex flex-wrap items-center justify-between gap-2 border px-2 py-1.5"
        style={{ borderColor: on ? C.lineBright : C.line, background: C.strip }}
      >
        <Toggle on={on} onClick={() => onToggle(!on)}>{label}</Toggle>
        <div className="flex items-center gap-3">
          {earned && (
            <span className="flex items-baseline gap-1.5" title="What your record has earned this input against the desk">
              <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
                {earned.label}
              </span>
              {(() => {
                const figure = (
                  <span className="text-sm font-bold tabular-nums" style={{ color: on ? earned.tone ?? C.accent : C.faint, fontFamily: FONT.mono }}>
                    {on ? earned.value : "OFF"}
                  </span>
                );
                return earned.derive ? <Derive id={earned.derive.id} ctx={earned.derive.ctx}>{figure}</Derive> : figure;
              })()}
            </span>
          )}
          {action}
        </div>
      </div>

      <p
        className="flex items-start gap-1.5 text-[10px] uppercase tracking-wider leading-relaxed"
        style={{ color: on ? C.amber : C.faint, fontFamily: FONT.mono }}
      >
        <TriangleAlert size={12} className="shrink-0 mt-px" />
        <span>{on ? charge : off}</span>
      </p>
    </>
  );
}
