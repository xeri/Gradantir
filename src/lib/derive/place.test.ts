import { describe, expect, it } from "vitest";
import { placePopover, type Rect, type Viewport } from "./place";

const vp: Viewport = { width: 1280, height: 800 };
const panel: Rect = { top: 0, left: 0, width: 400, height: 320 };
const anchor = (top: number, left: number): Rect => ({ top, left, width: 60, height: 18 });

describe("placePopover", () => {
  it("opens below the anchor when there is room", () => {
    const p = placePopover(anchor(100, 600), panel, vp);
    expect(p.side).toBe("below");
    expect(p.top).toBe(100 + 18 + 8);
    expect(p.maxHeight).toBe(320);
  });

  it("flips above when the anchor sits near the bottom", () => {
    const p = placePopover(anchor(740, 600), panel, vp);
    expect(p.side).toBe("above");
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(740 - 8);
  });

  it("stays below when below is the roomier side, even if it must scroll", () => {
    // Anchor at the very top: 'above' has almost nothing, 'below' has plenty.
    const p = placePopover(anchor(4, 600), panel, vp);
    expect(p.side).toBe("below");
  });

  it("centres on the anchor", () => {
    const p = placePopover(anchor(100, 600), panel, vp);
    expect(p.left).toBe(600 + 30 - 200);
  });

  it("clamps at both viewport edges", () => {
    expect(placePopover(anchor(100, 2), panel, vp).left).toBe(8);
    expect(placePopover(anchor(100, 1270), panel, vp).left).toBe(1280 - 400 - 8);
  });

  it("pins left when the panel is wider than the viewport", () => {
    const narrow: Viewport = { width: 360, height: 800 };
    expect(placePopover(anchor(100, 180), panel, narrow).left).toBe(8);
  });

  it("caps the height to the room available and never goes negative", () => {
    const tall: Rect = { top: 0, left: 0, width: 400, height: 2000 };
    for (const top of [0, 200, 400, 600, 799]) {
      const p = placePopover(anchor(top, 600), tall, vp);
      expect(p.maxHeight).toBeGreaterThan(0);
      expect(p.top).toBeGreaterThanOrEqual(8);
    }
  });

  it("never places a panel that starts off the top of the screen", () => {
    const tall: Rect = { top: 0, left: 0, width: 400, height: 900 };
    const p = placePopover(anchor(790, 600), tall, vp);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });
});
