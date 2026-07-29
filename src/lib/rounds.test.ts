import { describe, expect, it } from "vitest";
import { buildRounds, examRounds, labelRounds, pendingRound, roundLabels, roundName } from "./rounds";
import { freshCalendar } from "./calendar";
import type { GradeEntry } from "../types";

const CAL = freshCalendar();

let seq = 0;
const e = (date: string, title: string, opts: Partial<GradeEntry> = {}): GradeEntry => ({
  id: `e${seq++}`,
  subjectId: opts.subjectId ?? "s1",
  date,
  type: opts.type ?? "Exam",
  score: opts.score ?? 70,
  title,
  ...opts,
});

/** The real book's shape: three rounds a year, nothing in Term 3. */
const BOOK: GradeEntry[] = [
  e("2025-04-30", "Term 1 2025"),
  e("2025-08-01", "Mid-Year 2025"),
  e("2025-08-01", "Course work · Mid-Year 2025", { type: "Assignment", subjectId: "s2" }),
  e("2025-12-03", "End of Year 2025"),
  e("2026-04-08", "Term 1 2026"),
];

describe("roundName", () => {
  it("reads the shared title of the papers in the round", () => {
    expect(roundName([e("2025-08-01", "Mid-Year 2025"), e("2025-08-01", "Mid-Year 2025")])).toBe("MID");
    expect(roundName([e("2026-04-08", "Term 1 2026")])).toBe("T1");
    expect(roundName([e("2025-12-03", "End of Year 2025")])).toBe("EOY");
  });
  it("ignores the coursework prefix and the year", () => {
    expect(roundName([
      e("2025-08-01", "Mid-Year 2025"),
      e("2025-08-01", "Course work · Mid-Year 2025", { type: "Assignment" }),
    ])).toBe("MID");
  });
  it("lets the exams name the round when coursework disagrees", () => {
    expect(roundName([
      e("2025-08-01", "Mid-Year 2025"),
      e("2025-08-01", "Portfolio hand-in", { type: "Assignment" }),
    ])).toBe("MID");
  });
  it("takes a school's own word for it", () => {
    expect(roundName([e("2025-08-01", "Michaelmas exams 2025"), e("2025-08-01", "Michaelmas exams 2025")])).toBe("MICHAELMA");
  });
  it("stays anonymous when the titles share nothing", () => {
    expect(roundName([e("2025-08-01", "Algebra"), e("2025-08-01", "Poetry")])).toBeNull();
    expect(roundName([e("2025-08-01", "")])).toBeNull();
  });
  it("never returns half a word", () => {
    // "Term 1" and "Term 2" share "Term " — a stem that names neither.
    expect(roundName([e("2025-04-30", "Term 1 2025"), e("2025-04-30", "Term 2 2025")])).toBe("TERM");
  });
});

describe("buildRounds", () => {
  const rounds = buildRounds(BOOK, CAL);

  it("finds one round per term that printed, and none for terms that did not", () => {
    expect(rounds.map((r) => r.key)).toEqual(["2025-T1", "2025-T2", "2025-T4", "2026-T1"]);
  });
  it("names each round off the book", () => {
    expect(rounds.map((r) => r.label)).toEqual(["T1 25", "MID 25", "EOY 25", "T1 26"]);
  });
  it("strikes each round on its last print", () => {
    expect(rounds[1].date).toBe("2025-08-01");
    expect(rounds[1].n).toBe(2);
    expect(rounds[1].exams).toBe(1);
  });
  it("keeps the plain term label alongside the name", () => {
    expect(rounds[1].termLabel).toBe("T2 2025");
  });
  it("honors a hand-filed term over the date", () => {
    const pinned = buildRounds([...BOOK, e("2026-07-30", "Late paper", { term: "2026-T3" })], CAL);
    expect(pinned.map((r) => r.key)).toContain("2026-T3");
  });
  it("drops a round from the exam tape when it printed only coursework", () => {
    const cwOnly = buildRounds([e("2026-06-01", "Project", { type: "Assignment" })], CAL);
    expect(cwOnly).toHaveLength(1);
    expect(examRounds(cwOnly)).toHaveLength(0);
  });
});

describe("pendingRound — the next paper, learned not assumed", () => {
  it("names the term the book's own rhythm says is next", () => {
    // Rhythm is T1 / T2 / T4; the last round was T1 26, so the mid-year is due.
    const p = pendingRound(buildRounds(BOOK, CAL), "2026-07-22", CAL)!;
    expect(p.key).toBe("2026-T2");
    expect(p.label).toBe("MID 26");
    expect(p.termLabel).toBe("T2 2026");
  });
  it("skips terms this school never examines in", () => {
    // Standing in T3's window with the mid-year already filed: T3 is not in the
    // rhythm, so the next paper is the end-of-year one.
    const book = [...BOOK, e("2026-08-05", "Mid-Year 2026")];
    const p = pendingRound(buildRounds(book, CAL), "2026-09-01", CAL)!;
    expect(p.key).toBe("2026-T4");
    expect(p.label).toBe("EOY 26");
  });
  it("adopts a new term the moment the school examines in it", () => {
    const base = [...BOOK, e("2026-08-05", "Mid-Year 2026"), e("2027-04-30", "Term 1 2027"), e("2027-08-05", "Mid-Year 2027")];
    // Rhythm T1/T2/T4: after the 2027 mid-year, the next paper is the EOY one.
    expect(pendingRound(buildRounds(base, CAL), "2027-08-20", CAL)!.key).toBe("2027-T4");
    // Sit one Term 3 paper, ever, and Term 3 joins the rhythm by itself.
    const withT3 = [...base, e("2026-09-20", "Term 3 2026")];
    expect(pendingRound(buildRounds(withT3, CAL), "2027-08-20", CAL)!.key).toBe("2027-T3");
  });
  it("never looks back at a term whose window has closed", () => {
    const p = pendingRound(buildRounds(BOOK, CAL), "2027-03-01", CAL)!;
    expect(p.key).toBe("2027-T1");
  });
  it("has nothing to say about a book with no exams", () => {
    expect(pendingRound(buildRounds([e("2026-06-01", "Project", { type: "Assignment" })], CAL), "2026-07-22", CAL)).toBeNull();
    expect(pendingRound([], "2026-07-22", CAL)).toBeNull();
  });
});

describe("labelRounds", () => {
  it("renames term buckets to the rounds that filled them", () => {
    const rows = [{ key: "2025-T2", label: "T2 2025" }, { key: "2026-T3", label: "T3 2026" }];
    labelRounds(rows, roundLabels(BOOK, CAL));
    expect(rows.map((r) => r.label)).toEqual(["MID 25", "T3 2026"]);
  });
});
