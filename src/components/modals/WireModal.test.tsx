// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WireModal } from "./WireModal";
import { EXAMPLE_PAYLOAD } from "../../lib/wire/prompt";
import { freshSettings } from "../../constants";
import type { ImportPayload } from "../../lib/io";
import type { AppData } from "../../types";

/**
 * The wire's whole promise is that a paste becomes a book safely: the prompt
 * carries the roster, the reply is validated by the same pipeline as a file
 * import, the manifest says what will land, and nothing is filed without the
 * student's say-so — twice, for a replace.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const book: AppData = {
  subjects: [
    { id: "s-math", name: "Mathematics", ticker: "MATH", color: "#4D7CFE", target: 85, courseworkPct: 40 },
    { id: "s-chem", name: "Chemistry", ticker: "CHEM", color: "#654321", target: null, courseworkPct: 60 },
  ],
  entries: [],
  settings: freshSettings(),
  sample: false,
};

/** A reply whose payload the example already proves valid, plus a duel. */
const REPLY = JSON.stringify({
  ...EXAMPLE_PAYLOAD,
  data: {
    ...EXAMPLE_PAYLOAD.data,
    duels: [{ id: "d-1", aId: "s-math", bId: "s-chem", winnerId: "s-math", createdAt: "2026-07-27" }],
  },
});

let root: Root | null = null;
let host: HTMLElement;
let merged: ImportPayload[] = [];
let replaced: ImportPayload[] = [];

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  merged = [];
  replaced = [];
  vi.restoreAllMocks();
});

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root!.render(
      <WireModal
        data={book}
        today="2026-07-27"
        onMerge={(p) => merged.push(p)}
        onReplace={(p) => replaced.push(p)}
        onClose={() => {}}
      />,
    );
  });
}

const buttons = () => [...host.querySelectorAll("button")];
const button = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const click = (el: Element | undefined) => {
  expect(el, "expected the control to be on screen").toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};
const paste = (text: string) => {
  const ta = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste the AI\'s JSON reply"]');
  expect(ta).toBeTruthy();
  act(() => {
    const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!;
    proto.set!.call(ta!, text);
    ta!.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** Walk to the paste stage with the given build choices already made. */
function toPaste(opts: { forecasts?: boolean } = {}) {
  mount();
  if (opts.forecasts) click(button(/file its own calls/i));
  click(button(/Build the prompt/i));
  click(button(/I have the reply/i));
}

describe("the wire modal, end to end", () => {
  it("builds a prompt carrying the roster, and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount();
    click(button(/Build the prompt/i));
    const ta = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="The generated wire prompt"]');
    expect(ta!.value).toContain("s-math");
    expect(ta!.value).toContain("WIRE INTAKE PROTOCOL");
    await act(async () => { button(/Copy prompt/i)!.click(); });
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain("s-math");
    expect(host.textContent).toContain("Copied");
  });

  it("refuses to build with no source selected", () => {
    mount();
    click(button(/Documents/i));
    click(button(/Interview/i));
    click(button(/Build the prompt/i));
    expect(host.textContent).toContain("at least one source");
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("validates a pasted reply and files it on MERGE", () => {
    toPaste();
    paste("Here you go!\n```json\n" + REPLY + "\n```");
    click(button(/Validate/i));
    expect(host.textContent).toContain("THE MANIFEST");
    expect(host.textContent).toContain("RESULTS");
    click(button(/Merge in/i));
    expect(merged).toHaveLength(1);
    expect(merged[0].entries).toHaveLength(2);
    expect(merged[0].duels).toHaveLength(1);
    // The reply echoed s-chem without its color or coursework split — the
    // filed payload re-hydrates them from the book instead of wiping them.
    const chem = merged[0].subjects.find((s) => s.id === "s-chem")!;
    expect(chem.color).toBe("#654321");
    expect(chem.courseworkPct).toBe(60);
    // The AI's meta channel is surfaced, not swallowed.
    expect(host.textContent).toContain("Statistics module");
  });

  it("strips the AI's forecasts when their toggle is off", () => {
    toPaste({ forecasts: false });
    paste(REPLY);
    click(button(/Validate/i));
    // Forecast opt-out at build time defaults the review toggle off.
    click(button(/Merge in/i));
    expect(merged).toHaveLength(1);
    expect(merged[0].upcoming[0].aiPred).toBeUndefined();
    expect(merged[0].upcoming[0].selfPred).toBeTruthy();
  });

  it("keeps the AI's forecasts when opted in at build time", () => {
    toPaste({ forecasts: true });
    paste(REPLY);
    click(button(/Validate/i));
    click(button(/Merge in/i));
    expect(merged[0].upcoming[0].aiPred?.point).toBe(77);
  });

  it("drops an excluded elicitation section from the filed payload", () => {
    toPaste();
    paste(REPLY);
    click(button(/Validate/i));
    // The duels row carries its own include toggle; switch it off. The row is
    // the INNERMOST div matching — every ancestor matches too.
    const duelRow = [...host.querySelectorAll("div")]
      .filter((d) => d.textContent?.includes("DUELS") && d.querySelector('[role="switch"]'))
      .pop();
    expect(duelRow).toBeTruthy();
    click(duelRow!.querySelector('[role="switch"]')!);
    click(button(/Merge in/i));
    expect(merged[0].duels).toEqual([]);
    expect(merged[0].entries).toHaveLength(2);
    // And the student was warned these score THEIR skill.
    expect(host.textContent).toContain("YOUR");
    expect(host.textContent?.toUpperCase()).toContain("FORECASTING SKILL");
  });

  it("keeps the TOPIC MARKS manifest count live with the TOPICS toggle, not stale", () => {
    // Review-round finding: TOPIC MARKS depends on TOPICS (and entries) via
    // filterPayload's cascade. Before the fix, unticking TOPICS while leaving
    // TOPIC MARKS' own toggle ON left the manifest reading a stale "N NEW"
    // that would actually merge zero rows — no warning, no recount. The
    // manifest must show what will actually happen the moment the toggle
    // changes, without a re-Validate.
    toPaste();
    paste(REPLY);
    click(button(/Validate/i));
    expect(host.textContent).toContain("TOPIC MARKS");
    const topicMarksRowBefore = [...host.querySelectorAll("div")]
      .filter((d) => d.textContent?.includes("TOPIC MARKS") && d.querySelector('[role="switch"]'))
      .pop();
    expect(topicMarksRowBefore!.textContent).toContain("1 NEW");

    // Untick TOPICS (its own row) — leave TOPIC MARKS' own toggle untouched.
    const topicsRow = [...host.querySelectorAll("div")]
      .filter((d) => d.textContent?.includes("TOPICS") && d.querySelector('[role="switch"]'))
      .pop();
    expect(topicsRow).toBeTruthy();
    click(topicsRow!.querySelector('[role="switch"]')!);

    // The manifest updates itself — no re-Validate needed.
    const topicMarksRowAfter = [...host.querySelectorAll("div")]
      .filter((d) => d.textContent?.includes("TOPIC MARKS") && d.querySelector('[role="switch"]'))
      .pop();
    expect(topicMarksRowAfter!.textContent).toContain("0 NEW");
    expect(host.textContent).toContain("unticked above");

    click(button(/Merge in/i));
    expect(merged[0].topicMarks).toEqual([]);
  });

  it("REPLACE takes two clicks and quotes what it discards", () => {
    toPaste();
    paste(REPLY);
    click(button(/Validate/i));
    click(button(/Replace book/i));
    expect(replaced).toHaveLength(0);
    const armed = button(/Click again — discards/i);
    expect(armed!.textContent).toContain("2 subjects");
    click(armed);
    expect(replaced).toHaveLength(1);
  });

  it("reports a useless paste without filing anything", () => {
    toPaste();
    paste("I could not find any grades, sorry!");
    click(button(/Validate/i));
    expect(host.textContent).toContain("No JSON object found");
    expect(button(/Merge in/i)).toBeUndefined();
    expect(merged).toHaveLength(0);
  });

  it("accounts for dropped rows with reasons", () => {
    toPaste();
    const dirty = JSON.stringify({
      ...EXAMPLE_PAYLOAD,
      data: {
        ...EXAMPLE_PAYLOAD.data,
        entries: [
          ...EXAMPLE_PAYLOAD.data.entries,
          { id: "e-bad", subjectId: "s-ghost", date: "2026-05-01", type: "Exam", score: 70, title: "" },
        ],
      },
    });
    paste(dirty);
    click(button(/Validate/i));
    expect(host.textContent).toContain("1 DROPPED");
    expect(host.textContent).toContain("s-ghost");
  });
});
