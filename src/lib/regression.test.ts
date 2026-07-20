import { describe, expect, it } from "vitest";
import { linreg, subjectForecast, volatilityLabel } from "./regression";

describe("linreg", () => {
  it("fits a perfect line with zero residual", () => {
    const { slope, intercept, sigma } = linreg([0, 1, 2, 3].map((x) => ({ x, y: 10 + 2 * x })));
    expect(slope).toBeCloseTo(2);
    expect(intercept).toBeCloseTo(10);
    expect(sigma).toBeCloseTo(0);
  });
  it("handles a vertical stack without dividing by zero", () => {
    const r = linreg([{ x: 1, y: 5 }, { x: 1, y: 7 }]);
    expect(r.slope).toBe(0);
    expect(Number.isFinite(r.intercept)).toBe(true);
  });
});

describe("subjectForecast", () => {
  it("needs at least 3 results", () => {
    expect(subjectForecast([{ score: 70 }, { score: 72 }])).toBeNull();
  });
  it("projects the next point of a linear run", () => {
    const fc = subjectForecast([70, 72, 74, 76].map((score) => ({ score })))!;
    expect(fc.pred).toBeCloseTo(78);
    expect(fc.sigma).toBeCloseTo(0);
  });
  it("clamps predictions to 0–100", () => {
    const fc = subjectForecast([90, 94, 98].map((score) => ({ score })))!;
    expect(fc.pred).toBeLessThanOrEqual(100);
  });
  it("only uses the last 10 results", () => {
    const noisy = [10, 90, 10, 90, 10, ...[70, 71, 72, 73, 74, 75, 76, 77, 78, 79]].map((score) => ({ score }));
    const clean = [70, 71, 72, 73, 74, 75, 76, 77, 78, 79].map((score) => ({ score }));
    expect(subjectForecast(noisy)!.pred).toBeCloseTo(subjectForecast(clean)!.pred);
  });
});

describe("volatilityLabel", () => {
  it("maps spread to ratings", () => {
    expect(volatilityLabel(1)).toBe("Steady");
    expect(volatilityLabel(5)).toBe("Variable");
    expect(volatilityLabel(9)).toBe("Volatile");
  });
});
