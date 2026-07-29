/**
 * Regenerator for the §21 published table and the skill baseline. Core numbers
 * are GENERATED, never hand-typed: run `npm run gen:table`, eyeball the numeric
 * diff, and paste the output into README §21, `mark.book.test.ts`'s `toEqual`,
 * and `eval/__snapshots__/baseline.json` in one commit. See README §26.
 *
 *   npx vite-node src/lib/__fixtures__/gen-book-table.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseImport } from "../io";
import { computeStats } from "../stats";
import { evaluateBook } from "../quant/eval";
import type { AppData, SubjectStat } from "../../types";

const TODAY = "2026-07-21";
const raw = readFileSync(fileURLToPath(new URL("./book.json", import.meta.url)), "utf8");
const parsed = parseImport(raw);
if (!parsed.ok) throw new Error("fixture failed to parse");
const data: AppData = {
  subjects: parsed.payload.subjects,
  entries: parsed.payload.entries,
  settings: parsed.payload.settings!,
  sample: false,
};

const stats = computeStats(data.subjects, data.entries, data.settings, TODAY).filter((s) => !s.sub.archived);
const byTicker = new Map(stats.map((s) => [s.sub.ticker, s]));
const desk = (t: string): SubjectStat => byTicker.get(t)!;

const row = (t: string) => {
  const q = desk(t).quant!;
  const f = q.trace!.mark!.factors;
  return {
    ticker: t, n: f.n, fv: q.fv, mark: q.price, discount: q.discount, regime: q.regime,
    rmssd: f.vol, volRatio: f.volRatio, shockZ: f.shockZ, alpha: f.alphaCollapse,
    semiDev: f.semiDev, largest: q.premia[0]?.label, largestPts: q.premia[0]?.pts,
  };
};

console.log("=== §21 · the published table (paste into mark.book.test.ts + README §21) ===");
for (const t of ["BUS", "ECON", "MATH", "PHYS", "GEO", "ENG"]) console.log(JSON.stringify(row(t)));

const sb = evaluateBook(data, TODAY);
console.log("\n=== eval/__snapshots__/baseline.json ===");
console.log(JSON.stringify({
  modelVersion: sb.modelVersion,
  n: sb.book.n,
  perSubjectSkill: +sb.book.skill.toFixed(3),
  perSubjectMae: +sb.book.mae.toFixed(2),
  perSubjectBias: +sb.book.bias.toFixed(2),
  cover90: +sb.book.cover90.toFixed(2),
  meanMae: +sb.mean.mae.toFixed(2),
  meanNaiveMae: +sb.mean.naiveMae.toFixed(2),
}, null, 2));
console.log("\n=== ablation verdicts ===");
console.log("members:", sb.members.map((m) => `${m.key}:${m.delta.toFixed(2)}(${m.verdict})`).join(" "));
console.log("premia: ", sb.premia.map((m) => `${m.key}:${m.delta.toFixed(2)}(${m.verdict})`).join(" "));
