import { useEffect, useRef } from "react";

/**
 * ONE ESCAPE, ONE LAYER.
 *
 * Seven places used to attach their own `window` keydown listener for Escape.
 * They all fire on the same node in the same phase and none is an ancestor of
 * the others, so `stopPropagation` could not have helped even if it were
 * called — every open layer closed at once. Open a desk drawer, hit "Log
 * result", press Escape: the ticket AND the drawer went, and you lost your
 * place. Pin a point on the chart, open a drawer from the pin strip, press
 * Escape: the drawer closed and the pin was silently cleared behind it.
 *
 * Layers register here on mount and are popped on unmount; only the layer on
 * top of the stack sees the key. Registration order is mount order, which is
 * exactly the visual stacking order in this app.
 */
type Layer = { close: () => void };

const stack: Layer[] = [];
let bound = false;

const onKey = (e: KeyboardEvent) => {
  if (e.key !== "Escape" || stack.length === 0) return;
  e.preventDefault();
  stack[stack.length - 1].close();
};

/** Register a dismissible layer. Returns the unregister function. */
export function pushEscapeLayer(close: () => void): () => void {
  if (!bound && typeof window !== "undefined") {
    window.addEventListener("keydown", onKey);
    bound = true;
  }
  const layer: Layer = { close };
  stack.push(layer);
  return () => {
    const i = stack.lastIndexOf(layer);
    if (i >= 0) stack.splice(i, 1);
  };
}

/**
 * Dismiss-on-Escape for one layer. The callback is read through a ref so an
 * inline arrow does not re-register (and therefore re-order) the layer on every
 * render — the stack position has to mean "when did this open", nothing else.
 */
export function useEscapeLayer(onClose: () => void, active = true): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!active) return;
    return pushEscapeLayer(() => ref.current());
  }, [active]);
}
