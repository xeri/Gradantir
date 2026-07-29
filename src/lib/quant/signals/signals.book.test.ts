import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseImport } from "../../io";
import { computeStats } from "../../stats";
import { applySignals } from "./apply";
import { emptySignalBook, signalBoard } from "./signalread";
import type { AppData } from "../../../types";

/**
 * THE FIXTURE IDENTITY PROOF.
 *
 * The committed fixture (`src/lib/__fixtures__/book.json`) has never touched
 * the life-signals feature: no topics, no sessions, no rest logs, no
 * disruptions, no profile, no traits/mix/belief on any subject. `signalRead`'s
 * own doc comment calls this out as its load-bearing invariant — every desk
 * on such a book must read back adj 0, sdMult 1. `applySignals` layered on
 * top of that board must therefore be the exact identity: the same array
 * reference the priced board already was, so a book that has never touched
 * this feature costs nothing extra and every downstream memo keeps its
 * reference (the same discipline `applyBias`/`poolBoardJoint` are held to).
 */

const TODAY = "2026-07-29";
const raw = readFileSync(fileURLToPath(new URL("../../__fixtures__/book.json", import.meta.url)), "utf8");
const parsed = parseImport(raw);
if (!parsed.ok) throw new Error("fixture failed to parse");
const data: AppData = {
  subjects: parsed.payload.subjects,
  entries: parsed.payload.entries,
  settings: parsed.payload.settings!,
  sample: false,
};

describe("applySignals — fixture identity proof", () => {
  const stats = computeStats(data.subjects, data.entries, data.settings, TODAY);
  const modelMeans = new Map(stats.map((s) => [s.sub.id, s.quant?.nextExam.mean ?? null]));
  const board = signalBoard(data.subjects, emptySignalBook, data.entries, parsed.payload.upcoming ?? [], modelMeans, TODAY);

  it("every read on the untouched fixture is the signal identity: adj 0, sdMult 1", () => {
    expect(board.size).toBe(data.subjects.length);
    for (const read of board.values()) {
      expect(read.adj).toBe(0);
      expect(read.sdMult).toBe(1);
    }
  });

  it("applySignals returns the SAME array reference — a byte-exact no-op on the committed book", () => {
    expect(applySignals(stats, board, 0.35, true)).toBe(stats);
  });
});
