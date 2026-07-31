import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANX_MID, ANX_SPAN, ANX_W, ATTEND_FULL_PCT, ATTEND_SHAVE_W, CARELESS_CREDIT,
  CHRONO_PEAK_HOUR, CHRONO_TAPER_H, CHRONO_W,
  DEFAULT_HALF_LIFE, DISRUPT_CAP, DISRUPT_DUR_BASE, DISRUPT_DUR_FULL_DAYS, DISRUPT_DUR_SPAN,
  DISRUPT_SEV, DISRUPT_TAU,
  ENCODING_PENALTY, HALF_LIFE, MASTERY_ALPHA, MASTERY_FLOOR_FRAC, MASTERY_FULL_CREDIT_MARKS,
  MASTERY_MIN_COVERAGE, MASTERY_MIN_MARKS, MASTERY_SCALE,
  MASTERY_W, PREREQ_HEADROOM, QUALITY, REST_ACUTE_CAP, REST_ACUTE_W, REST_CHRONIC_CAP,
  REST_CHRONIC_MAX_LOSS_H, REST_CHRONIC_W,
  REST_MIN_NIGHTS, REST_REG_FREE_SD_MIN, REST_REG_SPAN_MIN, REST_REG_W, SHORT_SLEEP_H,
  SIGNAL_ADJ_CAP, SIGNAL_NOTE_FLOOR, SPACING_RECENT, SPACING_SAME_DAY,
  SPACING_STALE, STOCK_FLOOR, STOCK_W, TRAIT_BELIEF_MAX, TRAIT_BELIEF_W, TRAIT_MARKER_W,
  TRAIT_SAMPLING_W, TRAIT_SDMULT_CAP, TRAIT_TIME_MIN_SHARE, TRAIT_TIME_W,
  attendanceShave, halfLifeOf,
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

/**
 * E1 (audit Part I §4). README §30 claims every constant in this layer is
 * quoted from params.ts and never hand-typed. That claim was false in five
 * modules, and the loudest instance was a SECOND, invisible definition of a
 * short night: rest.ts's acute term gated on a hardcoded 6.5h while
 * SHORT_SLEEP_H = 6.0 governed stock.ts's encoding penalty, so the layer meant
 * two different things by "a short night" and only one of them was visible.
 * A doctrine with no test drifts, so the doctrine and its test land together.
 */

const sourceOf = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");

/** Strips block and whole-line comments so a literal quoted in prose is not a hit. */
const codeOf = (name: string): string =>
  sourceOf(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("E1 — one definition of a short night", () => {
  it("has exactly one short-sleep threshold, and it is SHORT_SLEEP_H", () => {
    expect(SHORT_SLEEP_H).toBe(6.0);
    // The old rival threshold. If 6.5 reappears anywhere in the priced path the
    // layer once again means two different things by "a short night", and only
    // one of them is visible to the student in params.ts.
    for (const mod of ["rest.ts", "stock.ts", "signalread.ts"]) {
      expect(codeOf(mod), `${mod} still hard-codes a rival short-sleep hour`).not.toMatch(/\b6\.5\b/);
    }
  });

  it("prices no bare magic number in a module body", () => {
    // Every knob below used to be typed inline. Each is now a named export, so
    // its literal must no longer appear in the module that spends it.
    const banned: Record<string, RegExp[]> = {
      "rest.ts": [/regSd\s*-\s*60/, /0,\s*2\)/],
      "mastery.ts": [/\b0\.3\b/, /\/\s*6\b/, /\b95\b/, /\b0\.5\b/],
      "signalread.ts": [/-\s*3\)\s*\/\s*2/, /<=\s*9\b/, />=\s*15\b/, /\b95\b/, /\/\s*10\b/],
      "disrupt.ts": [/0\.5\s*\+\s*0\.5/, /\b7\b/],
      "traits.ts": [/\b0\.25\b/, /\b0\.05\b/],
    };
    for (const [mod, patterns] of Object.entries(banned)) {
      const code = codeOf(mod);
      for (const p of patterns) {
        expect(code, `${mod} still hand-types ${p}`).not.toMatch(p);
      }
    }
  });
});

describe("E1 — the lifted constants", () => {
  it("exports every one of them, wired and in range", () => {
    expect(REST_CHRONIC_MAX_LOSS_H).toBe(2);
    expect(REST_REG_FREE_SD_MIN).toBe(60);
    expect(REST_REG_SPAN_MIN).toBe(60);
    expect(MASTERY_MIN_COVERAGE).toBeGreaterThan(0);
    expect(MASTERY_MIN_COVERAGE).toBeLessThan(1);
    expect(MASTERY_FULL_CREDIT_MARKS).toBe(6);
    expect(ATTEND_FULL_PCT).toBe(95);
    expect(ATTEND_SHAVE_W).toBe(0.5);
    expect(ANX_MID).toBe(3);
    expect(ANX_SPAN).toBe(2);
    expect(DISRUPT_DUR_BASE + DISRUPT_DUR_SPAN).toBe(1);
    expect(DISRUPT_DUR_FULL_DAYS).toBe(7);
    expect(TRAIT_TIME_MIN_SHARE).toBe(0.25);
    expect(TRAIT_TIME_W).toBe(0.05);
    expect(TRAIT_BELIEF_MAX).toBe(2);
    expect(TRAIT_BELIEF_W).toBe(0.05);
    expect(SIGNAL_NOTE_FLOOR).toBe(0.05);
  });
});

describe("M6 — the chronotype peaks", () => {
  it("puts the lark's peak in the morning and the owl's in the afternoon", () => {
    expect(CHRONO_PEAK_HOUR.lark).toBeLessThan(CHRONO_PEAK_HOUR.owl);
    expect(CHRONO_PEAK_HOUR.lark).toBeGreaterThanOrEqual(0);
    expect(CHRONO_PEAK_HOUR.owl).toBeLessThanOrEqual(23);
  });

  it("tapers over a plausible number of hours", () => {
    expect(CHRONO_TAPER_H).toBeGreaterThan(0);
    // Half a school day out is the saturating case, not half an hour.
    expect(CHRONO_TAPER_H).toBeGreaterThanOrEqual(3);
  });
});

describe("M4 — attendanceShave is the layer's only attendance scale", () => {
  it("is silent when attendance was never recorded, and at or above full attendance", () => {
    expect(attendanceShave(null)).toBe(0);
    expect(attendanceShave(ATTEND_FULL_PCT)).toBe(0);
    expect(attendanceShave(100)).toBe(0);
  });

  it("charges the shortfall at ATTEND_SHAVE_W", () => {
    // 75% attended is 20 points short of 95 — a fifth of the year missed, half
    // of which is treated as genuinely lost syllabus.
    expect(attendanceShave(75)).toBeCloseTo(0.2 * ATTEND_SHAVE_W, 10);
    expect(attendanceShave(85)).toBeCloseTo(0.1 * ATTEND_SHAVE_W, 10);
  });

  it("saturates at ATTEND_SHAVE_W rather than running away", () => {
    // 0% attended is a 0.95 shortfall, not 1.0 — the ramp starts at
    // ATTEND_FULL_PCT = 95, not at 100.
    expect(attendanceShave(0)).toBeCloseTo(0.95 * ATTEND_SHAVE_W, 10);
    // And a nonsense reading below zero clamps rather than running past the cap.
    expect(attendanceShave(-50)).toBeCloseTo(ATTEND_SHAVE_W, 10);
    for (const pct of [-100, -1, 0, 50, 94, 95, 100, 200]) {
      expect(attendanceShave(pct)).toBeLessThanOrEqual(ATTEND_SHAVE_W);
      expect(attendanceShave(pct)).toBeGreaterThanOrEqual(0);
    }
  });

  it("is continuous through the full-attendance boundary", () => {
    expect(Math.abs(attendanceShave(94.99) - attendanceShave(ATTEND_FULL_PCT))).toBeLessThan(1e-3);
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
