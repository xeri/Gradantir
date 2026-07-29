// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SittingModal } from "./SittingModal";
import type { Subject, Upcoming } from "../../types";

/**
 * The wire's call is READ-ONLY in this modal, and read-only cuts both ways: the
 * student cannot edit it, and an ordinary edit-and-save must not destroy it.
 * The save handler rebuilds the sitting from scratch, so the second half is a
 * real hazard, not a formality.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const subs: Subject[] = [
  { id: "s1", name: "Mathematics", ticker: "MATH", color: "#E8A33D", target: null },
];

const sitting: Upcoming = {
  id: "u1", subjectId: "s1", date: "2026-09-01", type: "Exam", title: "Finals",
  selfPred: { point: 80 },
  aiPred: { point: 74, lo: 66, hi: 83, basis: "Flat trend into a heavier paper." },
};

let root: Root | null = null;
let host: HTMLElement;
let saved: Upcoming[] = [];

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  saved = [];
});

function mount(s?: Upcoming) {
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root!.render(
      <SittingModal subjects={subs} sitting={s} onSave={(u) => saved.push(u)} onClose={() => {}} />,
    );
  });
}

const button = (re: RegExp) =>
  [...host.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""));
const click = (el: Element | undefined) => {
  expect(el, "expected the control to be on screen").toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

describe("the wire's call inside the sitting modal", () => {
  it("shows the call, its range and its basis — with no input to edit it", () => {
    mount(sitting);
    const html = host.innerHTML;
    expect(html).toContain("THE WIRE'S CALL");
    expect(html).toContain("74%");
    expect(html).toContain("66–83");
    expect(html).toContain("Flat trend into a heavier paper.");
    expect(html).toContain("Read-only");
  });

  it("says nothing when the wire never called the sitting", () => {
    mount({ ...sitting, aiPred: undefined });
    expect(host.innerHTML).not.toContain("THE WIRE'S CALL");
  });

  it("survives an ordinary edit-and-save untouched", () => {
    mount(sitting);
    click(button(/Save sitting/i));
    expect(saved).toHaveLength(1);
    expect(saved[0].aiPred).toEqual(sitting.aiPred);
    expect(saved[0].selfPred).toEqual({ point: 80 });
  });
});
