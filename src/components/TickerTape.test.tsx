import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TickerTape, tapeCopies } from "./TickerTape";

/**
 * A tape that stands still is not a tape. Two failures were folded together
 * here: the wrap distance assumed one run of quotes was always wider than the
 * viewport (it is not, on a short book), and the closing bell froze the belt
 * outright rather than just dimming it.
 */
describe("tapeCopies", () => {
  it("repeats a short run until it covers the viewport, plus one for the wrap", () => {
    expect(tapeCopies(200, 1400)).toBe(8);
    expect(tapeCopies(500, 1400)).toBe(4);
  });

  it("never drops below the two runs the seamless wrap needs", () => {
    expect(tapeCopies(4000, 1400)).toBe(2);
    expect(tapeCopies(1400, 1400)).toBe(2);
  });

  it("falls back to two runs before anything has been measured", () => {
    expect(tapeCopies(0, 0)).toBe(2);
    expect(tapeCopies(Number.NaN, 1400)).toBe(2);
  });
});

describe("TickerTape after the closing bell", () => {
  const html = renderToStaticMarkup(
    <TickerTape stats={[]} agg={null} forecast={null} composite={null} depth={null} phase="closed" />,
  );

  it("keeps the belt running", () => {
    expect(html).not.toContain("gx-tape-paused");
  });

  it("still says the desk is shut", () => {
    expect(html).toContain("MKT CLOSED");
  });
});
