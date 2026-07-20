import type { ButtonHTMLAttributes } from "react";
import { C, FONT } from "../../theme";

type Variant = "primary" | "ghost" | "danger";

const styles: Record<Variant, { background: string; color: string; borderColor: string }> = {
  primary: { background: C.amber, color: C.strip, borderColor: C.amber },
  ghost: { background: "transparent", color: C.dim, borderColor: C.lineBright },
  danger: { background: "transparent", color: C.down, borderColor: "#5A2620" },
};

/** Terminal key: square, mono, uppercase. */
export function Btn({
  variant = "ghost",
  className = "",
  style,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`gx-focus inline-flex items-center gap-1.5 border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] transition-[filter,color,border-color] hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none ${className}`}
      style={{ fontFamily: FONT.mono, ...styles[variant], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
