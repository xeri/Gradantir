// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import { STORE_KEY } from "./constants";

/**
 * WHEN THE BOOK CANNOT BE SAVED AT ALL.
 *
 * `localStorage.setItem` does not only throw when the quota is genuinely full.
 * Safari in private browsing, and any browser with site data blocked, throw on
 * every single write. The terminal keeps working perfectly in that state — the
 * board prices, the modals open, results log — and every one of those results
 * is gone the moment the tab reloads.
 *
 * The only signal used to be a 10px cell in a horizontally-scrollable status
 * strip reading "SAVE RETRY", which is both easy to miss and untrue: nothing
 * retries. For an app whose stated premise is that the book lives in this
 * browser and nowhere else, a silent total write failure is the one thing that
 * must be impossible to miss — and the way out has to be a file, because a file
 * is the only thing here that outlives the browser.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.restoreAllMocks();
  localStorage.clear();
});

beforeEach(() => {
  // jsdom has no object URL plumbing; the banner's download button needs it.
  globalThis.URL.createObjectURL ??= (() => "blob:stub") as never;
  globalThis.URL.revokeObjectURL ??= (() => {}) as never;
});

async function boot(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<App />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
  return host;
}

describe("a book that cannot be written says so, loudly", () => {
  it("warns in plain language when every save throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const host = await boot();
    const text = (host.textContent ?? "").toUpperCase();
    // Not merely a status cell: a sentence saying results are not being kept.
    expect(text).toContain("NOT BEING SAVED");
    // And the way out — a file, offered right there.
    const download = [...host.querySelectorAll("button")]
      .find((b) => /download/i.test(b.textContent ?? ""));
    expect(download, "an export button is offered").toBeTruthy();
  });

  it("says nothing at all when saving works", async () => {
    const host = await boot();
    expect((host.textContent ?? "").toUpperCase()).not.toContain("NOT BEING SAVED");
  });

  it("hands back the whole book as a real export when asked", async () => {
    let captured = "";
    globalThis.URL.createObjectURL = ((blob: Blob) => {
      // Blob.text() is async; read the parts synchronously via the stub instead.
      captured = (blob as Blob & { __parts?: string }).__parts ?? "";
      return "blob:stub";
    }) as never;
    const RealBlob = globalThis.Blob;
    globalThis.Blob = class extends RealBlob {
      __parts: string;
      constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
        super(parts, opts);
        this.__parts = parts.join("");
      }
    } as never;

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const host = await boot();
    const download = [...host.querySelectorAll("button")]
      .find((b) => /download/i.test(b.textContent ?? "")) as HTMLButtonElement;
    await act(async () => download.click());

    const env = JSON.parse(captured);
    expect(env.app).toBe("grade-exchange");
    // The demo book the shell seeds has desks and prints; both must be in it.
    expect(env.data.subjects.length).toBeGreaterThan(0);
    expect(env.data.entries.length).toBeGreaterThan(0);
    globalThis.Blob = RealBlob;
  });

  it("still leaves the stored book untouched for the next load", async () => {
    localStorage.setItem(STORE_KEY, "{}"); // unreadable, but present
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    await boot();
    // Every write attempt threw, so nothing overwrote what was there.
    setItem.mockRestore();
    expect(localStorage.getItem(STORE_KEY)).toBe("{}");
  });
});
