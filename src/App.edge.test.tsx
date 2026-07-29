// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import { STORE_KEY, freshSettings } from "./constants";
import type { AppData } from "./types";

/**
 * EVERY VIEW, EVERY DEGENERATE BOOK.
 *
 * `App.boot.test.tsx` proves the shell gets past its loading gate on a healthy
 * book, on the default view. That leaves five of the six views never mounted
 * inside App at all, and every degenerate shape — no prints, one print, zero
 * variance, a tape that is all 0s and 100s, a book whose desks are all
 * delisted — never rendered anywhere.
 *
 * The failure mode this guards is specific and unrecoverable: a throw during
 * render unmounts the tree, and because the save effect never runs, the same
 * bytes are still in localStorage on the next load. The book lives in one
 * browser. A view that white-screens on a shape a real student can produce
 * takes their data with it.
 *
 * This is what caught the relisted-ancestor bug: `assertRoster` states the
 * lineage invariant but is compiled out of production, so nothing else in the
 * suite ever put a violating book in front of the board.
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
  localStorage.clear();
});

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

/** Click every view tab in turn, surfacing anything that throws. */
async function visitAllViews(host: HTMLElement) {
  const tabs = [...host.querySelectorAll("nav[aria-label='Views'] button")] as HTMLButtonElement[];
  expect(tabs.length).toBeGreaterThan(0);
  for (const tab of tabs) {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
    window.addEventListener("error", onError);
    await act(async () => {
      tab.click();
    });
    // The register replay is deferred past first paint (App schedules it at
    // 40ms), so a view has to be given long enough to render the CORRECTED
    // board as well as the uncorrected first frame.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    window.removeEventListener("error", onError);
    if (errors.length) throw new Error(`view "${tab.textContent}" threw: ${String(errors[0])}`);
    if (host.textContent?.includes("TRADING HALTED")) {
      throw new Error(`view "${tab.textContent}" hit the error boundary`);
    }
  }
}

const sub = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id.toUpperCase(), ticker: id.slice(0, 4).toUpperCase(),
  color: "#4ea3ff", target: null, courseworkPct: null, ...over,
});
const ent = (id: string, subjectId: string, date: string, score: number, over: Record<string, unknown> = {}) => ({
  id, subjectId, date, type: "Exam", score, title: "", classAvg: null, yearAvg: null,
  rank: null, cohortN: null, worthPct: null, ...over,
});

const book = (d: Partial<AppData>): AppData => ({
  subjects: [], entries: [], settings: freshSettings(), sample: false, ...d,
} as AppData);

const CASES: Record<string, AppData> = {
  "empty book": book({}),
  "one subject, no entries": book({ subjects: [sub("a")] as never }),
  "one subject, one entry": book({
    subjects: [sub("a")] as never,
    entries: [ent("e1", "a", "2026-03-01", 70)] as never,
  }),
  "two entries, zero variance": book({
    subjects: [sub("a")] as never,
    entries: [ent("e1", "a", "2026-02-01", 70), ent("e2", "a", "2026-03-01", 70)] as never,
  }),
  "all scores identical, long tape": book({
    subjects: [sub("a")] as never,
    entries: Array.from({ length: 12 }, (_, i) =>
      ent(`e${i}`, "a", `2025-0${(i % 9) + 1}-15`, 80)) as never,
  }),
  "boundary scores 0 and 100": book({
    subjects: [sub("a")] as never,
    entries: [
      ent("e1", "a", "2025-02-01", 0), ent("e2", "a", "2025-06-01", 100),
      ent("e3", "a", "2026-02-01", 0), ent("e4", "a", "2026-06-01", 100),
    ] as never,
  }),
  "every desk archived": book({
    subjects: [sub("a", { archived: true }), sub("b", { archived: true })] as never,
    entries: [ent("e1", "a", "2025-03-01", 60), ent("e2", "a", "2025-08-01", 65),
      ent("e3", "b", "2025-03-01", 55), ent("e4", "b", "2025-08-01", 58)] as never,
  }),
  "entries all on one date": book({
    subjects: [sub("a")] as never,
    entries: [ent("e1", "a", "2026-03-01", 60), ent("e2", "a", "2026-03-01", 70),
      ent("e3", "a", "2026-03-01", 80)] as never,
  }),
  "far-future entries": book({
    subjects: [sub("a")] as never,
    entries: [ent("e1", "a", "2031-03-01", 60), ent("e2", "a", "2032-03-01", 70)] as never,
  }),
  "very old tape (stale)": book({
    subjects: [sub("a")] as never,
    entries: [ent("e1", "a", "2014-03-01", 60), ent("e2", "a", "2015-03-01", 70),
      ent("e3", "a", "2016-03-01", 65)] as never,
  }),
  "lineage chain": book({
    subjects: [sub("a"), sub("b", { formerly: "a" }), sub("c", { formerly: "b" })] as never,
    entries: [ent("e1", "a", "2024-03-01", 60), ent("e2", "a", "2024-08-01", 62),
      ent("e3", "b", "2025-03-01", 70), ent("e4", "c", "2026-03-01", 75)] as never,
  }),
  "ranks and cohorts": book({
    subjects: [sub("a")] as never,
    entries: [
      ent("e1", "a", "2025-03-01", 90, { rank: 1, cohortN: 1 }),
      ent("e2", "a", "2025-08-01", 50, { rank: 200, cohortN: 200, classAvg: 50, yearAvg: 50 }),
      ent("e3", "a", "2026-03-01", 70, { rank: 5, cohortN: 30, cohortSD: 0.1 }),
    ] as never,
  }),
  "coursework 0 and 100 pct": book({
    subjects: [sub("a", { courseworkPct: 0, target: 0 }), sub("b", { courseworkPct: 100, target: 100 })] as never,
    entries: [ent("e1", "a", "2025-03-01", 60), ent("e2", "a", "2026-03-01", 62),
      ent("e3", "b", "2025-03-01", 60, { type: "Assignment" }),
      ent("e4", "b", "2026-03-01", 62, { type: "Assignment" })] as never,
  }),
  "no exam prints at all": book({
    subjects: [sub("a")] as never,
    entries: [ent("e1", "a", "2025-03-01", 60, { type: "Assignment" }),
      ent("e2", "a", "2025-08-01", 62, { type: "Quiz" }),
      ent("e3", "a", "2026-03-01", 64, { type: "Assignment" })] as never,
  }),
  "elicited layer populated": book({
    subjects: [sub("a"), sub("b")] as never,
    entries: [ent("e1", "a", "2025-03-01", 60), ent("e2", "a", "2025-08-01", 65),
      ent("e3", "b", "2025-03-01", 55), ent("e4", "b", "2025-08-01", 58)] as never,
    upcoming: [{ id: "u1", subjectId: "a", date: "2026-11-01", type: "Exam", title: "",
      selfPred: { point: 70, lo: 60, hi: 80 }, teacherPred: 68, chips: [1, 2, 3] }] as never,
    duels: [{ id: "d1", aId: "a", bId: "b", winnerId: "a", createdAt: "2026-01-01" }] as never,
    allocations: [{ id: "al1", roundKey: "2026-T3", total: 100,
      planned: { a: 50, b: 50 }, createdAt: "2026-01-01" }] as never,
    meanCalls: [{ id: "m1", roundKey: "2026-T3", predAvg: 70, ranking: ["a", "b"],
      createdAt: "2026-01-01" }] as never,
  }),
};

describe("every view survives an adversarial book", () => {
  for (const [label, data] of Object.entries(CASES)) {
    it(label, async () => {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      const host = await boot();
      expect(host.textContent).not.toContain("TRADING HALTED");
      await visitAllViews(host);
    });
  }
});
