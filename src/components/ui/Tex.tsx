import { useEffect, useState } from "react";
import { C, FONT } from "../../theme";

/**
 * KaTeX, loaded on demand.
 *
 * The stylesheet ships with the app (main.tsx) — it is small, and browsers
 * only fetch the font files once a glyph actually renders. The ENGINE is
 * dynamically imported the first time a derivation opens, so a user who never
 * hovers a number never pays for it and the initial bundle is unchanged.
 *
 * Rendered output is memoized by (source, mode): the same handful of formulas
 * are re-rendered constantly as the pointer moves across a waterfall.
 */

type Katex = { renderToString: (tex: string, opts?: Record<string, unknown>) => string };

let katex: Katex | null = null;
let pending: Promise<void> | null = null;
const cache = new Map<string, string>();

/** Start fetching the engine — called on hover intent, before the panel opens. */
export function preloadKatex(): Promise<void> {
  if (katex) return Promise.resolve();
  if (!pending) {
    pending = import("katex")
      .then((m) => {
        katex = ((m as { default?: Katex }).default ?? m) as Katex;
      })
      .catch(() => {
        // Leave katex null: every <Tex> falls back to its own source, which is
        // still readable. A missing chunk must not blank the panel.
        pending = null;
      });
  }
  return pending;
}

/** Render to HTML, or null while the engine is still loading. */
export function renderTex(tex: string, display: boolean): string | null {
  if (!katex) return null;
  const key = (display ? "D " : "I ") + tex;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      // Never throw in the UI — a bad formula shows as red source, and
      // derive/katex.test.ts fails the build instead.
      throwOnError: false,
      strict: "ignore",
      output: "html",
      trust: false,
    });
  } catch {
    html = "";
  }
  cache.set(key, html);
  return html;
}

/**
 * One typeset expression. Falls back to its own LaTeX source in mono while the
 * engine loads or if it never arrives — the notation stays readable either way.
 */
export function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  const [, bump] = useState(0);

  useEffect(() => {
    if (katex) return;
    let alive = true;
    preloadKatex().then(() => {
      if (alive) bump((x) => x + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  const html = renderTex(tex, display);
  if (html == null || html === "") {
    return (
      <span
        className={display ? "gx-tex-src block" : "gx-tex-src"}
        style={{ fontFamily: FONT.mono, fontSize: 11, color: C.faint, whiteSpace: "pre-wrap" }}
      >
        {tex}
      </span>
    );
  }
  return (
    <span
      className={display ? "gx-katex gx-katex-display" : "gx-katex"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
