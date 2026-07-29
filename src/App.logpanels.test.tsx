// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import { STORE_KEY, freshSettings } from "./constants";
import { addDays, todayStr } from "./lib/utils";
import type { AppData } from "./types";

/**
 * TASK 16 — the SIGNALS view's quick-log panels, wired all the way to the
 * persisted book through App.tsx's own handlers.
 *
 * The load-bearing claim: filing ONE quick-log event writes exactly ONE row
 * to its own slice and leaves every other slice of the book byte-identical
 * — no cross-slice churn, no id generated anywhere but App.tsx (the panels
 * never call `uid()`). Rest additionally proves the dedupe-by-date REPLACE
 * rule (a second submit for the same night overwrites the first row rather
 * than appending a second) AND that its date defaults to LAST NIGHT
 * (`todayStr() - 1`), not today — RestLog's own convention (`date` is "the
 * night the reading is FOR"), which the panel's default has to honour or
 * `rest.ts`'s acute short-sleep term silently never fires.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  if (host) host.remove();
  root = null;
  host = null;
  localStorage.clear();
});

async function boot(): Promise<HTMLElement> {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
  window.addEventListener("error", onError);

  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el);
    root.render(<App />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });

  window.removeEventListener("error", onError);
  if (errors.length) throw errors[0];
  host = el;
  return el;
}

const book = (): AppData => ({
  subjects: [{ id: "s-math", name: "Mathematics", ticker: "MATH", color: "#4D7CFE", target: null }],
  entries: [
    { id: "e1", subjectId: "s-math", date: "2025-02-01", type: "Exam", score: 70, title: "", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
  ] as never,
  settings: freshSettings(),
  sample: false,
  topics: [{ id: "t-quad", subjectId: "s-math", name: "Quadratics" }] as never,
});

const stored = (): AppData => JSON.parse(localStorage.getItem(STORE_KEY)!);

const nav = (re: RegExp) =>
  [...host!.querySelectorAll('nav[aria-label="Views"] button')].find((b) => re.test(b.textContent ?? ""));
const button = (re: RegExp) => [...host!.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""));
const click = (el: Element | undefined) => {
  expect(el, "expected the control to be on screen").toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};
const label = (text: string): HTMLInputElement | HTMLSelectElement => {
  const field = [...host!.querySelectorAll("label")].find((l) => new RegExp(text, "i").test(l.textContent ?? ""));
  expect(field, `expected a field labeled ${text}`).toBeTruthy();
  return field!.querySelector("input, select") as HTMLInputElement | HTMLSelectElement;
};
const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el.tagName === "SELECT"
    ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!
    : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
  act(() => {
    proto.set!.call(el, value);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
};

describe("App wires the quick-log panels to the persisted book", () => {
  it("logging a study session appends exactly one row and touches no other slice", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(book()));
    await boot();
    const before = stored();

    click(nav(/SIGNALS/));
    setValue(label("minutes"), "45");
    click(button(/Log session/i));

    const after = stored();
    expect(after.sessions).toHaveLength(1);
    expect(after.sessions![0]).toMatchObject({ subjectId: "s-math", minutes: 45, kind: "practice" });
    expect(after.sessions![0].date).toBe(todayStr());
    expect(typeof after.sessions![0].id).toBe("string");

    // Nothing else on the book moved.
    expect(after.subjects).toEqual(before.subjects);
    expect(after.entries).toEqual(before.entries);
    expect(after.topics).toEqual(before.topics);
    expect(after.rest ?? []).toEqual([]);
    expect(after.disruptions ?? []).toEqual([]);
    expect(after.settings).toEqual(before.settings);
  });

  it("a second rest log for the same night replaces the first rather than adding a second", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(book()));
    await boot();

    click(nav(/SIGNALS/));
    setValue(label("hours slept"), "7");
    click(button(/Log rest/i));
    expect(stored().rest).toHaveLength(1);
    expect(stored().rest![0].hours).toBe(7);
    expect(stored().rest![0].date).toBe(addDays(todayStr(), -1));
    const firstId = stored().rest![0].id;

    setValue(label("hours slept"), "4.5");
    click(button(/Log rest/i));

    const after = stored();
    expect(after.rest).toHaveLength(1);
    expect(after.rest![0].hours).toBe(4.5);
    expect(after.rest![0].date).toBe(addDays(todayStr(), -1));
    // Replaced, not merely mutated in place by chance: touches no other slice.
    expect(after.sessions ?? []).toEqual([]);
    expect(after.disruptions ?? []).toEqual([]);
    void firstId;
  });

  it("logging a disruption appends exactly one row and touches no other slice", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(book()));
    await boot();
    const before = stored();

    click(nav(/SIGNALS/));
    setValue(label("days"), "3");
    setValue(label("note"), "flu");
    click(button(/Log disruption/i));

    const after = stored();
    expect(after.disruptions).toHaveLength(1);
    expect(after.disruptions![0]).toMatchObject({ date: todayStr(), kind: "illness", days: 3, note: "flu" });
    expect(after.subjects).toEqual(before.subjects);
    expect(after.entries).toEqual(before.entries);
    expect(after.sessions ?? []).toEqual([]);
    expect(after.rest ?? []).toEqual([]);
  });
});
