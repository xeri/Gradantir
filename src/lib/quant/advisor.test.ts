import { describe, expect, it } from "vitest";
import { advise } from "./advisor";
import type { AssessmentType, GradeEntry, PriceResult, Subject } from "../../types";

const sub = (id: string, ticker: string, target: number | null): Subject => ({
  id, name: ticker, ticker, color: "#4D7CFE", target,
});
let eid = 0;
const ge = (subjectId: string, date: string, score: number, type: AssessmentType = "Test"): GradeEntry => ({
  id: `e${eid++}`, subjectId, date, type, score, title: "",
});
const mkQuant = (price: number, p10: number): PriceResult => ({
  price, fv: price, discount: 0, premia: [], regime: "PRIME", sd: 5, df: 8,
  ci50: { lo: price - 3, hi: price + 3 },
  ci90: { lo: price - 8, hi: price + 8 },
  p10,
  lastExamPct: null, lastExamDate: null, prevPrice: null,
  nextExam: { mean: price, sd: 5, ci50: { lo: 0, hi: 100 }, ci90: { lo: 0, hi: 100 } },
  weights: {},
  horizonDays: 30, carry: 0, prevCarry: null, forward: [], prevForward: null,
});

const TODAY = "2026-07-01";
const steady = (id: string) =>
  ["2026-05-01", "2026-05-15", "2026-06-01", "2026-06-20"].map((d) => ge(id, d, 85));
const sliding = (id: string) =>
  ["2026-02-01", "2026-02-20", "2026-03-10", "2026-04-01", "2026-04-20"].map((d, i) => ge(id, d, 80 - 6 * i));

describe("advise", () => {
  it("a desk above target with fresh, flat prints is a low priority", () => {
    const calm = advise([{ sub: sub("a", "CALM", 80), quant: mkQuant(88, 84), entries: steady("a") }], TODAY);
    expect(calm[0].priority).toBeLessThan(25);
  });
  it("stale + sliding + under target ranks first with named reasons", () => {
    const out = advise(
      [
        { sub: sub("a", "CALM", 80), quant: mkQuant(88, 84), entries: steady("a") },
        { sub: sub("b", "PAIN", 85), quant: mkQuant(70, 58), entries: sliding("b") },
      ],
      TODAY,
    );
    expect(out[0].ticker).toBe("PAIN");
    expect(out[0].priority).toBeGreaterThan(out[1].priority);
    expect(out[0].reasons.length).toBeGreaterThan(0);
    expect(out[0].reasons.join(" ")).toContain("UNDER TARGET");
  });
  it("a desk without a target still ranks on risk, slide, and staleness", () => {
    const out = advise([{ sub: sub("b", "DRIFT", null), quant: mkQuant(70, 58), entries: sliding("b") }], TODAY);
    expect(out[0].gap).toBeNull();
    expect(out[0].priority).toBeGreaterThan(20);
  });
  it("sorts by priority descending and stays deterministic", () => {
    const inputs = [
      { sub: sub("a", "CALM", 80), quant: mkQuant(88, 84), entries: steady("a") },
      { sub: sub("b", "PAIN", 85), quant: mkQuant(70, 58), entries: sliding("b") },
      { sub: sub("c", "MID", 75), quant: mkQuant(72, 65), entries: steady("c") },
    ];
    const out = advise(inputs, TODAY);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].priority).toBeGreaterThanOrEqual(out[i].priority);
    expect(advise(inputs, TODAY)).toEqual(out);
  });
});
