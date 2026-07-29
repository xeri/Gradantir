// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useDialogFocus } from "./useDialogFocus";

/**
 * THE BACKGROUND SCROLL LOCK IS SHARED STATE, SO IT HAS TO BE COUNTED.
 *
 * Every dialog in this app locks `body.overflow` while it is open and restores
 * whatever it found on the way out. That is correct for one dialog and wrong for
 * two: the second one to open finds "hidden" (the first one's doing) and saves
 * THAT as the thing to restore.
 *
 * Both orders are reachable from the shell:
 *
 *   Drawer, then settings from the palette, then "clear the book" — App drops
 *   `drawerId` and `modal` in one commit, React unmounts the drawer first, it
 *   restores "", and the settings modal then restores "hidden" over the top. The
 *   page can never be scrolled again without a reload.
 *
 *   Drawer open, delete that desk from the settings ledger — the drawer unmounts
 *   underneath a modal that is still open, restores "", and the board behind the
 *   modal starts scrolling while it is supposed to be inert.
 *
 * The lock therefore has to be reference-counted: the first dialog in takes it,
 * the last one out gives it back, and out-of-order unmounts cannot desync it.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.style.overflow = "";
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Dialog({ label }: { label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  return (
    <div ref={ref} tabIndex={-1}>
      <button>{label}</button>
    </div>
  );
}

/** Render the given set of open dialogs, in the order the shell renders them. */
function show(open: { drawer?: boolean; modal?: boolean }) {
  act(() => {
    root!.render(
      <>
        {open.drawer && <Dialog label="drawer" />}
        {open.modal && <Dialog label="modal" />}
      </>,
    );
  });
}

const mount = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host!);
  });
};

describe("the dialog background-scroll lock", () => {
  it("locks while a dialog is open and releases when it closes", () => {
    mount();
    show({ drawer: true });
    expect(document.body.style.overflow).toBe("hidden");
    show({});
    expect(document.body.style.overflow).toBe("");
  });

  it("stays locked when an inner dialog closes over an outer one still open", () => {
    mount();
    show({ drawer: true });
    show({ drawer: true, modal: true });
    show({ drawer: true });
    expect(document.body.style.overflow).toBe("hidden");
    show({});
    expect(document.body.style.overflow).toBe("");
  });

  it("releases when the OUTER dialog closes first and the inner one follows", () => {
    // The settings-ledger delete: the drawer goes, the modal stays, and then the
    // modal goes. The page must scroll again at the end and not before.
    mount();
    show({ drawer: true });
    show({ drawer: true, modal: true });
    show({ modal: true });
    expect(document.body.style.overflow).toBe("hidden");
    show({});
    expect(document.body.style.overflow).toBe("");
  });

  it("releases when two stacked dialogs unmount in the same commit", () => {
    // "Clear the book" from settings with a drawer open behind it.
    mount();
    show({ drawer: true, modal: true });
    show({});
    expect(document.body.style.overflow).toBe("");
  });

  it("restores a page that was already unscrollable before any dialog opened", () => {
    mount();
    document.body.style.overflow = "clip";
    show({ drawer: true });
    expect(document.body.style.overflow).toBe("hidden");
    show({});
    expect(document.body.style.overflow).toBe("clip");
  });
});
