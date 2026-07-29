import { describe, expect, it } from "vitest";
import {
  ANX_W, CARELESS_CREDIT, CHRONO_W, DEFAULT_HALF_LIFE, DISRUPT_CAP, DISRUPT_SEV, DISRUPT_TAU,
  ENCODING_PENALTY, HALF_LIFE, MASTERY_ALPHA, MASTERY_FLOOR_FRAC, MASTERY_MIN_MARKS, MASTERY_SCALE,
  MASTERY_W, PREREQ_HEADROOM, QUALITY, REST_ACUTE_CAP, REST_ACUTE_W, REST_CHRONIC_CAP, REST_CHRONIC_W,
  REST_MIN_NIGHTS, REST_REG_W, SHORT_SLEEP_H, SIGNAL_ADJ_CAP, SPACING_RECENT, SPACING_SAME_DAY,
  SPACING_STALE, STOCK_FLOOR, STOCK_W, TRAIT_MARKER_W, TRAIT_SAMPLING_W, TRAIT_SDMULT_CAP,
  halfLifeOf,
} from "./params";
import { SELF_POOL_CAP, SIGNAL_CAP, SIGNAL_PRIOR, READINESS_PRIOR } from "../params";

/**
 * The signals package's formula constants — every knob the life-signals layer
 * turns. This suite defends the doctrine, not the exact figures: quality
 * multipliers obey the testing-effect ordering, the mix-weighted half-life
 * blends monotonically, every cap the layer can charge against is positive,
 * and the whole channel is deliberately seated below the older self/readiness
 * channels it sits beside (§27, §15c).
 */

describe("QUALITY — the testing-effect ordering", () => {
  it("every multiplier is positive", () => {
    for (const v of Object.values(QUALITY)) expect(v).toBeGreaterThan(0);
  });

  it("recall is the largest multiplier", () => {
    const max = Math.max(...Object.values(QUALITY));
    expect(QUALITY.recall).toBe(max);
  });

  it("reading trails class — passive rereading sits below the classroom baseline", () => {
    expect(QUALITY.reading).toBeLessThan(QUALITY.class);
  });
});

describe("halfLifeOf — the mix-weighted retention blend", () => {
  it("falls back to the default half-life when there is no mix", () => {
    expect(halfLifeOf(null)).toBe(DEFAULT_HALF_LIFE);
  });

  it("is exactly the knowledge half-life on an all-knowledge mix", () => {
    expect(halfLifeOf({ knowledge: 1, procedure: 0, skill: 0 })).toBeCloseTo(HALF_LIFE.knowledge, 9);
  });

  it("is exactly the skill half-life on an all-skill mix", () => {
    expect(halfLifeOf({ knowledge: 0, procedure: 0, skill: 1 })).toBeCloseTo(HALF_LIFE.skill, 9);
  });

  it("is monotone: more skill share (traded for knowledge share) never shortens the blend", () => {
    const lowSkill = halfLifeOf({ knowledge: 0.8, procedure: 0, skill: 0.2 });
    const midSkill = halfLifeOf({ knowledge: 0.5, procedure: 0, skill: 0.5 });
    const highSkill = halfLifeOf({ knowledge: 0.2, procedure: 0, skill: 0.8 });
    expect(midSkill).toBeGreaterThan(lowSkill);
    expect(highSkill).toBeGreaterThan(midSkill);
  });
});

describe("caps — every ceiling the layer can charge against is a real, positive cap", () => {
  it.each([
    ["STOCK_W", STOCK_W],
    ["MASTERY_W", MASTERY_W],
    ["REST_CHRONIC_CAP", REST_CHRONIC_CAP],
    ["REST_ACUTE_CAP", REST_ACUTE_CAP],
    ["DISRUPT_CAP", DISRUPT_CAP],
    ["SIGNAL_ADJ_CAP", SIGNAL_ADJ_CAP],
  ])("%s is positive", (_name, value) => {
    expect(value).toBeGreaterThan(0);
  });

  it("TRAIT_SDMULT_CAP widens the spread rather than shrinking it", () => {
    expect(TRAIT_SDMULT_CAP).toBeGreaterThan(1);
  });
});

describe("remaining formula constants are wired and sane", () => {
  it("spacing multipliers bracket 1.0 with recent practice rewarded most", () => {
    expect(SPACING_SAME_DAY).toBe(1.0);
    expect(SPACING_RECENT).toBeGreaterThan(SPACING_SAME_DAY);
    expect(SPACING_STALE).toBeGreaterThan(SPACING_SAME_DAY);
    expect(SPACING_STALE).toBeLessThan(SPACING_RECENT);
  });

  it("a short night encodes below full credit", () => {
    expect(SHORT_SLEEP_H).toBeGreaterThan(0);
    expect(ENCODING_PENALTY).toBeGreaterThan(0);
    expect(ENCODING_PENALTY).toBeLessThan(1);
  });

  it("stock, mastery and disruption denominators/rates are all positive", () => {
    expect(STOCK_FLOOR).toBeGreaterThan(0);
    expect(MASTERY_ALPHA).toBeGreaterThan(0);
    expect(MASTERY_FLOOR_FRAC).toBeGreaterThan(0);
    expect(MASTERY_FLOOR_FRAC).toBeLessThanOrEqual(1);
    expect(CARELESS_CREDIT).toBeGreaterThan(0);
    expect(PREREQ_HEADROOM).toBeGreaterThan(0);
    expect(MASTERY_SCALE).toBeGreaterThan(0);
    expect(MASTERY_MIN_MARKS).toBeGreaterThan(0);
    expect(DISRUPT_TAU).toBeGreaterThan(0);
  });

  it("rest weights are positive and every disruption kind carries a positive severity", () => {
    expect(REST_CHRONIC_W).toBeGreaterThan(0);
    expect(REST_REG_W).toBeGreaterThan(0);
    expect(REST_ACUTE_W).toBeGreaterThan(0);
    expect(REST_MIN_NIGHTS).toBeGreaterThan(0);
    for (const v of Object.values(DISRUPT_SEV)) expect(v).toBeGreaterThan(0);
  });

  it("anxiety, chronotype and trait-noise weights are all positive", () => {
    expect(ANX_W).toBeGreaterThan(0);
    expect(CHRONO_W).toBeGreaterThan(0);
    expect(TRAIT_MARKER_W).toBeGreaterThan(0);
    expect(TRAIT_SAMPLING_W).toBeGreaterThan(0);
  });
});

describe("the channel's seat is deliberately smaller than the older channels beside it", () => {
  it("SIGNAL_CAP sits below SELF_POOL_CAP — a logged state earns less seat than a self-forecast", () => {
    expect(SIGNAL_CAP).toBeLessThan(SELF_POOL_CAP);
  });

  it("SIGNAL_PRIOR sits below READINESS_PRIOR — signals make a level claim readiness never does", () => {
    expect(SIGNAL_PRIOR).toBeLessThan(READINESS_PRIOR);
  });
});
