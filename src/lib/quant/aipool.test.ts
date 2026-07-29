import { describe, expect, it } from "vitest";
import {
  IDENTITY_AI_POOL, aiChargePts, fitAiWeight, jointOutsideWeights, poolBoardJoint, poolNextExamJoint,
} from "./aipool";
import { IDENTITY_POOL, fitSelfWeight, poolNextExam, type SelfWeightModel } from "./pool";
import { AI_POOL_CAP, AI_POOL_KAPPA, POOL_CEIL, SELF_POOL_CAP } from "./params";
import type { AiWeightModel } from "./aipool";
import type {
  GradeEntry, NextExamForecast, SubjectStat, Upcoming,
} from "../../types";
import type { ResolvedUpcoming } from "../upcoming";

/**
 * The wire's pool obeys the same credibility rule as the student's, on harsher
 * terms — and the three-way mixture is pinned to the shipped two-way one by
 * DELEGATION, which these tests lock so the algebra can never drift apart.
 */

const entry = (subjectId: string, date: string, score: number): GradeEntry =>
  ({ id: "e-" + subjectId + date, subjectId, date, type: "Exam", score, title: "" });

const sitting = (i: number, over: Partial<Upcoming>): Upcoming =>
  ({ id: `u${i}`, subjectId: "s1", date: `2026-03-0${(i % 9) + 1}`, type: "Exam", title: "", ...over });

/** n resolved sittings the wire called with the given signed error. */
const resolvedWithAi = (n: number, aiErr: number): ResolvedUpcoming[] =>
  Array.from({ length: n }, (_, i) => ({
    upcoming: sitting(i, { aiPred: { point: 70 + aiErr } }),
    realized: entry("s1", `2026-03-1${i % 10}`, 70),
  }));

const modelFor = (off: number) => () => ({ mean: 70 + off, scale: 6, df: 8 });

const forecast: NextExamForecast = { mean: 70, sd: 6, ci50: { lo: 66, hi: 74 }, ci90: { lo: 60, hi: 80 } };

const earned = (w: number, sd: number | null = 5): AiWeightModel =>
  ({ w, n: 4, youScore: 2, modelScore: 8, rawShare: 0.8, aiSd: sd });
const earnedSelf = (w: number, sd: number | null = 5): SelfWeightModel =>
  ({ w, n: 4, youScore: 2, modelScore: 8, rawShare: 0.8, selfSd: sd });

describe("fitAiWeight", () => {
  it("is exactly the identity when the wire never called anything", () => {
    expect(fitAiWeight([], modelFor(8))).toEqual(IDENTITY_AI_POOL);
    const noAi: ResolvedUpcoming[] = [{ upcoming: sitting(0, { selfPred: { point: 75 } }), realized: entry("s1", "2026-03-10", 70) }];
    expect(fitAiWeight(noAi, modelFor(8))).toEqual(IDENTITY_AI_POOL);
  });
  it("earns along the shrinkage curve: share · n/(n+κ)", () => {
    // The wire is perfect, the desk is off by 8 → rawShare = 1.
    for (const n of [1, 2, 4, 8]) {
      const fit = fitAiWeight(resolvedWithAi(n, 0), modelFor(8));
      expect(fit.rawShare).toBeCloseTo(1, 6);
      expect(fit.w).toBeCloseTo(Math.min((1 * n) / (n + AI_POOL_KAPPA), AI_POOL_CAP), 6);
    }
  });
  it("never exceeds its cap, which sits below the student's", () => {
    const fit = fitAiWeight(resolvedWithAi(40, 0), modelFor(20));
    expect(fit.w).toBeLessThanOrEqual(AI_POOL_CAP);
    expect(AI_POOL_CAP).toBeLessThan(SELF_POOL_CAP);
  });
  it("scores a ranged call by CRPS and a point call by location, matched", () => {
    const ranged: ResolvedUpcoming[] = [{
      upcoming: sitting(0, { aiPred: { point: 70, lo: 62, hi: 78 } }),
      realized: entry("s1", "2026-03-10", 70),
    }];
    const fit = fitAiWeight(ranged, modelFor(8));
    // A well-centred range against an off desk earns a positive share.
    expect(fit.n).toBe(1);
    expect(fit.rawShare).toBeGreaterThan(0.5);
    const point = fitAiWeight(resolvedWithAi(1, 2), modelFor(8));
    expect(point.youScore).toBeCloseTo(2, 6);
    expect(point.modelScore).toBeCloseTo(8, 6);
  });
});

describe("jointOutsideWeights", () => {
  it("leaves an under-ceiling pair untouched", () => {
    expect(jointOutsideWeights(0.3, 0.2)).toEqual({ wSelf: 0.3, wAi: 0.2 });
  });
  it("scales an overflow proportionally — relative standing preserved", () => {
    const { wSelf, wAi } = jointOutsideWeights(0.45, 0.35);
    expect(wSelf + wAi).toBeCloseTo(POOL_CEIL, 9);
    expect(wSelf).toBeCloseTo(0.3375, 6);
    expect(wAi).toBeCloseTo(0.2625, 6);
    expect(wSelf / wAi).toBeCloseTo(0.45 / 0.35, 9);
  });
});

describe("poolNextExamJoint", () => {
  it("is the desk's own forecast when neither outside channel is live", () => {
    expect(poolNextExamJoint(forecast, 8, { point: 80 }, IDENTITY_POOL, { point: 76 }, IDENTITY_AI_POOL))
      .toBe(forecast);
    expect(poolNextExamJoint(forecast, 8, null, earnedSelf(0.3), null, earned(0.2))).toBe(forecast);
  });
  it("reduces EXACTLY to poolNextExam with the wire silent — ranged and point-only", () => {
    for (const sp of [{ point: 80 }, { point: 80, lo: 72, hi: 88 }]) {
      const joint = poolNextExamJoint(forecast, 8, sp, earnedSelf(0.3), null, IDENTITY_AI_POOL);
      expect(joint).toEqual(poolNextExam(forecast, 8, sp, earnedSelf(0.3)));
    }
  });
  it("reduces EXACTLY to poolNextExam with only the wire live", () => {
    const ap = { point: 76, lo: 68, hi: 84, basis: "trend" };
    const joint = poolNextExamJoint(forecast, 8, null, IDENTITY_POOL, ap, earned(0.2));
    expect(joint).toEqual(poolNextExam(forecast, 8, ap, { ...earned(0.2), selfSd: 5 } as SelfWeightModel));
  });
  it("pools three ways under the joint ceiling when both are live", () => {
    const joint = poolNextExamJoint(
      forecast, 8, { point: 80 }, earnedSelf(0.45), { point: 76 }, earned(0.35),
    );
    // Ceilinged weights: 0.3375 you, 0.2625 wire, 0.4 desk.
    expect(joint.mean).toBeCloseTo(round(0.4 * 70 + 0.3375 * 80 + 0.2625 * 76), 1);
    expect(joint).not.toBe(forecast);
  });
  it("widens the band when the wire contradicts the pool", () => {
    const agree = poolNextExamJoint(forecast, 8, { point: 71 }, earnedSelf(0.3), { point: 70.5 }, earned(0.2));
    const fight = poolNextExamJoint(forecast, 8, { point: 71 }, earnedSelf(0.3), { point: 95 }, earned(0.2));
    expect(fight.sd).toBeGreaterThan(agree.sd);
    expect(fight.sd).toBeGreaterThan(forecast.sd);
  });
});

const round = (x: number) => Math.round(x * 10) / 10;

describe("poolBoardJoint", () => {
  const stat = (id: string): SubjectStat =>
    ({
      sub: { id, name: id, ticker: id.toUpperCase(), color: "#333333", target: null },
      entries: [],
      quant: { nextExam: forecast, df: 8 },
    }) as unknown as SubjectStat;

  const live = (over: Partial<Upcoming>): Upcoming =>
    ({ id: "u-live", subjectId: "s1", date: "2026-12-01", type: "Exam", title: "", ...over });

  it("returns the SAME array when both channels are identity", () => {
    const stats = [stat("s1")];
    const up = [live({ selfPred: { point: 80 }, aiPred: { point: 76 } })];
    expect(poolBoardJoint(stats, up, [], "2026-07-01", IDENTITY_POOL, IDENTITY_AI_POOL)).toBe(stats);
  });
  it("matches poolBoard exactly while the wire is silent (an earlier ai-only sitting is invisible)", () => {
    const stats = [stat("s1")];
    const up = [
      live({ id: "u-ai", date: "2026-10-01", aiPred: { point: 60 } }),
      live({ id: "u-self", date: "2026-12-01", selfPred: { point: 80 } }),
    ];
    const joint = poolBoardJoint(stats, up, [], "2026-07-01", earnedSelf(0.3), IDENTITY_AI_POOL);
    // The ai-only sitting must NOT nominate the desk's pooled paper while the
    // wire has no weight — the self call on the later paper still pools.
    expect(joint[0].quant!.nextExam.mean).toBeCloseTo(
      poolNextExam(forecast, 8, { point: 80 }, earnedSelf(0.3)).mean, 6,
    );
  });
  it("pools the wire alone on a desk the student never called", () => {
    const stats = [stat("s1")];
    const up = [live({ aiPred: { point: 76 } })];
    const joint = poolBoardJoint(stats, up, [], "2026-07-01", IDENTITY_POOL, earned(0.2));
    expect(joint[0].quant!.nextExam.mean).toBeGreaterThan(forecast.mean);
  });
});

describe("aiChargePts — the quoted charge is measured, never asserted", () => {
  const stat = (id: string): SubjectStat =>
    ({
      sub: { id, name: id, ticker: id.toUpperCase(), color: "#333333", target: null },
      entries: [],
      quant: { nextExam: forecast, df: 8 },
    }) as unknown as SubjectStat;

  it("is zero with the wire silent, and the marginal move with it live", () => {
    const stats = [stat("s1")];
    const up: Upcoming[] = [{ id: "u1", subjectId: "s1", date: "2026-12-01", type: "Exam", title: "", selfPred: { point: 80 }, aiPred: { point: 76 } }];
    expect(aiChargePts(stats, up, [], "2026-07-01", earnedSelf(0.3), IDENTITY_AI_POOL))
      .toEqual({ desks: 0, maxAbsMove: 0 });
    const charge = aiChargePts(stats, up, [], "2026-07-01", earnedSelf(0.3), earned(0.2));
    expect(charge.desks).toBe(1);
    expect(charge.maxAbsMove).toBeGreaterThan(0);
  });
});

describe("the sample book is untouched by the channel's existence", () => {
  it("fitSelfWeight and fitAiWeight coexist without cross-contamination", () => {
    const both: ResolvedUpcoming[] = [{
      upcoming: sitting(0, { selfPred: { point: 72 }, aiPred: { point: 68 } }),
      realized: entry("s1", "2026-03-10", 70),
    }];
    const self = fitSelfWeight(both, modelFor(8));
    const ai = fitAiWeight(both, modelFor(8));
    expect(self.n).toBe(1);
    expect(ai.n).toBe(1);
    // Each channel is scored on ITS OWN call: 2 pts and −2 pts of error.
    expect(self.youScore).toBeCloseTo(2, 6);
    expect(ai.youScore).toBeCloseTo(2, 6);
  });
});
