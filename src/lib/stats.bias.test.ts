import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyBias, computeStats } from "./stats";
import { freshSettings } from "../constants";
import { IDENTITY_BIAS } from "./quant/biascal";
import type { AppData, GradeEntry, Subject } from "../types";

const subjects: Subject[] = [{ id: "s1", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: null }];
let seq = 0;
const exam = (date: string, score: number): GradeEntry => ({ id: `e${seq++}`, subjectId: "s1", date, type: "Exam", score, title: "Exam" });
const entries = ["2025-04-01", "2025-08-01", "2025-11-01", "2026-04-01"].map((d, i) => exam(d, 70 + i));
const settings = freshSettings();
const TODAY = "2026-06-01";

describe("computeStats bias seam", () => {
  it("the identity model leaves the forecast exactly as the un-biased engine", () => {
    const plain = computeStats(subjects, entries, settings, TODAY);
    const identity = computeStats(subjects, entries, settings, TODAY, IDENTITY_BIAS);
    expect(identity).toEqual(plain);
  });

  it("a positive (optimism) offset lowers the next-exam forecast", () => {
    const plain = computeStats(subjects, entries, settings, TODAY);
    const corrected = computeStats(subjects, entries, settings, TODAY, {
      global: 4, bySubject: {}, widthScale: 1, n: 5, nBySubject: {},
    });
    const before = plain[0].quant!.nextExam.mean;
    const after = corrected[0].quant!.nextExam.mean;
    expect(after).toBeCloseTo(before - 4, 6);
  });

  it("a widthScale > 1 widens the next-exam band", () => {
    const plain = computeStats(subjects, entries, settings, TODAY);
    const widened = computeStats(subjects, entries, settings, TODAY, {
      global: 0, bySubject: {}, widthScale: 1.5, n: 5, nBySubject: {},
    });
    const w0 = plain[0].quant!.nextExam.ci90;
    const w1 = widened[0].quant!.nextExam.ci90;
    expect(w1.hi - w1.lo).toBeGreaterThan(w0.hi - w0.lo);
  });
});

/**
 * THE CORRECTION IS A POST-PROCESS, AND THE BOARD MUST ONLY BE PRICED ONCE.
 *
 * Nothing upstream of the final map reads the bias model: it shifts and rescales
 * `quant.nextExam` after the price, the mark, the leave-one-out rewind and the
 * ratings have all been computed. The shell needs BOTH boards — the uncorrected
 * one the register scores against, and the corrected one the user sees — and
 * pricing the book twice to get them costs a second full sweep of the engine on
 * every single edit.
 *
 * So the correction is exposed on its own, and this is the lock that keeps the
 * two paths honest: correcting an already-priced board must be byte-identical to
 * having priced it with the bias in the first place. If that ever stops holding,
 * something upstream has started reading the bias and the shell's cheap path is
 * quietly wrong.
 */
const raw = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/book.json", import.meta.url)), "utf8"),
) as { data: Pick<AppData, "subjects" | "entries"> & { settings: Partial<AppData["settings"]> } };
const bookSettings = { ...freshSettings(), ...raw.data.settings };
const BOOK_TODAY = "2026-07-22";

describe("applyBias — the correction as a standalone post-process", () => {
  const board = () => computeStats(raw.data.subjects, raw.data.entries, bookSettings, BOOK_TODAY);

  it("is the identity on an empty register, and does not copy the rows", () => {
    const plain = board();
    expect(applyBias(plain, IDENTITY_BIAS)).toBe(plain);
  });

  it("matches a full recompute on the real book — global offset", () => {
    const bias = { global: 3.4, bySubject: {}, widthScale: 1.25, n: 11, nBySubject: {} };
    expect(applyBias(board(), bias)).toEqual(
      computeStats(raw.data.subjects, raw.data.entries, bookSettings, BOOK_TODAY, bias),
    );
  });

  it("matches a full recompute on the real book — per-desk offsets over the global", () => {
    // Two desks carry their own offset, the rest fall back to the global one, and
    // one of the per-desk entries is 0 — which must be USED, not treated as absent.
    const ids = raw.data.subjects.map((s) => s.id);
    const bias = {
      global: -2.1,
      bySubject: { [ids[0]]: 5.5, [ids[1]]: 0 },
      widthScale: 0.8,
      n: 20,
      nBySubject: { [ids[0]]: 6, [ids[1]]: 4 },
    };
    expect(applyBias(board(), bias)).toEqual(
      computeStats(raw.data.subjects, raw.data.entries, bookSettings, BOOK_TODAY, bias),
    );
  });

  it("leaves the board it was given untouched", () => {
    const plain = board();
    const snapshot = structuredClone(plain);
    applyBias(plain, { global: 7, bySubject: {}, widthScale: 2, n: 9, nBySubject: {} });
    expect(plain).toEqual(snapshot);
  });
});
