import { describe, expect, it } from "vitest";
import { scoreMeanCall, spearman } from "./meancall";
import type { MeanCall } from "../types";

const call = (predAvg: number, ranking: string[]): MeanCall =>
  ({ id: "m1", roundKey: "2026-T2", predAvg, ranking, createdAt: "2026-05-01" });

describe("spearman", () => {
  it("is +1 for an identical order and −1 for the reverse", () => {
    expect(spearman(["a", "b", "c"], ["a", "b", "c"])).toBeCloseTo(1, 6);
    expect(spearman(["a", "b", "c"], ["c", "b", "a"])).toBeCloseTo(-1, 6);
  });
  it("is null for fewer than two shared items", () => {
    expect(spearman(["a"], ["a"])).toBeNull();
  });
});

describe("scoreMeanCall", () => {
  const realized = { s1: 80, s2: 70, s3: 60 };
  it("scores the predicted average against the realized aggregate", () => {
    const s = scoreMeanCall(call(74, ["s1", "s2", "s3"]), realized);
    expect(s.realizedAvg).toBeCloseTo(70, 6);
    expect(s.error).toBeCloseTo(4, 6);
    expect(s.absError).toBeCloseTo(4, 6);
  });
  it("scores a correctly-ordered forced ranking at +1", () => {
    expect(scoreMeanCall(call(70, ["s1", "s2", "s3"]), realized).rankCorr).toBeCloseTo(1, 6);
  });
  it("penalizes a scrambled ranking", () => {
    expect(scoreMeanCall(call(70, ["s3", "s2", "s1"]), realized).rankCorr).toBeCloseTo(-1, 6);
  });
  it("is unresolved until at least one ranked desk has a realized mark", () => {
    const s = scoreMeanCall(call(70, ["s1", "s2"]), {});
    expect(s.realizedAvg).toBeNull();
    expect(s.error).toBeNull();
    expect(s.rankCorr).toBeNull();
  });
});
