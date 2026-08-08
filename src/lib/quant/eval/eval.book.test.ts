import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseImport } from "../../io";
import { evaluateBook } from "./index";
import { compareFolds, mdeBound } from "./compare";
import { baselineFolds, foldsOf, type BaselineSnapshot } from "./snapshot";
import baseline from "./__snapshots__/baseline.json";
import history from "./__snapshots__/history.json";
import type { AppData } from "../../../types";

/**
 * The skill scoreboard on the committed fixture — the engine graded against
 * itself. These assertions reproduce the forecasting post-mortem's own verdict
 * on this engine and pin it, so a core recalibration cannot quietly regress the
 * one number that matters (out-of-sample skill) without the build failing. Most
 * are behavioural bounds, not brittle floats; the baseline gate is the one hard
 * regression guard. See README §26 for the per-change loop.
 */

const TODAY = "2026-07-21";
const raw = readFileSync(fileURLToPath(new URL("../../__fixtures__/book.json", import.meta.url)), "utf8");
const parsed = parseImport(raw);
if (!parsed.ok) throw new Error("fixture failed to parse");
const data: AppData = {
  subjects: parsed.payload.subjects,
  entries: parsed.payload.entries,
  settings: parsed.payload.settings!,
  sample: false,
};
const sb = evaluateBook(data, TODAY);

describe("skill scoreboard — the engine's verdict on itself", () => {
  it("is fully deterministic", () => {
    expect(evaluateBook(data, TODAY)).toEqual(sb);
  });

  it("has only a modest per-subject edge over the random-walk naive", () => {
    // The post-mortem: MAE ~11.8 vs naive ~14.3 — real but unimpressive.
    expect(sb.book.skill).toBeGreaterThan(0);
    expect(sb.book.skill).toBeLessThan(0.6);
  });

  it("is optimistically biased — it over-predicts on average", () => {
    // "Every version of the model was optimistic" — the single most correctable defect.
    expect(sb.book.bias).toBeGreaterThan(0.5);
  });

  it("is overconfident: realized 90% coverage falls short of 0.90", () => {
    // "3 of 6 inside an 80% interval" — the bands are still too tight, but the
    // CRPS-tuned dispersion markup (C4) has pulled coverage up out of the 0.70s:
    // widening lowers CRPS on the walk-forward, so the undercoverage was real.
    expect(sb.book.cover90).toBeLessThan(0.9);
    expect(sb.book.cover90).toBeGreaterThan(0.82);
  });

  it("forecasts the all-subject MEAN better than the components", () => {
    // The structural finding: the mean is the forecastable object; per-subject
    // movement is near-irreducible noise.
    expect(sb.mean.mae).toBeLessThan(sb.book.mae);
    // …and a plain level model on the mean is itself hard to beat.
    expect(sb.mean.naiveMae).toBeLessThan(sb.book.mae);
  });

  it("the shrunk-mean member earns its place; a chaser is dead weight", () => {
    const byKey = new Map(sb.members.map((m) => [m.key, m]));
    expect(byKey.get("shrunk")!.verdict).toBe("keep");
    // At least one member is actively costing skill (ablation delta < 0).
    expect(sb.members.some((m) => m.delta < 0)).toBe(true);
  });

  it("does not regress against the committed baseline, on a paired cluster bootstrap", () => {
    // The merge gate. Pairs fold-for-fold against the committed per-fold
    // vector and resamples SUBJECTS, because folds within a subject share a
    // tape and are not independent. A change may ship on IMPROVED or on
    // INDISTINGUISHABLE-with-a-stated-reason; REGRESSED reverts.
    const r = compareFolds(baselineFolds(baseline as BaselineSnapshot), foldsOf(sb));
    expect(r.unmatchedBase).toEqual([]);
    expect(r.unmatchedNext).toEqual([]);
    expect(r.verdict).not.toBe("REGRESSED");
  });

  it("has not walked downhill across baseline regenerations", () => {
    // A sequence of individually-defensible INDISTINGUISHABLE steps can drift
    // down. The floor is the BEST historical skill, not the previous one.
    const best = history.reduce((a, h) => Math.max(a, h.perSubjectSkill), -Infinity);
    expect(sb.book.skill).toBeGreaterThan(best - 0.05);
  });

  it("reports what it cannot detect", () => {
    // Not an assertion about quality — an assertion that the harness states
    // its own resolution. A gate that cannot say how small an effect it would
    // miss is a gate nobody can calibrate their expectations against.
    const mde = mdeBound(foldsOf(sb));
    expect(mde).toBeGreaterThan(0);
    expect(mde).toBeLessThan(baseline.aggregate.mdeBound + 0.5);
  });

  it("is honest that the aggregate currently loses to its own naive", () => {
    // README §26 calls the all-subject mean the forecastable object. It is —
    // relative to the components. It is NOT relative to carrying last round
    // forward, and that is a defect, not a footnote. Phase C's reconciliation
    // is the fix; this assertion flips in the same commit.
    expect(sb.mean.skill).toBeLessThan(0);
  });
});
