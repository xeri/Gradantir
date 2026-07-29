// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TraitsEditor } from "./TraitsEditor";
import type { Profile, Subject, SubjectMix, SubjectTraits } from "../../types";

/**
 * TASK 17 — TraitsEditor is the one control in the whole app that has to
 * defend DRAFT-THEN-COMMIT against a real, high-frequency input: a slider.
 * App.tsx serialises the WHOLE book on every `update()` call — every field,
 * not just the one that changed — so a control that wrote on every drag
 * frame would file that whole-book write once per pixel of pointer motion.
 *
 * The load-bearing claim this file defends: dragging a slider (any of them —
 * a trait, a mix share, belief, attendance, or a profile slider) updates
 * only a local draft and calls neither `onSaveTraits` nor `onSaveProfile`;
 * releasing the pointer (or letting go of a key) commits the draft with
 * EXACTLY ONE call to the relevant handler. A second, independent claim:
 * the three-way knowledge/procedure/skill mix always sums to 1 after a
 * drag, so `io.ts`'s own renormalisation on load is a no-op and nothing the
 * student committed visibly changes under them on the next load.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const subjects: Subject[] = [
  { id: "s-math", name: "Mathematics", ticker: "MATH", color: "#4D7CFE", target: null },
  { id: "s-chem", name: "Chemistry", ticker: "CHEM", color: "#654321", target: null,
    traits: { cumulativeness: 0.8, determinism: 0.6, breadth: 0.4 },
    mix: { knowledge: 0.5, procedure: 0.3, skill: 0.2 },
    belief: 4, attendancePct: 92 },
];

let root: Root | null = null;
let host: HTMLElement;
let traitSaves: { subjectId: string; traits: SubjectTraits; mix: SubjectMix; belief: number; attendancePct: number }[];
let profileSaves: Profile[];

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function mount(subs = subjects, profile: Profile | null = null) {
  traitSaves = [];
  profileSaves = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root!.render(
      <TraitsEditor
        subjects={subs}
        profile={profile}
        onSaveTraits={(subjectId, patch) => traitSaves.push({ subjectId, ...patch })}
        onSaveProfile={(p) => profileSaves.push(p)}
      />,
    );
  });
}

const sliderFor = (label: string): HTMLInputElement => {
  const lab = [...host.querySelectorAll("label")].find((l) => new RegExp(label, "i").test(l.textContent ?? ""));
  expect(lab, `expected a slider labeled ${label}`).toBeTruthy();
  const el = lab!.querySelector('input[type="range"]');
  expect(el, `expected a range input inside ${label}`).toBeTruthy();
  return el as HTMLInputElement;
};

/** One drag frame: set the value and fire "input" only — never "change" —
 *  the same event a browser fires continuously while a range is being dragged. */
const dragTo = (el: HTMLInputElement, value: string) => {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
  act(() => {
    proto.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** Pointer release — the only thing that should ever commit. */
const release = (el: HTMLInputElement) => {
  act(() => { el.dispatchEvent(new Event("pointerup", { bubbles: true })); });
};

describe("dragging a trait slider", () => {
  it("fires zero saves while dragging, and exactly one on release", () => {
    mount();
    const cSlider = sliderFor("cumulativeness");

    dragTo(cSlider, "0.2");
    dragTo(cSlider, "0.35");
    dragTo(cSlider, "0.5");
    expect(traitSaves).toHaveLength(0);
    expect(profileSaves).toHaveLength(0);

    release(cSlider);
    expect(traitSaves).toHaveLength(1);
    expect(traitSaves[0].subjectId).toBe("s-math");
    expect(traitSaves[0].traits.cumulativeness).toBeCloseTo(0.5, 5);
    expect(profileSaves).toHaveLength(0);
  });

  it("drops the last drafted value into the commit, not a stale earlier one", () => {
    mount();
    const bSlider = sliderFor("breadth");
    dragTo(bSlider, "0.1");
    dragTo(bSlider, "0.9");
    release(bSlider);
    expect(traitSaves).toHaveLength(1);
    expect(traitSaves[0].traits.breadth).toBeCloseTo(0.9, 5);
  });
});

describe("the knowledge/procedure/skill mix", () => {
  it("stays normalised to 1 after dragging one share — the other two give way pro-rata", () => {
    mount();
    const kSlider = sliderFor("knowledge share");
    dragTo(kSlider, "0.7");
    release(kSlider);
    expect(traitSaves).toHaveLength(1);
    const { knowledge, procedure, skill } = traitSaves[0].mix;
    expect(knowledge).toBeCloseTo(0.7, 5);
    expect(knowledge + procedure + skill).toBeCloseTo(1, 6);
    // The starting mix was even (1/3 each): the other two should still be
    // equal to one another, having given way in proportion.
    expect(procedure).toBeCloseTo(skill, 5);
  });

  it("keeps a pre-set, uneven mix normalised too", () => {
    mount([subjects[1]]);
    const pSlider = sliderFor("procedure share");
    dragTo(pSlider, "0.6");
    release(pSlider);
    const { knowledge, procedure, skill } = traitSaves[0].mix;
    expect(procedure).toBeCloseTo(0.6, 5);
    expect(knowledge + procedure + skill).toBeCloseTo(1, 6);
  });
});

describe("belief and attendance sliders", () => {
  it("commits belief (1-5) and attendance (0-100) each as their own single write", () => {
    mount();
    const belief = sliderFor("belief");
    dragTo(belief, "2");
    dragTo(belief, "5");
    expect(traitSaves).toHaveLength(0);
    release(belief);
    expect(traitSaves).toHaveLength(1);
    expect(traitSaves[0].belief).toBe(5);

    const attendance = sliderFor("attendance");
    dragTo(attendance, "80");
    release(attendance);
    expect(traitSaves).toHaveLength(2);
    expect(traitSaves[1].attendancePct).toBe(80);
  });
});

describe("switching the subject picker", () => {
  it("resets the draft to the newly picked subject's own stored values", () => {
    mount();
    const sel = host.querySelector("select") as HTMLSelectElement;
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!;
    act(() => {
      proto.set!.call(sel, "s-chem");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const belief = sliderFor("belief");
    expect(belief.value).toBe("4");
    const attendance = sliderFor("attendance");
    expect(attendance.value).toBe("92");
  });
});

describe("the profile sliders (person-level, not subject-scoped)", () => {
  it("commits test anxiety through onSaveProfile alone, never onSaveTraits", () => {
    mount();
    const anxiety = sliderFor("test anxiety");
    dragTo(anxiety, "2");
    dragTo(anxiety, "4");
    expect(profileSaves).toHaveLength(0);
    release(anxiety);
    expect(profileSaves).toHaveLength(1);
    expect(profileSaves[0].testAnxiety).toBe(4);
    expect(traitSaves).toHaveLength(0);
  });

  it("picking a chronotype commits immediately (a discrete choice, not a drag) through onSaveProfile alone", () => {
    mount([subjects[0]], { testAnxiety: 3 });
    const owlBtn = [...host.querySelectorAll("button")].find((b) => /owl/i.test(b.textContent ?? ""));
    expect(owlBtn).toBeTruthy();
    act(() => { owlBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(profileSaves).toHaveLength(1);
    expect(profileSaves[0]).toMatchObject({ chronotype: "owl", testAnxiety: 3 });
    expect(traitSaves).toHaveLength(0);
  });
});
