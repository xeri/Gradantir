// Stage the app's compiled stylesheet + fonts into a stable, self-contained
// location the converter can point cfg.cssEntry at.
//
// `vite build` emits dist/assets/index-<hash>.css (content-hashed name) plus
// the @fontsource woff/woff2 it references via url(./<font>-<hash>.woff2).
// The converter needs ONE fixed path, and the font url()s must resolve
// relative to the CSS file — so we copy the CSS to a stable name AND copy the
// referenced font files alongside it (names preserved so the url()s resolve).
//
// Output lives under .design-sync/.cache/ (gitignored, regenerated each build).
// Run after `npm run build` (see cfg.buildCmd).

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const ASSETS = "dist/assets";
const OUT_DIR = ".design-sync/.cache/dsstyles";

if (!existsSync(ASSETS)) {
  console.error(`[stage-assets] ${ASSETS} not found — run \`npm run build\` first.`);
  process.exit(1);
}

// Newest index-*.css (the app's single compiled stylesheet: Tailwind
// utilities + the gx-* custom classes + @font-face rules).
const cssFiles = readdirSync(ASSETS)
  .filter((f) => /^index-.*\.css$/.test(f))
  .map((f) => join(ASSETS, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

if (!cssFiles.length) {
  console.error(`[stage-assets] no index-*.css under ${ASSETS} — did the build run?`);
  process.exit(1);
}
const cssSrc = cssFiles[0];

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// Copy the stylesheet to a stable name.
copyFileSync(cssSrc, join(OUT_DIR, "styles.css"));

// Copy every font file the CSS references so its url(./<file>) refs resolve
// next to the staged stylesheet.
const css = readFileSync(cssSrc, "utf8");
const refs = new Set(
  [...css.matchAll(/url\(\.?\/?([^)]+?\.(?:woff2?|ttf|otf))\)/gi)].map((m) =>
    basename(m[1].replace(/["']/g, "")),
  ),
);
let copied = 0;
for (const name of refs) {
  const src = join(ASSETS, name);
  if (existsSync(src)) {
    copyFileSync(src, join(OUT_DIR, name));
    copied++;
  }
}

writeFileSync(join(OUT_DIR, ".gitignore"), "*\n");
console.error(
  `[stage-assets] ${basename(cssSrc)} -> ${OUT_DIR}/styles.css (${copied}/${refs.size} font files)`,
);
