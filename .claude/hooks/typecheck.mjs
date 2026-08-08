#!/usr/bin/env node
/**
 * End-of-turn typecheck. `strict` + `noUnusedLocals` + `noUnusedParameters`
 * catches a whole class of half-finished refactor that no test covers, and the
 * compiler is faster and more certain about it than a re-read is.
 *
 * Stop hook, async + asyncRewake: it runs in the background and only interrupts
 * on failure. Skips entirely when no TypeScript is dirty, and skips a repeat run
 * when nothing has changed since the last check.
 *
 * To turn it off: delete this file and its entry in ../settings.json.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sh = (cmd, args) =>
  spawnSync(cmd, args, { encoding: "utf8", shell: true, cwd: process.cwd() });

function main() {
  const status = sh("git", ["status", "--porcelain"]);
  if (status.status !== 0) return 0;

  const dirty = status.stdout
    .split("\n")
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ""))
    .filter((p) => /\.tsx?$/.test(p));
  if (dirty.length === 0) return 0;

  /* Same files, same mtimes as last run — nothing to learn from re-running. */
  const stamp = createHash("sha1");
  for (const p of dirty.sort()) {
    let m = 0;
    try {
      m = statSync(p).mtimeMs;
    } catch {
      /* deleted; the path alone still distinguishes the state */
    }
    stamp.update(`${p}:${m}\n`);
  }
  const fingerprint = stamp.digest("hex");
  const cache = join(
    tmpdir(),
    `gradantir-tsc-${createHash("sha1").update(process.cwd()).digest("hex").slice(0, 12)}`,
  );
  try {
    if (readFileSync(cache, "utf8") === fingerprint) return 0;
  } catch {
    /* no cache yet */
  }

  const tsc = sh("npx", ["tsc", "--noEmit"]);
  if (tsc.status === 0) {
    try {
      writeFileSync(cache, fingerprint);
    } catch {
      /* cache is an optimisation, not a requirement */
    }
    return 0;
  }

  const out = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`.trim().split("\n").slice(0, 20);
  process.stderr.write(`\`npx tsc --noEmit\` fails:\n${out.join("\n")}\n`);
  return 2;
}

process.exit(main());
