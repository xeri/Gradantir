import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Derive } from "./Derive";
import { Tex } from "./Tex";
import { parseImport } from "../../lib/io";
import { computeStats } from "../../lib/stats";
import type { DeriveCtx } from "../../lib/derive";

/**
 * The trigger, rendered without a DOM. Everything interactive lives behind
 * pointer and focus handlers that need a browser, but three things must hold
 * in plain markup: the children survive, the trigger is reachable, and the
 * panel does NOT render until it is opened — a closed derivation must cost
 * nothing on a board with a hundred of them.
 */

const raw = readFileSync(fileURLToPath(new URL("../../lib/__fixtures__/book.json", import.meta.url)), "utf8");
const parsed = parseImport(raw);
if (!parsed.ok) throw new Error("real book failed to parse");
const { subjects, entries, settings } = parsed.payload;
// Whole book in, live desks out — filtering first would sever ECON/BUS's tape.
const stats = computeStats(subjects, entries, settings!, "2026-07-21").filter((s) => !s.sub.archived);
const ctx: DeriveCtx = { stat: stats[0], stats, settings: settings! };

describe("Derive", () => {
  it("renders its children untouched", () => {
    const html = renderToStaticMarkup(<Derive id="mark.price" ctx={ctx}>70.3</Derive>);
    expect(html).toContain("70.3");
    expect(html).toContain("gx-derive");
  });

  it("does not render the panel until it is opened", () => {
    const html = renderToStaticMarkup(<Derive id="mark.price" ctx={ctx}>70.3</Derive>);
    expect(html).not.toContain("REFERENCES");
    expect(html).not.toContain("role=\"tooltip\"");
    expect(html).not.toContain("aria-describedby");
  });

  it("is keyboard-reachable by default, and inert inside an interactive ancestor", () => {
    const active = renderToStaticMarkup(<Derive id="mark.price" ctx={ctx}>70.3</Derive>);
    expect(active).toContain('tabindex="0"');
    expect(active).toContain('role="button"');
    // Passive: a bare span, so the parent <button>/<tr> keeps the click.
    const passive = renderToStaticMarkup(<Derive id="mark.price" ctx={ctx} passive>70.3</Derive>);
    expect(passive).not.toContain("tabindex");
    expect(passive).not.toContain('role="button"');
  });

  it("accepts an unknown id without throwing", () => {
    expect(() => renderToStaticMarkup(<Derive id="nope.missing" ctx={ctx}>x</Derive>)).not.toThrow();
  });

  it("emits no NaN or undefined into the markup", () => {
    for (const s of stats) {
      const html = renderToStaticMarkup(<Derive id="mark.discount" ctx={{ ...ctx, stat: s }}>{s.quant!.discount.toFixed(1)}</Derive>);
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("undefined");
    }
  });
});

describe("Tex", () => {
  it("falls back to its own LaTeX source before the engine loads", () => {
    // Server-side there is no dynamic import, so the raw notation must show
    // rather than a blank space where an equation should be.
    const html = renderToStaticMarkup(<Tex tex="\\mathcal{D} = C\\tanh(x)" display />);
    expect(html).toContain("tanh");
    expect(html).toContain("gx-tex-src");
  });
});
