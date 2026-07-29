/**
 * DERIVATION MODE — a board-wide "show me the machinery" switch.
 *
 * Hover reveals are invisible until you happen to point at the right number,
 * which is a poor way to learn that a terminal has a paper behind it. This
 * mode underlines every inspectable figure at once, so the extent of the
 * model is legible before you touch anything.
 *
 * A module-level store rather than a React context: <Derive> is used in a
 * dozen files across four view trees, and threading a provider through all of
 * them to carry one boolean would be worse than the boolean.
 */

let on = false;
const subs = new Set<() => void>();

export function subscribeDerivationMode(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export const derivationModeOn = (): boolean => on;

/** Server/static render: the mode is always off, so markup stays stable. */
export const derivationModeOff = (): boolean => false;

export function setDerivationMode(next: boolean): void {
  if (next === on) return;
  on = next;
  for (const fn of [...subs]) fn();
}

export const toggleDerivationMode = (): void => setDerivationMode(!on);

/** Test hook: drop every subscriber and reset. */
export function resetDerivationMode(): void {
  on = false;
  subs.clear();
}
