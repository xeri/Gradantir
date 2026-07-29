import { describe, expect, it } from "vitest";
import { eloRank, nextPair, pairKey } from "./duel";
import type { Duel } from "../types";

const duel = (id: string, aId: string, bId: string, winnerId: string, createdAt: string): Duel =>
  ({ id, aId, bId, winnerId, createdAt });

describe("eloRank", () => {
  it("rates every listed desk, unbeaten ones at the base rating", () => {
    const r = eloRank([], ["s1", "s2"]);
    expect(r.map((x) => x.id).sort()).toEqual(["s1", "s2"]);
    expect(r[0].rating).toBe(r[1].rating);
  });
  it("lifts the winner of a duel above the loser", () => {
    const r = eloRank([duel("d1", "s1", "s2", "s1", "2026-05-01")], ["s1", "s2"]);
    const byId = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(byId.s1.rating).toBeGreaterThan(byId.s2.rating);
    expect(byId.s1.wins).toBe(1);
    expect(byId.s2.losses).toBe(1);
  });
  it("orders a transitive pile of duels strongest→weakest", () => {
    const duels = [
      duel("d1", "s1", "s2", "s1", "2026-05-01"),
      duel("d2", "s2", "s3", "s2", "2026-05-02"),
      duel("d3", "s1", "s3", "s1", "2026-05-03"),
    ];
    const r = eloRank(duels, ["s1", "s2", "s3"]);
    expect(r.map((x) => x.id)).toEqual(["s1", "s2", "s3"]);
  });
  it("is deterministic regardless of the input array order", () => {
    const a = [duel("d1", "s1", "s2", "s1", "2026-05-01"), duel("d2", "s2", "s3", "s2", "2026-05-02")];
    const r1 = eloRank(a, ["s1", "s2", "s3"]);
    const r2 = eloRank([...a].reverse(), ["s1", "s2", "s3"]);
    expect(r1).toEqual(r2);
  });
});

describe("pairKey", () => {
  it("is order-free, so A-vs-B and B-vs-A are the same matchup", () => {
    expect(pairKey("s1", "s2")).toBe(pairKey("s2", "s1"));
    expect(pairKey("s1", "s2")).not.toBe(pairKey("s1", "s3"));
  });
});

describe("nextPair", () => {
  it("has nothing to ask below two desks", () => {
    expect(nextPair([], [])).toBeNull();
    expect(nextPair([], ["s1"])).toBeNull();
  });

  it("returns a pair of listed desks, low id first", () => {
    expect(nextPair([], ["s2", "s1"])).toEqual(["s1", "s2"]);
  });

  it("asks about the least-compared pair before revisiting a settled one", () => {
    // s1/s2 is well-trodden; s3 has never been touched.
    const duels = [
      duel("d1", "s1", "s2", "s1", "2026-05-01"),
      duel("d2", "s1", "s2", "s1", "2026-05-02"),
      duel("d3", "s1", "s2", "s1", "2026-05-03"),
    ];
    expect(nextPair(duels, ["s1", "s2", "s3"])).not.toEqual(["s1", "s2"]);
  });

  it("among equally-compared pairs, picks the one the ratings cannot separate", () => {
    // Every pair has met once, so only the Elo gap decides. s2 beat s3 and lost
    // to s1, leaving s1-vs-s2 and s2-vs-s3 tight and s1-vs-s3 the settled gap.
    const duels = [
      duel("d1", "s1", "s2", "s1", "2026-05-01"),
      duel("d2", "s2", "s3", "s2", "2026-05-02"),
      duel("d3", "s1", "s3", "s1", "2026-05-03"),
    ];
    const p = nextPair(duels, ["s1", "s2", "s3"])!;
    expect(p).not.toEqual(["s1", "s3"]);
    const rank = Object.fromEntries(eloRank(duels, ["s1", "s2", "s3"]).map((r) => [r.id, r.rating]));
    const gap = Math.abs(rank[p[0]] - rank[p[1]]);
    expect(gap).toBeLessThan(Math.abs(rank.s1 - rank.s3));
  });

  it("sinks pairs already served this round", () => {
    const served = new Set([pairKey("s1", "s2")]);
    expect(nextPair([], ["s1", "s2", "s3"], served)).not.toEqual(["s1", "s2"]);
  });

  it("still answers when every pair has been served — a two-desk book can only repeat", () => {
    const served = new Set([pairKey("s1", "s2")]);
    expect(nextPair([], ["s1", "s2"], served)).toEqual(["s1", "s2"]);
  });

  it("is deterministic regardless of the input order", () => {
    const duels = [duel("d1", "s1", "s2", "s1", "2026-05-01"), duel("d2", "s2", "s3", "s2", "2026-05-02")];
    const p1 = nextPair(duels, ["s1", "s2", "s3", "s4"]);
    const p2 = nextPair([...duels].reverse(), ["s4", "s3", "s2", "s1"]);
    expect(p1).toEqual(p2);
  });

  it("ignores duels over desks the book no longer lists", () => {
    const duels = [duel("d1", "s1", "gone", "s1", "2026-05-01")];
    expect(nextPair(duels, ["s1", "s2"])).toEqual(["s1", "s2"]);
  });
});
