import type { ReactNode } from "react";
import { C, FONT, microLabel } from "../../theme";

export const inputCls =
  "gx-focus w-full border px-2.5 py-1.5 text-sm rounded-none appearance-none";

export const inputStyle = {
  background: C.panel2,
  borderColor: C.line,
  color: C.text,
  fontFamily: FONT.mono,
} as const;

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block mb-1.5" style={{ ...microLabel, color: C.faint }}>{label}</span>
      {children}
    </label>
  );
}

export function Sel({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={`gx-focus border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider cursor-pointer rounded-none ${className}`}
      style={{ background: C.panel2, borderColor: C.lineBright, color: C.text, fontFamily: FONT.mono }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
