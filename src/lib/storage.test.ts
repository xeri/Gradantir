import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coerceStored, loadData, quarantinedRaw, saveData } from "./storage";
import { DEFAULT_SETTINGS, LEGACY_STORE_KEY, STORE_KEY, freshSettings } from "../constants";
import type { AppData } from "../types";

const v2Blob = JSON.stringify({
  subjects: [{ id: "s1", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: 85 }],
  entries: [{ id: "e1", subjectId: "s1", date: "2026-05-01", type: "Exam", score: 82, title: "", classAvg: null }],
  settings: { weights: { Exam: 4 }, weighted: false },
  sample: false,
});

const v3Book: AppData = {
  subjects: [
    { id: "s1", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: 85, courseworkPct: 40 },
    { id: "s2", name: "History", ticker: "HIST", color: "#E0662E", target: null, archived: true, courseworkPct: null },
  ],
  entries: [
    {
      id: "e1", subjectId: "s1", date: "2026-05-01", type: "Exam", score: 82, title: "Mid-year",
      classAvg: 75, yearAvg: 71, rank: 12, cohortN: 140, worthPct: 30,
    },
  ],
  settings: freshSettings(),
  sample: false,
};

describe("coerceStored", () => {
  it("accepts a v2 blob (new fields simply absent)", () => {
    const d = coerceStored(v2Blob);
    expect(d).not.toBeNull();
    expect(d!.subjects[0].archived).toBeUndefined();
    expect(d!.settings.weights.Exam).toBe(4);
    expect(d!.settings.weighted).toBe(false);
  });
  it("passes v3 fields through untouched", () => {
    const d = coerceStored(JSON.stringify(v3Book));
    expect(d).toEqual(v3Book);
  });
  it("carries the wire's call through a load — the sanitizer copies aiPred (v9)", () => {
    const stored: AppData = {
      ...v3Book,
      upcoming: [{
        id: "u1", subjectId: "s1", date: "2026-09-01", type: "Exam", title: "Finals",
        aiPred: { point: 74, lo: 66, hi: 83, basis: "Flat trend into a heavier paper." },
      }],
    };
    const d = coerceStored(JSON.stringify(stored));
    expect(d!.upcoming).toEqual(stored.upcoming);
  });
  it("carries the five life-signals slices through a load (v10)", () => {
    const stored: AppData = {
      ...v3Book,
      topics: [{ id: "t1", subjectId: "s1", name: "Algebra", weightPct: 40 }],
      topicMarks: [{ id: "m1", entryId: "e1", topicId: "t1", scorePct: 80 }],
      sessions: [{ id: "sess1", subjectId: "s1", date: "2026-05-10", minutes: 30, kind: "practice", topicIds: ["t1"] }],
      rest: [{ id: "r1", date: "2026-05-09", hours: 7 }],
      disruptions: [{ id: "d1", date: "2026-05-05", kind: "illness" }],
    };
    const d = coerceStored(JSON.stringify(stored));
    expect(d!.topics).toEqual(stored.topics);
    expect(d!.topicMarks).toEqual(stored.topicMarks);
    expect(d!.sessions).toEqual(stored.sessions);
    expect(d!.rest).toEqual(stored.rest);
    expect(d!.disruptions).toEqual(stored.disruptions);
  });
  it("returns null for garbage", () => {
    expect(coerceStored("not json{")).toBeNull();
    expect(coerceStored("null")).toBeNull();
    expect(coerceStored('{"subjects": 1, "entries": []}')).toBeNull();
  });
  it("sanitizes garbled settings and the sample flag", () => {
    const d = coerceStored('{"subjects": [], "entries": [], "settings": 7, "sample": "yes"}');
    expect(d!.settings).toEqual(DEFAULT_SETTINGS);
    expect(d!.sample).toBe(false);
  });
});

/* A stored book is the accretion of every schema this app has shipped, and it
   is the ONLY copy. A row that would throw during render has to be dropped at
   the door: with no error boundary, one bad row white-screens the terminal on
   every load, and the failed render means the save effect never runs to correct
   it. Import already refuses all of these — the loader now shares that code. */
describe("coerceStored drops rows that would crash or poison the board", () => {
  const book = (subjects: unknown[], entries: unknown[]) =>
    coerceStored(JSON.stringify({ subjects, entries, settings: null, sample: false }));
  const sub = { id: "s1", name: "Maths", ticker: "MATH", color: "#4D7CFE", target: 85 };
  const ent = { id: "e1", subjectId: "s1", date: "2026-05-01", type: "Exam", score: 82 };

  it("drops a null entry instead of throwing in computeStats", () => {
    const d = book([sub], [ent, null, { ...ent, id: "e2" }]);
    expect(d!.entries.map((e) => e.id)).toEqual(["e1", "e2"]);
  });
  it("drops a null subject", () => {
    const d = book([sub, null], []);
    expect(d!.subjects).toHaveLength(1);
  });
  it("drops a non-numeric score rather than letting NaN reach every figure", () => {
    expect(book([sub], [{ ...ent, score: "70" }])!.entries).toHaveLength(0);
    expect(book([sub], [{ ...ent, score: null }])!.entries).toHaveLength(0);
  });
  it("drops an entry whose subject is not on the book", () => {
    expect(book([sub], [{ ...ent, subjectId: "ghost" }])!.entries).toHaveLength(0);
  });
  it("drops a malformed date", () => {
    expect(book([sub], [{ ...ent, date: "not-a-date" }])!.entries).toHaveLength(0);
  });
  it("cuts a lineage pointer to a desk this book does not contain", () => {
    const d = book([{ ...sub, formerly: "gone" }], []);
    expect(d!.subjects[0].formerly).toBeNull();
  });
  it("still accepts a genuinely empty book", () => {
    expect(book([], [])).not.toBeNull();
  });
});

describe("loadData migration", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("prefers the v3 key when present", () => {
    store.set(STORE_KEY, JSON.stringify(v3Book));
    store.set(LEGACY_STORE_KEY, v2Blob);
    expect(loadData()).toEqual(v3Book);
  });
  it("migrates a v2 book: returns it, writes v3, leaves v2 for rollback", () => {
    store.set(LEGACY_STORE_KEY, v2Blob);
    const d = loadData();
    expect(d).not.toBeNull();
    expect(d!.subjects[0].id).toBe("s1");
    expect(store.has(STORE_KEY)).toBe(true);
    expect(store.has(LEGACY_STORE_KEY)).toBe(true);
    expect(coerceStored(store.get(STORE_KEY)!)).toEqual(d);
  });
  it("falls back to legacy when the v3 blob is garbled", () => {
    store.set(STORE_KEY, "corrupt{");
    store.set(LEGACY_STORE_KEY, v2Blob);
    expect(loadData()!.subjects[0].id).toBe("s1");
  });
  it("returns null when neither key exists", () => {
    expect(loadData()).toBeNull();
  });
  /* Present-but-unreadable reads as null too, and the caller cannot tell it
     from a fresh machine — it seeds the sample book and commits it over the top
     within a tick. Keep the bytes so a human can still get the book back. */
  it("quarantines an unreadable book instead of letting it be overwritten", () => {
    store.set(STORE_KEY, '{"subjects": truncated…');
    expect(loadData()).toBeNull();
    expect(quarantinedRaw()).toBe('{"subjects": truncated…');
  });
  it("does not quarantine when there was simply nothing stored", () => {
    expect(loadData()).toBeNull();
    expect(quarantinedRaw()).toBeNull();
  });
  it("saveData round-trips through the store", () => {
    expect(saveData(v3Book)).toBe(true);
    expect(coerceStored(store.get(STORE_KEY)!)).toEqual(v3Book);
  });
});
