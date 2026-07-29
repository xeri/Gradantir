import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The background scroll lock, reference-counted.
 *
 * `body.overflow` is one slot shared by every dialog, so save-and-restore per
 * dialog desyncs the moment two are open. The second one in saves "hidden" —
 * the FIRST one's doing — as the value to put back, and both orders of unmount
 * then go wrong: close them together (the drawer plus "clear the book", which
 * App drops in a single commit) and the last cleanup writes "hidden" back over
 * the restored "", leaving a page that cannot be scrolled until a reload; close
 * the outer one first (delete the open desk from the settings ledger) and the
 * board behind a still-open modal starts scrolling.
 *
 * Counting fixes both: the first dialog in takes the lock and remembers what the
 * page actually had, the last one out gives that back, and unmount order stops
 * mattering. Each cleanup is idempotent so a double-invoked effect cannot
 * decrement twice.
 */
let lockDepth = 0;
let restoreOverflow = "";

function lockBackgroundScroll(): () => void {
  if (lockDepth === 0) {
    restoreOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockDepth++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockDepth--;
    if (lockDepth === 0) document.body.style.overflow = restoreOverflow;
  };
}

/**
 * Dialog focus management, in one hook (WCAG 2.4.3 Focus Order, 2.1.2 No
 * Keyboard Trap, 1.4.13). On open it moves focus into the dialog; while open it
 * traps Tab/Shift+Tab inside it and locks the background from scrolling; on
 * close it restores focus to whatever opened it. Without this a keyboard user
 * Tabs straight out of the modal into the board behind it and cannot Tab back,
 * and a screen-reader user is left reading a page that is visually obscured.
 *
 * The container it is given must be focusable as a fallback (tabIndex={-1}) for
 * the case where the dialog has no focusable children yet.
 */
export function useDialogFocus<T extends HTMLElement>(ref: RefObject<T | null>): void {
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof document === "undefined") return;
    const opener = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    (focusables()[0] ?? node).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = focusables();
      if (!els.length) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", onKey);

    const unlock = lockBackgroundScroll();

    return () => {
      node.removeEventListener("keydown", onKey);
      unlock();
      // Return focus to the opener — but not if focus has since moved somewhere
      // deliberate outside the (now unmounting) dialog.
      if (opener && document.body.contains(opener)) opener.focus?.();
    };
  }, [ref]);
}
