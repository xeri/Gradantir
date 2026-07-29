import { describe, expect, it } from "vitest";
import type { SubjectTraits, TopicMark } from "../../../types";
import { TRAIT_SDMULT_CAP } from "./params";
import { timeErrorShareOf, traitSdMult } from "./traits";

/**
 * traitSdMult — the trait-based sd-multiplier read: a variance-only humility
 * claim. Low marking determinism (a judged essay vs formula marking) and
 * narrow sampling breadth against uneven mastery widen the forecast band —
 * they never move the point estimate. Every hand value below is computed
 * independently from the documented formula in the task brief, never by
 * re-deriving the implementation's own arithmetic.
 */

const traits = (over: Partial<SubjectTraits>): SubjectTraits => ({
  cumulativeness: 0.5,
  determinism: 0.5,
  breadth: 0.5,
  ...over,
});

const mark = (over: Partial<TopicMark>): TopicMark => ({
  id: "m-" + Math.random().toString(36).slice(2),
  entryId: "e-1",
  topicId: "t-1",
  scorePct: 80,
  ...over,
});

describe("traitSdMult — identity", () => {
  it("null traits, unevenness 0, timeErrorShare 0, belief null => exactly 1", () => {
    expect(traitSdMult(null, 0, 0, null)).toBe(1);
  });

  it("D=1, B=1 (no marker or sampling noise) => exactly 1", () => {
    expect(traitSdMult(traits({ determinism: 1, breadth: 1 }), 0, 0, null)).toBe(1);
  });
});

describe("traitSdMult — belief nudge, null traits", () => {
  it("belief 2 (low) => 1.05", () => {
    expect(traitSdMult(null, 0, 0, 2)).toBe(1.05);
  });

  it("belief 3 (not low) => 1", () => {
    expect(traitSdMult(null, 0, 0, 3)).toBe(1);
  });
});

describe("traitSdMult — determinism/breadth component hand values", () => {
  it("D=0.6, B=1, unevenness 0 => 1 + 0.2*0.4 = 1.08", () => {
    expect(traitSdMult(traits({ determinism: 0.6, breadth: 1 }), 0, 0, null)).toBe(1.08);
  });

  it("B=0.3, D=1, unevenness 0.5 => 1 + 0.15*0.7*1.5 = 1.16", () => {
    expect(traitSdMult(traits({ determinism: 1, breadth: 0.3 }), 0.5, 0, null)).toBe(1.16);
  });
});

describe("traitSdMult — time-error share boundary", () => {
  it("timeErrorShare exactly 0.25 => +0.05", () => {
    const withoutTime = traitSdMult(traits({ determinism: 1, breadth: 1 }), 0, 0, null);
    const withTime = traitSdMult(traits({ determinism: 1, breadth: 1 }), 0, 0.25, null);
    expect(withTime - withoutTime).toBeCloseTo(0.05, 5);
  });

  it("timeErrorShare 0.24 (just under) => +0", () => {
    expect(traitSdMult(traits({ determinism: 1, breadth: 1 }), 0, 0.24, null)).toBe(1);
  });
});

describe("traitSdMult — global cap", () => {
  it("full stack (D=0, B=0, unevenness 1, time 0.5, belief 1) => raw 1.6, clamped to TRAIT_SDMULT_CAP (1.4)", () => {
    const out = traitSdMult(traits({ determinism: 0, breadth: 0 }), 1, 0.5, 1);
    expect(out).toBe(TRAIT_SDMULT_CAP);
    expect(out).toBe(1.4);
  });
});

describe("traitSdMult — floor", () => {
  it("never below 1 (D=1, B=1, no nudges) => 1", () => {
    expect(traitSdMult(traits({ determinism: 1, breadth: 1 }), 0, 0, null)).toBeGreaterThanOrEqual(1);
    expect(traitSdMult(traits({ determinism: 1, breadth: 1 }), 0, 0, null)).toBe(1);
  });
});

describe("timeErrorShareOf", () => {
  it("empty marks => 0", () => {
    expect(timeErrorShareOf([])).toBe(0);
  });

  it("1 of 4 marks errorKind 'time' => 0.25", () => {
    const marks = [
      mark({ errorKind: "time" }),
      mark({ errorKind: "careless" }),
      mark({ errorKind: "conceptual" }),
      mark({ errorKind: null }),
    ];
    expect(timeErrorShareOf(marks)).toBe(0.25);
  });
});
