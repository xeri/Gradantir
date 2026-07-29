import { describe, expect, it } from "vitest";
import { EXPORT_VERSION, mergeData, parseImport, replaceData, sanitizeSettings, serializeExport } from "./io";
import { DEFAULT_SETTINGS, freshSettings } from "../constants";
import type { AppData } from "../types";

const book: AppData = {
  subjects: [
    { id: "s1", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: 85, courseworkPct: 40 },
    { id: "s2", name: "English", ticker: "ENG", color: "#FF7A3D", target: null, courseworkPct: null },
  ],
  entries: [
    {
      id: "e1", subjectId: "s1", date: "2026-05-01", type: "Exam", score: 82, title: "Mid-year",
      classAvg: 75, yearAvg: 70.5, rank: 12, cohortN: 140, worthPct: 30,
    },
    {
      id: "e2", subjectId: "s2", date: "2026-05-08", type: "Quiz", score: 91, title: "",
      classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null,
    },
  ],
  settings: freshSettings(),
  sample: false,
};

describe("the register is not part of the book (v8)", () => {
  /* The engine's own predictions used to be stored and round-tripped here. They
     are derived state — replayed from the tape on every load (§26) — so an
     export must not carry them and an import must not trust them. */
  const REGISTER = [
    { id: "s1|2026-T2|exam|gx-1", subjectId: "s1", roundKey: "2026-T2", target: "exam", createdAt: "2026-05-01", modelVersion: "gx-1", point: 74, sd: 6, df: 8, ci90: { lo: 64, hi: 84 }, resolvedEntryId: "e1", resolvedAt: "2026-08-01", realized: 71, error: 3, crps: 2.1, is90: 12 },
  ];

  it("never writes predictions into an export", () => {
    const env = JSON.parse(serializeExport(book));
    expect(env.version).toBe(9);
    expect("forecasts" in env.data).toBe(false);
  });

  it("imports an older book that carries one, and ignores it", () => {
    const legacy = JSON.stringify({
      app: "grade-exchange", version: 7, data: { ...book, forecasts: REGISTER },
    });
    const res = parseImport(legacy);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("forecasts" in res.payload).toBe(false);
    // The book itself still lands intact — the prints are what matter.
    expect(res.payload.subjects).toHaveLength(book.subjects.length);
    expect(res.payload.entries).toHaveLength(book.entries.length);
  });

  it("neither replaces nor merges a register into the book", () => {
    const legacy = parseImport(JSON.stringify({
      app: "grade-exchange", version: 7, data: { ...book, forecasts: REGISTER },
    }));
    if (!legacy.ok) throw new Error("fixture failed to parse");
    expect("forecasts" in replaceData(legacy.payload)).toBe(false);
    expect("forecasts" in mergeData(book, legacy.payload)).toBe(false);
  });

  it("emits every elicited section, empty ones included", () => {
    const env = JSON.parse(serializeExport(book));
    for (const key of ["upcoming", "allocations", "duels", "meanCalls"]) {
      expect(env.data[key]).toEqual([]);
    }
  });
});

describe("forward calendar persistence (v7)", () => {
  const withCalendar: AppData = {
    ...book,
    upcoming: [
      {
        id: "u1", subjectId: "s1", date: "2026-09-01", type: "Exam", title: "Finals",
        weight: 50, syllabusCoverage: 80,
        selfPred: { point: 78, lo: 70, hi: 86 }, teacherPred: 82,
        chips: [0, 0, 1, 3, 4, 2],
        aiPred: { point: 74, lo: 66, hi: 83, basis: "Trend is flat; coverage 80% argues against the optimism." },
      },
      { id: "u2", subjectId: "s2", date: "2026-09-05", type: "Test", title: "" },
    ],
    allocations: [
      { id: "a1", roundKey: "2026-T3", total: 100, planned: { s1: 60, s2: 40 }, actual: { s1: 70, s2: 30 }, createdAt: "2026-08-01" },
    ],
    duels: [{ id: "d1", aId: "s1", bId: "s2", winnerId: "s1", createdAt: "2026-08-02" }],
    meanCalls: [{ id: "m1", roundKey: "2026-T3", predAvg: 74, ranking: ["s1", "s2"], createdAt: "2026-08-03" }],
  };
  it("round-trips the whole forward calendar through serialize → parse", () => {
    const res = parseImport(serializeExport(withCalendar));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.upcoming).toEqual(withCalendar.upcoming);
    expect(res.payload.allocations).toEqual(withCalendar.allocations);
    expect(res.payload.duels).toEqual(withCalendar.duels);
    expect(res.payload.meanCalls).toEqual(withCalendar.meanCalls);
  });
  it("carries the weekly hour budget an effort plan was drawn against", () => {
    const dirty = {
      ...book,
      allocations: [
        { id: "a1", roundKey: "2026-T3", total: 100, planned: { s1: 60, s2: 40 }, hoursPerWeek: 12.5, createdAt: "2026-08-01" },
      ],
    };
    const res = parseImport(JSON.stringify({ app: "grade-exchange", version: 7, data: dirty }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.allocations[0].hoursPerWeek).toBe(12.5);
  });
  it("drops an unusable hour budget rather than the whole effort plan", () => {
    const dirty = {
      ...book,
      allocations: [
        { id: "a1", roundKey: "2026-T3", total: 100, planned: { s1: 60, s2: 40 }, hoursPerWeek: -3, createdAt: "2026-08-01" },
        { id: "a2", roundKey: "2026-T2", total: 100, planned: { s1: 50, s2: 50 }, hoursPerWeek: "lots", createdAt: "2026-05-01" },
      ],
    };
    const res = parseImport(JSON.stringify({ app: "grade-exchange", version: 7, data: dirty }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.allocations).toHaveLength(2);
    expect(res.payload.allocations[0].hoursPerWeek).toBeUndefined();
    expect(res.payload.allocations[1].hoursPerWeek).toBeUndefined();
  });
  it("drops an upcoming for an unknown subject and a duel over one", () => {
    const dirty = {
      ...book,
      upcoming: [
        { id: "g1", subjectId: "ghost", date: "2026-09-01", type: "Exam", title: "" },
        { id: "u1", subjectId: "s1", date: "bad", type: "Exam", title: "" },
      ],
      duels: [{ id: "d1", aId: "s1", bId: "ghost", winnerId: "s1", createdAt: "2026-08-02" }],
    };
    const res = parseImport(JSON.stringify({ app: "grade-exchange", version: 7, data: dirty }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.upcoming).toEqual([]);
    expect(res.payload.duels).toEqual([]);
  });
  it("clamps a self-prediction and coverage into range, drops garbage chips", () => {
    const dirty = {
      ...book,
      upcoming: [
        {
          id: "u1", subjectId: "s1", date: "2026-09-01", type: "Exam", title: "",
          syllabusCoverage: 150, selfPred: { point: 120 }, teacherPred: -4, chips: "lots",
        },
      ],
    };
    const res = parseImport(JSON.stringify({ app: "grade-exchange", version: 7, data: dirty }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const u = res.payload.upcoming[0];
    expect(u.syllabusCoverage).toBe(100);
    expect(u.selfPred).toEqual({ point: 100 });
    expect(u.teacherPred).toBe(0);
    expect(u.chips).toBeUndefined();
  });
  it("keeps a point-only wire call, and the row when the call is garbage", () => {
    const dirty = {
      ...book,
      upcoming: [
        { id: "u1", subjectId: "s1", date: "2026-09-01", type: "Exam", title: "", aiPred: { point: 130 } },
        { id: "u2", subjectId: "s1", date: "2026-09-02", type: "Test", title: "", aiPred: { point: NaN, lo: 60 } },
        { id: "u3", subjectId: "s1", date: "2026-09-03", type: "Quiz", title: "", aiPred: "high" },
      ],
    };
    const res = parseImport(JSON.stringify({ app: "grade-exchange", version: 8, data: dirty }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.upcoming).toHaveLength(3);
    expect(res.payload.upcoming[0].aiPred).toEqual({ point: 100 });
    expect(res.payload.upcoming[1].aiPred).toBeUndefined();
    expect(res.payload.upcoming[2].aiPred).toBeUndefined();
  });
  it("trims the wire's basis to 160 characters and drops a blank one", () => {
    const dirty = {
      ...book,
      upcoming: [
        { id: "u1", subjectId: "s1", date: "2026-09-01", type: "Exam", title: "", aiPred: { point: 70, basis: "x".repeat(200) } },
        { id: "u2", subjectId: "s1", date: "2026-09-02", type: "Test", title: "", aiPred: { point: 70, basis: "   " } },
      ],
    };
    const res = parseImport(JSON.stringify({ app: "grade-exchange", version: 8, data: dirty }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.upcoming[0].aiPred?.basis).toHaveLength(160);
    expect(res.payload.upcoming[1].aiPred).toEqual({ point: 70 });
  });
  it("the wire's switch survives only as an explicit true (v9)", () => {
    expect(sanitizeSettings({ ...freshSettings(), aiWeighting: true }).aiWeighting).toBe(true);
    expect(sanitizeSettings({ ...freshSettings(), aiWeighting: false }).aiWeighting).toBeUndefined();
    expect(sanitizeSettings({ ...freshSettings(), aiWeighting: "yes" }).aiWeighting).toBeUndefined();
    // A v8 book that never heard of the switch imports with the channel off.
    expect(sanitizeSettings(freshSettings()).aiWeighting).toBeUndefined();
  });
  it("merge lets an incoming wire call overwrite its own sitting, and drops it with a remapped desk", () => {
    const current: AppData = {
      ...book,
      upcoming: [{ id: "u1", subjectId: "s1", date: "2026-09-01", type: "Exam", title: "Finals" }],
    };
    const incoming = parseImport(serializeExport({
      ...book,
      upcoming: [{ id: "u1", subjectId: "s1", date: "2026-09-01", type: "Exam", title: "Finals", aiPred: { point: 74 } }],
    }));
    if (!incoming.ok) throw new Error("fixture failed to parse");
    expect(mergeData(current, incoming.payload).upcoming?.[0].aiPred).toEqual({ point: 74 });

    // Same payload against a book where "s1" is a DIFFERENT desk: the subject is
    // re-listed under a fresh id, so the behavioural row's ref breaks and the
    // whole row — wire call included — stays out (keepsRefs).
    const other: AppData = {
      ...book,
      subjects: [{ id: "s1", name: "History", ticker: "HIST", color: "#4D7CFE", target: null, courseworkPct: null }],
      entries: [],
    };
    expect(mergeData(other, incoming.payload).upcoming ?? []).toEqual([]);
  });
  it("a book with no forward calendar imports to empty arrays", () => {
    const res = parseImport(serializeExport(book));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.upcoming).toEqual([]);
    expect(res.payload.allocations).toEqual([]);
    expect(res.payload.duels).toEqual([]);
    expect(res.payload.meanCalls).toEqual([]);
  });
});

describe("export/import roundtrip", () => {
  it("survives serialize → parse unchanged", () => {
    const res = parseImport(serializeExport(book));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.subjects).toEqual(book.subjects);
    expect(res.payload.entries).toEqual(book.entries);
    expect(res.payload.settings).toEqual(book.settings);
    expect(res.payload.dropped).toBe(0);
  });

  it("carries the censored and regime-break flags through, and only when truly set", () => {
    const flagged: AppData = {
      ...book,
      entries: [
        { ...book.entries[0], censored: true, regimeBreak: true },
        { ...book.entries[1], censored: false, regimeBreak: false },
      ],
    };
    const res = parseImport(serializeExport(flagged));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.entries[0].censored).toBe(true);
    expect(res.payload.entries[0].regimeBreak).toBe(true);
    // A false flag is not stored — it degrades to the ordinary unset entry.
    expect(res.payload.entries[1].censored).toBeUndefined();
    expect(res.payload.entries[1].regimeBreak).toBeUndefined();
  });

  it("carries rankScope and cohortSD through, keeping only the non-default scope", () => {
    const withScope: AppData = {
      ...book,
      entries: [
        { ...book.entries[0], rankScope: "year", cohortSD: 11.5, difficulty: "hard" },
        { ...book.entries[1], rankScope: "class", cohortSD: null, difficulty: "normal" },
      ],
    };
    const res = parseImport(serializeExport(withScope));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.entries[0].rankScope).toBe("year");
    expect(res.payload.entries[0].cohortSD).toBe(11.5);
    expect(res.payload.entries[0].difficulty).toBe("hard");
    // "class"/"normal" are defaults ⇒ not stored; no SD ⇒ absent.
    expect(res.payload.entries[1].rankScope).toBeUndefined();
    expect(res.payload.entries[1].cohortSD).toBeUndefined();
    expect(res.payload.entries[1].difficulty).toBeUndefined();
  });
});

describe("parseImport validation", () => {
  it("rejects non-JSON", () => {
    const res = parseImport("nope{");
    expect(res.ok).toBe(false);
  });
  it("rejects JSON without subjects/entries", () => {
    expect(parseImport('{"foo": 1}').ok).toBe(false);
  });
  it("drops malformed entries and counts them", () => {
    const res = parseImport(JSON.stringify({
      subjects: [{ id: "s1", name: "Maths", ticker: "MATH" }],
      entries: [
        { id: "ok", subjectId: "s1", date: "2026-05-01", type: "Test", score: 70 },
        { id: "bad-date", subjectId: "s1", date: "May 1st", type: "Test", score: 70 },
        { id: "bad-subject", subjectId: "ghost", date: "2026-05-01", type: "Test", score: 70 },
        { id: "bad-score", subjectId: "s1", date: "2026-05-01", type: "Test", score: "A+" },
      ],
    }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.entries).toHaveLength(1);
    expect(res.payload.dropped).toBe(3);
  });
  it("clamps out-of-range scores", () => {
    const res = parseImport(JSON.stringify({
      subjects: [{ id: "s1", name: "Maths", ticker: "MATH" }],
      entries: [{ id: "e", subjectId: "s1", date: "2026-05-01", type: "Test", score: 250 }],
    }));
    expect(res.ok && res.payload.entries[0].score).toBe(100);
  });
});

describe("v3 field sanitization", () => {
  const wrap = (subject: Record<string, unknown>, entry?: Record<string, unknown>) =>
    parseImport(JSON.stringify({
      subjects: [{ id: "s1", name: "Maths", ticker: "MATH", ...subject }],
      entries: entry ? [{ id: "e", subjectId: "s1", date: "2026-05-01", type: "Exam", score: 80, ...entry }] : [],
    }));

  it("keeps archived only when strictly true", () => {
    const yes = wrap({ archived: true });
    expect(yes.ok && yes.payload.subjects[0].archived).toBe(true);
    const junk = wrap({ archived: "yes" });
    expect(junk.ok && junk.payload.subjects[0].archived).toBeUndefined();
  });
  it("clamps courseworkPct into 0–100 and nulls garbage", () => {
    const hi = wrap({ courseworkPct: 150 });
    expect(hi.ok && hi.payload.subjects[0].courseworkPct).toBe(100);
    const junk = wrap({ courseworkPct: "lots" });
    expect(junk.ok && junk.payload.subjects[0].courseworkPct).toBeNull();
  });
  it("clamps yearAvg like classAvg", () => {
    const res = wrap({}, { yearAvg: 120 });
    expect(res.ok && res.payload.entries[0].yearAvg).toBe(100);
  });
  it("nulls worthPct outside (0, 100]", () => {
    expect((() => { const r = wrap({}, { worthPct: 0 }); return r.ok && r.payload.entries[0].worthPct; })()).toBeNull();
    expect((() => { const r = wrap({}, { worthPct: 120 }); return r.ok && r.payload.entries[0].worthPct; })()).toBeNull();
    expect((() => { const r = wrap({}, { worthPct: 25 }); return r.ok && r.payload.entries[0].worthPct; })()).toBe(25);
  });
  it("drops the rank pair when rank exceeds cohortN, keeps the entry", () => {
    const res = wrap({}, { rank: 3, cohortN: 2 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.entries).toHaveLength(1);
    expect(res.payload.entries[0].rank).toBeNull();
    expect(res.payload.entries[0].cohortN).toBeNull();
  });
  it("drops rank without cohortN but keeps cohortN alone", () => {
    const noCohort = wrap({}, { rank: 3 });
    expect(noCohort.ok && noCohort.payload.entries[0].rank).toBeNull();
    const cohortOnly = wrap({}, { cohortN: 120 });
    expect(cohortOnly.ok && cohortOnly.payload.entries[0].cohortN).toBe(120);
  });
  it("rejects non-integer rank/cohortN", () => {
    const res = wrap({}, { rank: 2.5, cohortN: 100.7 });
    expect(res.ok && res.payload.entries[0].rank).toBeNull();
    expect(res.ok && res.payload.entries[0].cohortN).toBeNull();
  });
  it("stamps the current version on the envelope", () => {
    expect(JSON.parse(serializeExport(book)).version).toBe(EXPORT_VERSION);
  });
});

describe("replace/merge", () => {
  const incoming = {
    subjects: [{ id: "s1", name: "Maths NCEA", ticker: "MATH", color: "#4D7CFE", target: 90 }],
    entries: [
      { id: "e1", subjectId: "s1", date: "2026-05-01", type: "Exam" as const, score: 85, title: "", classAvg: null },
      { id: "e9", subjectId: "s1", date: "2026-06-01", type: "Test" as const, score: 88, title: "", classAvg: null },
    ],
    settings: null,
    upcoming: [], allocations: [], duels: [], meanCalls: [],
    dropped: 0,
  };
  it("replace swaps the whole book and clears the sample flag", () => {
    const out = replaceData(incoming);
    expect(out.subjects).toHaveLength(1);
    expect(out.sample).toBe(false);
    expect(out.settings).toEqual(DEFAULT_SETTINGS);
  });
  /* Every book this app mints starts from defaultSubjects(), which hard-codes
     s-math/s-eng/s-phys… — so two students' books collide on all six ids while
     describing completely different desks. Letting the incoming row win there
     rewrote the name, ticker and target of a desk you had been trading and
     dropped somebody else's prints onto your tape. */
  it("re-lists a colliding id that describes a different desk, instead of overwriting", () => {
    const mine: AppData = {
      subjects: [{ id: "s-math", name: "Mathematics", ticker: "MATH", color: "#4D7CFE", target: 90, courseworkPct: null }],
      entries: [{ id: "m1", subjectId: "s-math", date: "2026-05-01", type: "Exam", score: 91, title: "", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null }],
      settings: freshSettings(),
      sample: false,
    };
    const theirs = {
      subjects: [{ id: "s-math", name: "Maths (Foundation)", ticker: "MTHF", color: "#E0662E", target: 55, courseworkPct: null }],
      entries: [{ id: "t1", subjectId: "s-math", date: "2026-05-02", type: "Exam" as const, score: 41, title: "", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null }],
      settings: null,
      upcoming: [], allocations: [], duels: [], meanCalls: [],
      dropped: 0,
    };
    const out = mergeData(mine, theirs);
    const kept = out.subjects.find((s) => s.id === "s-math")!;
    expect(kept.name).toBe("Mathematics");
    expect(kept.ticker).toBe("MATH");
    expect(kept.target).toBe(90);
    expect(out.subjects).toHaveLength(2);
    // Their print follows their desk; my tape is untouched.
    const theirSub = out.subjects.find((s) => s.id !== "s-math")!;
    expect(out.entries.filter((e) => e.subjectId === "s-math").map((e) => e.score)).toEqual([91]);
    expect(out.entries.filter((e) => e.subjectId === theirSub.id).map((e) => e.score)).toEqual([41]);
  });
  it("merge dedupes by id with incoming rows winning", () => {
    const out = mergeData(book, incoming);
    expect(out.subjects).toHaveLength(2);
    expect(out.subjects.find((s) => s.id === "s1")?.target).toBe(90);
    expect(out.entries).toHaveLength(3);
    expect(out.entries.find((e) => e.id === "e1")?.score).toBe(85);
    expect(out.settings).toEqual(book.settings); // no incoming settings → keep current
  });
});

describe("sanitizeSettings", () => {
  it("fills defaults from garbage", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ weights: { Exam: -5, Test: "x" }, weighted: "yes" })).toEqual(DEFAULT_SETTINGS);
  });
  it("keeps valid overrides", () => {
    const s = sanitizeSettings({ weights: { Exam: 5 }, weighted: false });
    expect(s.weights.Exam).toBe(5);
    expect(s.weights.Quiz).toBe(DEFAULT_SETTINGS.weights.Quiz);
    expect(s.weighted).toBe(false);
  });
  it("takes a school's own term dates, one year at a time", () => {
    const moved = [
      { start: "2026-01-19", end: "2026-04-01" },
      { start: "2026-04-20", end: "2026-07-03" },
      { start: "2026-07-13", end: "2026-09-18" },
      { start: "2026-10-12", end: "2026-12-02" },
    ];
    const s = sanitizeSettings({ calendar: { years: { "2026": moved }, settleDays: 21 } });
    expect(s.calendar.years["2026"]).toEqual(moved);
    expect(s.calendar.settleDays).toBe(21);
    expect(s.calendar.years["2025"]).toEqual(DEFAULT_SETTINGS.calendar.years["2025"]); // untouched
  });
  it("refuses a year that is not a school year, and keeps the published one", () => {
    const bad = {
      calendar: {
        years: {
          "2026": [{ start: "2026-04-01", end: "2026-01-01" }], // backwards, and short
          "2025": [
            { start: "2025-01-21", end: "2025-06-30" }, // overlaps T2
            { start: "2025-04-28", end: "2025-06-27" },
            { start: "2025-07-14", end: "2025-09-19" },
            { start: "2025-10-06", end: "2025-12-03" },
          ],
          "nope": [],
        },
        settleDays: 9000,
      },
    };
    const s = sanitizeSettings(bad);
    expect(s.calendar.years["2026"]).toEqual(DEFAULT_SETTINGS.calendar.years["2026"]);
    expect(s.calendar.years["2025"]).toEqual(DEFAULT_SETTINGS.calendar.years["2025"]);
    expect(s.calendar.years["nope"]).toBeUndefined();
    expect(s.calendar.settleDays).toBe(90); // clamped, never absurd
  });
  it("ignores the retired termStartMonth without complaint", () => {
    const s = sanitizeSettings({ termStartMonth: 1, weighted: false });
    expect(s.weighted).toBe(false);
    expect(s.calendar).toEqual(DEFAULT_SETTINGS.calendar);
    expect("termStartMonth" in s).toBe(false);
  });
});

describe("a hand-filed term survives the round trip", () => {
  it("carries entry.term through export and import, and drops a bogus one", () => {
    const book: AppData = {
      subjects: [{ id: "s1", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: null }],
      entries: [
        { id: "e1", subjectId: "s1", date: "2026-07-30", type: "Exam", score: 70, title: "Late paper", term: "2026-T3" },
        { id: "e2", subjectId: "s1", date: "2026-07-30", type: "Test", score: 60, title: "", term: "banana" },
      ],
      settings: freshSettings(),
      sample: false,
    };
    const res = parseImport(serializeExport(book));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.entries[0].term).toBe("2026-T3");
    expect(res.payload.entries[1].term).toBeUndefined();
  });
});
