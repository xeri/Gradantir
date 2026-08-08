#!/usr/bin/env node
/**
 * Determinism guard for the calculation layer (AGENTS.md invariant 1).
 *
 * `src/lib/**` must be pure and clock-free: the forecast register is replayed
 * from the tape rather than stored, so one `new Date()` in the engine makes two
 * people holding the same book get different numbers. That is a linter's job,
 * not an instruction's — so it runs here, deterministically, on every write.
 *
 * PostToolUse hook. Exit 2 hands the message back to the model to fix.
 * To turn it off: delete this file and its entry in ../settings.json.
 */
import { readFileSync } from "node:fs";

/** Clock and entropy are legitimate here — these are the edge, not the engine. */
const ALLOW = [
  "src/lib/utils.ts", // uid(), todayStr() — the id factory and the "today" helper
  "src/lib/session.ts", // reads the wall clock by definition
  "src/lib/sample.ts", // seeds the demo book relative to now
  "src/lib/io.ts", // stamps exportedAt on an export envelope
];

/* Only the zero-argument forms read the clock. `new Date(y, m, d)` and
   `new Date(ms)` are pure constructions and are used all over `calendar.ts`. */
const BANNED = [
  [/\bnew\s+Date\s*\(\s*\)/, "new Date()"],
  [/\bDate\.now\s*\(/, "Date.now()"],
  [/\bMath\.random\s*\(/, "Math.random()"],
];

/** Strip comments so prose about the rule does not trip the rule. */
const strip = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0; // never break a session over a malformed payload
  }

  const raw = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath;
  if (typeof raw !== "string") return 0;

  const path = raw.replace(/\\/g, "/");
  if (!/(^|\/)src\/lib\//.test(path)) return 0;
  if (!/\.tsx?$/.test(path)) return 0;
  if (/\.test\.tsx?$/.test(path)) return 0;
  if (ALLOW.some((a) => path.endsWith(a))) return 0;

  let body;
  try {
    body = strip(readFileSync(raw, "utf8"));
  } catch {
    return 0;
  }

  const hits = BANNED.filter(([re]) => re.test(body)).map(([, name]) => name);
  if (hits.length === 0) return 0;

  const rel = path.slice(path.indexOf("src/lib/"));
  process.stderr.write(
    `Determinism guard: ${rel} uses ${hits.join(" and ")}.\n` +
      `The calculation layer is pure and clock-free — take \`asOf\` as a parameter ` +
      `and let the clock enter at the App edge. See AGENTS.md invariant 1.\n`,
  );
  return 2;
}

process.exit(main());
