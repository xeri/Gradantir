import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelPanel } from "./ChannelPanel";
import { NO_CHANNEL_FIT, type SignalChannelFit } from "../../lib/quant/signals/channels";

/**
 * §2.5 of the prediction-math audit — the deliverable that makes the layer act
 * rather than assert. A student can read which of their own logging habits
 * actually predicts, which is the only honest basis for asking them to keep
 * logging it.
 *
 * A pure window onto `fitSignalChannels`' rows, so what this suite defends is
 * that the panel reports the fit's own numbers and says UNMEASURED where the
 * fit says UNMEASURED — never printing a fitted-looking multiplier for a
 * channel nobody measured.
 */

const MEASURED: SignalChannelFit = {
  ...NO_CHANNEL_FIT,
  rounds: 8,
  weights: { ...NO_CHANNEL_FIT.weights, mastery: 1.8, rest: 0.3 },
  rows: NO_CHANNEL_FIT.rows.map((r) =>
    r.key === "mastery"
      ? { ...r, n: 8, raw: 1.9, normalised: 1.9, a: 1.8, dCrps: 0.42, verdict: "CARRIES" as const }
      : r.key === "rest"
        ? { ...r, n: 6, raw: 0.3, normalised: 0.3, a: 0.3, dCrps: -0.05, verdict: "COSTS" as const }
        : r,
  ),
};

const countOf = (html: string, needle: string) => html.split(needle).length - 1;
/** The rows only — the footer copy quotes ×1.00 and ×EARNED in prose. */
const tableOf = (html: string) => html.slice(0, html.indexOf("</table>"));

describe("ChannelPanel", () => {
  it("says nothing has been measured on an unscored book", () => {
    const html = renderToStaticMarkup(<ChannelPanel fit={NO_CHANNEL_FIT} />);
    expect(countOf(tableOf(html), "UNMEASURED")).toBe(7);
    expect(html).toContain("NO ROUND HAS SCORED A LIVE SIGNAL READ YET");
    // Every channel is named, so a student can see which ones exist at all.
    for (const label of ["STUDY STOCK", "TOPIC MASTERY", "REST", "DISRUPTION", "ANXIETY", "CHRONOTYPE", "ATTENDANCE"]) {
      expect(html, label).toContain(label);
    }
  });

  it("prints the multiplier, the round count, the drop cost and the verdict", () => {
    const html = renderToStaticMarkup(<ChannelPanel fit={MEASURED} />);
    expect(html).toContain("×1.80");
    expect(html).toContain("×0.30");
    expect(html).toContain("CARRIES");
    expect(html).toContain("COSTS");
    expect(html).toContain("+0.42");
    expect(html).toContain("-0.05");
  });

  it("shows an unmeasured channel at the authored prior, never a fitted-looking number", () => {
    const rows = tableOf(renderToStaticMarkup(<ChannelPanel fit={MEASURED} />));
    // The five channels with no record all read ×1.00 with an em-dash cost.
    expect(countOf(rows, "×1.00")).toBe(5);
    expect(countOf(rows, "UNMEASURED")).toBe(5);
    expect(countOf(rows, "—")).toBe(5);
  });

  it("states that ×EARNED is relative, because it is", () => {
    const html = renderToStaticMarkup(<ChannelPanel fit={MEASURED} />);
    expect(html).toContain("RELATIVE, NOT ABSOLUTE");
    expect(html).toContain("NORMALISED TO AVERAGE 1");
  });

  it("states the chronotype limit rather than leaving it to be found", () => {
    const html = renderToStaticMarkup(<ChannelPanel fit={NO_CHANNEL_FIT} />);
    expect(html).toContain("CHRONOTYPE CANNOT BE MEASURED FROM THIS BOOK");
  });
});
