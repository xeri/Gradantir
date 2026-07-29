import { describe, expect, it } from "vitest";
import { EXAMPLE_PAYLOAD, PROMPT_VERSION, buildWirePrompt, type WireOpts } from "./prompt";
import { WIRE_SECTIONS } from "./schema";
import { extractJson, parseWire } from "./parse";
import { filterPayload, rehydrateSubjects, reviewWire } from "./review";
import { mergeData, parseImport, RELIABILITY_TAGS, type ImportPayload } from "../io";
import { TYPES, freshSettings } from "../../constants";
import type { AppData } from "../../types";

/**
 * The wire's contract tests. The two locks that matter most:
 *  · the GOLDEN test pushes the prompt's own worked example through the REAL
 *    import pipeline — the prompt can never teach a shape the validator would
 *    refuse;
 *  · the registry-coverage test walks every schema field into the prompt —
 *    with the `satisfies` locks in schema.ts, a new field on any entity must
 *    pass through the registry AND the rendered prompt to compile and pass.
 */

const TODAY = "2026-07-27";

const book: AppData = {
  subjects: [
    { id: "s-math", name: "Mathematics", ticker: "MATH", color: "#123456", target: 85, courseworkPct: 40 },
    { id: "s-eng", name: "English", ticker: "ENG", color: "#E0662E", target: null, courseworkPct: null, formerly: "s-lit" },
    { id: "s-lit", name: "English Literature", ticker: "LIT", color: "#AA33CC", target: null, courseworkPct: null, archived: true },
  ],
  entries: [
    {
      id: "e1", subjectId: "s-math", date: "2026-05-01", type: "Exam", score: 63.7, title: "Mid-year",
      classAvg: 58, yearAvg: null, rank: 12, cohortN: 140, worthPct: 30,
    },
  ],
  settings: freshSettings(),
  sample: false,
  upcoming: [
    { id: "u-math-2026-09-12-finals", subjectId: "s-math", date: "2026-09-12", type: "Exam", title: "Finals", weight: 50 },
  ],
};

const ALL: WireOpts = { sources: { documents: true, interview: true }, forecasts: true, embedHistory: false };

describe("the golden example", () => {
  it("passes the REAL import pipeline with zero rows lost", () => {
    const res = parseImport(JSON.stringify(EXAMPLE_PAYLOAD));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.dropped).toBe(0);
    expect(res.payload.subjects).toHaveLength(EXAMPLE_PAYLOAD.data.subjects.length);
    expect(res.payload.entries).toHaveLength(EXAMPLE_PAYLOAD.data.entries.length);
    expect(res.payload.upcoming).toHaveLength(EXAMPLE_PAYLOAD.data.upcoming.length);
    // The example's wire call survives intact — range, basis and all.
    expect(res.payload.upcoming[0].aiPred?.point).toBe(77);
    expect(res.payload.upcoming[0].aiPred?.basis).toBeTruthy();
  });
  it("stamps the current prompt version", () => {
    expect(EXAMPLE_PAYLOAD.promptVersion).toBe(PROMPT_VERSION);
  });
});

describe("the prompt covers its own registry", () => {
  const prompt = buildWirePrompt(ALL, book, TODAY);
  it("names every field of every section", () => {
    for (const s of WIRE_SECTIONS) {
      for (const field of Object.keys(s.fields)) {
        expect(prompt.includes(`- ${field}`), `${s.key}.${field}`).toBe(true);
      }
    }
  });
  it("quotes every assessment type and every reliability tag", () => {
    for (const t of TYPES) expect(prompt).toContain(`"${t}"`);
    for (const tag of RELIABILITY_TAGS) expect(prompt).toContain(tag);
  });
  it("embeds the roster ids, tickers, today and the version", () => {
    for (const s of book.subjects) {
      expect(prompt).toContain(s.id);
      expect(prompt).toContain(s.ticker);
    }
    expect(prompt).toContain(TODAY);
    expect(prompt).toContain(`"promptVersion": ${PROMPT_VERSION}`);
    // Existing sittings are offered for id echo.
    expect(prompt).toContain("u-math-2026-09-12-finals");
  });
});

describe("the prompt's switches", () => {
  it("carries the forecast module and aiPred only when opted in", () => {
    const on = buildWirePrompt(ALL, book, TODAY);
    expect(on).toContain("FORECAST MODULE");
    expect(on).toContain('"aiPred"');
    const off = buildWirePrompt({ ...ALL, forecasts: false }, book, TODAY);
    expect(off).not.toContain("FORECAST MODULE");
    expect(off).not.toContain('"aiPred"');
    expect(off).toContain("NO FORECASTS");
  });
  it("never leaks a mark unless history embedding is opted in — the privacy line", () => {
    const closed = buildWirePrompt(ALL, book, TODAY);
    expect(closed).not.toContain("63.7");
    expect(closed).toContain("NOT included");
    const open = buildWirePrompt({ ...ALL, embedHistory: true }, book, TODAY);
    expect(open).toContain("63.7");
  });
  it("renders only the requested source protocols", () => {
    const docsOnly = buildWirePrompt({ ...ALL, sources: { documents: true, interview: false } }, book, TODAY);
    expect(docsOnly).toContain("SOURCE · DOCUMENTS");
    expect(docsOnly).not.toContain("SOURCE · INTERVIEW");
    const interviewOnly = buildWirePrompt({ ...ALL, sources: { documents: false, interview: true } }, book, TODAY);
    expect(interviewOnly).not.toContain("SOURCE · DOCUMENTS");
    expect(interviewOnly).toContain("SOURCE · INTERVIEW");
  });
});

describe("the roster echo and the wording a weak model would obey", () => {
  const prompt = buildWirePrompt(ALL, book, TODAY);

  it("echoes roster rows losslessly — color, target, courseworkPct, lineage, archived", () => {
    expect(prompt).toContain('"color":"#123456"');
    expect(prompt).toContain('"target":85');
    expect(prompt).toContain('"courseworkPct":40');
    expect(prompt).toContain('"formerly":"s-lit"');
    expect(prompt).toContain('"archived":true');
  });

  it("orders a full echo and never says 'never re-list them'", () => {
    expect(prompt).not.toContain("never re-list them");
    expect(prompt).toContain("echo these ids exactly");
  });

  it("scopes upcoming's transcribe-only brand to its call fields", () => {
    expect(prompt).toContain("[selfPred, chips & syllabusCoverage are TRANSCRIBE-ONLY — see R7]");
    // The fully-elicited sections keep the plain brand…
    expect(prompt).toContain("[TRANSCRIBE-ONLY — see R7]");
    // …but the forward calendar as a whole is never branded with it.
    expect(prompt).not.toContain("attach to it)   [TRANSCRIBE-ONLY");
  });

  it("lists chips among R7's transcribe-only fields", () => {
    expect(prompt).toContain("`chips`");
  });

  it("interviews for the round-table sections — meanCalls, duels, allocations, chips", () => {
    const interviewOnly = buildWirePrompt({ ...ALL, sources: { documents: false, interview: true } }, book, TODAY);
    expect(interviewOnly).toContain("round-table");
    expect(interviewOnly).toContain("⇒ duels");
    expect(interviewOnly).toContain("⇒ allocations");
    expect(interviewOnly).toContain("meanCalls row");
  });

  it("invites reasoning before the payload message, never inside it", () => {
    expect(prompt).toContain("BEFORE your final payload message");
  });

  it("drops the forecast-module reference from the blurbs when the module is off", () => {
    const off = buildWirePrompt({ ...ALL, forecasts: false }, book, TODAY);
    expect(off).not.toContain("when the forecast module is on");
  });
});

describe("extractJson — charity toward imperfect models", () => {
  it("takes a clean object as-is", () => {
    expect(extractJson('{"a": 1}')).toBe('{"a": 1}');
  });
  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });
  it("cuts prose before and after", () => {
    expect(extractJson('Here is your payload:\n{"a": 1}\nLet me know!')).toBe('{"a": 1}');
  });
  it("keeps braces inside strings intact", () => {
    const s = '{"note": "a {brace} inside"}';
    expect(extractJson(`reply:\n${s}`)).toBe(s);
  });
  it("returns null when there is no object", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("parseWire", () => {
  const reply = (over: object = {}) =>
    JSON.stringify({ ...EXAMPLE_PAYLOAD, ...over });

  it("parses a full wire envelope, meta included", () => {
    const res = parseWire("Sure! Here it is:\n```json\n" + reply() + "\n```");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.subjects).toHaveLength(2);
    expect(res.meta.warnings).toHaveLength(1);
    expect(res.meta.sources).toContain("Student interview");
    expect(res.promptVersion).toBe(PROMPT_VERSION);
    expect(res.versionMismatch).toBe(false);
    expect(res.raw.entries).toHaveLength(2);
  });
  it("accepts a bare payload from a model that forgot the envelope", () => {
    const res = parseWire(JSON.stringify(EXAMPLE_PAYLOAD.data));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.entries).toHaveLength(2);
    expect(res.promptVersion).toBeNull();
    expect(res.versionMismatch).toBe(false);
    expect(res.meta.warnings).toEqual([]);
  });
  it("flags a reply built against another prompt version", () => {
    const res = parseWire(reply({ promptVersion: 99 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.versionMismatch).toBe(true);
  });
  it("refuses a paste with no JSON in it", () => {
    const res = parseWire("I could not find any grades in the documents.");
    expect(res.ok).toBe(false);
  });
  it("tolerates garbage meta without losing the payload", () => {
    const res = parseWire(reply({ meta: { warnings: "not-an-array", questions: [1, 2] } }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.meta.warnings).toEqual([]);
    expect(res.meta.questions).toEqual([]);
  });
});

describe("reviewWire", () => {
  const current: AppData = {
    ...book,
    entries: [
      { id: "e-math-2026-05-14-midyear", subjectId: "s-math", date: "2026-05-14", type: "Exam", score: 70, title: "old row", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
    ],
    upcoming: [],
  };

  it("splits kept rows into added and updated against the current book", () => {
    const res = parseWire(JSON.stringify(EXAMPLE_PAYLOAD));
    if (!res.ok) throw new Error("fixture failed");
    const review = reviewWire(res, current);
    const entries = review.sections.find((s) => s.key === "entries")!;
    expect(entries.found).toBe(2);
    expect(entries.kept).toBe(2);
    expect(entries.updated).toBe(1); // e-math-2026-05-14-midyear already on the book
    expect(entries.added).toBe(1);
    expect(entries.dropped).toBe(0);
    expect(review.aiPredCount).toBe(1);
    expect(review.keptTotal).toBeGreaterThan(0);
    const elicited = review.sections.filter((s) => s.elicitation).map((s) => s.key);
    expect(elicited).toEqual(["upcoming", "allocations", "duels", "meanCalls"]);
  });

  it("explains the casualties — bad date, unknown desk", () => {
    const dirty = {
      ...EXAMPLE_PAYLOAD,
      data: {
        ...EXAMPLE_PAYLOAD.data,
        entries: [
          ...EXAMPLE_PAYLOAD.data.entries,
          { id: "e-bad-date", subjectId: "s-math", date: "14/05/2026", type: "Exam", score: 70, title: "" },
          { id: "e-ghost", subjectId: "s-ghost", date: "2026-05-14", type: "Exam", score: 70, title: "" },
        ],
      },
    };
    const res = parseWire(JSON.stringify(dirty));
    if (!res.ok) throw new Error("fixture failed");
    const review = reviewWire(res, current);
    const entries = review.sections.find((s) => s.key === "entries")!;
    expect(entries.dropped).toBe(2);
    expect(entries.reasons.join(" | ")).toContain("not YYYY-MM-DD");
    expect(entries.reasons.join(" | ")).toContain('"s-ghost"');
  });

  it("rehydrateSubjects restores what a stripped same-desk echo dropped", () => {
    const parseEcho = (subjects: object[]): ImportPayload => {
      const res = parseImport(JSON.stringify({ app: "grade-exchange", data: { subjects, entries: [] } }));
      if (!res.ok) throw new Error("fixture failed");
      return res.payload;
    };
    const fixed = rehydrateSubjects(
      parseEcho([
        { id: "s-math", name: "Mathematics", ticker: "MATH" },
        { id: "s-eng", name: "English", ticker: "ENG" },
        { id: "s-lit", name: "English Literature", ticker: "LIT" },
        { id: "s-chem", name: "Chemistry", ticker: "CHEM" },
      ]),
      book,
    );
    const math = fixed.subjects.find((s) => s.id === "s-math")!;
    expect(math.color).toBe("#123456");
    expect(math.target).toBe(85);
    expect(math.courseworkPct).toBe(40);
    expect(fixed.subjects.find((s) => s.id === "s-eng")?.formerly).toBe("s-lit");
    expect(fixed.subjects.find((s) => s.id === "s-lit")?.archived).toBe(true);
    // A genuinely new desk passes through untouched.
    expect(fixed.subjects.find((s) => s.id === "s-chem")?.target).toBeNull();

    // An explicit incoming value still wins over the book's.
    const explicit = rehydrateSubjects(
      parseEcho([{ id: "s-math", name: "Mathematics", ticker: "MATH", target: 90, courseworkPct: 55 }]),
      book,
    ).subjects[0];
    expect(explicit.target).toBe(90);
    expect(explicit.courseworkPct).toBe(55);

    // An id collision that is a DIFFERENT desk gets nothing grafted on.
    const clash = rehydrateSubjects(
      parseEcho([{ id: "s-math", name: "Chemistry", ticker: "CHEM" }]),
      book,
    ).subjects[0];
    expect(clash.target).toBeNull();
    expect(clash.color).not.toBe("#123456");

    // End to end: a compliant stripped echo merges without losing a field.
    const merged = mergeData(book, rehydrateSubjects(
      parseEcho([
        { id: "s-math", name: "Mathematics", ticker: "MATH" },
        { id: "s-eng", name: "English", ticker: "ENG" },
        { id: "s-lit", name: "English Literature", ticker: "LIT" },
      ]),
      book,
    ));
    expect(merged.subjects.find((s) => s.id === "s-eng")?.formerly).toBe("s-lit");
    expect(merged.subjects.find((s) => s.id === "s-math")?.courseworkPct).toBe(40);
    expect(merged.subjects.find((s) => s.id === "s-lit")?.archived).toBe(true);
  });

  it("filterPayload strips sections and forecasts, never the roster", () => {
    const res = parseWire(JSON.stringify(EXAMPLE_PAYLOAD));
    if (!res.ok) throw new Error("fixture failed");
    const filtered = filterPayload(res.payload, { entries: false, duels: false }, false);
    expect(filtered.entries).toEqual([]);
    expect(filtered.duels).toEqual([]);
    expect(filtered.subjects).toHaveLength(2);
    expect(filtered.upcoming).toHaveLength(1);
    expect(filtered.upcoming[0].aiPred).toBeUndefined();
    expect(filtered.upcoming[0].selfPred).toEqual({ point: 80, lo: 72, hi: 88 });
    // With forecasts allowed the wire call rides through untouched.
    const kept = filterPayload(res.payload, {}, true);
    expect(kept.upcoming[0].aiPred?.point).toBe(77);
  });
});
