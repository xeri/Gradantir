// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import { STORE_KEY, freshSettings } from "./constants";
import { addDays, todayStr } from "./lib/utils";
import type { AppData } from "./types";

/**
 * REVIEW FIX B5 — `aiCharge` (App.tsx) must measure the wire's move against
 * the board the student actually sees (`signalled`, post-life-signals),
 * never the pre-signal `stats`.
 *
 * The clean, robust way to observe this without hand-computing the engine's
 * own numbers: `stats`, `selfFit` and `aiFit` are ALL independent of
 * `settings.signalWeighting` — only `signalled` reads it. So on a book where
 * the wire's channel is genuinely moving a desk (aiFit.w > 0, a staked
 * future sitting with an aiPred far from the house mean) AND that same desk
 * carries a real life-signals deviation (a study-hours surge against its own
 * norm), the reported "MOVING N CALLS BY UP TO X PTS" text can only change
 * when `signalWeighting` is toggled if `aiCharge` is reading the signalled
 * board. Before the fix, `aiChargePts(stats, …)` never reads anything
 * `signalWeighting` touches, so the toggle would leave the printed charge
 * BYTE IDENTICAL — the bug this test pins.
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
    await new Promise((r) => setTimeout(r, 200));
  });

  window.removeEventListener("error", onError);
  if (errors.length) throw errors[0];
  host = el;
  return el;
}

const nav = (re: RegExp) =>
  [...host!.querySelectorAll('nav[aria-label="Views"] button')].find((b) => re.test(b.textContent ?? ""));
const click = (el: Element | undefined) => {
  expect(el, "expected the control to be on screen").toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

const TODAY = todayStr();

/** A desk with: three past AI-called sittings the wire called perfectly
 *  against a model that has since moved on (earns aiFit.w), a staked FUTURE
 *  sitting with an aiPred far from the house mean (so the wire's channel is
 *  actually moving something right now), and a study-hours surge over its
 *  own sparse baseline (a genuine, nonzero life-signals deviation). */
function book(signalWeighting: boolean | undefined): AppData {
  const entries = [
    { id: "e1", subjectId: "s-math", date: addDays(TODAY, -500), type: "Exam", score: 60, title: "T1", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
    { id: "e2", subjectId: "s-math", date: addDays(TODAY, -400), type: "Exam", score: 60, title: "T2", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
    { id: "e3", subjectId: "s-math", date: addDays(TODAY, -300), type: "Exam", score: 60, title: "T3", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
    { id: "e4", subjectId: "s-math", date: addDays(TODAY, -200), type: "Exam", score: 92, title: "T4", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
    { id: "e5", subjectId: "s-math", date: addDays(TODAY, -120), type: "Exam", score: 92, title: "T5", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
    { id: "e6", subjectId: "s-math", date: addDays(TODAY, -60), type: "Exam", score: 92, title: "T6", classAvg: null, yearAvg: null, rank: null, cohortN: null, worthPct: null },
  ] as never;

  const upcoming = [
    // Resolved (past) — the wire called each perfectly, against a house model
    // that has since moved on (a big regime jump at e4), so it earns weight.
    { id: "u-1", subjectId: "s-math", date: addDays(TODAY, -495), type: "Exam", title: "T1", aiPred: { point: 60 } },
    { id: "u-2", subjectId: "s-math", date: addDays(TODAY, -395), type: "Exam", title: "T2", aiPred: { point: 60 } },
    { id: "u-3", subjectId: "s-math", date: addDays(TODAY, -295), type: "Exam", title: "T3", aiPred: { point: 60 } },
    // Staked and unresolved — this is the sitting whose forecast the wire is
    // ACTIVELY moving right now, far below wherever the house mean sits.
    { id: "u-future", subjectId: "s-math", date: addDays(TODAY, 20), type: "Exam", title: "Finals", aiPred: { point: 5 } },
  ] as never;

  // The stock-surge recipe from stock.test.ts's own "tanh cap" test: a sparse
  // baseline, then 14 days of heavy daily recall — saturates the STUDY STOCK
  // channel near its own cap, a real, nonzero life-signals deviation.
  const sessions = [
    { id: "old1", subjectId: "s-math", date: addDays(TODAY, -50), minutes: 10, kind: "reading" },
    { id: "old2", subjectId: "s-math", date: addDays(TODAY, -40), minutes: 10, kind: "reading" },
    { id: "old3", subjectId: "s-math", date: addDays(TODAY, -30), minutes: 10, kind: "reading" },
    ...Array.from({ length: 14 }, (_, i) => ({
      id: `surge${i}`, subjectId: "s-math", date: addDays(TODAY, -i), minutes: 600, kind: "recall",
    })),
  ] as never;

  return {
    subjects: [{ id: "s-math", name: "Mathematics", ticker: "MATH", color: "#4D7CFE", target: null }],
    entries,
    settings: { ...freshSettings(), aiWeighting: true, ...(signalWeighting === undefined ? {} : { signalWeighting }) },
    sample: false,
    upcoming,
    sessions,
  };
}

const chargeText = (): string | null => {
  const p = [...host!.querySelectorAll("p")].find((el) => /MOVING .* CALL/i.test(el.textContent ?? ""));
  return p ? p.textContent : null;
};

describe("B5 — aiCharge measures the wire's move against the board the student sees", () => {
  it("changes when a genuine life-signals deviation is toggled on for the moving desk", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(book(false)));
    await boot();
    click(nav(/SCORECARD/));
    const off = chargeText();
    expect(off, "expected the wire's charge to be printing (aiFit.w should be > 0)").toBeTruthy();

    localStorage.setItem(STORE_KEY, JSON.stringify(book(true)));
    act(() => { root!.unmount(); });
    host!.remove();
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => {
      root = createRoot(el);
      root.render(<App />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    host = el;
    click(nav(/SCORECARD/));
    const on = chargeText();
    expect(on, "expected the wire's charge to be printing (aiFit.w should be > 0)").toBeTruthy();

    // Before the fix, `stats`/`selfFit`/`aiFit` are all independent of
    // signalWeighting, so this text would be BYTE IDENTICAL regardless of
    // the toggle. After the fix, the desk's own life-signals shift moves the
    // board the wire's charge is measured against, so the printed charge
    // must differ.
    expect(on).not.toBe(off);
  });
});
