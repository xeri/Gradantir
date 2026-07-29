import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SpiderAllocator, type SpiderAllocatorProps } from "./SpiderAllocator";
import { axisMaxFor } from "../lib/allocate";

const axes = [
  { id: "s1", label: "ENG", color: "#E0662E" },
  { id: "s2", label: "MATH", color: "#53B1FD" },
  { id: "s3", label: "PHYS", color: "#2FD980" },
  { id: "s4", label: "CHEM", color: "#B06AF0" },
];

const noop = () => {};

const render = (over: Partial<SpiderAllocatorProps> = {}) =>
  renderToStaticMarkup(
    <SpiderAllocator
      axes={axes}
      plan={{ s1: 40, s2: 30, s3: 20, s4: 10 }}
      actual={null}
      model={null}
      total={100}
      axisMax={axisMaxFor(100, 4)}
      hoursPerWeek={14}
      pinned={[]}
      armed="plan"
      onPlan={noop}
      onActual={noop}
      onCommit={noop}
      onTogglePin={noop}
      {...over}
    />,
  );

describe("SpiderAllocator", () => {
  it("gives every desk a draggable handle quoted in hours, not tokens", () => {
    const html = render();
    expect(html.split('role="slider"').length - 1).toBe(4);
    // 40 of 100 tokens against a 14h week is 5.6h.
    expect(html).toContain("5.6 hours a week on ENG");
    expect(html).toContain("1.4 hours a week on CHEM");
  });

  it("relabels every hour figure when the weekly budget changes, leaving the shape alone", () => {
    const at14 = render();
    const at20 = render({ hoursPerWeek: 20 });
    expect(at14).toContain("5.6 hours a week on ENG");
    expect(at20).toContain("8.0 hours a week on ENG");
    // Same tokens ⇒ same geometry: the polygon is untouched.
    const poly = (h: string) => h.match(/points="([\d., ]+)" fill="#53B1FD"/)?.[1];
    expect(poly(at20)).toBe(poly(at14));
  });

  it("draws the model only as a ghost, and the actual ring only once it exists", () => {
    const bare = render();
    expect(bare).not.toContain("stroke-dasharray");
    expect(bare).not.toContain("#E8A33D");

    const full = render({ model: { s1: 55, s2: 25, s3: 20, s4: 0 }, actual: { s1: 30, s2: 30, s3: 30, s4: 10 } });
    expect(full).toContain("stroke-dasharray");
    expect(full).toContain("#E8A33D");
  });

  it("marks a pinned desk and locks its handle out of the drag", () => {
    const html = render({ pinned: ["s2"] });
    expect(html).toContain("▪ MATH");
    expect(html).toContain("hours a week on MATH, pinned");
    expect(html).toContain('aria-disabled="true"');
  });

  it("leaves the actual ring editable even on a pinned desk — you spent what you spent", () => {
    const html = render({ armed: "actual", actual: { s1: 40, s2: 30, s3: 20, s4: 10 }, pinned: ["s2"] });
    expect(html).toContain("▪ MATH");
    expect(html).not.toContain('aria-disabled="true"');
  });

  it("flags a desk pushed past the outer ring rather than clipping it silently", () => {
    const ringed = render({ armed: "actual", actual: { s1: 90, s2: 30, s3: 20, s4: 10 } });
    expect(ringed).toContain("0,-5 4.5,2 -4.5,2");
    expect(render()).not.toContain("0,-5 4.5,2 -4.5,2");
  });

  it("never emits NaN or undefined into the markup", () => {
    for (const props of [{}, { hoursPerWeek: 0 }, { axisMax: 0 }, { plan: {} }, { axes: axes.slice(0, 3) }]) {
      const html = render(props as Partial<SpiderAllocatorProps>);
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("undefined");
    }
  });
});
