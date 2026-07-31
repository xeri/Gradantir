// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import { STORE_KEY, freshSettings } from "./constants";
import type { AppData } from "./types";

/**
 * REVIEW FIXES B2/B3 — App.tsx's own data-safety cascades, wired all the way
 * through the persisted book.
 *
 * B2: editing a print's SUBJECT (the select is live on edit) re-files it
 * under a different desk. The entry keeps its id, so its topic marks'
 * dual FK (io.ts's sanitizeTopicMark) now disagrees on subject — dropped
 * SILENTLY on the next load unless `saveGrade` drops them in the SAME write
 * and tells the student, in the modal, at the moment of the edit.
 *
 * B3: deleting a desk (`deleteSubject`) already cascades into its entries
 * and lineage, but left its topics and sessions behind in state — visible in
 * an export taken before the next reload, gone only once the sanitizer next
 * runs. Same cascade, applied at the moment of deletion.
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

const stored = (): AppData => JSON.parse(localStorage.getItem(STORE_KEY)!);

const button = (re: RegExp) => [...host!.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""));
const click = (el: Element | undefined) => {
  expect(el, "expected the control to be on screen").toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};
const dialog = (title: string): HTMLElement => {
  const el = host!.querySelector(`[role="dialog"][aria-label="${title}"]`);
  expect(el, `expected a dialog titled ${title}`).toBeTruthy();
  return el as HTMLElement;
};
const fieldIn = (scope: HTMLElement, text: string): HTMLInputElement | HTMLSelectElement => {
  const field = [...scope.querySelectorAll("label")].find((l) => new RegExp(text, "i").test(l.textContent ?? ""));
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

describe("B2 — editing a print's subject drops its topic marks visibly, in the same write", () => {
  const book = (): AppData => ({
    subjects: [
      { id: "s-math", name: "Mathematics", ticker: "MATH", color: "#4D7CFE", target: null },
      { id: "s-eng", name: "English", ticker: "ENG", color: "#E0662E", target: null },
    ],
    entries: [
      { id: "e1", subjectId: "s-math", date: "2025-02-01", type: "Exam", score: 70, title: "Mid-year", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
    ] as never,
    settings: freshSettings(),
    sample: false,
    topics: [{ id: "t-quad", subjectId: "s-math", name: "Quadratics" }] as never,
    topicMarks: [{ id: "tm1", entryId: "e1", topicId: "t-quad", scorePct: 80 }] as never,
  });

  it("warns in the modal once the subject is changed away from the print's own desk", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(book()));
    await boot();

    click(button(/MATH/));
    click(button(/Mid-year/i));
    const d = dialog("EDIT RESULT");
    expect(d.textContent).not.toMatch(/drops 1 topic mark/i);

    setValue(fieldIn(d, "subject"), "s-eng");
    expect(d.textContent).toMatch(/drops 1 topic mark/i);
  });

  it("drops the topic marks filed against the print in the SAME write that re-files its subject", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(book()));
    await boot();

    click(button(/MATH/));
    click(button(/Mid-year/i));
    const d = dialog("EDIT RESULT");
    setValue(fieldIn(d, "subject"), "s-eng");
    click(button(/Save changes/i));

    const after = stored();
    expect(after.entries.find((e) => e.id === "e1")?.subjectId).toBe("s-eng");
    expect(after.topicMarks ?? []).toEqual([]);
  });

  it("leaves topic marks untouched when a print is edited without changing its subject", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(book()));
    await boot();

    click(button(/MATH/));
    click(button(/Mid-year/i));
    const d = dialog("EDIT RESULT");
    setValue(fieldIn(d, "score"), "75");
    click(button(/Save changes/i));

    const after = stored();
    expect(after.entries.find((e) => e.id === "e1")?.score).toBe(75);
    expect(after.topicMarks).toHaveLength(1);
  });
});

describe("B3 — deleting a desk cascades into its topics and sessions, not just entries", () => {
  const book = (): AppData => ({
    subjects: [
      { id: "s-math", name: "Mathematics", ticker: "MATH", color: "#4D7CFE", target: null },
      { id: "s-eng", name: "English", ticker: "ENG", color: "#E0662E", target: null },
    ],
    entries: [
      { id: "e1", subjectId: "s-math", date: "2025-02-01", type: "Exam", score: 70, title: "Mid-year", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
      { id: "e2", subjectId: "s-eng", date: "2025-02-01", type: "Exam", score: 70, title: "Essay", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
    ] as never,
    settings: freshSettings(),
    sample: false,
    topics: [
      { id: "t-quad", subjectId: "s-math", name: "Quadratics" },
      { id: "t-essay", subjectId: "s-eng", name: "Essay structure" },
    ] as never,
    sessions: [
      { id: "sess1", subjectId: "s-math", date: "2025-02-01", minutes: 30, kind: "practice" },
      { id: "sess2", subjectId: "s-eng", date: "2025-02-01", minutes: 30, kind: "practice" },
    ] as never,
  });

  it("drops the deleted desk's own topics and sessions, keeping every other desk's", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(book()));
    await boot();

    click(button(/MATH/));
    // The drawer's delete control is armed on a first click and struck on a
    // second ("Delete subject and its prints" -> "Click again to strike
    // every print for good") — a deliberate two-click confirm, not a single
    // accidental one.
    click(button(/delete subject/i));
    click(button(/click again/i));

    const after = stored();
    expect(after.subjects.some((s) => s.id === "s-math")).toBe(false);
    expect((after.topics ?? []).map((t) => t.subjectId)).toEqual(["s-eng"]);
    expect((after.sessions ?? []).map((s) => s.subjectId)).toEqual(["s-eng"]);
  });
});
