import type { ReactNode } from "react";
import { C, FONT } from "../../theme";

/** Terminal checkbox: [■] on / [ ] off. */
export function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className="gx-focus inline-flex items-center gap-1.5 px-1.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors"
      style={{ fontFamily: FONT.mono, color: on ? C.amber : C.faint }}
    >
      <span aria-hidden="true">{on ? "[■]" : "[ ]"}</span>
      {children}
    </button>
  );
}
