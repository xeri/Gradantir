import { describe, expect, it } from "vitest";
import { kalmanFilter } from "./kalman";
import { PRIOR_VAR, Q_PER_DAY } from "./params";
import type { QuantPoint } from "./types";

const pt = (x: number, y: number, type: QuantPoint["type"] = "Test"): QuantPoint => ({ x, y, type });

describe("kalmanFilter", () => {
  it("returns null with no observations", () => {
    expect(kalmanFilter([])).toBeNull();
  });
  it("n=1: posterior sits between prior and observation, tighter than the prior", () => {
    const r = kalmanFilter([pt(0, 90)], { priorMean: 70 })!;
    expect(r.last.mean).toBeGreaterThan(70);
    expect(r.last.mean).toBeLessThan(90);
    expect(r.last.var).toBeLessThan(PRIOR_VAR);
  });
  it("an Exam moves the state more than a Quiz at equal distance", () => {
    const exam = kalmanFilter([pt(0, 90, "Exam")], { priorMean: 70 })!;
    const quiz = kalmanFilter([pt(0, 90, "Quiz")], { priorMean: 70 })!;
    expect(exam.last.mean).toBeGreaterThan(quiz.last.mean);
  });
  it("a long gap between prints widens the posterior", () => {
    const near = kalmanFilter([pt(0, 75), pt(2, 75)])!;
    const far = kalmanFilter([pt(0, 75), pt(200, 75)])!;
    expect(far.last.var).toBeGreaterThan(near.last.var);
  });
  it("converges onto a constant series with ever-tighter updates", () => {
    const r = kalmanFilter([0, 7, 14, 21, 28].map((x) => pt(x, 80)))!;
    expect(r.last.mean).toBeCloseTo(80, 0);
    // every update step reduces variance vs the state it saw
    for (let i = 1; i < r.states.length; i++) {
      expect(r.states[i].var).toBeLessThan(r.states[i - 1].var + Q_PER_DAY * 7 + 1e-9);
    }
    expect(r.states[r.states.length - 1].var).toBeLessThan(r.states[0].var);
  });
  it("predictAhead grows uncertainty linearly with days", () => {
    const r = kalmanFilter([pt(0, 80), pt(7, 82)])!;
    const d10 = r.predictAhead(10);
    const d20 = r.predictAhead(20);
    expect(d10.mean).toBe(r.last.mean);
    expect(d20.var - d10.var).toBeCloseTo(10 * Q_PER_DAY, 9);
  });
  it("a less-reliable reading pulls the state less and leaves more uncertainty", () => {
    const official = kalmanFilter([{ x: 0, y: 90, type: "Test", rMult: 1 }], { priorMean: 70 })!;
    const estimated = kalmanFilter([{ x: 0, y: 90, type: "Test", rMult: 1.8 }], { priorMean: 70 })!;
    expect(estimated.last.mean).toBeLessThan(official.last.mean); // moved less toward 90
    expect(estimated.last.var).toBeGreaterThan(official.last.var); // wider posterior
  });
  it("an absent reliability multiplier is exactly the type-only observation noise", () => {
    const bare = kalmanFilter([pt(0, 90)], { priorMean: 70 })!;
    const explicit = kalmanFilter([{ x: 0, y: 90, type: "Test", rMult: 1 }], { priorMean: 70 })!;
    expect(bare.last).toEqual(explicit.last);
    expect(bare.states).toEqual(explicit.states);
  });
  it("robustly down-weights an UNCERTAIN outlier, on top of its inflated noise", () => {
    // steady at 75, then a remembered crash to 30 — a multi-σ innovation on a
    // low-reliability print. rMult already inflates R; robustness adds to that.
    const base = [pt(0, 75), pt(7, 75), pt(14, 75), pt(21, 75)];
    const tape = [...base, { x: 28, y: 30, type: "Test" as const, rMult: 1.8 }];
    const noRobust = kalmanFilter(tape, { robustC: Infinity })!; // rMult R-inflation only
    const robust = kalmanFilter(tape)!; // + robust down-weighting past the knee
    // held even higher than R-inflation alone, and with more posterior uncertainty
    expect(robust.last.mean).toBeGreaterThan(noRobust.last.mean);
    expect(robust.last.var).toBeGreaterThan(noRobust.last.var);
  });
  it("does NOT robustify an OFFICIAL outlier — a clean crash is written into the level", () => {
    // Every print official (rMult 1): the robustifier is dormant, so the filter
    // is exactly Gaussian however wild the surprise. A real bad exam is real.
    const tape = [pt(0, 75), pt(7, 75), pt(14, 75), pt(21, 75), pt(28, 30)];
    expect(kalmanFilter(tape)!.last).toEqual(kalmanFilter(tape, { robustC: Infinity })!.last);
    expect(kalmanFilter(tape)!.states).toEqual(kalmanFilter(tape, { robustC: Infinity })!.states);
  });
  it("an innovation under the Huber knee is exactly the Gaussian update, tagged or not", () => {
    const tape = [pt(0, 70), pt(7, 72), { x: 14, y: 74, type: "Test" as const, rMult: 1.8 }];
    expect(kalmanFilter(tape)!.last).toEqual(kalmanFilter(tape, { robustC: Infinity })!.last);
  });
});
