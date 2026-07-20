import { useEffect, useMemo, useRef, useState } from "react";
import { C, FONT, microLabel } from "../theme";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Loose subsequence match — "lg rs" hits "LOG RESULT". */
function matches(query: string, label: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const l = label.toLowerCase();
  let i = 0;
  for (const ch of q) {
    i = l.indexOf(ch, i);
    if (i === -1) return false;
    i++;
  }
  return true;
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => commands.filter((c) => matches(query, c.label)), [commands, query]);
  const clamped = Math.min(sel, Math.max(0, filtered.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runIdx = (i: number) => {
    const cmd = filtered[i];
    if (cmd) {
      onClose();
      cmd.run();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); runIdx(clamped); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] p-4" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0" style={{ background: "rgba(5,7,10,0.75)" }} onClick={onClose} />
      <div className="gx-fade relative w-full max-w-md border" style={{ background: C.panel, borderColor: C.lineBright, boxShadow: "0 24px 64px rgba(0,0,0,0.65)" }}>
        <div className="flex items-center gap-2 px-3 border-b" style={{ borderColor: C.line }}>
          <span aria-hidden="true" className="text-xs font-bold" style={{ color: C.amber, fontFamily: FONT.mono }}>&gt;</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSel(0); }}
            onKeyDown={onKey}
            placeholder="TYPE A COMMAND…"
            className="w-full bg-transparent py-2.5 text-sm outline-none uppercase"
            style={{ color: C.text, fontFamily: FONT.mono }}
            aria-label="Command"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto" role="listbox">
          {filtered.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === clamped}>
              <button
                onMouseEnter={() => setSel(i)}
                onClick={() => runIdx(i)}
                className="w-full flex items-center justify-between px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.1em]"
                style={{
                  fontFamily: FONT.mono,
                  background: i === clamped ? C.panel2 : "transparent",
                  color: i === clamped ? C.amber : C.dim,
                }}
              >
                {c.label}
                {c.hint && <span className="text-[9px]" style={{ color: C.faint }}>{c.hint}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-4 text-center" style={{ ...microLabel, color: C.faint }}>No matching command</li>
          )}
        </ul>
      </div>
    </div>
  );
}
