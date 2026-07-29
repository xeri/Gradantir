import { useEffect, useRef, useState } from "react";

/**
 * A destructive control that has to be clicked twice — and that FORGETS.
 *
 * An arm-and-forget confirm is the worst of both worlds. "Clear book" arms, you
 * go and export a file, adjust a weight, scroll around, come back — and the
 * button still reads as armed, so the next click wipes the book without ever
 * having asked a question you were paying attention to. A confirmation is only
 * a confirmation while the intent is fresh.
 */
export function useArmed(ms = 5000): { armed: boolean; arm: () => void; disarm: () => void } {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const arm = () => {
    setArmed(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), ms);
  };
  const disarm = () => {
    clearTimeout(timer.current);
    setArmed(false);
  };
  return { armed, arm, disarm };
}
