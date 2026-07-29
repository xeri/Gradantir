import { describe, expect, it } from "vitest";
import { RATING_RANK, benchmarkDrift, rateBook, rateDesk, ratingMove, type RateContext } from "./ratings";
import { poolStats } from "./shrinkage";
import { priceSubject } from "./price";
import { DEFAULT_SETTINGS } from "../../constants";
import type { AssessmentType, ForwardView, GradeEntry, PriceResult, Subject } from "../../types";

const S = DEFAULT_SETTINGS;
const TODAY = "2026-07-01";

const sub = (id: string): Subject => ({ id, name: id, ticker: id.toUpperCase(), color: "#4D7CFE", target: null });
let eid = 0;

/** A series on a fixed 21-day cadence ending 10 days before "today". */
const series = (id: string, scores: (number | [number, AssessmentType])[]): GradeEntry[] =>
  scores.map((s, i) => {
    const [score, type] = Array.isArray(s) ? s : [s, "Test" as AssessmentType];
    const d = new Date(2026, 6, 1);
    d.setDate(d.getDate() - 10 - 21 * (scores.length - 1 - i));
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { id: `e${eid++}`, subjectId: id, date, type, score, title: "" };
  });

/** An analyst holding its level (level members) or moving it (the trend). */
const view = (name: string, now: number, mean = now, sd = 4, weight = 0.25): ForwardView =>
  ({ name, weight, now, mean, sd });
const ctx = (over: Partial<RateContext> = {}): RateContext =>
  ({ price: 70, carry: 0, n: 6, staleDays: 0, horizon: 30, benchmark: 0, ...over });

/** Price a whole book the way computeStats does, then rate it. */
function book(desks: { sub: Subject; entries: GradeEntry[] }[]) {
  const pool = poolStats(desks.map((d) => d.entries.map((e) => e.score)));
  const inputs = desks.map((d) => ({
    sub: d.sub,
    quant: priceSubject(d.entries, pool, S, TODAY) as PriceResult | null,
    n: d.entries.length,
    staleDays: 10,
  }));
  return { inputs, rated: rateBook(inputs) };
}

describe("rateDesk", () => {
  it("analysts forecasting a rise make a buy; forecasting a fall, a sell", () => {
    const up = rateDesk(
      [view("kalman", 70), view("ewma", 70, 71), view("shrunk", 70), view("trend", 70, 78)],
      ctx(),
    );
    expect(up.rating).toBe("BUY");
    expect(up.expected).toBeGreaterThan(0);
    expect(up.upside!).toBeGreaterThan(0);

    const down = rateDesk(
      [view("kalman", 70), view("ewma", 70, 69), view("shrunk", 70), view("trend", 70, 62)],
      ctx(),
    );
    expect(down.rating).toBe("SELL");
    expect(down.score).toBeLessThan(0);
  });

  it("a desk drifting exactly with the book is a HOLD — the benchmark eats it", () => {
    const views = [view("kalman", 70), view("ewma", 70), view("shrunk", 70), view("trend", 70, 78)];
    expect(rateDesk(views, ctx({ benchmark: 0 })).rating).toBe("BUY");
    const withBook = rateDesk(views, ctx({ benchmark: 2 })); // the whole book expects +2
    expect(withBook.rating).toBe("HOLD");
    expect(withBook.benchmark).toBe(2);
  });

  it("carry alone can rate a desk — exams that pay over the coursework price", () => {
    const flat = [view("kalman", 70), view("ewma", 70), view("shrunk", 70), view("trend", 70)];
    expect(rateDesk(flat, ctx({ carry: 0 })).rating).toBe("HOLD");
    expect(rateDesk(flat, ctx({ carry: 3 })).rating).toBe("STRONG BUY");
    expect(rateDesk(flat, ctx({ carry: -3 })).rating).toBe("STRONG SELL");
  });

  it("the convergence term splits the analysts without moving the consensus", () => {
    const agreed = rateDesk(
      [view("kalman", 70, 74), view("ewma", 70, 74), view("shrunk", 70, 74), view("trend", 70, 74)],
      ctx(),
    );
    // The same +4 drift from every analyst — but they disagree about today's
    // level. Fair value is their weighted mean, so Σ wₘ(Mₘ − FV) = 0 and the
    // call must not move a hair.
    const split = rateDesk(
      [view("kalman", 62, 66), view("ewma", 66, 70), view("shrunk", 74, 78), view("trend", 78, 82)],
      ctx({ price: 70 }),
    );
    expect(split.expected).toBeCloseTo(agreed.expected, 6);
    expect(split.score).toBeCloseTo(agreed.score, 6);
    expect(split.dispersion).toBeGreaterThan(agreed.dispersion);
    expect(new Set(split.views.map((v) => v.rating)).size).toBeGreaterThan(1); // the desk is split
    expect(new Set(agreed.views.map((v) => v.rating)).size).toBe(1);
  });

  it("a deep discount does not pay the analysts — the gap is measured off fv", () => {
    const views = [view("kalman", 62, 66), view("ewma", 66, 70), view("shrunk", 74, 78), view("trend", 78, 82)];
    // Fair value is the weighted member mean (70); the mark is 15 points under
    // it. Measured against the mark every analyst would publish an extra φ·𝒟 of
    // pure bookkeeping, dispersion would inflate by (φ𝒟)², and the targets
    // would drift off the consensus they are supposed to bracket.
    const par = rateDesk(views, ctx({ price: 70, fv: 70 }));
    const marked = rateDesk(views, ctx({ price: 55, fv: 70 }));

    expect(marked.expected).toBeCloseTo(par.expected, 6);
    expect(marked.dispersion).toBeCloseTo(par.dispersion, 6);
    expect(marked.rating).toBe(par.rating);
    // Targets are quoted off the mark, so they move down with it — but they
    // still bracket the consensus target rather than sitting above it.
    expect(marked.targetLo).toBeLessThanOrEqual(marked.target!);
    expect(marked.targetHi).toBeGreaterThanOrEqual(marked.target!);
    // Σ wₘ(rₘ − r̄) = 0: the published views average back to the consensus.
    const w = marked.views.map((v) => v.weight / 100);
    const mean = marked.views.reduce((a, v, i) => a + w[i] * v.ret, 0);
    expect(mean).toBeCloseTo(marked.expected, 2);
  });

  it("analysts disagreeing about the DRIFT is real error and mutes the call", () => {
    const agreed = rateDesk(
      [view("kalman", 70, 72), view("ewma", 70, 72), view("shrunk", 70, 72), view("trend", 70, 72)],
      ctx(),
    );
    const split = rateDesk(
      [view("kalman", 70, 62), view("ewma", 70, 68), view("shrunk", 70, 74), view("trend", 70, 84)],
      ctx(),
    );
    expect(split.expected).toBeCloseTo(agreed.expected, 6); // same consensus drift…
    expect(split.risk).toBeGreaterThan(agreed.risk); // …but far less certain
    expect(Math.abs(split.score)).toBeLessThan(Math.abs(agreed.score));
    expect(split.conviction).toBeLessThan(agreed.conviction);
  });

  it("stale prints decay the signal toward HOLD", () => {
    const views = [view("kalman", 70), view("ewma", 70), view("shrunk", 70), view("trend", 70, 78)];
    const fresh = rateDesk(views, ctx({ staleDays: 0 }));
    const stale = rateDesk(views, ctx({ staleDays: 180 }));
    expect(Math.abs(stale.score)).toBeLessThan(Math.abs(fresh.score));
    expect(stale.conviction).toBeLessThan(fresh.conviction);
    expect(RATING_RANK[stale.rating]).toBeGreaterThan(RATING_RANK[fresh.rating]); // strictly less bullish
    expect(stale.note).toContain("SIGNAL DECAYED");
  });

  it("thin evidence shrinks the call — credibility is earned print by print", () => {
    const views = [view("kalman", 70), view("ewma", 70), view("shrunk", 70), view("trend", 70, 78)];
    expect(Math.abs(rateDesk(views, ctx({ n: 2 })).score))
      .toBeLessThan(Math.abs(rateDesk(views, ctx({ n: 20 })).score));
  });

  it("is uncovered at zero prints and merely initiated at one", () => {
    const none = rateDesk([], ctx({ n: 0 }));
    expect(none.rating).toBe("N/A");
    expect(none.target).toBeNull();
    expect(none.note).toContain("NO COVERAGE");

    const one = rateDesk([view("kalman", 70, 88)], ctx({ n: 1 }));
    expect(one.rating).toBe("N/A");
    expect(one.note).toContain("COVERAGE INITIATED");
    expect(one.target).toBe(88); // the target still publishes: 70 + 18
  });

  it("the consensus target is the weighted mean of the analyst targets", () => {
    // Levels average to the price, exactly as the ensemble guarantees.
    const r = rateDesk(
      [view("kalman", 66), view("ewma", 70, 72), view("shrunk", 72), view("trend", 78, 84)],
      ctx({ price: 71.5 }),
    );
    const weighted = r.views.reduce((a, v) => a + (v.weight / 100) * v.target, 0);
    expect(r.target!).toBeCloseTo(weighted, 1);
    expect(r.target!).toBeGreaterThanOrEqual(r.targetLo!);
    expect(r.target!).toBeLessThanOrEqual(r.targetHi!);
    expect(Object.values(r.distribution).reduce((a, b) => a + b, 0)).toBe(r.views.length);
  });

  it("the loudest analyst moves the consensus furthest", () => {
    const loud = rateDesk(
      [view("kalman", 70, 70, 4, 0.1), view("ewma", 70, 70, 4, 0.1), view("shrunk", 70, 70, 4, 0.1), view("trend", 70, 82, 4, 0.7)],
      ctx(),
    );
    const quiet = rateDesk(
      [view("kalman", 70, 70, 4, 0.3), view("ewma", 70, 70, 4, 0.3), view("shrunk", 70, 70, 4, 0.3), view("trend", 70, 82, 4, 0.1)],
      ctx(),
    );
    expect(loud.expected).toBeGreaterThan(quiet.expected);
    expect(loud.target!).toBeGreaterThan(quiet.target!);
  });

  it("conviction is the probability the call has the right sign", () => {
    const flat = rateDesk([view("kalman", 70), view("ewma", 70), view("shrunk", 70), view("trend", 70)], ctx());
    expect(flat.conviction).toBe(0); // no direction, no confidence
    const strong = rateDesk([view("kalman", 70), view("ewma", 70), view("shrunk", 70), view("trend", 70)], ctx({ carry: 4 }));
    expect(strong.conviction).toBeGreaterThan(80);
    expect(strong.conviction).toBeLessThanOrEqual(100);
  });
});

describe("benchmarkDrift", () => {
  const q = (price: number, drift: number, carry = 0): PriceResult =>
    ({ price, carry, forward: [{ name: "kalman", weight: 1, now: price, mean: price + drift, sd: 4 }] } as PriceResult);

  it("needs three priced desks before a benchmark means anything", () => {
    expect(benchmarkDrift([q(70, 5), q(60, 6)])).toBeNull();
    expect(benchmarkDrift([null, null, null])).toBeNull();
  });
  it("takes the median so one runaway desk cannot set the bar", () => {
    expect(benchmarkDrift([q(70, 2), q(60, 2), q(50, 2), q(40, 50)])).toBe(2);
  });
  it("counts the exam carry as part of the book's expected return", () => {
    expect(benchmarkDrift([q(70, 0, 1.5), q(60, 0, 1.5), q(50, 0, 1.5)])).toBe(1.5);
  });
});

describe("ratingMove", () => {
  it("reads the direction on the scale and ignores uncovered ends", () => {
    expect(ratingMove("HOLD", "BUY")).toBe("UPGRADE");
    expect(ratingMove("BUY", "STRONG SELL")).toBe("DOWNGRADE");
    expect(ratingMove("BUY", "BUY")).toBeNull();
    expect(ratingMove("N/A", "BUY")).toBeNull();
    expect(ratingMove(null, "BUY")).toBeNull();
  });
});

describe("rateBook — the whole desk, priced end to end", () => {
  it("a book that rises together rates flat; the desk left behind is marked down", () => {
    const risers = ["a", "b", "c"].map((id) => ({ sub: sub(id), entries: series(id, [60, 65, 70, 75, 80]) }));
    const flat = { sub: sub("d"), entries: series("d", [72, 72, 72, 72, 72]) };
    const { rated } = book([...risers, flat]);
    for (const r of risers) expect(rated.get(r.sub.id)!.rating.rating).toBe("HOLD");
    expect(RATING_RANK[rated.get("d")!.rating.rating]).toBeGreaterThan(RATING_RANK["HOLD"]);
  });

  it("a climbing desk in a flat book earns a buy", () => {
    const flats = ["a", "b", "c"].map((id) => ({ sub: sub(id), entries: series(id, [70, 70, 70, 70, 70]) }));
    const climber = { sub: sub("d"), entries: series("d", [60, 65, 70, 75, 80]) };
    const { rated } = book([...flats, climber]);
    const r = rated.get("d")!.rating;
    expect(RATING_RANK[r.rating]).toBeLessThan(RATING_RANK["HOLD"]);
    expect(r.upside!).toBeGreaterThan(0);
    expect(r.horizon).toBe(21); // the desk's own print cadence
  });

  it("a shuffled, no-correlation desk forecasts flat — noise is never a call", () => {
    const others = ["a", "b"].map((id) => ({ sub: sub(id), entries: series(id, [70, 72, 68, 71]) }));
    const noisy = { sub: sub("d"), entries: series("d", [72, 61, 80, 64, 78, 66]) };
    const { rated } = book([...others, noisy]);
    expect(rated.get("d")!.rating.rating).toBe("HOLD");
  });

  it("one wild print does not move the call — the engine is robust by design", () => {
    const { rated } = book([
      { sub: sub("a"), entries: series("a", [70, 70, 70, 70, 92]) },
      { sub: sub("b"), entries: series("b", [70, 70, 70, 70, 70]) },
      { sub: sub("c"), entries: series("c", [70, 70, 70, 70, 70]) },
    ]);
    const a = rated.get("a")!;
    expect(a.rating.rating).toBe("HOLD");
    expect(ratingMove(a.prev, a.rating.rating)).toBeNull();
  });

  it("an exam that beats the coursework price upgrades the desk", () => {
    const flat = (id: string) => ({
      sub: sub(id),
      entries: series(id, [70, 70, 70, [70, "Exam"], 70] as (number | [number, AssessmentType])[]),
    });
    const turn = {
      sub: sub("d"),
      entries: series("d", [70, 70, 70, [60, "Exam"], [88, "Exam"]] as (number | [number, AssessmentType])[]),
    };
    const { rated } = book([flat("a"), flat("b"), flat("c"), turn]);
    const d = rated.get("d")!;
    // The lone 60 exam said the desk pays badly — a sell-side call, but not a
    // wild one: the oracle shrinks a single exam toward the book rather than
    // marking the whole coursework tape down by the raw exam-coursework gap.
    expect(RATING_RANK[d.prev!]).toBeGreaterThan(RATING_RANK["HOLD"]);
    // …and one good exam lifts it off the sell side without buying it: a single
    // print may move the call, never hijack it.
    expect(RATING_RANK[d.rating.rating]).toBeLessThanOrEqual(RATING_RANK["HOLD"]);
    expect(ratingMove(d.prev, d.rating.rating)).toBe("UPGRADE");
  });

  it("an unpriced desk stays uncovered and never publishes a target", () => {
    const { rated } = book([{ sub: sub("a"), entries: [] }]);
    const r = rated.get("a")!;
    expect(r.rating.rating).toBe("N/A");
    expect(r.rating.target).toBeNull();
    expect(r.prev).toBeNull();
  });

  it("a two-desk book is rated absolute and says so", () => {
    const { rated } = book([
      { sub: sub("a"), entries: series("a", [60, 65, 70, 75, 80]) },
      { sub: sub("b"), entries: series("b", [70, 70, 70, 70, 70]) },
    ]);
    expect(rated.get("a")!.rating.note).toContain("RATED ABSOLUTE");
    expect(rated.get("a")!.rating.benchmark).toBe(0);
  });
});
