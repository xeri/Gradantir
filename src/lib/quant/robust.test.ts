import { describe, expect, it } from "vitest";
import { dampedDrift, mad, median, shrunkSlope, theilSen, winsorizedMean } from "./robust";

describe("median / mad / winsorizedMean", () => {
  it("median handles empty, odd, even", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("mad is 0 below two points and scales to sd for normal-ish data", () => {
    expect(mad([])).toBe(0);
    expect(mad([7])).toBe(0);
    expect(mad([70, 70, 70, 70])).toBe(0);
    // deviations {2,1,0,1,2} → median 1 → 1.4826
    expect(mad([68, 69, 70, 71, 72])).toBeCloseTo(1.4826, 3);
  });
  /**
   * `median` is the engine's hottest primitive by a distance: Theil–Sen asks it
   * for the median of every PAIRWISE SLOPE, so one call on an 11-print tape
   * medians 55 numbers and one on a long tape medians thousands — and the
   * ensemble runs Theil–Sen once per walk-forward fold, four ensembles deep, for
   * every desk on the book. It is therefore selected rather than sorted, and
   * this is the lock that the selection returns exactly what a full sort would.
   *
   * The awkward cases are all here on purpose: even lengths (where the answer is
   * the mean of the two middles, so BOTH order statistics have to be right),
   * heavy duplicates (which is what a flat tape's slope array looks like — every
   * pivot equal), already-sorted and reverse-sorted input, and negatives.
   */
  it("median matches a full sort on every shape, and never touches its input", () => {
    const reference = (xs: number[]): number | null => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      const mid = s.length >> 1;
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    // A deterministic LCG — a fixed pseudo-random sweep beats a handful of
    // hand-picked arrays for a partition-based algorithm, and stays reproducible.
    let seed = 20260727;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    const shapes: number[][] = [
      [], [5], [1, 2], [2, 1], [3, 1, 2], [1, 2, 3, 4],
      [7, 7, 7, 7], [7, 7, 7], [-3, -1, -2], [0, -0, 0],
      Array.from({ length: 64 }, (_, i) => i),          // sorted
      Array.from({ length: 64 }, (_, i) => 64 - i),     // reverse sorted
      Array.from({ length: 65 }, () => 4),              // all equal, odd
      Array.from({ length: 64 }, (_, i) => (i % 3) - 1), // three values, even
    ];
    for (let n = 1; n <= 40; n++) {
      shapes.push(Array.from({ length: n }, () => Math.round(rnd() * 20) - 10));
      shapes.push(Array.from({ length: n }, () => rnd() * 200 - 100));
    }
    for (const xs of shapes) {
      const before = [...xs];
      expect(median(xs)).toBe(reference(xs));
      expect(xs).toEqual(before);
    }
  });

  it("winsorizedMean shrugs off a wild outlier at n≥5", () => {
    const clean = winsorizedMean([70, 72, 74, 76, 78])!;
    const spiked = winsorizedMean([70, 72, 74, 76, 5])!;
    expect(Math.abs(spiked - clean)).toBeLessThan(15);
    expect(winsorizedMean([])).toBeNull();
    // below 5 points it's a plain mean
    expect(winsorizedMean([0, 100])).toBe(50);
  });
});

describe("theilSen", () => {
  it("needs two points", () => {
    expect(theilSen([])).toBeNull();
    expect(theilSen([{ x: 0, y: 70 }])).toBeNull();
  });
  it("recovers an exact line from two points", () => {
    const ts = theilSen([{ x: 0, y: 60 }, { x: 10, y: 70 }])!;
    expect(ts.slope).toBeCloseTo(1, 6);
    expect(ts.intercept).toBeCloseTo(60, 6);
  });
  it("flat series → slope 0, p = 1 below n=4", () => {
    const ts = theilSen([{ x: 0, y: 70 }, { x: 5, y: 70 }, { x: 9, y: 70 }])!;
    expect(ts.slope).toBe(0);
    expect(ts.p).toBe(1);
  });
  it("skips duplicate-x pairs without dividing by zero", () => {
    const ts = theilSen([{ x: 0, y: 60 }, { x: 0, y: 62 }, { x: 10, y: 70 }]);
    expect(ts).not.toBeNull();
    expect(Number.isFinite(ts!.slope)).toBe(true);
  });
  it("returns null when every x is identical", () => {
    expect(theilSen([{ x: 3, y: 60 }, { x: 3, y: 70 }])).toBeNull();
  });
  it("a single outlier barely moves the slope", () => {
    const pts = [0, 1, 2, 3, 4, 5, 6].map((x) => ({ x, y: 70 + x }));
    const spiked = pts.map((p) => (p.x === 3 ? { ...p, y: 10 } : p));
    expect(theilSen(spiked)!.slope).toBeCloseTo(1, 0);
  });
  it("monotone data earns a small p, shuffled data a large one", () => {
    const up = [0, 1, 2, 3, 4, 5, 6, 7].map((x) => ({ x, y: 60 + 2 * x }));
    expect(theilSen(up)!.p).toBeLessThan(0.05);
    const noise = [70, 82, 64, 79, 68, 75, 73, 77].map((y, i) => ({ x: i, y }));
    expect(theilSen(noise)!.p).toBeGreaterThan(0.3);
  });
});

describe("shrunkSlope (the no-correlation gate)", () => {
  it("is 0 for null, tiny n, or insignificant trends", () => {
    expect(shrunkSlope(null)).toBe(0);
    expect(shrunkSlope(theilSen([{ x: 0, y: 60 }, { x: 1, y: 80 }]))).toBe(0); // n=2
    const noise = [70, 82, 64, 79, 68, 75, 73, 77].map((y, i) => ({ x: i, y }));
    expect(shrunkSlope(theilSen(noise))).toBe(0);
  });
  it("keeps most of a clearly significant slope", () => {
    const up = [0, 1, 2, 3, 4, 5, 6, 7].map((x) => ({ x, y: 60 + 2 * x }));
    const s = shrunkSlope(theilSen(up));
    expect(s).toBeGreaterThan(1.5);
    expect(s).toBeLessThanOrEqual(2);
  });
});

describe("dampedDrift — extrapolation that saturates instead of running away", () => {
  const TAU = 90;
  it("adds nothing at the anchor or for a non-positive horizon", () => {
    expect(dampedDrift(0.2, 0, TAU)).toBe(0);
    expect(dampedDrift(0.2, -30, TAU)).toBe(0);
  });
  it("is nearly the straight line when the horizon is short next to tau", () => {
    const s = 0.3, h = 3; // h ≪ tau ⇒ ≈ s·h
    expect(dampedDrift(s, h, TAU)).toBeCloseTo(s * h, 1);
  });
  it("caps the total drift at slope·tau however far out it is asked", () => {
    const s = 0.3;
    expect(dampedDrift(s, 1e6, TAU)).toBeCloseTo(s * TAU, 6);
    expect(Math.abs(dampedDrift(s, 400, TAU))).toBeLessThan(Math.abs(s * TAU));
  });
  it("sits below the undamped line at a long horizon — the anti-runaway", () => {
    const s = 0.3, h = 180;
    expect(dampedDrift(s, h, TAU)).toBeGreaterThan(0);
    expect(dampedDrift(s, h, TAU)).toBeLessThan(s * h);
  });
  it("follows the slope's sign and grows monotonically with the horizon", () => {
    expect(dampedDrift(-0.3, 60, TAU)).toBeLessThan(0);
    expect(dampedDrift(0.3, 60, TAU)).toBeGreaterThan(dampedDrift(0.3, 30, TAU));
  });
});
