// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import { STORE_KEY, freshSettings } from "./constants";
import { addDays, todayStr } from "./lib/utils";
import type { AppData } from "./types";

/**
 * TASK 12 — the life-signals pricing path wired through App.tsx.
 *
 * Three claims, all at the App level (not just the pure engine underneath,
 * which `signals.book.test.ts` already covers):
 *
 *  1. Logging a severe life-signal (a short night before the exam) against
 *     an otherwise identical book measurably moves the rendered board — the
 *     positive proof the pricing path is actually wired, not merely inert.
 *  2. A book with EMPTY signal slices — the committed fixture, which has
 *     never touched this feature — renders byte-identical text whether the
 *     LIFE SIGNALS switch is on (default) or forced off. That is the
 *     fixture-identity guarantee `signals.book.test.ts` proves at the engine
 *     level, carried all the way to the rendered board.
 *  3. A book with several signal channels populated at once still renders
 *     without a NaN reaching the board — the failure mode a bad wiring (an
 *     unguarded `undefined` slice, a mis-keyed memo) produces first.
 *
 * `todayStr()` is captured once at import time rather than frozen via fake
 * timers: App calls the real clock internally (by design — it is the one
 * place a real "now" is allowed), and every date below is built relative to
 * that same capture, so the two are never out of step.
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

/** Mount App, run its effects (including the deferred register replay), and rethrow whatever React threw. */
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
  // The register replay is deferred past first paint (App schedules it at
  // 40ms) — give it time to land so the signal fit sees the same corrected
  // board a real session would.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });

  window.removeEventListener("error", onError);
  if (errors.length) throw errors[0];
  host = el;
  return el;
}

/** Unmount and clear storage between two renders in the same test. */
async function reset() {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  localStorage.clear();
}

const TODAY = todayStr();

const sub = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id.toUpperCase(), ticker: id.slice(0, 4).toUpperCase(),
  color: "#4ea3ff", target: null, courseworkPct: null, ...over,
});
const ent = (id: string, subjectId: string, date: string, score: number, over: Record<string, unknown> = {}) => ({
  id, subjectId, date, type: "Exam", score, title: "", classAvg: null, yearAvg: null,
  rank: null, cohortN: null, worthPct: null, ...over,
});

describe("App wires the life-signals pricing path", () => {
  it("a short night before the exam measurably moves the board vs an otherwise identical book with no signal logs", async () => {
    // Tomorrow, not further out: rest.ts's acute charge only reads rest logs
    // dated on/before TODAY (you cannot log a night that hasn't happened
    // yet), so "the night before the exam" has to already be on the books.
    const examDate = addDays(TODAY, 1);
    const base: AppData = {
      subjects: [sub("a")] as never,
      entries: [
        ent("e1", "a", addDays(TODAY, -400), 62),
        ent("e2", "a", addDays(TODAY, -300), 65),
        ent("e3", "a", addDays(TODAY, -200), 68),
        ent("e4", "a", addDays(TODAY, -100), 71),
      ] as never,
      settings: freshSettings(),
      sample: false,
      upcoming: [{ id: "u1", subjectId: "a", date: examDate, type: "Exam", title: "" }] as never,
    };

    localStorage.setItem(STORE_KEY, JSON.stringify(base));
    const offHost = await boot();
    const htmlNoSignals = offHost.innerHTML;
    await reset();

    const withSignal: AppData = {
      ...base,
      // Logged the night before the exam, well under the 6.5h floor —
      // triggers rest.ts's acute short-sleep charge on its own, nothing else.
      rest: [{ id: "r1", date: addDays(examDate, -1), hours: 3 }] as never,
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(withSignal));
    const onHost = await boot();

    expect(onHost.innerHTML).not.toBe(htmlNoSignals);
  });

  it("an untouched fixture book renders byte-identical text whether the LIFE SIGNALS switch is on or off", async () => {
    const raw = readFileSync("src/lib/__fixtures__/book.json", "utf8");
    const fixture = JSON.parse(raw);

    localStorage.setItem(STORE_KEY, JSON.stringify(fixture.data));
    const onHost = await boot();
    const htmlOn = onHost.innerHTML;
    await reset();

    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ ...fixture.data, settings: { ...fixture.data.settings, signalWeighting: false } }),
    );
    const offHost = await boot();
    expect(offHost.innerHTML).toBe(htmlOn);
  });

  it("a book with several signal channels populated at once renders without a NaN anywhere", async () => {
    const examDate = addDays(TODAY, 21);
    const data: AppData = {
      subjects: [sub("a")] as never,
      entries: [
        ent("e1", "a", addDays(TODAY, -200), 62),
        ent("e2", "a", addDays(TODAY, -120), 68),
        ent("e3", "a", addDays(TODAY, -40), 71),
      ] as never,
      settings: freshSettings(),
      sample: false,
      upcoming: [{ id: "u1", subjectId: "a", date: examDate, type: "Exam", title: "", hour: 9 }] as never,
      topics: [{ id: "t1", subjectId: "a", name: "Algebra" }] as never,
      topicMarks: [{ id: "tm1", entryId: "e3", topicId: "t1", scorePct: 55 }] as never,
      sessions: [
        { id: "s1", subjectId: "a", date: addDays(TODAY, -3), minutes: 40, kind: "practice" },
        { id: "s2", subjectId: "a", date: addDays(TODAY, -2), minutes: 30, kind: "recall" },
      ] as never,
      rest: [
        { id: "r1", date: addDays(TODAY, -3), hours: 4.5 },
        { id: "r2", date: addDays(TODAY, -2), hours: 4.2 },
        { id: "r3", date: addDays(TODAY, -1), hours: 4.0 },
      ] as never,
      disruptions: [{ id: "d1", date: addDays(TODAY, -5), days: 3, kind: "illness" }] as never,
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(data));

    const el = await boot();
    expect(el.textContent).not.toContain("TRADING HALTED");
    expect(el.textContent ?? "").not.toMatch(/NaN/);
  });
});
