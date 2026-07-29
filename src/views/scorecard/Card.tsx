import { Loader, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { C, FONT, microLabel } from "../../theme";
import { Derive } from "../../components/ui/Derive";
import type { DeriveCtx } from "../../lib/derive";

/** Which research note a figure on this board opens, and the facts behind it. */
export interface DeriveRef {
  id: string;
  ctx: DeriveCtx;
  /** Set inside an interactive ancestor: hover only, clicks fall through. */
  passive?: boolean;
}

/**
 * Wrap a figure in its derivation, or render it bare when the board has not
 * been handed a context (the drawer-less test harness, a card mid-backtest).
 */
export function Derived({ on, children }: { on?: DeriveRef | null; children: ReactNode }) {
  return on ? <Derive id={on.id} ctx={on.ctx} passive={on.passive}>{children}</Derive> : <>{children}</>;
}

/** The scorecard's chrome: one iconized, accent-ruled section per subject. */
export function Card({
  icon: Icon, title, accent = C.amber, help, right, children,
}: {
  icon: LucideIcon;
  title: string;
  accent?: string;
  help?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border" style={{ background: C.panel, borderColor: C.line, borderLeft: `2px solid ${accent}` }}>
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b" style={{ borderColor: C.line }}>
        <h2 className="flex items-center gap-2" style={{ ...microLabel, color: accent }}>
          <Icon size={12} /> {title}
        </h2>
        {right}
      </header>
      <div className="p-3">{children}</div>
      {help && (
        <p className="px-3 pb-2 -mt-1 text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
          {help}
        </p>
      )}
    </section>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-4 justify-center" style={{ color: C.faint }}>
      <Loader size={13} className="gx-spin" />
      <span className="text-[11px] uppercase tracking-wider" style={{ fontFamily: FONT.mono }}>{label}</span>
    </div>
  );
}

export function Stat({
  label, value, sub, tone, derive,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  /** The research note behind this figure, when there is real machinery here. */
  derive?: DeriveRef | null;
}) {
  return (
    <div className="border px-3 py-2" style={{ borderColor: C.line, background: C.panel2 }}>
      <div style={{ ...microLabel, color: C.faint }}>{label}</div>
      <Derived on={derive}>
        <span className="block text-lg font-black tabular-nums leading-tight" style={{ color: tone ?? C.text, fontFamily: FONT.mono }}>{value}</span>
      </Derived>
      {sub && <div className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>{sub}</div>}
    </div>
  );
}

/**
 * One logged input, with the ✕ that drops it.
 *
 * Every elicited row on the scorecard is removable where it was made. A pile you
 * can only wipe wholesale is not correctable, and the alternative — leaving a
 * mis-click in because the only remedy is to lose the lot — quietly poisons
 * whatever the pile is priced into.
 */
export function LoggedRow({
  primary, secondary, tone = C.text, onRemove, removeLabel, children,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  tone?: string;
  onRemove?: () => void;
  removeLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border px-2 py-1" style={{ borderColor: C.line, background: C.panel2 }}>
      <span className="text-[11px] font-bold tabular-nums shrink-0" style={{ color: tone, fontFamily: FONT.mono }}>{primary}</span>
      <span className="flex-1 min-w-0 truncate text-[10px] uppercase tracking-wider" style={{ color: C.dim, fontFamily: FONT.mono }}>
        {secondary}
      </span>
      {children}
      {onRemove && (
        <button
          onClick={onRemove}
          className="gx-focus shrink-0 px-1 hover:brightness-150"
          style={{ color: C.faint }}
          aria-label={removeLabel}
          title={removeLabel}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
