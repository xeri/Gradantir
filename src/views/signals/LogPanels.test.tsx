// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LogPanels } from "./LogPanels";
import type { Disruption, SessionKind, Subject, Topic } from "../../types";

/**
 * TASK 16 — quick-log panels for the SIGNALS view.
 *
 * Each of the three panels (study session, rest night, disruption) is a
 * DISCRETE event: file-on-submit, one submit == one call to its own
 * `onLog*` handler, and nothing else. The load-bearing claim this file
 * defends is isolation — logging a session must call `onLogSession` alone,
 * never `onLogRest` or `onLogDisruption` (and so on for the other two), so a
 * bug that wired the wrong handler or fired on every keystroke would show up
 * here immediately. Bounds validation (minutes 1-600, hours 0-14, days
 * 1-60) mirrors `io.ts`'s sanitizer so a value the sanitizer would silently
 * clamp is instead refused up front, with no handler call at all.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const subjects: Subject[] = [
  { id: "s-math", name: "Mathematics", ticker: "MATH", color: "#4D7CFE", target: null },
  { id: "s-chem", name: "Chemistry", ticker: "CHEM", color: "#654321", target: null },
];
const topics: Topic[] = [
  { id: "t-quad", subjectId: "s-math", name: "Quadratics" },
  { id: "t-trig", subjectId: "s-math", name: "Trigonometry" },
  { id: "t-acid", subjectId: "s-chem", name: "Acids" },
];

let root: Root | null = null;
let host: HTMLElement;
let sessions: { subjectId: string; minutes: number; kind: SessionKind; topicIds: string[] }[];
let rests: { hours: number; bedtime: string | null }[];
let disruptions: { date: string; kind: Disruption["kind"]; days: number | null; note: string | null }[];

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  sessions = [];
  rests = [];
  disruptions = [];
});

function mount(todayIso = "2026-07-29", subs = subjects) {
  sessions = [];
  rests = [];
  disruptions = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root!.render(
      <LogPanels
        subjects={subs}
        topics={topics}
        todayIso={todayIso}
        onLogSession={(subjectId, minutes, kind, topicIds) => sessions.push({ subjectId, minutes, kind, topicIds })}
        onLogRest={(hours, bedtime) => rests.push({ hours, bedtime })}
        onLogDisruption={(date, kind, days, note) => disruptions.push({ date, kind, days, note })}
      />,
    );
  });
}

const input = (label: string): HTMLInputElement | HTMLSelectElement => {
  const field = [...host.querySelectorAll("label")].find((l) => new RegExp(label, "i").test(l.textContent ?? ""));
  expect(field, `expected a field labeled ${label}`).toBeTruthy();
  const el = field!.querySelector("input, select");
  expect(el, `expected an input/select inside ${label}`).toBeTruthy();
  return el as HTMLInputElement | HTMLSelectElement;
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

const button = (re: RegExp) => [...host.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""));
const click = (el: Element | undefined) => {
  expect(el, "expected the control to be on screen").toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

describe("the study session panel", () => {
  it("logs one session on submit, touching no other handler", () => {
    mount();
    setValue(input("minutes"), "45");
    click(button(/Log session/i));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual({ subjectId: "s-math", minutes: 45, kind: "practice", topicIds: [] });
    expect(rests).toHaveLength(0);
    expect(disruptions).toHaveLength(0);
  });

  it("carries selected topic chips, scoped to the chosen subject", () => {
    mount();
    setValue(input("minutes"), "30");
    click(button(/Quadratics/));
    click(button(/Log session/i));
    expect(sessions[0].topicIds).toEqual(["t-quad"]);
    // Chemistry's chip never appears while Mathematics is selected.
    expect(host.textContent).not.toContain("Acids");
  });

  it("refuses minutes outside 1-600 and calls nothing", () => {
    mount();
    setValue(input("minutes"), "0");
    click(button(/Log session/i));
    expect(sessions).toHaveLength(0);
    expect(host.textContent).toMatch(/1 to 600/);

    setValue(input("minutes"), "601");
    click(button(/Log session/i));
    expect(sessions).toHaveLength(0);
  });

  it("shows a placeholder instead of a form when no subject is listed", () => {
    mount("2026-07-29", []);
    expect(button(/Log session/i)).toBeUndefined();
    expect(host.textContent).toMatch(/list a subject/i);
  });
});

describe("the rest night panel", () => {
  it("logs hours and bedtime on submit, touching no other handler", () => {
    mount();
    setValue(input("hours slept"), "7.5");
    setValue(input("bedtime"), "22:30");
    click(button(/Log rest/i));
    expect(rests).toEqual([{ hours: 7.5, bedtime: "22:30" }]);
    expect(sessions).toHaveLength(0);
    expect(disruptions).toHaveLength(0);
  });

  it("bedtime is optional — omitting it logs null, not empty string", () => {
    mount();
    setValue(input("hours slept"), "6");
    click(button(/Log rest/i));
    expect(rests).toEqual([{ hours: 6, bedtime: null }]);
  });

  it("refuses hours outside 0-14", () => {
    mount();
    setValue(input("hours slept"), "15");
    click(button(/Log rest/i));
    expect(rests).toHaveLength(0);
    expect(host.textContent).toMatch(/0 to 14/);
  });

  it("says a same-day resubmit replaces rather than adds a second night", () => {
    mount();
    expect(host.textContent).toMatch(/replaces/i);
  });
});

describe("the disruption panel", () => {
  it("logs date, kind, days and note on submit, touching no other handler", () => {
    mount("2026-07-20");
    setValue(input("kind"), "illness");
    setValue(input("days"), "3");
    setValue(input("note"), "flu, off school");
    click(button(/Log disruption/i));
    expect(disruptions).toEqual([{ date: "2026-07-20", kind: "illness", days: 3, note: "flu, off school" }]);
    expect(sessions).toHaveLength(0);
    expect(rests).toHaveLength(0);
  });

  it("defaults its date to todayIso without reading a live clock", () => {
    mount("2026-01-05");
    const date = input("started") as HTMLInputElement;
    expect(date.value).toBe("2026-01-05");
  });

  it("days and note are optional", () => {
    mount("2026-07-20");
    click(button(/Log disruption/i));
    expect(disruptions).toEqual([{ date: "2026-07-20", kind: "illness", days: null, note: null }]);
  });

  it("refuses days outside 1-60", () => {
    mount("2026-07-20");
    setValue(input("days"), "61");
    click(button(/Log disruption/i));
    expect(disruptions).toHaveLength(0);
    expect(host.textContent).toMatch(/1 to 60/);
  });
});
