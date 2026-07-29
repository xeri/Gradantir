/**
 * Popover placement, as pure geometry.
 *
 * The panel is portalled to <body> and fixed-positioned, because the drawer
 * and the screener are their own scroll containers and an in-flow panel would
 * be clipped by both. That means the placement is ours to compute: below the
 * anchor when it fits, flipped above when it does not, always clamped inside
 * the viewport, and always told how tall it is allowed to be so a long
 * derivation scrolls internally instead of running off the screen.
 *
 * Kept out of the component so it can be tested without a DOM.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  side: "above" | "below";
  /** Hard cap for the panel; it scrolls internally past this. */
  maxHeight: number;
}

/** Gap between the anchor and the panel, px. */
const GAP = 8;
/** Keep-out margin from every viewport edge, px. */
const MARGIN = 8;
/** A panel shorter than this is not worth flipping for — it fits anywhere. */
const MIN_HEIGHT = 140;

/**
 * @param anchor  the trigger's bounding box, in viewport coordinates
 * @param panel   the panel's natural size (measured, or an estimate)
 * @param vp      the viewport
 */
export function placePopover(anchor: Rect, panel: Rect, vp: Viewport): Placement {
  const below = vp.height - (anchor.top + anchor.height) - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;

  // Prefer below — reading order. Flip only when above is genuinely roomier,
  // so a panel that fits below never jumps over the number it explains.
  const side: Placement["side"] = panel.height <= below || below >= above ? "below" : "above";
  const room = Math.max(MIN_HEIGHT, side === "below" ? below : above);
  const maxHeight = Math.min(panel.height, room);

  const top =
    side === "below"
      ? anchor.top + anchor.height + GAP
      : Math.max(MARGIN, anchor.top - GAP - maxHeight);

  // Centre on the anchor, then clamp. A panel wider than the viewport pins to
  // the left margin rather than centring off both edges.
  const wide = panel.width >= vp.width - 2 * MARGIN;
  const left = wide
    ? MARGIN
    : Math.min(
        Math.max(MARGIN, anchor.left + anchor.width / 2 - panel.width / 2),
        vp.width - panel.width - MARGIN,
      );

  return { top, left, side, maxHeight };
}
