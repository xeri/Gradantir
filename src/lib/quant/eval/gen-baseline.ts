import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseImport } from "../../io";
import { evaluateBook } from "./index";
import { snapshotOf, type HistoryRow } from "./snapshot";
import type { AppData } from "../../../types";

/**
 * Regenerate the skill baseline. Run DELIBERATELY, never automatically, and
 * always in the same commit as the change that moved the numbers, with the
 * before/after skill in the commit message (README §26 step 7).
 *
 *   npm run gen:baseline -- "C7 conformal width: skill 0.26 → 0.29"
 *
 * The note is required. A baseline regenerated without one is a baseline
 * nobody can audit later, and `history.json` exists precisely so that a
 * sequence of individually-defensible steps cannot walk downhill unnoticed.
 */

const TODAY = "2026-07-21"; // the fixture's as-of; see README §21

const note = process.argv.slice(2).join(" ").trim();
if (!note) {
  console.error('gen:baseline requires a note, e.g. npm run gen:baseline -- "C7 conformal width: 0.26 → 0.29"');
  process.exit(1);
}

const bookUrl = new URL("../../__fixtures__/book.json", import.meta.url);
const parsed = parseImport(readFileSync(fileURLToPath(bookUrl), "utf8"));
if (!parsed.ok) throw new Error("fixture failed to parse");
const data: AppData = {
  subjects: parsed.payload.subjects,
  entries: parsed.payload.entries,
  settings: parsed.payload.settings!,
  sample: false,
};

const sb = evaluateBook(data, TODAY);
const snap = snapshotOf(sb, note);

const baselineUrl = new URL("./__snapshots__/baseline.json", import.meta.url);
writeFileSync(fileURLToPath(baselineUrl), JSON.stringify(snap, null, 2) + "\n", "utf8");

const historyUrl = fileURLToPath(new URL("./__snapshots__/history.json", import.meta.url));
let history: HistoryRow[] = [];
try {
  history = JSON.parse(readFileSync(historyUrl, "utf8"));
} catch {
  history = [];
}
history.push({
  asOf: sb.asOf,
  modelVersion: sb.modelVersion,
  perSubjectSkill: snap.aggregate.perSubjectSkill,
  cover90: snap.aggregate.cover90,
  meanSkill: snap.aggregate.meanSkill,
  note,
});
writeFileSync(historyUrl, JSON.stringify(history, null, 2) + "\n", "utf8");

console.log(
  `baseline: skill ${snap.aggregate.perSubjectSkill}  cover90 ${snap.aggregate.cover90}  ` +
    `meanSkill ${snap.aggregate.meanSkill}  MDE≤${snap.aggregate.mdeBound} pts over ${snap.aggregate.n} folds`,
);
