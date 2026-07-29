import { describe, expect, it } from "vitest";
import { buildWire } from "./headlines";
import { computeStats } from "./stats";
import { freshSettings } from "../constants";
import { iso } from "./utils";
import type { GradeEntry, Settings, Signal, Subject } from "../types";

const flat: Settings = { ...freshSettings(), weighted: false };
const sub: Subject = { id: "a", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: null };
const subject = (id: string, ticker: string): Subject =>
  ({ id, name: ticker, ticker, color: "#4D7CFE", target: null });

const NO_COMP = { value: null, delta: null };
const daysAgo = (d: number) => iso(new Date(Date.now() - d * 864e5));
let n = 0;
const entry = (date: string, score: number): GradeEntry =>
  ({ id: "e" + n++, subjectId: "a", date, type: "Test", score, title: "" });
const entryFor = (
  subjectId: string, date: string, score: number, type: GradeEntry["type"] = "Test",
): GradeEntry => ({ id: "e" + n++, subjectId, date, type, score, title: "" });

const signal = (ticker: string, priority: number, reasons: string[] = []): Signal =>
  ({ id: ticker.toLowerCase(), ticker, priority, reasons, gap: null, downside: 3, slope30: 0, staleDays: 3 });

describe("buildWire", () => {
  it("prints an ATH beat when the last result jumps above a flat run", () => {
    const es = [entry(daysAgo(60), 70), entry(daysAgo(45), 70), entry(daysAgo(30), 70), entry(daysAgo(15), 70), entry(daysAgo(1), 90)];
    const stats = computeStats([sub], es, flat);
    const wire = buildWire(stats, NO_COMP);
    const top = wire[0];
    expect(top.tag).toBe("MATH");
    expect(top.text).toContain("ALL-TIME HIGH 90.0");
    expect(top.tone).toBe("gain");
  });
  it("prints a miss when a result lands under the estimate", () => {
    const es = [entry(daysAgo(60), 80), entry(daysAgo(45), 80), entry(daysAgo(30), 80), entry(daysAgo(1), 60)];
    const stats = computeStats([sub], es, flat);
    const wire = buildWire(stats, NO_COMP);
    expect(wire.some((w) => w.text.includes("MISSES EST") && w.tone === "loss")).toBe(true);
  });
  it("never returns an empty wire", () => {
    const stats = computeStats([sub], [], flat);
    const wire = buildWire(stats, NO_COMP);
    expect(wire.length).toBeGreaterThan(0);
  });
  it("respects the cap", () => {
    const es = Array.from({ length: 30 }, (_, i) => entry(daysAgo(60 - i), 70 + (i % 9)));
    const stats = computeStats([sub], es, flat);
    expect(buildWire(stats, NO_COMP, 6).length).toBeLessThanOrEqual(6);
  });
  it("prints the advisor's top signal as a standing note", () => {
    const es = [entry(daysAgo(30), 70), entry(daysAgo(15), 70)];
    const stats = computeStats([sub], es, flat);
    const wire = buildWire(stats, NO_COMP, 14, [
      { ...signal("MATH", 62, ["8.0 PTS UNDER TARGET", "SLIDING 2.1 PTS/30D"]), id: "a" },
    ]);
    const note = wire.find((w) => w.tag === "ADVISOR");
    expect(note).toBeDefined();
    expect(note!.text).toContain("MATH TOP PRIORITY");
    expect(note!.text).toContain("8.0 PTS UNDER TARGET");
  });
  it("prints the capability index move when the term shifted it", () => {
    const stats = computeStats([sub], [entry(daysAgo(30), 70), entry(daysAgo(15), 74)], flat);
    const wire = buildWire(stats, { value: 74.2, delta: 2.6 });
    const note = wire.find((w) => w.tag === "COMP");
    expect(note).toBeDefined();
    expect(note!.text).toContain("CAPABILITY INDEX UP 2.6");
    expect(note!.tone).toBe("gain");
  });
  it("skips the advisor note for a calm book", () => {
    const es = [entry(daysAgo(30), 70), entry(daysAgo(15), 70)];
    const stats = computeStats([sub], es, flat);
    const wire = buildWire(stats, NO_COMP, 14, [{ ...signal("MATH", 8), id: "a" }]);
    expect(wire.some((w) => w.tag === "ADVISOR")).toBe(false);
  });
});

describe("buildWire — the harsh multifactor tape", () => {
  const TODAY = "2026-06-01";
  const wireOf = (subs: Subject[], es: GradeEntry[], signals: Signal[] | null = null) =>
    buildWire(computeStats(subs, es, flat, TODAY), NO_COMP, 14, signals, TODAY);

  it("leads with the bleeding desk, not the healthy one", () => {
    const subs = [subject("b", "BBB"), subject("h", "HHH")];
    const es = [
      ...[80, 78, 76, 70, 60].map((s, i) => entryFor("b", `2026-0${1 + i}-28`, s)),
      ...[75, 75, 75, 75, 75].map((s, i) => entryFor("h", `2026-0${1 + i}-28`, s)),
    ];
    const wire = wireOf(subs, es);
    expect(wire[0].tag).toBe("BBB");
    expect(wire[0].tone).toBe("loss");
  });
  it("escalates a two-print miss streak and again at three", () => {
    const two = wireOf([subject("a", "MATH")], [80, 80, 80, 70, 62].map((s, i) => entryFor("a", `2026-0${1 + i}-10`, s)));
    expect(two.some((w) => w.text.includes("TWICE RUNNING"))).toBe(true);
    expect(two.some((w) => w.text.includes("THIRD CONSECUTIVE"))).toBe(false);
    n = 0;
    const three = wireOf([subject("a", "MATH")], [80, 80, 80, 70, 62, 55].map((s, i) => entryFor("a", `2026-0${1 + i}-10`, s)));
    expect(three.some((w) => w.text.includes("THIRD CONSECUTIVE MISS"))).toBe(true);
  });
  it("calls the whipsaw desk gambling against the book norm", () => {
    const subs = [subject("s1", "AAA"), subject("s2", "BBB"), subject("w", "WLD")];
    const es = [
      ...[69, 70, 71, 70, 72].map((s, i) => entryFor("s1", `2026-0${1 + i}-10`, s)),
      ...[67, 68, 69, 68, 70].map((s, i) => entryFor("s2", `2026-0${1 + i}-10`, s)),
      ...[55, 85, 50, 90, 60].map((s, i) => entryFor("w", `2026-0${1 + i}-10`, s)),
    ];
    const risk = wireOf(subs, es).find((w) => w.tag === "RISK");
    expect(risk).toBeDefined();
    expect(risk!.text).toContain("WLD");
    expect(risk!.text).toContain("× BOOK");
    expect(risk!.tone).toBe("warn");
  });
  it("reads sliding coursework as a red leading indicator for the exam", () => {
    const es = [
      entryFor("a", "2026-01-10", 80, "Exam"),
      entryFor("a", "2026-03-01", 70), entryFor("a", "2026-03-20", 65),
      entryFor("a", "2026-04-10", 58), entryFor("a", "2026-05-01", 55),
    ];
    const wire = wireOf([subject("a", "MATH")], es);
    const lead = wire.find((w) => /PRICES THE EXAM|FLASHING RED/.test(w.text));
    expect(lead).toBeDefined();
    expect(lead!.tone).toBe("loss");
  });
  it("names the execution gap when capability prints high and payout prints low", () => {
    const es = [
      entryFor("a", "2026-01-10", 72, "Exam"), entryFor("a", "2026-02-20", 68, "Exam"),
      entryFor("a", "2026-03-15", 66, "Exam"),
      entryFor("a", "2026-02-01", 85), entryFor("a", "2026-03-01", 88),
      entryFor("a", "2026-04-01", 90), entryFor("a", "2026-05-01", 92),
    ];
    const wire = wireOf([subject("a", "MATH")], es);
    const gap = wire.find((w) => w.text.includes("CONVERSION IS THE WHOLE JOB"));
    expect(gap).toBeDefined();
    expect(gap!.tone).toBe("loss");
  });
  it("flags a desk flying blind past its own coursework cadence", () => {
    const subs = [subject("s", "STL"), subject("r1", "RRA"), subject("r2", "RRB")];
    const es = [
      entryFor("s", "2026-01-05", 70), entryFor("s", "2026-01-25", 71), entryFor("s", "2026-02-15", 70),
      entryFor("r1", "2026-05-06", 70), entryFor("r1", "2026-05-13", 71), entryFor("r1", "2026-05-20", 70),
      entryFor("r2", "2026-05-13", 70), entryFor("r2", "2026-05-20", 71), entryFor("r2", "2026-05-27", 70),
    ];
    const wire = wireOf(subs, es);
    const blind = wire.find((w) => w.text.includes("FLYING BLIND"));
    expect(blind).toBeDefined();
    expect(blind!.tag).toBe("STL");
  });
  it("prints one book-level dark-tape item instead of per-desk stale spam", () => {
    const subs = [subject("x", "XXX"), subject("y", "YYY")];
    const es = [
      entryFor("x", "2026-01-01", 70), entryFor("x", "2026-01-15", 71), entryFor("x", "2026-02-01", 70),
      entryFor("y", "2026-01-01", 68), entryFor("y", "2026-01-15", 69), entryFor("y", "2026-02-01", 68),
    ];
    const wire = wireOf(subs, es);
    expect(wire.filter((w) => w.text.includes("TAPE DARK"))).toHaveLength(1);
    expect(wire.some((w) => w.text.includes("FLYING BLIND"))).toBe(false);
  });
  it("calls a book-wide margin call when most desks print red at a session", () => {
    const subs = [subject("d1", "DDA"), subject("d2", "DDB"), subject("d3", "DDC"), subject("d4", "DDD")];
    const es = [
      entryFor("d1", "2026-03-01", 75), entryFor("d1", "2026-04-01", 75), entryFor("d1", "2026-05-15", 60),
      entryFor("d2", "2026-03-01", 75), entryFor("d2", "2026-04-01", 75), entryFor("d2", "2026-05-15", 60),
      entryFor("d3", "2026-03-01", 75), entryFor("d3", "2026-04-01", 75), entryFor("d3", "2026-05-15", 60),
      entryFor("d4", "2026-03-01", 70), entryFor("d4", "2026-04-01", 70), entryFor("d4", "2026-05-15", 80),
    ];
    const wire = wireOf(subs, es);
    const breadth = wire.find((w) => w.tag === "BOOK");
    expect(breadth).toBeDefined();
    expect(breadth!.text).toContain("THREE OF FOUR");
    expect(breadth!.text).toContain("MARGIN CALL");
    expect(breadth!.tone).toBe("loss");
  });
  it("credits consistency exactly once, and only while it is earned", () => {
    const subs = [subject("c", "CLK"), subject("nz", "NZY")];
    const noisy = [60, 80, 55, 85, 65].map((s, i) => entryFor("nz", `2026-0${1 + i}-10`, s));
    const steady = [70, 71, 70, 71, 70, 71].map((s, i) => entryFor("c", `2026-0${1 + i}-10`, s));
    const praise = wireOf(subs, [...steady, ...noisy]).filter((w) => w.icon === "shield");
    expect(praise).toHaveLength(1);
    expect(praise[0].text).toContain("CONSISTENCY");
    expect(praise[0].tone).toBe("gain");
    n = 0;
    const sliding = [78, 76, 74, 72, 70, 68].map((s, i) => entryFor("c", `2026-0${1 + i}-10`, s));
    const noPraise = wireOf(subs, [...sliding, ...noisy]).filter((w) => w.icon === "shield");
    expect(noPraise).toHaveLength(0);
  });
  it("tells the desk to reallocate hours toward the weak line", () => {
    const subs = [subject("m", "MATH"), subject("p", "PHYS")];
    const es = [
      ...[62, 60, 61, 59].map((s, i) => entryFor("m", `2026-0${1 + i}-10`, s)),
      ...[85, 86, 85, 87].map((s, i) => entryFor("p", `2026-0${1 + i}-10`, s)),
    ];
    const wire = wireOf(subs, es, [{ ...signal("MATH", 62, ["DOWNSIDE RISK 6 PTS"]), id: "m" }, { ...signal("PHYS", 10), id: "p" }]);
    const rotate = wire.find((w) => w.text.includes("CAPITAL MISALLOCATION"));
    expect(rotate).toBeDefined();
    expect(rotate!.text).toContain("MATH");
    expect(rotate!.text).toContain("PHYS");
  });
  it("decays a dated story once newer prints supersede it", () => {
    const missDate = "2026-05-20";
    const older = [
      entryFor("a", "2026-02-10", 80), entryFor("a", "2026-03-10", 80), entryFor("a", "2026-04-10", 80),
    ];
    const fresh = wireOf([subject("a", "AAA")], [...older, entryFor("a", missDate, 60)]);
    n = 0;
    const superseded = wireOf([subject("a", "AAA")], [
      entryFor("a", "2026-02-10", 80), entryFor("a", "2026-03-10", 80), entryFor("a", "2026-04-10", 80),
      entryFor("a", missDate, 60), entryFor("a", "2026-05-25", 59), entryFor("a", "2026-05-28", 52),
    ]);
    const freshMiss = fresh.find((w) => w.text.includes("MISSES EST 80.0"));
    const oldMiss = superseded.find((w) => w.text.includes("MISSES EST 80.0"));
    expect(freshMiss).toBeDefined();
    expect(oldMiss).toBeDefined();
    expect(freshMiss!.severity!).toBeGreaterThan(oldMiss!.severity!);
  });
  it("caps one crisis desk at three standing notes so it cannot flood the tape", () => {
    const subs = [subject("cr", "CRS"), subject("ok", "OKD")];
    const es = [
      entryFor("cr", "2026-01-05", 85, "Exam"),
      entryFor("cr", "2026-02-10", 70), entryFor("cr", "2026-03-10", 64),
      entryFor("cr", "2026-04-10", 58), entryFor("cr", "2026-05-10", 50),
      ...[74, 75, 74, 75, 74].map((s, i) => entryFor("ok", `2026-0${1 + i}-12`, s)),
    ];
    const wire = wireOf(subs, es);
    expect(wire.filter((w) => w.tag === "CRS" && w.date === "").length).toBeLessThanOrEqual(3);
  });
});
