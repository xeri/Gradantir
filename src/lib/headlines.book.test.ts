import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildWire } from "./headlines";
import { computeStats } from "./stats";
import { freshSettings } from "../constants";
import type { AppData } from "../types";

/**
 * Calibration harness: the engine must tell the right harsh stories on a full
 * three-year tape, not just on toy inputs. The book is the committed fixture —
 * anonymised from the real export, same structure and trajectory shapes — and
 * is exam-anchored (term cadence, no targets, class averages absent), exactly
 * the regime the severity constants are tuned for.
 */
const raw = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/book.json", import.meta.url)), "utf8"),
) as { data: Pick<AppData, "subjects" | "entries"> & { settings: Partial<AppData["settings"]> } };

const TODAY = "2026-07-22";
const settings = { ...freshSettings(), ...raw.data.settings };
// Priced on the whole book, reported on the live desks: filtering the subjects
// first would drop the ancestor ECON and BUS inherit their tape from.
const stats = computeStats(raw.data.subjects, raw.data.entries, settings, TODAY)
  .filter((s) => !s.sub.archived);
const wire = buildWire(stats, null, 14, null, TODAY);

describe("buildWire on the real book", () => {
  it("stays within the cap and prices every item", () => {
    expect(wire.length).toBeGreaterThan(0);
    expect(wire.length).toBeLessThanOrEqual(14);
    for (const w of wire) expect(w.severity).toBeDefined();
  });
  it("leads with the PHYS crash — a 30-point structural break, not a dip", () => {
    expect(wire[0].tag).toBe("PHYS");
    expect(wire[0].tone).toBe("loss");
    expect(/SIGMA|STRUCTURAL/.test(wire[0].text)).toBe(true);
  });
  it("calls the April session book-wide: five of six desks red", () => {
    expect(wire.some((w) => w.tag === "BOOK" && w.text.includes("FIVE OF SIX"))).toBe(true);
  });
  it("names MATH's execution gap — capability prints high, payout prints low", () => {
    const gap = wire.find((w) => w.tag === "MATH" && w.text.includes("CONVERSION IS THE WHOLE JOB"));
    expect(gap).toBeDefined();
  });
  it("prints exactly one dark-tape macro item for the uniformly stale book", () => {
    expect(wire.filter((w) => w.text.includes("TAPE DARK"))).toHaveLength(1);
    expect(wire.some((w) => w.text.includes("FLYING BLIND"))).toBe(false);
  });
  it("never mentions archived desks", () => {
    for (const w of wire) expect(["LAT", "SPA", "GRA"]).not.toContain(w.tag);
  });
});
