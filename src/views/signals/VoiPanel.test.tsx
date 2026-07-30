import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiPanel } from "./VoiPanel";
import type { VoiItem } from "../../lib/quant/signals/voi";

/**
 * VoiPanel is a pure window onto `valueOfInformation`'s own ranked output
 * (voi.ts, T11): every `VoiItem.action` string already embeds its own
 * computed gain, so this component must render that string byte-for-byte —
 * never re-deriving, re-rounding or re-wording the gain/effort numbers baked
 * into it — and must preserve the ranker's own score-desc order rather than
 * re-sorting. The one thing this suite defends beyond "prints the string" is
 * that a book with nothing left to log (an empty `VoiItem[]`) says so in
 * terminal copy instead of rendering an empty shell.
 */

const item = (over: Partial<VoiItem> = {}): VoiItem => ({
  subjectId: null,
  ticker: null,
  domain: "rest",
  action: "LOG 5 NIGHTS OF SLEEP → TIGHTEN CI90 BY ±1.5",
  gainPts: 1.5,
  effortMin: 10,
  score: 1.125,
  ...over,
});

describe("VoiPanel — renders the ranker's own copy verbatim", () => {
  it("prints every item's ready-made action string", () => {
    const items: VoiItem[] = [
      item(),
      item({
        subjectId: "s-math",
        ticker: "MATH",
        domain: "traits",
        action: "SET SUBJECT TRAITS → TIGHTEN MATH CI90 BY ±3.28",
        gainPts: 3.28,
        effortMin: 2,
        score: 3.075,
      }),
    ];
    const html = renderToStaticMarkup(<VoiPanel items={items} />);
    expect(html).toMatch(/LOG 5 NIGHTS OF SLEEP/);
    expect(html).toMatch(/±1\.5/);
    expect(html).toMatch(/SET SUBJECT TRAITS/);
    expect(html).toMatch(/±3\.28/);
  });

  it("keeps the ranker's own score-desc order rather than re-sorting", () => {
    // Deliberately non-monotonic: the LOWER-scoring item is listed first. A
    // panel that (wrongly) re-sorted by score desc would flip this order —
    // two same-score fixtures would pass either way and miss that bug.
    const items: VoiItem[] = [
      item({ domain: "rest", action: "FIRST ITEM ACTION", score: 0.5 }),
      item({ domain: "profile", action: "SECOND ITEM ACTION", score: 3.075 }),
    ];
    const html = renderToStaticMarkup(<VoiPanel items={items} />);
    expect(html.indexOf("FIRST ITEM ACTION")).toBeLessThan(html.indexOf("SECOND ITEM ACTION"));
  });

  it("never fabricates a number the item itself did not carry", () => {
    const html = renderToStaticMarkup(<VoiPanel items={[item()]} />);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });

  it("says there is nothing left to log rather than rendering an empty shell", () => {
    const html = renderToStaticMarkup(<VoiPanel items={[]} />);
    expect(html).toMatch(/nothing (left )?to log/i);
  });
});
