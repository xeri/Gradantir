import { describe, expect, it } from "vitest";
import { assertRoster, rosterAt, supersededBy } from "./lineage";
import { listedAsOf } from "./listing";
import { sanitizeBook } from "./io";
import { examAggregate } from "./quant/aggregate";
import type { GradeEntry, Subject } from "../types";

/**
 * THE RELIST HOLE.
 *
 * `applySplit` archives the ancestor, which is the only thing keeping the
 * lineage invariant true: a round may never seat a desk and a desk it descends
 * from, or the ancestor's prints are counted twice. Nothing enforced that
 * afterwards. "Relist — trade this desk again" un-archives ANY closed desk,
 * ancestors included, and `assertRoster` is compiled out of a production build —
 * so the aggregate, the composite index and every cross-desk headline went
 * quietly wrong and stayed wrong, with no way for a student to see it.
 *
 * The same hole is reachable without touching the drawer: a stored or imported
 * book that already violates the rule was loaded verbatim, because `sanitizeBook`
 * checked that `formerly` POINTS somewhere but never that the desk it points at
 * had stopped reporting.
 */

const sub = (id: string, over: Partial<Subject> = {}): Subject => ({
  id, name: id.toUpperCase(), ticker: id.toUpperCase(), color: "#fff",
  target: null, courseworkPct: null, ...over,
});

let n = 0;
const ex = (subjectId: string, date: string, score: number): GradeEntry => ({
  id: `e${++n}`, subjectId, date, type: "Exam", score, title: "Exam",
});

describe("supersededBy — who has taken over a desk's tape", () => {
  it("names the successor that now carries the lineage", () => {
    const bea = sub("bea", { archived: true });
    const econ = sub("econ", { formerly: "bea" });
    const all = [bea, econ];
    const tape = [ex("bea", "2024-05-01", 60), ex("econ", "2025-05-01", 70)];
    expect(supersededBy(bea, all, tape)?.id).toBe("econ");
  });

  it("leaves a desk whose successor has not printed yet alone", () => {
    // The successor only takes over once it reports under its own name — the
    // same rule `crossSectionAt` already applies.
    const bea = sub("bea");
    const econ = sub("econ", { formerly: "bea" });
    const all = [bea, econ];
    expect(supersededBy(bea, all, [ex("bea", "2024-05-01", 60)])).toBeNull();
  });

  it("reaches through a chain the middle of which never printed", () => {
    const sci = sub("sci", { archived: true });
    const phys = sub("phys", { formerly: "sci" });
    const adv = sub("adv", { formerly: "phys" });
    const all = [sci, phys, adv];
    const tape = [ex("sci", "2024-05-01", 60), ex("adv", "2026-05-01", 80)];
    expect(supersededBy(sci, all, tape)?.id).toBe("adv");
  });

  it("never reports a successor as superseding itself, or an unrelated desk", () => {
    const bea = sub("bea", { archived: true });
    const econ = sub("econ", { formerly: "bea" });
    const math = sub("math");
    const all = [bea, econ, math];
    const tape = [ex("bea", "2024-05-01", 60), ex("econ", "2025-05-01", 70), ex("math", "2025-05-01", 90)];
    expect(supersededBy(econ, all, tape)).toBeNull();
    expect(supersededBy(math, all, tape)).toBeNull();
  });

  it("survives a hand-edited cycle rather than hanging", () => {
    const a = sub("a", { formerly: "b" });
    const b = sub("b", { formerly: "a" });
    const tape = [ex("a", "2025-05-01", 60), ex("b", "2025-06-01", 70)];
    expect(() => supersededBy(a, [a, b], tape)).not.toThrow();
  });
});

describe("a relisted ancestor cannot double-count its own history", () => {
  /* The exact book the drawer's Relist button used to be able to produce. */
  const bea = sub("bea");           // relisted: `archived` gone
  const econ = sub("econ", { formerly: "bea" });
  const roster = [bea, econ];
  const tape = [
    ex("bea", "2024-05-01", 60), ex("bea", "2024-11-01", 62),
    ex("econ", "2025-05-01", 90), ex("econ", "2025-11-01", 92),
  ];

  it("is the violation the invariant exists to forbid", () => {
    expect(() => assertRoster(rosterAt(roster, tape, "2025-12-01"), roster)).toThrow(/lineage violation/);
  });

  it("gives the honest one-desk headline once repaired", () => {
    /* THE DAMAGE, STATED AS THE FIX. Unrepaired, this book seats two desks where
       there is one lineage: ECON's 92 is joined by BEA's stale 62, so the
       headline reads 154/200 = 77 and the student's average is dragged down by
       their own history being counted a second time. Repaired, BEA is delisted,
       `listedAsOf` drops it, and the headline is ECON's 92/100 alone. */
    const clean = sanitizeBook(roster, tape);
    const rows = listedAsOf(
      clean.subjects.map((s) => ({ sub: s, entries: clean.entries.filter((e) => e.subjectId === s.id) })),
      "2025-12-01",
    );
    expect(rows.map((r) => r.sub.id)).toEqual(["econ"]);
    const agg = examAggregate(rows);
    expect(agg?.count).toBe(1);
    expect(agg?.sum).toBe(92);
    expect(agg?.outOf).toBe(100);
  });

  it("is repaired at the boundary: the ancestor comes back delisted", () => {
    const clean = sanitizeBook(roster, tape);
    const cleanBea = clean.subjects.find((s) => s.id === "bea");
    const cleanEcon = clean.subjects.find((s) => s.id === "econ");
    expect(cleanBea?.archived).toBe(true);
    // The repair delists; it never cuts the lineage or drops a print.
    expect(cleanEcon?.formerly).toBe("bea");
    expect(clean.entries).toHaveLength(4);
    // And the invariant now holds on the repaired book.
    expect(() =>
      assertRoster(rosterAt(clean.subjects, clean.entries, "2025-12-01"), clean.subjects),
    ).not.toThrow();
  });

  it("leaves a book that already obeys the rule byte-identical", () => {
    const ok = [sub("bea", { archived: true }), econ];
    const clean = sanitizeBook(ok, tape);
    expect(clean.subjects.find((s) => s.id === "bea")?.archived).toBe(true);
    // Untouched where it matters: the successor keeps its lineage and stays listed.
    const cleanEcon = clean.subjects.find((s) => s.id === "econ");
    expect(cleanEcon?.formerly).toBe("bea");
    expect(cleanEcon?.archived).toBeUndefined();
  });

  it("does not delist a live desk whose successor has not printed", () => {
    const live = [sub("bea"), sub("econ", { formerly: "bea" })];
    const onlyBea = [ex("bea", "2024-05-01", 60)];
    const clean = sanitizeBook(live, onlyBea);
    expect(clean.subjects.find((s) => s.id === "bea")?.archived).toBeUndefined();
  });
});
