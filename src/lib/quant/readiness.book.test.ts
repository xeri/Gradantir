import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeStats } from "../stats";
import { sanitizeSettings } from "../io";
import { READINESS_PRIOR } from "./params";
import type { AppData, Duel } from "../../types";

/**
 * The readiness channel end to end, on the committed book: does a pile of gut
 * calls actually reach a mark, and does the switch actually take it back out?
 * The module tests prove the mathematics; this proves the wiring, which is the
 * half that silently breaks.
 */

const TODAY = "2026-07-21";
const raw = JSON.parse(readFileSync("src/lib/__fixtures__/book.json", "utf8"));
const base: AppData = { ...raw.data, settings: sanitizeSettings(raw.data.settings) };
const live = base.subjects.filter((s) => !s.archived);

const duels = (): Duel[] => {
  /* A decisive, consistent pile: the first desk beats every other, the last
     loses to every other — the clearest ordering the arena can produce. */
  const out: Duel[] = [];
  const first = live[0].id;
  const last = live[live.length - 1].id;
  live.slice(1).forEach((s, i) => {
    out.push({ id: `d-top-${i}`, aId: first, bId: s.id, winnerId: first, createdAt: "2026-07-01" });
  });
  live.slice(0, -1).forEach((s, i) => {
    out.push({ id: `d-bot-${i}`, aId: s.id, bId: last, winnerId: s.id, createdAt: "2026-07-02" });
  });
  return out;
};

const priceOf = (rows: ReturnType<typeof computeStats>, id: string) =>
  rows.find((r) => r.sub.id === id)?.quant?.price ?? null;

const run = (over: Partial<AppData> = {}, skill = READINESS_PRIOR) => {
  const data = { ...base, ...over };
  return computeStats(data.subjects, data.entries, data.settings, TODAY, undefined, {
    allocations: data.allocations, duels: data.duels, readinessSkill: skill,
  });
};

describe("readiness reaches the board", () => {
  it("is an exact identity on the committed book, which has never duelled", () => {
    expect(run()).toEqual(run({ duels: [] }));
  });

  it("marks the desk you feel least ready for below where it stood", () => {
    const before = run();
    const after = run({ duels: duels() });
    const last = live[live.length - 1].id;
    expect(priceOf(after, last)!).toBeLessThan(priceOf(before, last)!);
  });

  it("credits the desk you feel readiest for — never charges it", () => {
    const before = run();
    const after = run({ duels: duels() });
    const first = live[0].id;
    const credit = priceOf(after, first)! - priceOf(before, first)!;
    // A credit can only ever lift a desk back toward par: `markDesk` floors the
    // discount at zero, so a desk already AT fair value has nothing to give back
    // and the credit is worth exactly nothing to it. What must never happen is
    // the readiest desk being marked DOWN for being the readiest.
    expect(credit).toBeGreaterThanOrEqual(0);
    const line = after.find((r) => r.sub.id === first)!.quant!.trace!.mark!.raw.find((l) => l.key === "ready");
    expect(line, "expected a READINESS EDGE line on the readiest desk").toBeTruthy();
    expect(line!.pts).toBeLessThan(0);
    expect(line!.note).toContain("DAMPED CREDIT");
  });

  it("nets a charge on an unevenly prepared book — dispersion is a risk (§15c)", () => {
    const total = (rows: ReturnType<typeof computeStats>) =>
      rows.reduce((a, r) => a + (r.quant?.price ?? 0), 0);
    const before = run();
    const after = run({ duels: duels() });
    // The λ charges sum to zero before damping; loss aversion is what leaves a
    // residue, and the residue is deliberately on the charge side.
    expect(total(after)).toBeLessThan(total(before));
  });

  it("charges harder as the pile earns more credibility", () => {
    const last = live[live.length - 1].id;
    const timid = priceOf(run({ duels: duels() }, 0.2), last)!;
    const proven = priceOf(run({ duels: duels() }, 1), last)!;
    expect(proven).toBeLessThan(timid);
  });

  it("names the line in the waterfall, so the charge is attributable", () => {
    const after = run({ duels: duels() });
    const last = after.find((r) => r.sub.id === live[live.length - 1].id)!;
    const line = last.quant!.premia.find((p) => p.key === "ready");
    expect(line, "expected a READINESS line on the marked-down desk").toBeTruthy();
    expect(line!.note).toContain("ARENA");
  });

  it("the switch takes it back out exactly — not approximately", () => {
    const off = run({ duels: duels(), settings: { ...base.settings, readinessWeighting: false } });
    expect(off).toEqual(run({ duels: [] }));
  });
});
