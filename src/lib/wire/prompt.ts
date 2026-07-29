import { AI_PRED_FIELDS, NESTED_SPECS, WIRE_SECTIONS, type FieldSpec } from "./schema";
import type { AppData } from "../../types";

/**
 * The wire's prompt engine (§29). `buildWirePrompt` writes the document a
 * student pastes into ANY external AI — strong or weak — alongside their
 * school reports, and everything about its design serves one outcome: the AI's
 * reply drops into `parseImport` with zero rows lost.
 *
 * Pure and clock-free: the book and today are arguments, nothing global. The
 * schema tables render from `schema.ts`, whose `satisfies` locks make prompt
 * drift a compile error; the worked example is exported so the tests can push
 * the byte-identical object through the REAL import pipeline and prove it
 * lands clean.
 */

/**
 * Bumped when the payload contract changes; echoed back in the reply.
 * 2: Subject gained `traits`/`mix`/`belief`/`attendancePct`, Upcoming gained
 * `hour` (T2), and five life-signal sections (`topics`, `topicMarks`,
 * `sessions`, `rest`, `disruptions`) were added (T13) — one bump covering both.
 */
export const PROMPT_VERSION = 2;

export interface WireOpts {
  sources: {
    /** Mine documents the student attaches or pastes. */
    documents: boolean;
    /** Interview the student, subject by subject, before emitting. */
    interview: boolean;
  };
  /** Allow the AI to file its OWN forecasts (aiPred) for pending sittings. */
  forecasts: boolean;
  /** Embed the book's score history in the prompt (privacy trade-off). */
  embedHistory: boolean;
}

/**
 * The worked example embedded in the prompt — and pushed through the real
 * `parseImport` by the tests, so the example can never teach a shape the
 * validator would refuse.
 */
export const EXAMPLE_PAYLOAD = {
  app: "grade-exchange",
  kind: "wire",
  promptVersion: PROMPT_VERSION,
  data: {
    subjects: [
      {
        id: "s-math", name: "Mathematics", ticker: "MATH", color: "#4D7CFE", target: 85, courseworkPct: 40,
        traits: { cumulativeness: 0.8, determinism: 0.6, breadth: 0.4 },
        mix: { knowledge: 0.3, procedure: 0.4, skill: 0.3 },
        belief: 4, attendancePct: 96,
      },
      { id: "s-chem", name: "Chemistry", ticker: "CHEM", target: null, courseworkPct: null },
    ],
    entries: [
      {
        id: "e-math-2026-05-14-midyear", subjectId: "s-math", date: "2026-05-14", type: "Exam",
        score: 78, title: "Mid-year examination", classAvg: 71, yearAvg: null,
        rank: 5, cohortN: 120, rankScope: "year", worthPct: 30, reliability: "official",
      },
      {
        id: "e-chem-2026-06-02-acids", subjectId: "s-chem", date: "2026-06-02", type: "Test",
        score: 66.7, title: "Acids and bases topic test", classAvg: null, yearAvg: null,
        rank: null, cohortN: null, worthPct: null, reliability: "remembered",
      },
    ],
    upcoming: [
      {
        id: "u-math-2026-09-12-finals", subjectId: "s-math", date: "2026-09-12", type: "Exam",
        title: "End-of-year exam", weight: 50, teacherPred: 82, hour: 9,
        selfPred: { point: 80, lo: 72, hi: 88 },
        aiPred: { point: 77, lo: 68, hi: 86, basis: "Prints trending +2/term but the final carries double weight and cohort ranks say the class is tightening." },
      },
    ],
    allocations: [],
    duels: [],
    meanCalls: [],
    topics: [
      { id: "t-math-quadratics", subjectId: "s-math", name: "Quadratics", weightPct: 25 },
      { id: "t-chem-acids-bases", subjectId: "s-chem", name: "Acids and bases", weightPct: 20 },
    ],
    topicMarks: [
      {
        id: "tm-e-math-2026-05-14-midyear-t-math-quadratics",
        entryId: "e-math-2026-05-14-midyear", topicId: "t-math-quadratics",
        scorePct: 82, maxMarks: 20,
      },
    ],
    sessions: [
      { id: "ss-math-2026-05-10-0", subjectId: "s-math", date: "2026-05-10", minutes: 45, kind: "practice", topicIds: ["t-math-quadratics"] },
    ],
    rest: [
      { id: "r-2026-05-13", date: "2026-05-13", hours: 6.5, bedtime: "23:40" },
    ],
    disruptions: [
      { id: "d-2026-04-20-illness", date: "2026-04-20", days: 3, kind: "illness", note: "flu, off school" },
    ],
  },
  meta: {
    warnings: ["Chemistry topic test score was recalled from memory, not documented — tagged remembered."],
    questions: ["The 2025 report mentions a 'Statistics module' — is that part of Mathematics or a separate subject?"],
    skipped: ["Effort rubric grades: the book has no field for them."],
    sources: ["2026 Mid-year report (PDF)", "Student interview"],
  },
};

const fieldLines = (fields: Record<string, FieldSpec>, skip: string[] = []): string[] =>
  Object.entries(fields)
    .filter(([key]) => !skip.includes(key))
    .map(([key, f]) => {
      const bits = [
        `  - ${key}${f.required ? " (REQUIRED)" : ""}: ${f.constraint}`,
        ...(f.hint ? [`      · where to look: ${f.hint}`] : []),
        ...(f.example ? [`      · e.g. ${f.example}`] : []),
      ];
      return bits.join("\n");
    });

function roleBlock(opts: WireOpts): string[] {
  const jobs = [
    ...(opts.sources.documents ? ["mine every document the student gives you"] : []),
    ...(opts.sources.interview ? ["interview the student for what documents cannot hold"] : []),
    ...(opts.forecasts ? ["file your own forecasts for what is still ahead"] : []),
  ];
  return [
    "═══════════════════════════════════════════════════════════════════",
    "GRADE EXCHANGE · WIRE INTAKE PROTOCOL",
    "═══════════════════════════════════════════════════════════════════",
    "",
    "You are the intake desk for GRADE EXCHANGE, a student's personal grade",
    `terminal. Your job: ${jobs.join("; ")}; then emit ONE JSON payload the`,
    "terminal imports automatically. The terminal runs a forecasting engine",
    "on what you deliver — every field you fill makes its predictions",
    "sharper, and every field you fabricate poisons them. Be exhaustive",
    "about facts. Be incapable of inventing them.",
    "",
  ];
}

function outputContract(): string[] {
  return [
    "───────────────────────────────────────────────────────────────────",
    "THE OUTPUT CONTRACT",
    "───────────────────────────────────────────────────────────────────",
    "",
    "Your FINAL message must be exactly one JSON object — no markdown",
    "fences, no commentary before or after — shaped like this:",
    "",
    "  {",
    '    "app": "grade-exchange",',
    '    "kind": "wire",',
    `    "promptVersion": ${PROMPT_VERSION},`,
    '    "data": {',
    '      "subjects": [...], "entries": [...], "upcoming": [...],',
    '      "allocations": [...], "duels": [...], "meanCalls": [...],',
    '      "topics": [...], "topicMarks": [...], "sessions": [...],',
    '      "rest": [...], "disruptions": [...]',
    "    },",
    '    "meta": {',
    '      "warnings":  ["anything you were unsure about"],',
    '      "questions": ["anything only the student can resolve"],',
    '      "skipped":   ["data you saw but could not encode"],',
    '      "sources":   ["each document or interview you drew from"]',
    "    }",
    "  }",
    "",
    "Every data section is present, even when empty. `meta` is your",
    "channel back to the student — use it instead of prose.",
    "",
  ];
}

function hardRules(opts: WireOpts, today: string): string[] {
  return [
    "───────────────────────────────────────────────────────────────────",
    "HARD RULES — each one exists because breaking it corrupts the book",
    "───────────────────────────────────────────────────────────────────",
    "",
    "R1 · FACTS ONLY. Every number in `data` is either printed in a",
    "     document or stated by the student. Nothing is interpolated,",
    "     rounded up, or guessed" + (opts.forecasts ? " — except inside `aiPred`, the one field that IS yours (see FORECAST MODULE)." : "."),
    "",
    "R2 · THE PROVENANCE LADDER. Every entry carries `reliability`, which",
    "     tells the engine how hard to lean on the number: official ▸",
    "     returned ▸ remembered ▸ estimated ▸ partial. A remembered mark",
    "     with the right tag is VALUABLE; the same mark tagged official",
    "     is poison. When in doubt, tag down.",
    "",
    "R3 · ECHO THE ROSTER. Your `subjects` must contain every subject",
    "     from CURRENT BOOK CONTEXT — every row verbatim, every field,",
    "     not just the id — then any new ones. A dropped field is a",
    "     field the student loses; a result whose subjectId is missing",
    "     from your own `subjects` is silently dropped by the importer.",
    "",
    "R4 · DETERMINISTIC IDS. Follow each section's id recipe. Ids are",
    "     what make a second paste an UPDATE instead of a duplicate.",
    "",
    `R5 · DATES are ISO "YYYY-MM-DD". Today is ${today}. Resolve relative`,
    '     dates ("last Friday", "week 3") against today and the term',
    "     calendar below; a month-only memory becomes the 15th, tagged",
    '     "remembered", with a note in meta.warnings.',
    "",
    "R6 · SCORES are percentages 0–100. Convert fractions and points",
    "     (18/25 → 72). A letter-only grade becomes an estimated percent,",
    '     tagged "estimated", flagged in meta.warnings.',
    "",
    "R7 · TRANSCRIBE-ONLY SECTIONS. `selfPred`, `chips`, `duels`,",
    "     `meanCalls`, `allocations` and `syllabusCoverage` are the",
    "     student's own forecasting record — the terminal scores THEIR",
    "     skill on them. Write them only when the student explicitly",
    "     stated them, in their words. Inventing one corrupts a",
    "     scoreboard about a person.",
    "",
    `R8 · ELICITATION DATES. A transcribed call is filed \`createdAt\` = ${today}`,
    "     (today) unless the student produces a dated note. Backdating an",
    "     undocumented call lets hindsight masquerade as foresight.",
    "",
    opts.forecasts
      ? "R9 · YOUR FORECASTS live in `aiPred` and NOWHERE else. Never write\n     your own opinion into selfPred, teacherPred, or any student field."
      : "R9 · NO FORECASTS. The forecast module is off: emit no `aiPred`,\n     and no predictions of your own anywhere.",
    "",
    "R10 · UNENCODABLE DATA goes in meta.skipped, unresolved ambiguity in",
    "     meta.questions. Losing information silently is the only failure",
    "     this protocol cannot recover from.",
    "",
  ];
}

function schemaBlock(opts: WireOpts): string[] {
  const out: string[] = [
    "───────────────────────────────────────────────────────────────────",
    "THE SCHEMA — every section, every field",
    "───────────────────────────────────────────────────────────────────",
    "",
  ];
  for (const s of WIRE_SECTIONS) {
    out.push(`▸ ${s.title}`);
    out.push(`  ${s.blurb}`);
    out.push(`  id recipe: ${s.idConvention}${s.transcribeNote ? `   [${s.transcribeNote}]` : ""}`);
    out.push(...fieldLines(s.fields, opts.forecasts ? [] : ["aiPred"]));
    out.push("");
  }
  for (const n of NESTED_SPECS) {
    if (!opts.forecasts && n.fields === AI_PRED_FIELDS) continue;
    out.push(`▸ ${n.title}`);
    out.push(...fieldLines(n.fields));
    out.push("");
  }
  return out;
}

function contextBlock(book: AppData, today: string, embedHistory: boolean): string[] {
  // The echo must be LOSSLESS: merge replaces subject rows wholesale, so any
  // field missing here is a field a compliant reply deletes from the book —
  // color reshuffled, coursework split nulled, `formerly` lineage severed,
  // or (T2's fields) a shape prior/self-rating quietly wiped. `traits`/`mix`/
  // `belief`/`attendancePct` are set once and rarely revisited, so losing one
  // to a stripped echo would be invisible for months.
  const roster = book.subjects.map((s) => ({
    id: s.id, name: s.name, ticker: s.ticker, color: s.color,
    target: s.target, courseworkPct: s.courseworkPct,
    ...(s.archived ? { archived: true } : {}),
    ...(s.formerly ? { formerly: s.formerly } : {}),
    ...(s.traits ? { traits: s.traits } : {}),
    ...(s.mix ? { mix: s.mix } : {}),
    ...(s.belief != null ? { belief: s.belief } : {}),
    ...(s.attendancePct != null ? { attendancePct: s.attendancePct } : {}),
  }));
  const years = Object.entries(book.settings.calendar?.years ?? {})
    .filter(([y]) => Math.abs(Number(y) - Number(today.slice(0, 4))) <= 1)
    .map(([y, spans]) =>
      `  ${y}: ${spans.map((t, i) => `T${i + 1} ${t.start}→${t.end}`).join("  ")}`);
  const sittings = (book.upcoming ?? []).map((u) => {
    const tk = book.subjects.find((s) => s.id === u.subjectId)?.ticker ?? u.subjectId;
    return `  ${u.id} · ${tk} · ${u.date} · ${u.type}${u.title ? ` · "${u.title}"` : ""}${u.weight != null ? ` · worth ${u.weight}%` : ""}`;
  });
  const out = [
    "───────────────────────────────────────────────────────────────────",
    "CURRENT BOOK CONTEXT — echo these ids exactly; never mint new ones",
    "───────────────────────────────────────────────────────────────────",
    "",
    `Today: ${today}`,
    "",
    "The roster (echo every row into your `subjects` — every field,",
    "verbatim):",
    "  " + JSON.stringify(roster),
    "",
    ...(years.length ? ["School term calendar:", ...years, ""] : []),
    ...(sittings.length
      ? ["Sittings already on the book (echo an id to attach to one):", ...sittings, ""]
      : []),
  ];
  if (embedHistory) {
    const hist = [...book.entries]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((e) => {
        const tk = book.subjects.find((s) => s.id === e.subjectId)?.ticker ?? e.subjectId;
        return `  ${e.date} ${tk} ${e.type} ${e.score}${e.classAvg != null ? ` (class ${e.classAvg})` : ""}${e.rank != null && e.cohortN != null ? ` [rank ${e.rank}/${e.cohortN}]` : ""}`;
      });
    out.push(
      "Score history already on the book (context — do NOT re-emit these",
      "rows unless a document corrects one):",
      ...(hist.length ? hist : ["  (empty)"]),
      "",
    );
  } else {
    out.push(
      "The student's existing marks are NOT included in this prompt. Work",
      "from the documents and the interview alone.",
      "",
    );
  }
  return out;
}

function documentsBlock(): string[] {
  return [
    "───────────────────────────────────────────────────────────────────",
    "SOURCE · DOCUMENTS — the extraction protocol",
    "───────────────────────────────────────────────────────────────────",
    "",
    "The student will attach or paste school artifacts: report cards,",
    "transcript exports, portal screenshots, marked papers, teacher",
    "emails, exam timetables, assessment matrices, spreadsheets.",
    "",
    "Sweep EVERY artifact field-by-field, in passes:",
    "  1. RESULTS — every mark, however small. A quiz is a data point.",
    "  2. CONTEXT — for each result, hunt the surrounding text for class",
    "     average, year average, rank, cohort size, weighting, spread.",
    "     These multiply the value of the mark they attach to.",
    "  3. FORWARD — timetables, 'exams begin…', due dates ⇒ upcoming[].",
    "  4. STRUCTURE — coursework percentages, subject changes/renames",
    "     (⇒ formerly), teacher changes (⇒ regimeBreak), stated targets,",
    "     teacher predicted grades (⇒ teacherPred on a sitting).",
    "  5. RESIDUE — anything informative you could not encode ⇒",
    "     meta.skipped, so the student knows what the book cannot hold.",
    "",
    "Conflicts: the most official, most recent document wins; note the",
    "loser in meta.warnings. Same assessment in two documents = ONE row.",
    "",
  ];
}

function markedPaperBlock(): string[] {
  return [
    "───────────────────────────────────────────────────────────────────",
    "PARSING A MARKED PAPER — per-question marks → per-topic %",
    "───────────────────────────────────────────────────────────────────",
    "",
    "A returned, marked paper is a richer source than its headline score:",
    "every question maps to a syllabus topic, and the marker's own working",
    "tells you exactly how the student did on each one.",
    "",
    "  1. File the whole paper as an entries[] row FIRST, as usual — a",
    "     topicMarks row is never evidence for a result the tape cannot",
    "     show, so the entry must exist (already on the book, or emitted",
    "     in this same payload) before you break it down.",
    "  2. Group the paper's questions by syllabus topic, using topics[]",
    "     — mint a new topic row for one you have not seen before.",
    "  3. For each topic the paper touched, sum the marks earned and the",
    "     marks available across that topic's questions, and emit one",
    "     topicMarks row: scorePct = earned/available × 100, maxMarks =",
    "     available.",
    "  4. When the marker or the student explains a lost mark (a careless",
    "     slip, a concept that never landed, the wrong procedure, running",
    "     out of time), set errorKind — omit rather than guess one.",
    "",
    "Never invent a topic breakdown for a paper you have not actually",
    "seen marked question-by-question; a whole-paper score with no",
    "breakdown is a complete, honest entries[] row on its own.",
    "",
  ];
}

function sleepExportBlock(): string[] {
  return [
    "───────────────────────────────────────────────────────────────────",
    "PARSING A SLEEP EXPORT",
    "───────────────────────────────────────────────────────────────────",
    "",
    "Sleep app exports (a health app, a wearable, a manual log) list one",
    "row per NIGHT — transcribe them the same way: one rest[] row per",
    'night, `date` = the night the reading is FOR (not the morning it',
    'was logged), `hours` = total sleep that night, `bedtime` = "HH:MM"',
    "24-hour clock when the export states one.",
    "",
    "  · One row per date. A second reading for the same night REPLACES",
    "    the first on import — never emit two rows for one date.",
    "  · A gap in the export (a night with no reading) is a gap in",
    "    `rest` — leave it out. Never interpolate or average across it.",
    "  · An export that gives only a weekly/period average with no",
    "    nightly breakdown cannot become rest[] rows at all: note it in",
    "    meta.skipped instead of inventing nights to fit the average.",
    "",
  ];
}

function subjectTraitsBlock(): string[] {
  return [
    "───────────────────────────────────────────────────────────────────",
    "ASSIGNING SUBJECT TRAITS from a syllabus",
    "───────────────────────────────────────────────────────────────────",
    "",
    "A course outline or syllabus tells you how a subject's OWN material",
    "behaves — read it for that subject's `traits` and `mix`, not for",
    "anything about how the student is doing:",
    "",
    "  · cumulativeness — high (→1) when each result depends on nearly",
    "    everything before it (a language, a subject built strand on",
    "    strand); low (→0) when units stand alone (self-contained",
    "    modules, any of which could be assessed first).",
    "  · determinism — high when grading is mechanical (formula/method",
    "    marking, a single correct answer); low when it is judged (an",
    "    essay, a practical write-up, a holistic-band rubric).",
    "  · breadth — high when one assessment can cover most of the",
    "    syllabus (a comprehensive final); low when assessments are",
    "    narrowly scoped to one topic at a time.",
    "  · mix {knowledge, procedure, skill} — read off what the",
    "    assessment matrix actually SAYS it tests: recalling facts is",
    "    knowledge, applying a method is procedure, a demonstrated",
    "    practical or performance is skill. Renormalised to sum 1 on",
    "    import — approximate proportions from the document are fine.",
    "",
    "These are set once and rarely revisited: omit any of them the",
    "syllabus does not clearly support rather than guess a middling",
    "value — a wrong prior sitting unexamined for a term is worse than",
    "an absent one.",
    "",
  ];
}

function interviewBlock(opts: WireOpts): string[] {
  return [
    "───────────────────────────────────────────────────────────────────",
    "SOURCE · INTERVIEW — the debrief protocol",
    "───────────────────────────────────────────────────────────────────",
    "",
    opts.sources.documents
      ? "AFTER mining the documents, interview the student to fill what the\ndocuments left open. Ask only about gaps — never re-ask what a\ndocument already answered."
      : "You have no documents: everything comes from the student's memory.\nRun the full debrief.",
    "",
    "Rules of engagement: ONE subject at a time, a few questions per",
    "message, never a wall. Accept \"don't know\" instantly and move on.",
    "Offer memory joggers: the school portal, old report cards or emails,",
    "photos of returned papers, the class group chat.",
    "",
    "Per subject, in order:",
    "  1. Recent results — score, roughly when, what kind of assessment.",
    "     (Month-only memory ⇒ the 15th, reliability \"remembered\".)",
    "  2. For each: do you remember the class average? Your rank? How",
    "     many in the class/year? (Students remember ranks — always ask.)",
    "  3. Anything coming up? When, what type, worth how much?",
    "  4. Their target for the subject, and the coursework/exam split",
    "     if they know it.",
    "  5. Has a teacher given a predicted grade?",
    "  6. Their OWN prediction for anything upcoming — point, and if",
    "     offered, a range. (Goes to selfPred — their words only.)",
    "  7. Recent study sessions on THIS subject they can recall — roughly",
    "     how long, what kind (recall/practice/reading/class/tutoring),",
    "     which topics if they can say. (⇒ sessions.)",
    "  8. Their own belief about how they're doing right now, 1 (worst)",
    "     – 5 (best), and their attendance rate if they know it. (⇒",
    "     belief, attendancePct — no document states these.)",
    "",
    "After the last subject, the round-table — every item optional,",
    "the student's stated words only (R7), filed createdAt today (R8):",
    "  9. Their call on their overall exam average for the current",
    "     round, plus their forced strongest→weakest subject ranking.",
    "     (⇒ one meanCalls row.)",
    "  10. Head-to-head readiness — \"more ready for X or Y?\" — for any",
    "      pairs they will answer. (⇒ duels.)",
    "  11. How they plan to split study time this term: tokens out of",
    "      100 across subjects, real hours/week if known. (⇒ allocations.)",
    "  12. If they want it: spread 10 chips over the score bands for a",
    "      sitting they care about. (⇒ chips on that sitting.)",
    "  13. Their sleep the last week or two — night by night if they can",
    "      recall it. (⇒ rest.) Any stretch of days that took them off",
    "      their normal routine — illness, family, a big event. (⇒ disruptions.)",
    "      Skip anything they cannot recall with confidence rather than",
    "      estimate a night or a span.",
    "",
    "Close the debrief with a compact recap of everything you will file",
    "(counts per section + anything tagged below \"official\"), get one",
    "confirmation, THEN emit the payload. The payload is always your",
    "final, separate message.",
    "",
  ];
}

function forecastBlock(): string[] {
  return [
    "───────────────────────────────────────────────────────────────────",
    "FORECAST MODULE — your own calls, filed as `aiPred`",
    "───────────────────────────────────────────────────────────────────",
    "",
    "The student has opted in to YOUR forecasts. For each pending sitting",
    "in `upcoming`, you may file aiPred: {point, lo, hi, basis}. These",
    "are scored against real marks when they land, and a proven record",
    "EARNS your forecasts a capped seat in the terminal's own predictions",
    "— so calibration matters more than confidence.",
    "",
    "Reason each sitting through before you emit — silently, or out",
    "loud in a message BEFORE your final payload message; none of that",
    "prose belongs in or around the JSON:",
    "  · TREND — the subject's recent trajectory and its volatility.",
    "  · LEVEL vs the class — alpha over class averages, rank movement.",
    "  · THE PAPER — its weight, its type, how exams have historically",
    "    paid vs coursework for this subject.",
    "  · TIME — days until the sitting (from the timestamps you hold);",
    "    how much syllabus remains; whether a regime break clouds the",
    "    tape.",
    "  · BASE RATES — students overrate themselves; single results mean-",
    "    revert; a hot streak is mostly noise on 3 data points.",
    "",
    "Calibration contract:",
    "  · point = the median of your honest belief, not a hope.",
    "  · [lo, hi] = a 90% interval: wide enough that 9 of 10 such calls",
    "    contain the mark. If your interval feels comfortable, it is too",
    "    narrow.",
    "  · basis = the ONE strongest piece of evidence, ≤160 chars.",
    "  · No sitting you cannot reason about: skip rather than guess.",
    "",
  ];
}

function ladderBlock(opts: WireOpts): string[] {
  return [
    "───────────────────────────────────────────────────────────────────",
    "CAPABILITY LADDER — climb only as high as you can hold",
    "───────────────────────────────────────────────────────────────────",
    "",
    "Tier 1 · subjects + entries with the required fields only. Valid",
    "         JSON. This alone is a successful intake.",
    "Tier 2 · + context fields: classAvg, rank, cohortN, worthPct,",
    "         reliability tags on every row.",
    "Tier 3 · + the forward calendar, targets, coursework splits,",
    "         teacher predictions, and the student's transcribed calls.",
    ...(opts.forecasts
      ? ["Tier 4 · + your own calibrated aiPred per pending sitting."]
      : []),
    "",
    "A small model doing Tier 1 perfectly beats a large one doing Tier",
    `${opts.forecasts ? 4 : 3} sloppily. Perfect JSON at a low tier is always the better trade.`,
    "",
  ];
}

function checklistBlock(opts: WireOpts): string[] {
  return [
    "───────────────────────────────────────────────────────────────────",
    "PRE-FLIGHT — verify every line before you emit",
    "───────────────────────────────────────────────────────────────────",
    "",
    "  □ Output is ONE JSON object; no fences, no prose around it.",
    '  □ app = "grade-exchange", kind = "wire", promptVersion = ' + PROMPT_VERSION + ".",
    "  □ All eleven data sections present (empty arrays where empty).",
    "  □ Every roster subject echoed with its exact id — traits/mix/",
    "    belief/attendancePct included when the subject already has them.",
    "  □ Every entries[]/upcoming[] subjectId exists in your subjects[].",
    '  □ Every date matches "YYYY-MM-DD"; every score is 0–100.',
    "  □ Every entry carries an honest reliability tag.",
    "  □ Ids follow the recipes; upcoming rows ALWAYS have an id.",
    "  □ chips, if any, are 6 integers summing to 10.",
    "  □ Every topicMarks row's entryId and topicId both resolve, and",
    "    the entry and topic agree on subject.",
    "  □ rest has at most one row per date.",
    "  □ Nothing in topics/topicMarks/sessions/rest/disruptions the",
    "    source material or the student did not actually state.",
    "  □ Nothing in a transcribe-only field the student did not say.",
    opts.forecasts
      ? "  □ aiPred: point inside [lo, hi]; basis ≤160 chars."
      : "  □ No aiPred anywhere.",
    "  □ Everything doubtful is reflected in meta.",
    "",
  ];
}

function exampleBlock(opts: WireOpts): string[] {
  // With the forecast module off, the example must not model an aiPred —
  // an example that contradicts R9 teaches a weak model to break R9.
  const example = opts.forecasts
    ? EXAMPLE_PAYLOAD
    : {
        ...EXAMPLE_PAYLOAD,
        data: {
          ...EXAMPLE_PAYLOAD.data,
          upcoming: EXAMPLE_PAYLOAD.data.upcoming.map((u) => {
            const { aiPred: _aiPred, ...rest } = u;
            return rest;
          }),
        },
      };
  return [
    "───────────────────────────────────────────────────────────────────",
    "WORKED EXAMPLE — shape reference (invent nothing from it)",
    "───────────────────────────────────────────────────────────────────",
    "",
    JSON.stringify(example, null, 1),
    "",
    "═══════════════════════════════════════════════════════════════════",
    "BEGIN. The student's material follows this prompt.",
    "═══════════════════════════════════════════════════════════════════",
  ];
}

export function buildWirePrompt(opts: WireOpts, book: AppData, today: string): string {
  return [
    ...roleBlock(opts),
    ...outputContract(),
    ...hardRules(opts, today),
    ...schemaBlock(opts),
    ...contextBlock(book, today, opts.embedHistory),
    ...(opts.sources.documents
      ? [...documentsBlock(), ...markedPaperBlock(), ...sleepExportBlock(), ...subjectTraitsBlock()]
      : []),
    ...(opts.sources.interview ? interviewBlock(opts) : []),
    ...(opts.forecasts ? forecastBlock() : []),
    ...ladderBlock(opts),
    ...checklistBlock(opts),
    ...exampleBlock(opts),
  ].join("\n");
}
