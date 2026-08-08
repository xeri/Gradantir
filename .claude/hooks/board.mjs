#!/usr/bin/env node
/**
 * Session-start digest of `docs/board.md`.
 *
 * A tracking file only works if it is read, and the reliable way to be read is
 * to be injected rather than retrieved. So this parses the board once per
 * session and hands back the live rows, the path collisions between them, and
 * the drift between the board and what is actually on disk — the nag that keeps
 * the board honest without anyone remembering to reconcile it.
 *
 * SessionStart hook. Prints nothing when the board is clean and empty.
 * To turn it off: delete this file and its entry in ../settings.json.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BOARD = "docs/board.md";
const IDEAS = "docs/ideas.md";
const PLAN_DIRS = ["docs/superpowers/plans", "docs/superpowers/specs"];

const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

const list = (d) => {
  try {
    return readdirSync(d).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
};

/** Every pipe table in the document, as arrays of header-keyed rows. */
function parseTables(md) {
  const tables = [];
  let head = null;
  let rows = null;
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) {
      if (head && rows?.length) tables.push({ head, rows });
      head = rows = null;
      continue;
    }
    const cells = t.slice(1, -1).split("|").map((c) => c.trim());
    if (!head) {
      head = cells;
      rows = [];
    } else if (/^:?-{2,}/.test(cells[0] ?? "")) {
      /* the separator row */
    } else {
      rows.push(Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""])));
    }
  }
  if (head && rows?.length) tables.push({ head, rows });
  return tables;
}

/** A glob reduced to the directory prefix it claims. */
const claim = (g) => g.trim().replace(/\*+$/, "").replace(/\/+$/, "");

function main() {
  const md = read(BOARD);
  if (!md) return "";

  const tables = parseTables(md);
  const work = tables.filter((t) => t.head.includes("touches")).flatMap((t) => t.rows);
  const loose = tables.filter((t) => t.head.includes("where")).flatMap((t) => t.rows);
  const live = work.filter((r) => r.status !== "done");

  const out = [];

  for (const r of live) {
    const artifact = r.artifact && r.artifact !== "none yet" ? ` — ${r.artifact}` : " — no spec yet";
    out.push(`  [${r.status}] ${r.id}: ${r.title}${artifact}`);
  }
  if (out.length) out.unshift(`Board — ${live.length} live workstream(s):`);

  /* Two live rows reaching into the same tree. */
  const collisions = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i].touches.split(",").map(claim).filter(Boolean);
      const b = live[j].touches.split(",").map(claim).filter(Boolean);
      const shared = a.filter((x) => b.some((y) => x.startsWith(y) || y.startsWith(x)));
      if (shared.length) {
        collisions.push(`  ${live[i].id} and ${live[j].id} both claim ${[...new Set(shared)].join(", ")}`);
      }
    }
  }
  if (collisions.length) out.push("Overlapping claims — sequence them before planning:", ...collisions);

  /* Drift: a plan or spec on disk that no row mentions. */
  const untracked = [];
  for (const dir of PLAN_DIRS) {
    for (const f of list(dir)) if (!md.includes(f)) untracked.push(join(dir, f).replace(/\\/g, "/"));
  }
  if (untracked.length) {
    out.push(`Not on the board (${untracked.length}) — add a row or delete the file:`);
    for (const f of untracked.slice(0, 6)) out.push(`  ${f}`);
  }

  const openLoose = loose.filter((r) => r.status !== "done");
  if (openLoose.length) {
    out.push(`Loose ends (${openLoose.length}): ${openLoose.map((r) => r.id).join(", ")}`);
  }

  const ideas = read(IDEAS);
  if (ideas) {
    const n = (ideas.match(/^### /gm) ?? []).length;
    if (n) out.push(`docs/ideas.md holds ${n} candidate(s). Add one before the session ends.`);
  }

  return out.join("\n");
}

let context = "";
try {
  context = main();
} catch {
  context = "";
}
if (context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
      suppressOutput: true,
    }),
  );
}
