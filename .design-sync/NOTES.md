# design-sync notes — grade-exchange

Repo-specific gotchas for future syncs. Read this before re-syncing.

## Architecture (why this config looks the way it does)

- **This is a Vite *app*, not a component library.** There is no published
  library entry and `main.tsx` mounts the app at module load. So the bundle is
  built from a hand-authored barrel — `.design-sync/ds-entry.ts` — that
  re-exports ONLY the `src/components/ui/` primitives. `cfg.entry` points at it
  (`--entry ./.design-sync/ds-entry.ts`). PKG_DIR resolves to the repo root via
  the entry walk-up. **If you add/remove/rename a `ui/` primitive, update the
  barrel AND `cfg.componentSrcMap` AND `cfg.dtsPropsFor` AND `cfg.docsMap`.**
- **No shipped `.d.ts`** (the app is `noEmit`, prop types are inline in each
  `.tsx`). So props come from hand-written `cfg.dtsPropsFor` bodies, one per
  component. These are transcribed from source and do **not** auto-track — if a
  component's props change in `src/components/ui/*.tsx`, update `dtsPropsFor`
  by hand. (`ds-bundle/components/**/<Name>.d.ts` is the emitted contract.)
- **CSS comes from the app's own compiled Tailwind build.** `vite build` emits
  `dist/assets/index-<hash>.css` (Tailwind utilities + the `gx-*` custom classes
  + `--gx-*` tokens + `@font-face`). The hash changes each build, so
  `.design-sync/stage-assets.mjs` copies it to a stable path
  (`.design-sync/.cache/dsstyles/styles.css`) **with the referenced font files
  alongside** (so the CSS `url(./*.woff2)` refs resolve). `cfg.cssEntry` points
  there. `cfg.buildCmd` runs the app build THEN the staging script — always run
  buildCmd before the converter on re-sync.
- **Grouping** (controls / data / surfaces) is done with frontmatter-only stub
  docs under `.design-sync/groups/` wired via `cfg.docsMap`. The stubs set the
  group; `.prompt.md` bodies stay synthesized (import + source JSDoc + Props).
- **`Sel`** (styled `<select>`) is a bonus primitive exported from `Field.tsx`,
  synced alongside the 9 originally-scoped components (10 total).

## Verification status

- **2026-07-27 re-sync: 13 components, all authored + render-verified.** The
  floor-card era is over — every component has an authored
  `.design-sync/previews/<Name>.tsx` and every cell graded `good` from a real
  headless-chromium capture. `package-validate.mjs` reports 13/13 clean with
  **zero warn lines**, so the "Known render warns" list is deliberately empty:
  **any** warn on a future run is new and must be triaged, not assumed benign.
- The 2026-07-20 first import was floor cards with the render check never run
  (`--no-render-check`, no browser). That is history; don't re-derive it.

### Playwright ↔ chromium pinning (the one non-obvious setup step)

- The machine has a chromium cache at `%LOCALAPPDATA%\ms-playwright` holding
  **build 1234**, and a cached build pins the playwright release: **only
  `playwright@1.62.0` matches build 1234**. Install that exact version into
  `.ds-sync/` (`npm i … playwright@1.62.0`) — the browser is already there, so
  there is **no 200MB download**. A different playwright version fails with
  `browserType.launch: Executable doesn't exist`. Verify a candidate by reading
  `node_modules/playwright-core/browsers.json` as a FILE, or the raw GitHub copy
  for versions you haven't installed. Revision ≈ +6..9 per minor release.
- No `PLAYWRIGHT_BROWSERS_PATH` is needed — the cache is at the Windows default.

## Preview authoring conventions (read before adding one)

- **Preview cards render on a WHITE body** (`background:#fff` in the card html)
  while every component is designed for near-black chrome. So **each cell must
  supply its own dark surface** — a wrapper `div` with
  `background:#0F131A` (or `#0A0D12`), a `1px solid #1F2733` border, padding and
  `fontFamily: "'IBM Plex Mono', …"`. Skip it and the card looks broken even
  though the component is fine. Every existing preview does this via a local
  `const desk = {…}` (not exported — an exported const would become a cell).
- Previews `import { … } from "grade-exchange"` — the pkg name is shimmed to the
  `window.GradeExchange` global at compile time.
- **`lucide-react` imports work inside previews** (esbuild resolves it from the
  repo `node_modules`); `Btn.tsx` uses real `Plus`/`Settings2`/`Trash2` icons.
- **`Modal` is `position:fixed; inset:0`** — it owns the viewport, so it is
  pinned to `cfg.overrides.Modal = {cardMode:"single", primaryStory:"LogResult",
  viewport:"620x440"}`. Adding more exports to `Modal.tsx` is pointless: single
  mode renders only `primaryStory`.
- **`SortHeader` renders a `<th>`** — its preview must compose a real
  `table > thead > tr`, else it renders nothing meaningful.
- Compositions are ported from the app's own screens (App header row, GradeModal
  field grid, Blotter filter strip + table, SubjectCard, Screener head), not
  invented. When a component changes, re-check its preview against the source
  screen it was ported from.

## Non-component exports in the barrel (deliberate)

`ds-entry.ts` exports 6 non-component symbols alongside the 13 components, so
`window.GradeExchange` has 19 keys. They are lowercase/SCREAMING_CASE so
component discovery ignores them, and they are documented in `conventions.md`:

- `inputCls` / `inputStyle` — **required** to style a raw `<input>`/`<select>`
  inside a `Field`; without them the control renders browser-default white.
- `RATING_COLOR`, `RATING_SHORT`, `REGIME_COLOR`, `DELISTED_STYLE` — the colour
  language behind the badges (which hue means which call/regime) and the
  closed-desk row treatment.

If you add a component whose look depends on an exported constant, export the
constant too and document it there — that pattern is now established.

## Re-sync risks / watch-list

- **`dtsPropsFor` drift**: hand-written prop bodies won't follow source changes.
  Re-check them against `src/components/ui/*.tsx` when components change.
- **`stage-assets.mjs` coupling**: it greps `dist/assets/index-*.css` and copies
  every `url(...woff2?)` it references. If Vite's asset-naming or the fontsource
  imports change, revisit the script. All font subsets ship (~1MB); trim to
  latin/latin-ext in the script if size matters.
- **Barrel must track `ui/`**: a new primitive won't appear until it's added to
  `.design-sync/ds-entry.ts` (+ componentSrcMap/dtsPropsFor/docsMap).
- **JSDoc one-liners** don't reach the README component index (no `.d.ts` for
  ts-morph to read the entry from) — they DO appear in each `.prompt.md`.
- **`conventions.md` hard-codes palette hex values**, so it rots when
  `src/theme.ts` changes. It has already happened once: `faint` moved
  #5C6779 → **#7A8497** (a contrast fix to clear 4.5:1) and the 2026-07-27 run
  corrected the file. On every re-sync, re-verify the palette block and the
  `var(--gx-*)` list against `src/theme.ts` and the compiled
  `ds-bundle/_ds_bundle.css`. Currently **six** `--gx-*` tokens are live
  (`bg, panel, line, text, dim, amber`); `panel2`, `lineBright`, `faint`, `up`,
  `down`, `accent`, `strip` are **not** CSS variables — they exist only as hex
  in the JS, so the header must keep quoting them literally.
- **The six ui/ primitives left unsynced** (2026-07-27 scope decision): `Tex`
  (KaTeX, dynamic `import("katex")`), `Derive` + `PricedBanner` (both need a
  live `DeriveCtx` object and encode app-specific §15b/§28 pricing copy), plus
  the `useArmed`/`useDialogFocus` hooks. They were judged app-domain machinery
  rather than reusable design vocabulary. Revisit only if the user asks — adding
  `Derive`/`PricedBanner` means building `DeriveCtx` fixtures behind
  `cfg.provider` or a `$ref` module, not inlining data into the config.
- **Grades are keyed to the authored `.tsx` + preview-affecting config**, so a
  no-op re-sync should print `carried forward` for all 13 with zero
  `grade cleared`. A cleared grade on an untouched component means something
  nondeterministic moved — chase it before re-grading.
