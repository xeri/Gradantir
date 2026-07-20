import { describe, expect, it } from "vitest";
import { buildWire } from "./headlines";
import { computeStats } from "./stats";
import { compositeNow } from "./composite";
import { iso } from "./utils";
import type { GradeEntry, Settings, Subject } from "../types";

const flat: Settings = { weights: { Exam: 3, Test: 2, Assignment: 1.5, Quiz: 1 }, weighted: false };
const sub: Subject = { id: "a", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: null };

const daysAgo = (d: number) => iso(new Date(Date.now() - d * 864e5));
let n = 0;
const entry = (date: string, score: number): GradeEntry =>
  ({ id: "e" + n++, subjectId: "a", date, type: "Test", score, title: "" });

describe("buildWire", () => {
  it("prints an ATH beat when the last result jumps above a flat run", () => {
    const es = [entry(daysAgo(60), 70), entry(daysAgo(45), 70), entry(daysAgo(30), 70), entry(daysAgo(15), 70), entry(daysAgo(1), 90)];
    const stats = computeStats([sub], es, flat);
    const wire = buildWire(stats, compositeNow(stats));
    const top = wire[0];
    expect(top.tag).toBe("MATH");
    expect(top.text).toContain("ALL-TIME HIGH 90.0");
    expect(top.tone).toBe("gain");
  });
  it("prints a miss when a result lands under the estimate", () => {
    const es = [entry(daysAgo(60), 80), entry(daysAgo(45), 80), entry(daysAgo(30), 80), entry(daysAgo(1), 60)];
    const stats = computeStats([sub], es, flat);
    const wire = buildWire(stats, compositeNow(stats));
    expect(wire.some((w) => w.text.includes("MISSES EST") && w.tone === "loss")).toBe(true);
  });
  it("never returns an empty wire", () => {
    const stats = computeStats([sub], [], flat);
    const wire = buildWire(stats, compositeNow(stats));
    expect(wire.length).toBeGreaterThan(0);
  });
  it("respects the cap", () => {
    const es = Array.from({ length: 30 }, (_, i) => entry(daysAgo(60 - i), 70 + (i % 9)));
    const stats = computeStats([sub], es, flat);
    expect(buildWire(stats, compositeNow(stats), 6).length).toBeLessThanOrEqual(6);
  });
});
