import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseImport } from "../../io";
import { compareFolds } from "./compare";
import { evaluateBook } from "./index";
import { baselineFolds, foldsOf, snapshotOf } from "./snapshot";
import type { AppData } from "../../../types";

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

describe("foldsOf", () => {
  it("emits one fold per scored one-step-ahead point", () => {
    const folds = foldsOf(sb);
    expect(folds.length).toBe(sb.book.n);
  });

  it("keys each fold deterministically on subject, target date and print id", () => {
    const folds = foldsOf(sb);
    for (const f of folds) {
      expect(f.key).toMatch(/^[^|]+\|\d{4}-\d{2}-\d{2}\|[^|]+$/);
      expect(f.key.startsWith(f.cluster + "|")).toBe(true);
    }
  });

  it("emits unique keys", () => {
    // The regression this key exists for: the fixture has 24 days on which a
    // desk both sits an exam and hands in coursework, so a (subject, date) key
    // collapses 56 folds into 38 and the paired comparison silently differences
    // half the book against the wrong partner.
    const folds = foldsOf(sb);
    expect(new Set(folds.map((f) => f.key)).size).toBe(folds.length);
  });

  it("clusters by subject", () => {
    const folds = foldsOf(sb);
    expect(new Set(folds.map((f) => f.cluster)).size).toBe(sb.book.subjects.length);
  });
});

describe("snapshotOf", () => {
  it("round-trips through JSON without losing precision that matters", () => {
    const snap = snapshotOf(sb, "test");
    const again = JSON.parse(JSON.stringify(snap));
    expect(baselineFolds(again)).toEqual(foldsOf(sb));
  });

  it("carries the aggregate metrics the gate reads", () => {
    const snap = snapshotOf(sb, "test");
    expect(snap.aggregate.n).toBe(sb.book.n);
    expect(snap.aggregate.meanSkill).toBeCloseTo(sb.mean.skill, 4);
    expect(snap.aggregate.meanCover90).toBeCloseTo(sb.mean.cover90, 4);
    expect(snap.aggregate.mdeBound).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(snapshotOf(sb, "x")).toEqual(snapshotOf(sb, "x"));
  });
});

describe("the committed baseline", () => {
  it("pairs completely against a fresh run of the same engine", () => {
    const committed = JSON.parse(
      readFileSync(fileURLToPath(new URL("./__snapshots__/baseline.json", import.meta.url)), "utf8"),
    );
    const r = compareFolds(baselineFolds(committed), foldsOf(sb));
    expect(r.unmatchedBase).toEqual([]);
    expect(r.unmatchedNext).toEqual([]);
    expect(r.nPaired).toBe(sb.book.n);
    // An unchanged engine against its own baseline is an exact identity.
    expect(r.meanDiff).toBeCloseTo(0, 6);
    expect(r.verdict).toBe("INDISTINGUISHABLE");
  });
});
