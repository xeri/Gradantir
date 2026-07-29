import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ancestorsOf, detectSplits, inheritedEntries, lineageRootOf, rosterAt } from "./lineage";
import { examAggregateHistory } from "./quant/aggregate";
import { buildRounds, examRounds } from "./rounds";
import { parseImport, sanitizeSettings } from "./io";
import { freshSettings } from "../constants";
import type { AppData, GradeEntry } from "../types";

/**
 * BOOK INTEGRITY — the standing guard against a doubled denominator.
 *
 * The AGGREGATE once reported 2025 out of 700 because ECON and BUS each carried
 * a copy of BEA's tape, so one desk was summed twice. These assertions are
 * written against the committed fixture book (anonymised from the real export)
 * and fail on the SHAPE of that mistake, not on the specific desks involved —
 * any future import that duplicates a tape trips them.
 */
const raw = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/book.json", import.meta.url)), "utf8"),
) as { data: Pick<AppData, "subjects" | "entries"> & { settings: Partial<AppData["settings"]> } };

const TODAY = "2026-07-22";
const { subjects, entries } = raw.data;
const settings = { ...freshSettings(), ...raw.data.settings };
const CAL = settings.calendar;
const sig = (e: GradeEntry) => `${e.date}|${e.type}|${e.score}`;

describe("the book carries no duplicated tape", () => {
  it("has nothing left for the split detector to find", () => {
    expect(detectSplits(subjects, entries)).toEqual([]);
  });

  it("never lets two desks on the book at once share a RUN of prints", () => {
    // Two desks scoring alike on one round day is a coincidence and this book
    // has one (ENG and GEO both printed the same mark in MID 24). A run of
    // three is not a coincidence — that is one tape wearing two names.
    const rounds = examRounds(buildRounds(entries, CAL)).filter((r) => r.date <= TODAY);
    let pairs = 0;
    for (const round of rounds) {
      const roster = rosterAt(subjects, entries, round.date, CAL);
      for (let i = 0; i < roster.length; i++) {
        for (let j = i + 1; j < roster.length; j++) {
          const a = new Set(roster[i].entries.map(sig));
          const shared = roster[j].entries.filter((e) => a.has(sig(e))).length;
          expect(
            `${round.key} ${roster[i].sub.ticker}/${roster[j].sub.ticker} shared=${shared >= 3}`,
          ).toBe(`${round.key} ${roster[i].sub.ticker}/${roster[j].sub.ticker} shared=false`);
          pairs++;
        }
      }
    }
    expect(pairs).toBeGreaterThan(0); // seated pairs were actually compared
  });

  it("never seats a desk together with a desk it descends from", () => {
    // Two SUCCESSORS of one ancestor may sit together — after the split, ECON
    // and BUS are genuinely two desks. What must never happen is a desk sharing
    // a round with its own ancestor, because then the ancestor's prints are
    // counted once on their own and again inside the successor.
    let checked = 0;
    for (const round of examRounds(buildRounds(entries, CAL)).filter((r) => r.date <= TODAY)) {
      const roster = rosterAt(subjects, entries, round.date, CAL);
      const seated = new Set(roster.map((r) => r.sub.id));
      for (const r of roster) {
        const clash = ancestorsOf(r.sub, subjects).filter((a) => seated.has(a.id));
        expect(`${round.key} ${r.sub.ticker} <- ${clash.map((c) => c.ticker).join(",")}`).toBe(
          `${round.key} ${r.sub.ticker} <- `,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // rounds actually seated desks to check
  });

  it("gives ECON and BUS the same lineage root and MATH its own", () => {
    const root = (tk: string) => lineageRootOf(subjects.find((s) => s.ticker === tk)!, subjects).ticker;
    expect(root("ECON")).toBe("BEA");
    expect(root("BUS")).toBe("BEA");
    expect(root("MATH")).toBe("MATH");
  });
});

describe("every round is scored out of the desks that actually sat it", () => {
  const hist = examAggregateHistory(subjects, entries, TODAY, CAL);

  it("puts six desks on every round of this book", () => {
    expect(hist).toHaveLength(7); // else "for every round" asserts nothing
    for (const p of hist) expect(`${p.key} ${p.outOf}`).toBe(`${p.key} 600`);
  });

  it("keeps outOf equal to 100 × the desks counted, always", () => {
    expect(hist.length).toBeGreaterThan(0);
    for (const p of hist) {
      expect(p.outOf % 100).toBe(0);
      expect(p.pct).toBeCloseTo((100 * p.sum) / p.outOf, 1); // the point is rounded to 1dp
      expect(p.pct).toBeLessThanOrEqual(100);
    }
  });
});

describe("lineage survives the round trip", () => {
  it("keeps `formerly` through an import — losing it would orphan the successors", () => {
    const parsed = parseImport(
      readFileSync(fileURLToPath(new URL("./__fixtures__/book.json", import.meta.url)), "utf8"),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const bea = parsed.payload.subjects.find((s) => s.ticker === "BEA")!;
    for (const tk of ["ECON", "BUS"]) {
      expect(parsed.payload.subjects.find((s) => s.ticker === tk)!.formerly).toBe(bea.id);
    }
    // And the imported book still prices as one lineage, not three subjects.
    expect(detectSplits(parsed.payload.subjects, parsed.payload.entries)).toEqual([]);
  });

  it("cuts a pointer to a desk the file does not contain rather than truncating a tape", () => {
    const broken = JSON.stringify({
      subjects: [{ id: "a", name: "Alpha", ticker: "A", formerly: "ghost" }],
      entries: [{ id: "e1", subjectId: "a", date: "2026-04-08", type: "Exam", score: 70, title: "x" }],
    });
    const parsed = parseImport(broken);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.subjects[0].formerly).toBeNull();
  });

  it("remembers a dismissal so the prompt never returns", () => {
    expect(sanitizeSettings({ ignoredSplits: ["a+b", "a+b", ""] }).ignoredSplits).toEqual(["a+b"]);
  });
});

describe("a split desk keeps the years behind it", () => {
  it("prices ECON and BUS off BEA's tape, not off their single own print", () => {
    const econ = subjects.find((s) => s.ticker === "ECON")!;
    const bus = subjects.find((s) => s.ticker === "BUS")!;
    const bea = subjects.find((s) => s.ticker === "BEA")!;

    expect(econ.formerly).toBe(bea.id);
    expect(bus.formerly).toBe(bea.id);

    // Own prints: one apiece, the April 2026 paper they diverged on.
    expect(entries.filter((e) => e.subjectId === econ.id)).toHaveLength(1);
    expect(entries.filter((e) => e.subjectId === bus.id)).toHaveLength(1);

    // Inherited: BEA's five prints in front of it.
    expect(inheritedEntries(econ, subjects, entries)).toHaveLength(6);
    expect(inheritedEntries(bus, subjects, entries)).toHaveLength(6);
  });

  it("stores BEA's tape exactly once across the whole book", () => {
    const bea = subjects.find((s) => s.ticker === "BEA")!;
    const beaPrints = entries.filter((x) => x.subjectId === bea.id);
    expect(beaPrints.length).toBeGreaterThan(0); // BEA must have a tape to guard
    for (const e of beaPrints) {
      expect(entries.filter((x) => sig(x) === sig(e) && x.subjectId !== bea.id)).toEqual([]);
    }
  });
});
