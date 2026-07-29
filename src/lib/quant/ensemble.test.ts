import { describe, expect, it } from "vitest";
import { ensemble, ewma } from "./ensemble";
import { ENSEMBLE_DISPERSION } from "./params";
import { poolStats } from "./shrinkage";
import type { AssessmentType, GradeEntry } from "../../types";
import type { QuantPoint } from "./types";

let id = 0;
const ge = (date: string, score: number, type: AssessmentType = "Test"): GradeEntry => ({
  id: `e${id++}`, subjectId: "s1", date, type, score, title: "",
});
const pool = poolStats([[70, 72, 75], [62, 60, 65], [81, 84, 80]]);

describe("ewma", () => {
  it("is null on empty input", () => {
    expect(ewma([])).toBeNull();
  });
  it("recent prints dominate", () => {
    const pts: QuantPoint[] = [
      { x: 0, y: 60, type: "Test" },
      { x: 180, y: 90, type: "Test" },
    ];
    expect(ewma(pts, 60, 180)!.mean).toBeGreaterThan(80);
  });
  it("coursework outweighs a quiz at equal recency", () => {
    const towardTest = ewma([
      { x: 0, y: 90, type: "Test" },
      { x: 0, y: 60, type: "Quiz" },
    ], 60, 0)!.mean;
    expect(towardTest).toBeGreaterThan(75); // pulled toward the Test's 90
  });
});

describe("ensemble", () => {
  it("returns null with no entries", () => {
    expect(ensemble([], pool, "2026-07-01")).toBeNull();
  });
  it("n=1: runs wide, trend silent, weights sum to 1", () => {
    const r = ensemble([ge("2026-06-01", 92)], pool, "2026-07-01")!;
    expect(r.weights.trend).toBe(0);
    const total = Object.values(r.weights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(r.sd).toBeGreaterThan(5);
    // shrinkage: one hot print doesn't get taken at face value
    expect(r.mean).toBeLessThan(92);
    expect(r.mean).toBeGreaterThan(pool!.grandMean - 1);
  });
  it("n=3 switches to walk-forward validation weights", () => {
    const r = ensemble(
      [ge("2026-05-01", 74), ge("2026-05-20", 78), ge("2026-06-10", 76)],
      pool, "2026-07-01",
    )!;
    const total = Object.values(r.weights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(r.mean).toBeGreaterThan(70);
    expect(r.mean).toBeLessThan(82);
  });
  it("a constant series converges on the constant", () => {
    const dates = ["2026-03-01", "2026-03-20", "2026-04-10", "2026-05-01", "2026-05-20", "2026-06-10"];
    const r = ensemble(dates.map((d) => ge(d, 80)), pool, "2026-07-01")!;
    expect(r.mean).toBeCloseTo(80, 0);
    expect(r.sd).toBeGreaterThan(0);
  });
  it("clean trending data hands the trend member the biggest weight", () => {
    const dates = ["2026-03-01", "2026-03-15", "2026-03-29", "2026-04-12", "2026-04-26", "2026-05-10", "2026-05-24", "2026-06-07"];
    const r = ensemble(dates.map((d, i) => ge(d, 58 + 4 * i)), pool, "2026-06-14")!;
    expect(r.weights.trend).toBeGreaterThanOrEqual(r.weights.kalman);
    expect(r.weights.trend).toBeGreaterThanOrEqual(r.weights.ewma);
    expect(r.weights.trend).toBeGreaterThanOrEqual(r.weights.shrunk);
    // and the blend actually rides the trend above the flat members
    expect(r.mean).toBeGreaterThan(78);
  });
  it("keeps the blend inside the member envelope", () => {
    const r = ensemble(
      [ge("2026-04-01", 55), ge("2026-05-01", 85), ge("2026-06-01", 70)],
      pool, "2026-07-01",
    )!;
    const means = r.members.map((m) => m.mean);
    expect(r.mean).toBeGreaterThanOrEqual(Math.min(...means) - 1e-9);
    expect(r.mean).toBeLessThanOrEqual(Math.max(...means) + 1e-9);
  });
  it("is deterministic", () => {
    const entries = [ge("2026-05-01", 74), ge("2026-05-20", 78), ge("2026-06-10", 71)];
    expect(ensemble(entries, pool, "2026-07-01")).toEqual(ensemble(entries, pool, "2026-07-01"));
  });
});

describe("ensemble — regime break truncates a stale regime", () => {
  it("re-anchors the level on the post-break prints, dropping the old regime", () => {
    // A low regime, a flagged structural break, then a high regime.
    const entries: GradeEntry[] = [
      ge("2026-02-01", 50), ge("2026-02-15", 52), ge("2026-03-01", 51),
      { ...ge("2026-05-01", 85), regimeBreak: true },
      ge("2026-05-20", 87), ge("2026-06-10", 86),
    ];
    const r = ensemble(entries, pool, "2026-07-01")!;
    // Fit the ~86 regime, not dragged toward the buried ~51s.
    expect(r.mean).toBeGreaterThan(80);
  });

  it("a break on the very first print keeps the whole tape (slice-0 is a no-op)", () => {
    const plain = [ge("2026-04-01", 70), ge("2026-05-01", 72), ge("2026-06-01", 74)];
    const flaggedFirst = plain.map((e, i) => (i === 0 ? { ...e, regimeBreak: true } : e));
    expect(ensemble(flaggedFirst, pool, "2026-07-01")!.mean)
      .toBeCloseTo(ensemble(plain, pool, "2026-07-01")!.mean, 9);
  });

  it("a mid-tape break shortens the usable history, so the band widens (lower df)", () => {
    const long = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"].map((d) => ge(d, 71));
    const broken = long.map((e, i) => (i === 3 ? { ...e, regimeBreak: true } : e));
    const rLong = ensemble(long, pool, "2026-07-01")!;
    const rBroken = ensemble(broken, pool, "2026-07-01")!;
    expect(rBroken.df).toBeLessThan(rLong.df);
  });
});

describe("ensemble — a censored (boundary) print carries less measurement weight", () => {
  it("moves the level less than the same mark fully observed", () => {
    const hot = ge("2026-06-01", 96);
    const plain = ensemble([hot], pool, "2026-07-01")!;
    const censored = ensemble([{ ...hot, censored: true }], pool, "2026-07-01")!;
    // Wider observation noise ⇒ the maxed paper pulls the estimate less toward 96.
    expect(censored.mean).toBeLessThan(plain.mean);
  });
});

describe("ensemble — member ablation seam", () => {
  const dates = ["2026-03-01", "2026-03-20", "2026-04-10", "2026-05-01", "2026-05-20", "2026-06-10"];
  const entries = dates.map((d, i) => ge(d, 60 + 3 * i));

  it("restricting to one member blends only that member", () => {
    const r = ensemble(entries, pool, "2026-07-01", { members: new Set(["kalman"]) })!;
    expect(r.weights.kalman).toBeCloseTo(1, 9);
    expect(r.weights.ewma + r.weights.shrunk + r.weights.trend).toBeCloseTo(0, 9);
    expect(r.members.map((m) => m.name)).toEqual(["kalman"]);
    expect(r.mean).toBeCloseTo(r.members[0].mean, 9);
  });

  it("dropping the trend member leaves it out of the blend entirely", () => {
    const r = ensemble(entries, pool, "2026-07-01", { members: new Set(["kalman", "ewma", "shrunk"]) })!;
    expect(r.weights.trend).toBe(0);
    expect(r.members.some((m) => m.name === "trend")).toBe(false);
    const total = Object.values(r.weights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("the default (no opts) is identical to passing the full member set", () => {
    const full = new Set<"kalman" | "ewma" | "shrunk" | "trend">(["kalman", "ewma", "shrunk", "trend"]);
    expect(ensemble(entries, pool, "2026-07-01", { members: full }))
      .toEqual(ensemble(entries, pool, "2026-07-01"));
  });
});

describe("ensemble — predictive dispersion markup (honest bands)", () => {
  const dates = ["2026-03-01", "2026-03-20", "2026-04-10", "2026-05-01", "2026-05-20", "2026-06-10"];
  const entries = dates.map((d, i) => ge(d, 70 + (i % 2 === 0 ? 4 : -4))); // some scatter

  it("marks the moment-matched sd up by the CRPS-tuned dispersion factor", () => {
    // With a single member there is no disagreement term, so the mixture sd is
    // exactly that member's sd — the markup is then the whole gap.
    const r = ensemble(entries, pool, "2026-07-01", { members: new Set(["kalman"]) })!;
    expect(r.sd).toBeCloseTo(r.members[0].sd * ENSEMBLE_DISPERSION, 9);
  });

  it("the factor exceeds 1 — the bands widen, never tighten", () => {
    expect(ENSEMBLE_DISPERSION).toBeGreaterThan(1);
  });
});
