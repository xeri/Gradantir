import { C, FONT } from "../../theme";
import type { Rating } from "../../types";

/** Consensus colors: conviction calls saturate, HOLD stays grey, N/A recedes. */
export const RATING_COLOR: Record<Rating, string> = {
  "STRONG BUY": C.up,
  BUY: "#1F9E5E",
  HOLD: C.dim,
  // #E85348, not #C43A32: badge text needs 4.5:1 (WCAG 1.4.3) and the old red
  // sat at ~3.5:1 on the panels. Still a clear step below STRONG SELL's #FF5449.
  SELL: "#E85348",
  "STRONG SELL": C.down,
  "N/A": C.faint,
};

/** Compact form for the tape and tight table cells. */
export const RATING_SHORT: Record<Rating, string> = {
  "STRONG BUY": "STR BUY",
  BUY: "BUY",
  HOLD: "HOLD",
  SELL: "SELL",
  "STRONG SELL": "STR SELL",
  "N/A": "N/A",
};

/** The sell-side chip: outlined, uppercase, never louder than the price. */
export function RatingBadge({ rating, short = false, size = "sm" }: {
  rating: Rating;
  short?: boolean;
  size?: "sm" | "lg";
}) {
  const color = RATING_COLOR[rating];
  const na = rating === "N/A";
  return (
    <span
      className={`inline-block border font-bold whitespace-nowrap ${size === "lg" ? "px-2 py-1 text-[11px] tracking-[0.16em]" : "px-1.5 py-0.5 text-[9px] tracking-[0.12em]"}`}
      style={{
        fontFamily: FONT.mono,
        color,
        borderColor: na ? C.line : color,
        background: na ? "transparent" : `${color}14`,
      }}
    >
      {short ? RATING_SHORT[rating] : rating}
    </span>
  );
}
