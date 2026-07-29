// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import { STORE_KEY } from "./constants";

/**
 * The shell boots in two renders: `data` is null on the first paint and the
 * load effect fills it on the second. Every hook must therefore sit ABOVE the
 * `if (!data)` early return — one hook below it renders a different hook count
 * on the second pass, React tears the tree down, and the terminal shows a
 * blank screen. Nothing else in the suite mounts App, so this is the only
 * place that pass-two is exercised at all.
 */

// cwd-relative, not import.meta.url: this suite runs under jsdom, where
// import.meta.url is an http: URL that fileURLToPath rejects. Vitest runs from
// the project root, so the repo-relative path resolves.
const book = JSON.parse(readFileSync("src/lib/__fixtures__/book.json", "utf8"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom ships no ResizeObserver; recharts' ResponsiveContainer subscribes to one
   on mount. Real browsers have it, so this is an environment gap, not a defect
   under test — a no-op stub keeps the charts mounting at zero size. */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  localStorage.clear();
});

/** Mount App, run its effects, and rethrow whatever React threw. */
async function boot(): Promise<HTMLElement> {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
  window.addEventListener("error", onError);

  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<App />);
  });

  window.removeEventListener("error", onError);
  if (errors.length) throw errors[0];
  return host;
}

describe("App boots past the loading gate", () => {
  it("mounts on a fresh machine and reaches the sample book", async () => {
    const host = await boot();
    // Positive proof pass-two rendered the shell, not just that the loading
    // gate is gone: the chrome header prints GRADE·EXCHANGE, which the loading
    // splash ("OPENING THE EXCHANGE…") does not contain.
    expect(host.textContent).not.toContain("OPENING THE EXCHANGE");
    expect(host.textContent).toContain("GRADE");
    expect(host.querySelector("main")).not.toBeNull();
  });

  it("opens the AI import from the header, next to Log result", async () => {
    const host = await boot();
    const wire = [...host.querySelectorAll("button")].find((b) => /ai import/i.test(b.textContent ?? ""));
    expect(wire, "expected an AI IMPORT button in the header").toBeTruthy();
    await act(async () => {
      wire!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("THE WIRE — AI INTAKE");
  });

  it("mounts against the real stored book", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(book.data));
    const host = await boot();
    expect(host.textContent).not.toContain("OPENING THE EXCHANGE");
    expect(host.textContent).toContain("GRADE");
    // The stored book's desks reached the board — MATH is one of its six.
    expect(host.textContent).toContain("MATH");
  });
});
