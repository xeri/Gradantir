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
    {
      id: "s-math", name: "Mathematics", ticker: "MATH", color: "#123456", target: 85, courseworkPct: 40,
      traits: { cumulativeness: 0.8, determinism: 0.6, breadth: 0.4 },
      mix: { knowledge: 0.3, procedure: 0.4, skill: 0.3 },
      belief: 4, attendancePct: 97,
    },
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
    // T2's fields survive the real parser too — the doc comment's own claim.
    expect(res.payload.subjects[0].traits).toEqual({ cumulativeness: 0.8, determinism: 0.6, breadth: 0.4 });
    expect(res.payload.subjects[0].mix).toEqual({ knowledge: 0.3, procedure: 0.4, skill: 0.3 });
    expect(res.payload.subjects[0].belief).toBe(4);
    expect(res.payload.subjects[0].attendancePct).toBe(96);
    expect(res.payload.upcoming[0].hour).toBe(9);
  });
  it("stamps the current prompt version", () => {
    expect(EXAMPLE_PAYLOAD.promptVersion).toBe(PROMPT_VERSION);
  });
  it("bumps PROMPT_VERSION for T2's subject/upcoming fields plus the five life-signal sections", () => {
    expect(PROMPT_VERSION).toBe(2);
  });
  it("pushes the five new life-signal sections through the REAL import pipeline with zero rows lost", () => {
    const res = parseImport(JSON.stringify(EXAMPLE_PAYLOAD));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.topics).toHaveLength(EXAMPLE_PAYLOAD.data.topics.length);
    expect(res.payload.topicMarks).toHaveLength(EXAMPLE_PAYLOAD.data.topicMarks.length);
    expect(res.payload.sessions).toHaveLength(EXAMPLE_PAYLOAD.data.sessions.length);
    expect(res.payload.rest).toHaveLength(EXAMPLE_PAYLOAD.data.rest.length);
    expect(res.payload.disruptions).toHaveLength(EXAMPLE_PAYLOAD.data.disruptions.length);
    // The dual-FK topicMark survives with both references intact.
    expect(res.payload.topicMarks[0].entryId).toBe(EXAMPLE_PAYLOAD.data.entries[0].id);
    expect(res.payload.topicMarks[0].topicId).toBe(EXAMPLE_PAYLOAD.data.topics[0].id);
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

  it("echoes traits, mix, belief and attendancePct when the desk has them set", () => {
    expect(prompt).toContain('"traits":{"cumulativeness":0.8,"determinism":0.6,"breadth":0.4}');
    expect(prompt).toContain('"mix":{"knowledge":0.3,"procedure":0.4,"skill":0.3}');
    expect(prompt).toContain('"belief":4');
    expect(prompt).toContain('"attendancePct":97');
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

  it("interviews for the life-signal sections too — sessions, rest, disruptions, belief, attendance", () => {
    const interviewOnly = buildWirePrompt({ ...ALL, sources: { documents: false, interview: true } }, book, TODAY);
    expect(interviewOnly).toContain("⇒ sessions");
    expect(interviewOnly).toContain("⇒ rest");
    expect(interviewOnly).toContain("⇒ disruptions");
    // Asserting the INTERVIEW STEP's own wording, not just that "belief" and
    // "attendancePct" appear somewhere in the prompt — schemaBlock renders
    // every field name into every prompt regardless of interview content, so
    // a bare substring check would pass even if step 8 never existed.
    expect(interviewOnly).toContain("⇒ belief");
    expect(interviewOnly).toContain("⇒ attendancePct");
  });

  it("interviews for a sitting's start time too, feeding Upcoming.hour", () => {
    const interviewOnly = buildWirePrompt({ ...ALL, sources: { documents: false, interview: true } }, book, TODAY);
    expect(interviewOnly).toContain("⇒ hour");
  });

  it("invites reasoning before the payload message, never inside it", () => {
    expect(prompt).toContain("BEFORE your final payload message");
  });

  it("drops the forecast-module reference from the blurbs when the module is off", () => {
    const off = buildWirePrompt({ ...ALL, forecasts: false }, book, TODAY);
    expect(off).not.toContain("when the forecast module is on");
  });
});

describe("the five life-signal sections", () => {
  it("registers a SectionSpec with a deterministic id recipe for each", () => {
    const byKey = new Map(WIRE_SECTIONS.map((s) => [s.key, s]));
    expect(byKey.get("topics")?.idConvention).toContain("t-");
    expect(byKey.get("topicMarks")?.idConvention).toBe("tm-<entryId>-<topicId>");
    expect(byKey.get("sessions")?.idConvention).toContain("ss-");
    expect(byKey.get("rest")?.idConvention).toBe("r-<date>");
    expect(byKey.get("disruptions")?.idConvention).toBe("d-<date>-<kind>");
  });

  it("carries a transcribe note per section, none invented", () => {
    for (const key of ["topics", "topicMarks", "sessions", "rest", "disruptions"] as const) {
      const spec = WIRE_SECTIONS.find((s) => s.key === key)!;
      expect(spec.transcribeNote, key).toBeTruthy();
      expect(spec.transcribeNote, key).toMatch(/transcribe/i);
    }
  });

  it("none of the five are flagged as scoring the student's own forecasting skill", () => {
    for (const key of ["topics", "topicMarks", "sessions", "rest", "disruptions"] as const) {
      expect(WIRE_SECTIONS.find((s) => s.key === key)!.elicitation, key).toBe(false);
    }
  });

  it("renders the three new guidance blocks when documents are a source", () => {
    const prompt = buildWirePrompt(ALL, book, TODAY);
    expect(prompt).toContain("PARSING A MARKED PAPER");
    expect(prompt).toContain("PARSING A SLEEP EXPORT");
    expect(prompt).toContain("ASSIGNING SUBJECT TRAITS");
  });

  it("omits the document-mining guidance blocks when documents are not a source", () => {
    const interviewOnly = buildWirePrompt({ ...ALL, sources: { documents: false, interview: true } }, book, TODAY);
    expect(interviewOnly).not.toContain("PARSING A MARKED PAPER");
    expect(interviewOnly).not.toContain("PARSING A SLEEP EXPORT");
    expect(interviewOnly).not.toContain("ASSIGNING SUBJECT TRAITS");
  });

  it("the output contract's literal skeleton lists all eleven data sections", () => {
    // Asserting the OUTPUT CONTRACT's own skeleton lines, not just that the
    // section names appear anywhere in the prompt — exampleBlock's
    // JSON.stringify(EXAMPLE_PAYLOAD) already emits every one of these
    // strings regardless of whether outputContract() ever mentioned them.
    const prompt = buildWirePrompt(ALL, book, TODAY);
    expect(prompt).toContain('"topics": [...], "topicMarks": [...], "sessions": [...],');
    expect(prompt).toContain('"rest": [...], "disruptions": [...]');
    expect(prompt).toContain("All eleven data sections present");
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
  it("carries raw counts for the five life-signal sections", () => {
    const res = parseWire(reply());
    if (!res.ok) throw new Error("fixture failed");
    expect(res.raw.topics.length).toBeGreaterThan(0);
    expect(res.raw.topicMarks.length).toBeGreaterThan(0);
    expect(res.raw.sessions.length).toBeGreaterThan(0);
    expect(res.raw.rest.length).toBeGreaterThan(0);
    expect(res.raw.disruptions.length).toBeGreaterThan(0);
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
    // A stripped echo must not wipe the shape priors/self-ratings T2 added either.
    expect(math.traits).toEqual({ cumulativeness: 0.8, determinism: 0.6, breadth: 0.4 });
    expect(math.mix).toEqual({ knowledge: 0.3, procedure: 0.4, skill: 0.3 });
    expect(math.belief).toBe(4);
    expect(math.attendancePct).toBe(97);
    expect(fixed.subjects.find((s) => s.id === "s-eng")?.formerly).toBe("s-lit");
    expect(fixed.subjects.find((s) => s.id === "s-lit")?.archived).toBe(true);
    // A genuinely new desk passes through untouched.
    expect(fixed.subjects.find((s) => s.id === "s-chem")?.target).toBeNull();

    // An explicit incoming value still wins over the book's.
    const explicit = rehydrateSubjects(
      parseEcho([{ id: "s-math", name: "Mathematics", ticker: "MATH", target: 90, courseworkPct: 55, belief: 2, attendancePct: 80 }]),
      book,
    ).subjects[0];
    expect(explicit.target).toBe(90);
    expect(explicit.courseworkPct).toBe(55);
    expect(explicit.belief).toBe(2);
    expect(explicit.attendancePct).toBe(80);

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

  it("filterPayload strips the five life-signal sections too (T2 minor: they used to ride past the review gate unconditionally)", () => {
    const res = parseWire(JSON.stringify(EXAMPLE_PAYLOAD));
    if (!res.ok) throw new Error("fixture failed");
    const filtered = filterPayload(
      res.payload,
      { topics: false, topicMarks: false, sessions: false, rest: false, disruptions: false },
      false,
    );
    expect(filtered.topics).toEqual([]);
    expect(filtered.topicMarks).toEqual([]);
    expect(filtered.sessions).toEqual([]);
    expect(filtered.rest).toEqual([]);
    expect(filtered.disruptions).toEqual([]);
    // Untouched when not excluded.
    const kept = filterPayload(res.payload, {}, false);
    expect(kept.topics.length).toBeGreaterThan(0);
    expect(kept.topicMarks.length).toBeGreaterThan(0);
    expect(kept.sessions.length).toBeGreaterThan(0);
    expect(kept.rest.length).toBeGreaterThan(0);
    expect(kept.disruptions.length).toBeGreaterThan(0);
  });

  it("filterPayload cascades: excluding topics (or entries) drops topicMarks too, even when topicMarks itself is kept", () => {
    // Important review finding: mergeData merges each section independently
    // with no re-sanitize pass afterward (App.tsx merges straight into
    // state; sanitizeBook only runs on load). Filing a topicMark whose
    // topicId/entryId was excluded from the SAME merge would leave a
    // dangling dual FK sitting in state unchecked.
    const res = parseWire(JSON.stringify(EXAMPLE_PAYLOAD));
    if (!res.ok) throw new Error("fixture failed");
    const topicsExcluded = filterPayload(res.payload, { topics: false }, false);
    expect(topicsExcluded.topicMarks).toEqual([]);
    // topics itself still empties, as before.
    expect(topicsExcluded.topics).toEqual([]);
    const entriesExcluded = filterPayload(res.payload, { entries: false }, false);
    expect(entriesExcluded.topicMarks).toEqual([]);
    // Excluding neither keeps topicMarks.
    const neitherExcluded = filterPayload(res.payload, {}, false);
    expect(neitherExcluded.topicMarks.length).toBeGreaterThan(0);
  });

  it("filterPayload strips a session's dangling topicIds (not the whole session) when topics is excluded", () => {
    const res = parseWire(JSON.stringify(EXAMPLE_PAYLOAD));
    if (!res.ok) throw new Error("fixture failed");
    expect(res.payload.sessions[0].topicIds?.length).toBeGreaterThan(0); // fixture sanity check
    const filtered = filterPayload(res.payload, { topics: false }, false);
    expect(filtered.sessions).toHaveLength(res.payload.sessions.length);
    expect(filtered.sessions[0].topicIds).toBeUndefined();
    // Kept intact when topics is not excluded.
    const kept = filterPayload(res.payload, {}, false);
    expect(kept.sessions[0].topicIds).toEqual(res.payload.sessions[0].topicIds);
  });

  it("reviewWire covers the five life-signal sections — found/kept/added", () => {
    const res = parseWire(JSON.stringify(EXAMPLE_PAYLOAD));
    if (!res.ok) throw new Error("fixture failed");
    const review = reviewWire(res, current);
    for (const key of ["topics", "topicMarks", "sessions", "rest", "disruptions"] as const) {
      const s = review.sections.find((sec) => sec.key === key)!;
      expect(s.found, key).toBeGreaterThan(0);
      expect(s.kept, key).toBe(s.found);
      expect(s.added, key).toBe(s.kept);
      expect(s.dropped, key).toBe(0);
    }
  });

  it("lintRow explains casualties in the five life-signal sections", () => {
    const dirty = {
      ...EXAMPLE_PAYLOAD,
      data: {
        ...EXAMPLE_PAYLOAD.data,
        topicMarks: [
          ...EXAMPLE_PAYLOAD.data.topicMarks,
          { id: "tm-bad", entryId: "e-ghost", topicId: "t-ghost", scorePct: 50 },
        ],
        rest: [
          ...EXAMPLE_PAYLOAD.data.rest,
          { id: "r-bad", date: "not-a-date", hours: 7 },
        ],
        disruptions: [
          ...EXAMPLE_PAYLOAD.data.disruptions,
          { id: "d-bad", date: "2026-04-01", kind: "made-up-kind" },
        ],
      },
    };
    const res = parseWire(JSON.stringify(dirty));
    if (!res.ok) throw new Error("fixture failed");
    const review = reviewWire(res, current);
    const topicMarks = review.sections.find((s) => s.key === "topicMarks")!;
    expect(topicMarks.dropped).toBe(1);
    expect(topicMarks.reasons.join(" | ")).toContain("e-ghost");
    const rest = review.sections.find((s) => s.key === "rest")!;
    expect(rest.dropped).toBe(1);
    expect(rest.reasons.join(" | ")).toContain("not YYYY-MM-DD");
    const disruptions = review.sections.find((s) => s.key === "disruptions")!;
    expect(disruptions.dropped).toBe(1);
    expect(disruptions.reasons.join(" | ")).toContain("made-up-kind");
  });

  it("lintRow names the actual rule that drops a rest row: sanitizeRestList dedupes by DATE, not id", () => {
    const dirty = {
      ...EXAMPLE_PAYLOAD,
      data: {
        ...EXAMPLE_PAYLOAD.data,
        rest: [
          ...EXAMPLE_PAYLOAD.data.rest,
          // Same date as the existing r-2026-05-13 row, otherwise well-formed —
          // this is the ONE rest rule that actually drops a row (io.ts:527-533),
          // and the generic "failed validation" fallback must not be all lintRow
          // can say about it.
          { id: "r-second-reading", date: "2026-05-13", hours: 8, bedtime: "22:10" },
        ],
      },
    };
    const res = parseWire(JSON.stringify(dirty));
    if (!res.ok) throw new Error("fixture failed");
    const review = reviewWire(res, current);
    const rest = review.sections.find((s) => s.key === "rest")!;
    expect(rest.found).toBe(2);
    expect(rest.kept).toBe(1);
    expect(rest.dropped).toBe(1);
    expect(rest.reasons.join(" | ")).toContain("a second reading for 2026-05-13");
    expect(rest.reasons.join(" | ")).not.toContain("failed validation");
  });
});
