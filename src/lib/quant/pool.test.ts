import { describe, expect, it } from "vitest";
import { IDENTITY_POOL, fitSelfWeight, poolBoard, poolNextExam, selfPredictive, stakedSittings } from "./pool";
import { SELF_POOL_CAP, SELF_POOL_KAPPA } from "./params";
import type { StudentT } from "./bayes";
import type { ResolvedUpcoming } from "../upcoming";
import type { GradeEntry, NextExamForecast, SelfPrediction, SubjectStat, Upcoming } from "../../types";

const sitting = (
  selfPred: SelfPrediction | null,
  realized: number,
  id = "u1",
): ResolvedUpcoming => ({
  upcoming: {
    id, subjectId: "s1", date: "2026-06-01", type: "Exam", title: "Paper",
    ...(selfPred ? { selfPred } : {}),
  },
  realized: { id: `e-${id}`, subjectId: "s1", date: "2026-06-01", type: "Exam", title: "Paper", score: realized },
});

/** The desk always calls `mean`, with a fixed band. */
const desk = (mean: number, scale = 6): (() => StudentT) => () => ({ mean, scale, df: 8 });

const nextExam = (mean: number, sd: number): NextExamForecast => ({
  mean, sd,
  ci50: { lo: mean - 0.67 * sd, hi: mean + 0.67 * sd },
  ci90: { lo: mean - 1.86 * sd, hi: mean + 1.86 * sd },
});

describe("fitSelfWeight", () => {
  it("gives a student with no record no weight at all", () => {
    expect(fitSelfWeight([], desk(70))).toEqual(IDENTITY_POOL);
    // A sitting nobody called is not a record either.
    expect(fitSelfWeight([sitting(null, 70)], desk(70)).n).toBe(0);
  });

  it("earns the student weight when the desk is persistently off and they are not", () => {
    // The desk calls 70 every time; the student nails 85 every time.
    const resolved = [85, 85, 85, 85].map((y, i) => sitting({ point: y }, y, `u${i}`));
    const fit = fitSelfWeight(resolved, desk(70));
    expect(fit.n).toBe(4);
    expect(fit.youScore).toBe(0);
    expect(fit.modelScore).toBe(15);
    expect(fit.rawShare).toBe(1);
    // Earned, not assumed: four sittings against κ pseudo-sittings, and the
    // cap binds before a perfect record ever reaches half the call.
    expect(fit.w).toBeCloseTo(Math.min(4 / (4 + SELF_POOL_KAPPA), SELF_POOL_CAP), 6);
    expect(fit.w).toBeGreaterThan(0.3);
  });

  it("gives the student nothing when the DESK is the one getting it right", () => {
    const resolved = [70, 70, 70].map((y, i) => sitting({ point: y + 20 }, y, `u${i}`));
    const fit = fitSelfWeight(resolved, desk(70));
    expect(fit.rawShare).toBe(0);
    expect(fit.w).toBe(0);
  });

  it("splits the share when both sides are equally wrong", () => {
    const resolved = [sitting({ point: 80 }, 75), sitting({ point: 80 }, 75, "u2")];
    const fit = fitSelfWeight(resolved, desk(70));
    expect(fit.rawShare).toBeCloseTo(0.5, 6);
    expect(fit.w).toBeCloseTo(0.5 * (2 / (2 + SELF_POOL_KAPPA)), 6);
  });

  it("never lets the student's call past the cap, however long the streak", () => {
    const resolved = Array.from({ length: 40 }, (_, i) => sitting({ point: 85 }, 85, `u${i}`));
    expect(fitSelfWeight(resolved, desk(70)).w).toBe(SELF_POOL_CAP);
  });

  it("judges both sides by the same rule within a sitting — CRPS only when a range was stated", () => {
    // A bare point call is scored on location alone, so a stated range can only
    // ever help the student who states an honest one, never punish the one who
    // declines to guess a spread.
    const bare = fitSelfWeight([sitting({ point: 75 }, 75)], desk(70));
    expect(bare.youScore).toBe(0);
    expect(bare.modelScore).toBe(5);

    const ranged = fitSelfWeight([sitting({ point: 75, lo: 70, hi: 80 }, 75)], desk(70));
    // CRPS of a dead-centre band is positive — you are charged for your spread,
    // and so is the desk, on the same rule.
    expect(ranged.youScore!).toBeGreaterThan(0);
    expect(ranged.modelScore!).toBeGreaterThan(0);
    expect(ranged.youScore!).toBeLessThan(ranged.modelScore!);
  });

  it("reports the student's realized error spread, for calls they gave no range for", () => {
    const resolved = [sitting({ point: 80 }, 76), sitting({ point: 70 }, 74, "u2")];
    // rms of (+4, −4)
    expect(fitSelfWeight(resolved, desk(70)).selfSd).toBeCloseTo(4, 6);
  });
});

describe("selfPredictive", () => {
  it("reads a stated range as a ~90% interval", () => {
    const t = selfPredictive({ point: 75, lo: 65, hi: 85 }, 99);
    expect(t.mean).toBe(75);
    // A 20-wide 90% range is ±10 = 1.645σ, so σ ≈ 6.08.
    expect(t.scale).toBeCloseTo(20 / (2 * 1.6448536269514722), 6);
  });

  it("clamps a call stored off the board — corrupt input, not a bold forecast", () => {
    expect(selfPredictive({ point: 200 }, 5).mean).toBe(100);
    expect(selfPredictive({ point: -40 }, 5).mean).toBe(0);
  });

  it("falls back to the supplied spread when no range was given", () => {
    expect(selfPredictive({ point: 75 }, 7).scale).toBe(7);
    // Never a degenerate spike, whatever it is handed.
    expect(selfPredictive({ point: 75 }, 0).scale).toBe(0.5);
  });
});

describe("poolNextExam", () => {
  const model = nextExam(70, 6);
  const fit = (w: number) => ({ ...IDENTITY_POOL, w, selfSd: 5 });

  it("is exactly the desk's own call at zero weight, or with nothing staked", () => {
    expect(poolNextExam(model, 8, { point: 90 }, IDENTITY_POOL)).toEqual(model);
    expect(poolNextExam(model, 8, null, fit(0.4))).toEqual(model);
  });

  it("pulls the centre toward your call in proportion to the weight", () => {
    const pooled = poolNextExam(model, 8, { point: 90 }, fit(0.25));
    expect(pooled.mean).toBeCloseTo(0.75 * 70 + 0.25 * 90, 1);
  });

  it("WIDENS the band when you contradict the desk — a contested call is uncertain", () => {
    const agree = poolNextExam(model, 8, { point: 70 }, fit(0.4));
    const contest = poolNextExam(model, 8, { point: 90 }, fit(0.4));
    expect(contest.sd).toBeGreaterThan(agree.sd);
    expect(contest.sd).toBeGreaterThan(model.sd);
    // Agreeing with the desk must not manufacture precision either: your own
    // spread is still mixed in, so the band cannot collapse below the tighter side.
    expect(agree.sd).toBeGreaterThanOrEqual(Math.min(model.sd, 5));
  });

  it("keeps the pooled call on the board, with the 50 nested inside the 90", () => {
    const pooled = poolNextExam(model, 8, { point: 95 }, fit(0.45));
    expect(pooled.mean).toBeGreaterThan(70);
    expect(pooled.mean).toBeLessThanOrEqual(100);
    // Intervals are the [0,100]-TRUNCATED quantiles (§23), so near the ceiling
    // they extend into the interior rather than straddling the centre — nesting
    // and the bounds are what must hold, not symmetry about the mean.
    expect(pooled.ci50.lo).toBeGreaterThanOrEqual(pooled.ci90.lo);
    expect(pooled.ci50.hi).toBeLessThanOrEqual(pooled.ci90.hi);
    expect(pooled.ci90.lo).toBeGreaterThanOrEqual(0);
    expect(pooled.ci90.hi).toBeLessThanOrEqual(100);
  });

  it("honours a stated range over the fitted error spread", () => {
    const tight = poolNextExam(model, 8, { point: 80, lo: 79, hi: 81 }, fit(0.4));
    const loose = poolNextExam(model, 8, { point: 80, lo: 60, hi: 100 }, fit(0.4));
    expect(tight.mean).toBeCloseTo(loose.mean, 6);
    expect(tight.sd).toBeLessThan(loose.sd);
  });
});

/* ── the board-level pass ───────────────────────────────────────────── */

const TODAY = "2026-06-01";

const sitting2 = (over: Partial<Upcoming>): Upcoming => ({
  id: "u", subjectId: "s1", date: "2026-07-01", type: "Exam", title: "Finals",
  selfPred: { point: 90 }, ...over,
});

const row = (id: string, nextMean: number): SubjectStat =>
  ({ sub: { id, name: id, ticker: id.toUpperCase(), color: "#fff", target: null, courseworkPct: null },
     quant: { nextExam: nextExam(nextMean, 6), df: 8 } } as unknown as SubjectStat);

describe("stakedSittings", () => {
  const entries: GradeEntry[] = [];

  it("takes the soonest unresolved exam you have staked a call on, per desk", () => {
    const staked = stakedSittings([
      sitting2({ id: "far", date: "2026-09-01", selfPred: { point: 60 } }),
      sitting2({ id: "near", date: "2026-07-01", selfPred: { point: 80 } }),
      sitting2({ id: "other", subjectId: "s2", date: "2026-08-01" }),
    ], entries, TODAY);
    expect(staked.get("s1")!.id).toBe("near");
    expect(staked.get("s2")!.id).toBe("other");
  });

  it("ignores a sitting with no call, a non-exam, and one already in the past", () => {
    const staked = stakedSittings([
      sitting2({ id: "bare", selfPred: null }),
      sitting2({ id: "quiz", subjectId: "s2", type: "Quiz" }),
      sitting2({ id: "stale", subjectId: "s3", date: "2026-01-01" }),
    ], entries, TODAY);
    expect(staked.size).toBe(0);
  });

  it("ignores a sitting whose real mark has already landed", () => {
    const sat: GradeEntry = {
      id: "e1", subjectId: "s1", date: "2026-07-02", type: "Exam", title: "Finals", score: 77,
    };
    expect(stakedSittings([sitting2({})], [sat], TODAY).size).toBe(0);
  });
});

describe("poolBoard", () => {
  const stats = [row("s1", 70), row("s2", 65)];
  const staked = [sitting2({})];
  const fit = { ...IDENTITY_POOL, w: 0.3, selfSd: 5 };

  it("hands back the very same array when the pool has earned nothing", () => {
    expect(poolBoard(stats, staked, [], TODAY, IDENTITY_POOL)).toBe(stats);
  });

  it("hands back the very same array when no call is staked on anything", () => {
    expect(poolBoard(stats, [], [], TODAY, fit)).toBe(stats);
  });

  it("moves only the desk you staked a call on", () => {
    const out = poolBoard(stats, staked, [], TODAY, fit);
    expect(out).not.toBe(stats);
    expect(out[0].quant!.nextExam.mean).toBeCloseTo(0.7 * 70 + 0.3 * 90, 1);
    // The desk you said nothing about is untouched — the same object, even.
    expect(out[1]).toBe(stats[1]);
  });

  it("leaves every other figure on the moved desk alone", () => {
    const out = poolBoard(stats, staked, [], TODAY, fit);
    expect(out[0].sub).toBe(stats[0].sub);
    expect(out[0].quant!.df).toBe(stats[0].quant!.df);
  });
});

/* ── the derivation reconciles with the number the board draws ──────── */

describe("the oracle's derivation under the pool", () => {
  it("lands on the POOLED forecast, not the desk's own arithmetic", async () => {
    const { derivationFor } = await import("../derive");
    const { computeStats } = await import("../stats");
    const { sanitizeSettings } = await import("../io");
    const { readFileSync } = await import("node:fs");
    const raw = JSON.parse(readFileSync("src/lib/__fixtures__/book.json", "utf8"));
    const data = { ...raw.data, settings: sanitizeSettings(raw.data.settings) };
    const today = "2026-07-21";

    const stats = computeStats(data.subjects, data.entries, data.settings, today);
    const target = stats.find((s) => s.quant)!;
    const staked: Upcoming = {
      id: "u-pool", subjectId: target.sub.id, date: "2026-11-01",
      type: "Exam", title: "Finals", selfPred: { point: 95 },
    };
    const fit = { ...IDENTITY_POOL, w: 0.4, n: 5, selfSd: 5 };

    const board = poolBoard(stats, [staked], data.entries, today, fit);
    const moved = board.find((s) => s.sub.id === target.sub.id)!;
    expect(moved.quant!.nextExam.mean).not.toBe(target.quant!.nextExam.mean);

    const d = derivationFor("oracle.next", {
      stat: moved,
      stats: board,
      selfPool: fit,
      selfStakes: { [target.sub.id]: staked.selfPred! },
    });
    // The headline result and the pooling step must both quote the board's number.
    expect(d!.result.value).toBe(moved.quant!.nextExam.mean.toFixed(1));
    expect(d!.steps.some((s) => s.subst?.includes(moved.quant!.nextExam.mean.toFixed(1)))).toBe(true);
    expect(d!.steps.some((s) => s.note?.includes("CREDIBILITY POOL"))).toBe(true);
  });

  it("says nothing about pooling on a desk whose call nobody contested", async () => {
    const { derivationFor } = await import("../derive");
    const { computeStats } = await import("../stats");
    const { sanitizeSettings } = await import("../io");
    const { readFileSync } = await import("node:fs");
    const raw = JSON.parse(readFileSync("src/lib/__fixtures__/book.json", "utf8"));
    const data = { ...raw.data, settings: sanitizeSettings(raw.data.settings) };
    const stats = computeStats(data.subjects, data.entries, data.settings, "2026-07-21");
    const s = stats.find((x) => x.quant)!;
    const d = derivationFor("oracle.next", { stat: s, stats, selfPool: IDENTITY_POOL, selfStakes: {} });
    expect(d!.result.value).toBe(s.quant!.nextExam.mean.toFixed(1));
    expect(d!.steps.some((st) => st.note?.includes("CREDIBILITY POOL"))).toBe(false);
  });
});
