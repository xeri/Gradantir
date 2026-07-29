// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DuelArena } from "./DuelArena";
import { DUEL_ROUND } from "../lib/duel";
import type { Duel, Subject } from "../types";

/**
 * The arena's contract is as much about what it WITHHOLDS as what it records:
 * no ratings while you answer, and no write until you confirm.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const subs: Subject[] = [
  { id: "s1", name: "Mathematics", ticker: "MATH", color: "#E8A33D", target: null },
  { id: "s2", name: "Physics", ticker: "PHYS", color: "#53B1FD", target: null },
  { id: "s3", name: "English", ticker: "ENG", color: "#2FD980", target: null },
];

let root: Root | null = null;
let host: HTMLElement;
let recorded: [string, string, string][] = [];
let resets = 0;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  recorded = [];
  resets = 0;
  vi.useRealTimers();
});

function mount(duels: Duel[] = []) {
  host = document.createElement("div");
  document.body.appendChild(host);
  // The book grows as duels are filed, exactly as App does it — a NEW array each
  // time, never a push, since that is what the arena's memos key off.
  let log = [...duels];
  const render = () =>
    root!.render(
      <DuelArena
        subjects={subs}
        duels={log}
        onRecordDuel={(a, b, w) => {
          recorded.push([a, b, w]);
          log = [...log, { id: `d${log.length}`, aId: a, bId: b, winnerId: w, createdAt: "2026-07-26" }];
          act(() => render());
        }}
        onResetDuels={() => {
          resets++;
          log = [];
          act(() => render());
        }}
      />,
    );
  act(() => {
    root = createRoot(host);
    render();
  });
}

const buttons = () => [...host.querySelectorAll("button")];
const button = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const click = (el: Element | undefined) => {
  expect(el, "expected the control to be on screen").toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};
/** The two big blocks carry an aria-label naming the desk; nothing else does. */
const blocks = () => buttons().filter((b) => b.getAttribute("aria-label")?.startsWith("More ready for"));
const key = (k: string) => act(() => {
  host.querySelector("div")!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
});

/** Walk from the board to a live duel. */
const enter = () => { click(button(/start duels/i)); click(button(/begin round/i)); };
/** Answer the pair on screen by taking a side. */
const answer = (side: 0 | 1 = 0) => { click(blocks()[side]); click(button(/confirm/i)); };

describe("DuelArena", () => {
  it("opens on the board, not on a duel", () => {
    mount();
    expect(host.textContent).toContain("0 DUELS ON RECORD");
    expect(button(/start duels/i)).toBeTruthy();
    expect(blocks()).toHaveLength(0);
  });

  it("explains itself before asking anything", () => {
    mount();
    click(button(/start duels/i));
    expect(host.textContent).toContain("FORCED CHOICE");
    expect(blocks()).toHaveLength(0); // still no duel until you begin
    click(button(/begin round/i));
    expect(blocks()).toHaveLength(2);
  });

  it("hides the ratings while you answer", () => {
    // A lopsided pile so a leaked rating would be unmistakable in the markup.
    mount([{ id: "d0", aId: "s1", bId: "s2", winnerId: "s1", createdAt: "2026-05-01" }]);
    expect(host.textContent).toContain("1012"); // board shows them…
    enter();
    expect(host.textContent).not.toContain("1012"); // …the duel does not
    expect(host.textContent).toContain("WHICH ARE YOU MORE READY TO SIT?");
  });

  it("marks the pick won and the other lost without filing anything", () => {
    mount();
    enter();
    click(blocks()[0]);
    expect(blocks()[0].getAttribute("aria-pressed")).toBe("true");
    expect(blocks()[1].getAttribute("aria-pressed")).toBe("false");
    expect(host.textContent).toContain("MORE READY");
    expect(host.textContent).toContain("LESS READY");
    expect(recorded).toHaveLength(0); // nothing is written until confirm
  });

  it("resets a pick, leaving the same pair up and the book untouched", () => {
    mount();
    enter();
    const pairBefore = blocks().map((b) => b.getAttribute("aria-label"));
    click(blocks()[0]);
    click(button(/reset/i));
    expect(blocks().every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(blocks().map((b) => b.getAttribute("aria-label"))).toEqual(pairBefore);
    expect(recorded).toHaveLength(0);
  });

  it("cannot confirm without a pick", () => {
    mount();
    enter();
    expect(button(/confirm/i)!.disabled).toBe(true);
    click(blocks()[0]);
    expect(button(/confirm/i)!.disabled).toBe(false);
  });

  it("files one duel per confirm and closes the round after five", () => {
    mount();
    enter();
    for (let i = 0; i < DUEL_ROUND; i++) {
      expect(host.textContent).toContain(`DUEL ${i + 1} / ${DUEL_ROUND}`);
      answer();
    }
    expect(recorded).toHaveLength(DUEL_ROUND);
    expect(host.textContent).toContain("ROUND COMPLETE");
    expect(blocks()).toHaveLength(0);
  });

  it("records the desk you picked as the winner of the pair on screen", () => {
    mount();
    enter();
    const [aId, bId] = blocks().map((b) => subs.find((s) => b.getAttribute("aria-label")!.includes(s.ticker))!.id);
    answer();
    expect(recorded[0]).toEqual([aId, bId, aId]);
  });

  it("does not ask the same matchup twice inside a round", () => {
    mount();
    enter();
    const seen: string[] = [];
    for (let i = 0; i < DUEL_ROUND; i++) {
      seen.push(blocks().map((b) => b.getAttribute("aria-label")).sort().join("|"));
      answer();
    }
    // Three desks give three unique pairs; a round of five must use all of them
    // before it repeats, and never repeat back-to-back.
    expect(new Set(seen).size).toBe(3);
    expect(seen.slice(0, 3).length).toBe(new Set(seen.slice(0, 3)).size);
  });

  it("shows the ranking with this round's movement once it closes", () => {
    mount();
    enter();
    // Blocks are laid out low-id-left and an untouched board ranks the same way,
    // so always taking the RIGHT desk is what actually inverts the order.
    for (let i = 0; i < DUEL_ROUND; i++) answer(1);
    expect(host.textContent).toContain("ROUND COMPLETE");
    expect(/▲/.test(host.textContent ?? "")).toBe(true);
    expect(/▼/.test(host.textContent ?? "")).toBe(true);
    // ENG won every duel it was in; it must sit above the desk that lost them.
    const board = host.textContent ?? "";
    expect(board.indexOf("ENG")).toBeLessThan(board.indexOf("MATH"));
  });

  it("exits to the board, which now carries the round's duels", () => {
    mount();
    enter();
    for (let i = 0; i < DUEL_ROUND; i++) answer();
    click(button(/exit/i));
    expect(host.textContent).toContain(`${DUEL_ROUND} DUELS ON RECORD`);
    expect(button(/start duels/i)).toBeTruthy(); // and can be run again later
  });

  it("runs another round without going back to the board", () => {
    mount();
    enter();
    for (let i = 0; i < DUEL_ROUND; i++) answer();
    click(button(/another/i));
    expect(blocks()).toHaveLength(2);
    expect(host.textContent).toContain(`DUEL 1 / ${DUEL_ROUND}`);
    for (let i = 0; i < DUEL_ROUND; i++) answer();
    expect(recorded).toHaveLength(DUEL_ROUND * 2);
  });

  it("catches focus as the phase turns, so ← → is live without a click", () => {
    mount();
    click(button(/start duels/i));
    click(button(/begin round/i));
    // The button that got us here is gone; focus must not have fallen to body.
    expect(document.activeElement).toBe(host.querySelector("div"));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("takes ← and → as the pick", () => {
    mount();
    enter();
    key("ArrowRight");
    expect(blocks()[1].getAttribute("aria-pressed")).toBe("true");
    key("ArrowLeft");
    expect(blocks()[0].getAttribute("aria-pressed")).toBe("true");
    expect(recorded).toHaveLength(0); // a keyed pick is still only a pick
  });

  it("confirms on Enter once a pick is standing", () => {
    mount();
    enter();
    key("Enter");
    expect(recorded).toHaveLength(0); // nothing picked yet
    key("ArrowLeft");
    key("Enter");
    expect(recorded).toHaveLength(1);
  });

  it("offers no reset until there is a record to drop", () => {
    mount();
    expect(button(/reset record/i)).toBeFalsy();
    mount([{ id: "d0", aId: "s1", bId: "s2", winnerId: "s1", createdAt: "2026-05-01" }]);
    expect(button(/reset record/i)).toBeTruthy();
  });

  it("takes two clicks to drop the record, and says what it will cost", () => {
    mount([
      { id: "d0", aId: "s1", bId: "s2", winnerId: "s1", createdAt: "2026-05-01" },
      { id: "d1", aId: "s1", bId: "s3", winnerId: "s1", createdAt: "2026-05-02" },
    ]);
    click(button(/reset record/i));
    expect(resets).toBe(0); // armed, not fired
    expect(host.textContent).toContain("CLICK AGAIN — DROPS ALL 2");
    click(button(/click again/i));
    expect(resets).toBe(1);
    expect(host.textContent).toContain("0 DUELS ON RECORD");
    expect(button(/reset record/i)).toBeFalsy(); // nothing left to drop
  });

  it("returns every desk to the base rating once the record is dropped", () => {
    mount([{ id: "d0", aId: "s1", bId: "s2", winnerId: "s1", createdAt: "2026-05-01" }]);
    expect(host.textContent).toContain("1012");
    click(button(/reset record/i));
    click(button(/click again/i));
    expect(host.textContent).not.toContain("1012");
    expect(host.textContent).toContain("1000");
  });

  it("forgets it was armed, so a stale click cannot drop the record", () => {
    vi.useFakeTimers();
    mount([{ id: "d0", aId: "s1", bId: "s2", winnerId: "s1", createdAt: "2026-05-01" }]);
    click(button(/reset record/i));
    expect(host.textContent).toContain("CLICK AGAIN");
    act(() => void vi.advanceTimersByTime(5001));
    expect(host.textContent).toContain("RESET RECORD");
    click(button(/reset record/i)); // this is an arm again, not a fire
    expect(resets).toBe(0);
  });

  it("disarms when you walk off into a round", () => {
    mount([{ id: "d0", aId: "s1", bId: "s2", winnerId: "s1", createdAt: "2026-05-01" }]);
    click(button(/reset record/i));
    click(button(/start duels/i));
    click(button(/cancel/i)); // back to the board
    expect(host.textContent).toContain("RESET RECORD");
    expect(host.textContent).not.toContain("CLICK AGAIN");
    expect(resets).toBe(0);
  });

  it("never renders NaN or undefined into the board", () => {
    mount([{ id: "d0", aId: "s1", bId: "s2", winnerId: "s1", createdAt: "2026-05-01" }]);
    expect(host.textContent).not.toContain("NaN");
    expect(host.textContent).not.toContain("undefined");
  });
});
