import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeStats } from "../stats";
import { sanitizeSettings } from "../io";
import { buildRounds, pendingRound } from "../rounds";
import { aggregateForecast, examAggregate } from "./aggregate";
import { replayRegister } from "./eval/replay";
import { aggregateCallFor, meanCallSkill, poolAggregate } from "./meanpool";
import type { AppData, MeanCall } from "../../types";

/**
 * The aggregate pool end to end, on the committed book: your call on the overall
 * average against the register the model replays for itself. The module tests
 * prove the mixture; this proves the pipeline `App` actually assembles.
 */

const TODAY = "2026-07-21";
const raw = JSON.parse(readFileSync("src/lib/__fixtures__/book.json", "utf8"));
const base: AppData = { ...raw.data, settings: sanitizeSettings(raw.data.settings) };
const cal = base.settings.calendar;

const stats = computeStats(base.subjects, base.entries, base.settings, TODAY);
const booked = stats.filter((s) => !s.sub.archived);
const agg = examAggregate(booked);
const deskFc = aggregateForecast(booked, agg, 0);
const register = replayRegister(base.subjects, base.entries, base.settings, TODAY);
const pending = pendingRound(buildRounds(base.entries, cal), TODAY, cal);

const call = (predAvg: number, createdAt: string, roundKey: string): MeanCall => ({
  id: `m-${createdAt}-${predAvg}`, roundKey, predAvg,
  ranking: booked.map((s) => s.sub.id), createdAt,
});

describe("the aggregate pool reaches the band", () => {
  it("has a forward aggregate and a pending round to call at all", () => {
    expect(deskFc).not.toBeNull();
    expect(pending).not.toBeNull();
  });

  it("replays a register the book can be scored against", () => {
    expect(register.length).toBeGreaterThan(0);
    expect(register.some((l) => l.resolvedAt != null)).toBe(true);
  });

  it("is an exact identity with nothing called", () => {
    const fit = meanCallSkill([], base.entries, register, cal);
    expect(poolAggregate(deskFc, null, fit)).toBe(deskFc);
  });

  it("leaves the aggregate alone until a call has been scored", () => {
    /* One call, for the round still ahead: it has no record behind it, so the
       desk keeps the whole forecast. Weight is earned, never assumed. */
    const calls = [call(90, TODAY, pending!.key)];
    const fit = meanCallSkill(calls, base.entries, register, cal);
    const standing = aggregateCallFor(calls, pending!.key, true);
    expect(standing).not.toBeNull();
    expect(fit.n).toBe(0);
    expect(poolAggregate(deskFc, standing, fit)).toBe(deskFc);
  });

  it("moves the band once a past call has beaten the desk", () => {
    /* Score a round the book has already printed by calling it almost exactly,
       then stake a fresh call on the round ahead. */
    const scored = register.filter((l) => l.resolvedAt != null);
    const roundKey = scored[0].roundKey;
    const realized = base.entries.filter(
      (e) => e.type === "Exam" && booked.some((s) => s.sub.id === e.subjectId),
    );
    const inRound = realized.filter((e) => scored.some((l) => l.roundKey === roundKey && l.subjectId === e.subjectId));
    const truth = inRound.reduce((a, e) => a + e.score, 0) / inRound.length;
    const before = inRound.map((e) => e.date).sort()[0];
    const past = call(Math.round(truth * 10) / 10, "2020-01-01", roundKey);
    // The dated call must genuinely predate the round, or it is a memory.
    expect(past.createdAt < before).toBe(true);

    const calls = [past, call(90, TODAY, pending!.key)];
    const fit = meanCallSkill(calls, base.entries, register, cal);
    expect(fit.n).toBeGreaterThan(0);
    expect(fit.w).toBeGreaterThan(0);

    const pooled = poolAggregate(deskFc, aggregateCallFor(calls, pending!.key, true), fit)!;
    // Pulled toward a call well above the desk, and WIDER for the disagreement.
    expect(pooled.pct).toBeGreaterThan(deskFc!.pct);
    expect(pooled.sd).toBeGreaterThan(deskFc!.sd);
    expect(pooled.outOf).toBe(deskFc!.outOf);
  });

  it("the switch takes it back out exactly", () => {
    const calls = [call(90, TODAY, pending!.key)];
    expect(aggregateCallFor(calls, pending!.key, false)).toBeNull();
    const fit = meanCallSkill(calls, base.entries, register, cal);
    expect(poolAggregate(deskFc, aggregateCallFor(calls, pending!.key, false), fit)).toBe(deskFc);
  });
});
