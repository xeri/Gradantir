import { C, FONT } from "../../theme";
import type { Regime } from "../../types";

/** Regime colors ride the gain/loss axis: par is green, distress is red. */
export const REGIME_COLOR: Record<Regime, string> = {
  PRIME: C.up,
  STABLE: C.dim,
  STRESSED: C.amber,
  DISTRESSED: C.down,
};

/** The risk desk's stamp: outlined like the sell-side chip, never louder. */
export function RegimeTag({ regime, size = "sm" }: { regime: Regime; size?: "sm" | "lg" }) {
  const color = REGIME_COLOR[regime];
  return (
    <span
      className={`inline-block border font-bold whitespace-nowrap ${size === "lg" ? "px-2 py-1 text-[11px] tracking-[0.16em]" : "px-1.5 py-0.5 text-[9px] tracking-[0.12em]"}`}
      style={{ fontFamily: FONT.mono, color, borderColor: color, background: `${color}14` }}
    >
      {regime}
    </span>
  );
}
