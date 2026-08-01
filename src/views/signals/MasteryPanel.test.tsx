// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MasteryPanel } from "./MasteryPanel";
import type { SubjectMasteryRead } from "./MasteryPanel";
import type { Subject, Topic } from "../../types";

/**
 * TASK 17 — MasteryPanel is a READ-ONLY window onto the mastery engine's own
 * output (`topicMastery`/`masteryRead`, mastery.ts): it must never call
 * either function itself, only render the `SubjectMasteryRead` the SIGNALS
 * view computed once and handed down — the same "the leaf renders, the view
 * computes" split `signalRead`'s per-term Shapley columns already hold one level
 * up. The one thing that DOES write here is topic add/edit, which is a
 * discrete, file-on-submit event (LogPanels' pattern, T16) — never a slider,
 * so it needs no draft.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const subjects: Subject[] = [
  { id: "s-math", name: "Mathematics", ticker: "MATH", color: "#4D7CFE", target: null },
  { id: "s-chem", name: "Chemistry", ticker: "CHEM", color: "#654321", target: null },
];

const topics: Topic[] = [
  { id: "t-quad", subjectId: "s-math", name: "Quadratics", weightPct: 60 },
  { id: "t-trig", subjectId: "s-math", name: "Trigonometry", weightPct: 40 },
];

const mathMasteries = [
  { topicId: "t-quad", m: 0.9, mEff: 0.82, lastTouched: "2026-07-20", n: 4 },
  { topicId: "t-trig", m: 0, mEff: 0, lastTouched: null, n: 0 },
];

const masteryBySubject = new Map<string, SubjectMasteryRead>([
  ["s-math", {
    masteries: mathMasteries,
    // read.topics mirrors masteries exactly, the way the real masteryRead() always
    // returns them (`topics: masteries`, mastery.ts) — never an empty array beside
    // non-empty masteries, a state masteryRead() itself can never produce.
    read: { topics: mathMasteries, coverage: 0.6, predictedPaper: 72.4, term: 0.8, unevenness: 0.3 },
  }],
  ["s-chem", {
    masteries: [],
    read: { topics: [], coverage: null, predictedPaper: null, term: 0, unevenness: 0 },
  }],
]);

let root: Root | null = null;
let host: HTMLElement;
let added: { subjectId: string; name: string; weightPct: number | null; prereqIds: string[] }[];
let edited: { topicId: string; name: string; weightPct: number | null; prereqIds: string[] }[];

afterEach(() => { act(() => root?.unmount()); root = null; });

function mount() {
  added = [];
  edited = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root!.render(
      <MasteryPanel
        subjects={subjects}
        topics={topics}
        masteryBySubject={masteryBySubject}
        onAddTopic={(subjectId, name, weightPct, prereqIds) => added.push({ subjectId, name, weightPct, prereqIds })}
        onEditTopic={(topicId, name, weightPct, prereqIds) => edited.push({ topicId, name, weightPct, prereqIds })}
      />,
    );
  });
}

const fieldIn = (label: string): HTMLInputElement | HTMLSelectElement => {
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
const buttonByLabel = (label: RegExp) => [...host.querySelectorAll("button")].find((b) => label.test(b.getAttribute("aria-label") ?? ""));
const click = (el: Element | undefined) => {
  expect(el, "expected the control to be on screen").toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

describe("the mastery bars", () => {
  it("shows coverage and a mastery bar per topic, reading the engine's own numbers", () => {
    mount();
    expect(host.textContent).toContain("Quadratics");
    expect(host.textContent).toContain("Trigonometry");
    expect(host.textContent).toMatch(/60%/); // coverage
    expect(host.textContent).toMatch(/4 MARKS/); // n marks on Quadratics — not any stray digit
    expect(host.textContent).toMatch(/no marks/i); // Trigonometry, n=0
  });

  it("says a subject has no topics yet rather than fabricating a bar", () => {
    mount();
    expect(host.textContent).toContain("Chemistry");
    expect(host.textContent).toMatch(/no topics/i);
  });

  it("never emits NaN or undefined", () => {
    mount();
    expect(host.textContent).not.toContain("NaN");
    expect(host.textContent).not.toContain("undefined");
  });
});

describe("adding a topic", () => {
  it("files one topic on submit, touching no other handler", () => {
    mount();
    setValue(fieldIn("topic name"), "Vectors");
    click(button(/add topic/i));
    expect(added).toHaveLength(1);
    expect(added[0]).toEqual({ subjectId: "s-math", name: "Vectors", weightPct: null, prereqIds: [] });
    expect(edited).toHaveLength(0);
  });

  it("carries an optional weight and chosen prerequisites", () => {
    mount();
    setValue(fieldIn("topic name"), "Calculus");
    setValue(fieldIn("weight"), "30");
    click(button(/^quadratics$/i));
    click(button(/add topic/i));
    expect(added[0]).toMatchObject({ name: "Calculus", weightPct: 30, prereqIds: ["t-quad"] });
  });

  it("refuses an empty name and calls nothing", () => {
    mount();
    click(button(/add topic/i));
    expect(added).toHaveLength(0);
    expect(host.textContent).toMatch(/name/i);
  });
});

describe("editing an existing topic", () => {
  it("clicking a topic row's edit control seeds the form and files through onEditTopic, not onAddTopic", () => {
    mount();
    click(buttonByLabel(/edit quadratics/i));
    const nameField = fieldIn("topic name") as HTMLInputElement;
    expect(nameField.value).toBe("Quadratics");
    setValue(nameField, "Quadratic equations");
    click(button(/save changes/i));
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({ topicId: "t-quad", name: "Quadratic equations", weightPct: 60 });
    expect(added).toHaveLength(0);
  });

  it("offers a way to cancel out of editing back to add mode", () => {
    mount();
    click(buttonByLabel(/edit quadratics/i));
    expect(button(/save changes/i)).toBeTruthy();
    click(button(/cancel/i));
    expect(button(/add topic/i)).toBeTruthy();
    expect(button(/save changes/i)).toBeUndefined();
  });
});

describe("subjectId re-syncing when subjects arrive after mount (T17 review finding)", () => {
  /** SIGNALS mounts MasteryPanel with `liveSubs` — `visible.filter(!archived)` — so a
   *  book whose desks are ALL delisted mounts this component with `subjects: []`.
   *  Relisting a desk from "Show N delisted desks" re-renders the SAME instance with
   *  a non-empty `subjects` array; nothing unmounts. `subjectId` must track that
   *  arrival, or the add-topic form silently files a topic with subjectId "" — a
   *  topic that matches no desk, is invisible to every SubjectBlock and the engine,
   *  yet is serialised into the book forever. */
  it("does not file an orphan topic (subjectId '') when subjects goes from empty to non-empty without a remount", () => {
    added = [];
    edited = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host);
      root!.render(
        <MasteryPanel
          subjects={[]}
          topics={[]}
          masteryBySubject={new Map()}
          onAddTopic={(subjectId, name, weightPct, prereqIds) => added.push({ subjectId, name, weightPct, prereqIds })}
          onEditTopic={(topicId, name, weightPct, prereqIds) => edited.push({ topicId, name, weightPct, prereqIds })}
        />,
      );
    });
    expect(host.textContent).toMatch(/list a subject/i);

    // The student relists a desk without leaving the SIGNALS floor: same root, new props.
    act(() => {
      root!.render(
        <MasteryPanel
          subjects={subjects}
          topics={topics}
          masteryBySubject={masteryBySubject}
          onAddTopic={(subjectId, name, weightPct, prereqIds) => added.push({ subjectId, name, weightPct, prereqIds })}
          onEditTopic={(topicId, name, weightPct, prereqIds) => edited.push({ topicId, name, weightPct, prereqIds })}
        />,
      );
    });

    setValue(fieldIn("topic name"), "Vectors");
    click(button(/add topic/i));
    expect(added).toHaveLength(1);
    expect(added[0].subjectId).not.toBe("");
    expect(added[0].subjectId).toBe("s-math");
  });
});
