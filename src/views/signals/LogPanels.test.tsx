// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LogPanels } from "./LogPanels";
import { restRead } from "../../lib/quant/signals/rest";
import { addDays } from "../../lib/utils";
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
 *
 * A second load-bearing claim, added on review: REST's date is "the night
 * the reading is FOR", not the day it is typed (RestLog's own doc comment,
 * `rest.ts`'s acute-term lookup, and the wire's intake prompt all agree).
 * The realistic use of this panel is retrospective — a student wakes and
 * logs last night — so its date input defaults to `todayIso - 1`, and one
 * test below pins the case the review flagged: a night logged on the
 * morning of an exam must land under `examDate - 1`, or `restRead`'s acute
 * short-sleep term can never find it.
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
let sessions: { subjectId: string; date: string; minutes: number; kind: SessionKind; topicIds: string[] }[];
let rests: { date: string; hours: number; bedtime: string | null }[];
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
        onLogSession={(subjectId, date, minutes, kind, topicIds) => sessions.push({ subjectId, date, minutes, kind, topicIds })}
        onLogRest={(date, hours, bedtime) => rests.push({ date, hours, bedtime })}
        onLogDisruption={(date, kind, days, note) => disruptions.push({ date, kind, days, note })}
      />,
    );
  });
}

/** Scope a field lookup to one panel — SESSION and DISRUPTION both have a
 *  field labeled "KIND", so an unscoped lookup is ambiguous. */
const panel = (title: RegExp): HTMLElement => {
  const h = [...host.querySelectorAll("h2")].find((h) => title.test(h.textContent ?? ""));
  expect(h, `expected a panel titled ${title}`).toBeTruthy();
  return h!.closest("section") as HTMLElement;
};
const SESSION = () => panel(/LOG STUDY SESSION/);
const REST = () => panel(/LOG REST NIGHT/);
const DISRUPTION = () => panel(/LOG DISRUPTION/);

const fieldIn = (root: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement => {
  const field = [...root.querySelectorAll("label")].find((l) => new RegExp(label, "i").test(l.textContent ?? ""));
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
  it("logs one session on submit, dated today by default, touching no other handler", () => {
    mount("2026-07-29");
    setValue(fieldIn(SESSION(), "minutes"), "45");
    click(button(/Log session/i));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual({ subjectId: "s-math", date: "2026-07-29", minutes: 45, kind: "practice", topicIds: [] });
    expect(rests).toHaveLength(0);
    expect(disruptions).toHaveLength(0);
  });

  it("lets the date be backdated for a session logged after the fact", () => {
    mount("2026-07-29");
    setValue(fieldIn(SESSION(), "date"), "2026-07-27");
    setValue(fieldIn(SESSION(), "minutes"), "30");
    click(button(/Log session/i));
    expect(sessions[0].date).toBe("2026-07-27");
  });

  it("carries selected topic chips, scoped to the chosen subject", () => {
    mount();
    setValue(fieldIn(SESSION(), "minutes"), "30");
    click(button(/Quadratics/));
    click(button(/Log session/i));
    expect(sessions[0].topicIds).toEqual(["t-quad"]);
    // Chemistry's chip never appears while Mathematics is selected.
    expect(host.textContent).not.toContain("Acids");
  });

  it("refuses minutes outside 1-600 and calls nothing", () => {
    mount();
    setValue(fieldIn(SESSION(), "minutes"), "0");
    click(button(/Log session/i));
    expect(sessions).toHaveLength(0);
    expect(host.textContent).toMatch(/1 to 600/);

    setValue(fieldIn(SESSION(), "minutes"), "601");
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
  it("defaults the night to yesterday relative to todayIso — the reading is FOR last night, not today", () => {
    mount("2026-07-29");
    const night = fieldIn(REST(), "for the night of") as HTMLInputElement;
    expect(night.value).toBe("2026-07-28");
  });

  it("logs the night, hours and bedtime on submit, touching no other handler", () => {
    mount("2026-07-29");
    setValue(fieldIn(REST(), "hours slept"), "7.5");
    setValue(fieldIn(REST(), "bedtime"), "22:30");
    click(button(/Log rest/i));
    expect(rests).toEqual([{ date: "2026-07-28", hours: 7.5, bedtime: "22:30" }]);
    expect(sessions).toHaveLength(0);
    expect(disruptions).toHaveLength(0);
  });

  it("bedtime is optional — omitting it logs null, not empty string", () => {
    mount("2026-07-29");
    setValue(fieldIn(REST(), "hours slept"), "6");
    click(button(/Log rest/i));
    expect(rests).toEqual([{ date: "2026-07-28", hours: 6, bedtime: null }]);
  });

  it("lets the night be changed — a catch-up log two nights back", () => {
    mount("2026-07-29");
    setValue(fieldIn(REST(), "for the night of"), "2026-07-25");
    setValue(fieldIn(REST(), "hours slept"), "8");
    click(button(/Log rest/i));
    expect(rests).toEqual([{ date: "2026-07-25", hours: 8, bedtime: null }]);
  });

  it("refuses hours outside 0-14", () => {
    mount();
    setValue(fieldIn(REST(), "hours slept"), "15");
    click(button(/Log rest/i));
    expect(rests).toHaveLength(0);
    expect(host.textContent).toMatch(/0 to 14/);
  });

  it("names the night it is filing for, and says a same-night resubmit replaces rather than adds", () => {
    mount("2026-07-29");
    expect(host.textContent).toContain("2026-07-28");
    expect(host.textContent).toMatch(/replaces/i);
  });

  it("PINS THE ACUTE-TERM CASE: a night logged the morning of the exam lands under examDate-1, so restRead finds it", () => {
    const examDate = "2026-08-15";
    // Logging "this morning" — todayIso is exam day itself — with no date
    // edit: the default must be examDate-1 for the acute term to fire.
    mount(examDate);
    setValue(fieldIn(REST(), "hours slept"), "3"); // well under the 6.5h floor
    click(button(/Log rest/i));
    expect(rests).toHaveLength(1);
    expect(rests[0].date).toBe(addDays(examDate, -1));

    const read = restRead(
      [{ id: "r1", date: rests[0].date, hours: rests[0].hours, ...(rests[0].bedtime ? { bedtime: rests[0].bedtime } : {}) }],
      examDate,
      examDate,
    );
    expect(read.acuteTerm).toBeLessThan(0);
  });
});

describe("the disruption panel", () => {
  it("logs date, kind, days and note on submit, touching no other handler", () => {
    mount("2026-07-20");
    setValue(fieldIn(DISRUPTION(), "kind"), "illness");
    setValue(fieldIn(DISRUPTION(), "days"), "3");
    setValue(fieldIn(DISRUPTION(), "note"), "flu, off school");
    click(button(/Log disruption/i));
    expect(disruptions).toEqual([{ date: "2026-07-20", kind: "illness", days: 3, note: "flu, off school" }]);
    expect(sessions).toHaveLength(0);
    expect(rests).toHaveLength(0);
  });

  it("defaults its date to todayIso without reading a live clock", () => {
    mount("2026-01-05");
    const date = fieldIn(DISRUPTION(), "started") as HTMLInputElement;
    expect(date.value).toBe("2026-01-05");
  });

  it("days and note are optional", () => {
    mount("2026-07-20");
    click(button(/Log disruption/i));
    expect(disruptions).toEqual([{ date: "2026-07-20", kind: "illness", days: null, note: null }]);
  });

  it("refuses days outside 1-60", () => {
    mount("2026-07-20");
    setValue(fieldIn(DISRUPTION(), "days"), "61");
    click(button(/Log disruption/i));
    expect(disruptions).toHaveLength(0);
    expect(host.textContent).toMatch(/1 to 60/);
  });
});
