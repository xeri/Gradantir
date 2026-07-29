import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { Btn } from "../ui/Btn";
import { useArmed } from "../ui/useArmed";
import { bookLedger, type LedgerSection, type SectionKey } from "../../lib/ledger";
import type { AppData } from "../../types";

/**
 * Everything the book is storing about you, section by section, with a ✕ on
 * every row it is safe to drop from here.
 *
 * The list is deliberately complete rather than curated. A student should be
 * able to answer "what does this thing know about me, and how do I remove any
 * one piece of it" without reading an export, and the answer should not change
 * shape depending on what they happen to have filled in — which is why empty
 * sections are still drawn, with their count at zero.
 *
 * Nothing the engine computed appears here, because nothing it computes is
 * stored. Prices, forecasts, the bias register and every score are recalculated
 * from these rows on load.
 */
function Section({
  section, onRemove, onClear,
}: {
  section: LedgerSection;
  onRemove: (key: SectionKey, id: string) => void;
  onClear: (key: SectionKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const wipe = useArmed();
  const rows = [...section.rows].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="border" style={{ borderColor: C.line, background: C.panel2 }}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={!rows.length}
          className="gx-focus flex flex-1 items-center gap-1.5 text-left disabled:opacity-60"
          aria-expanded={open}
          title={rows.length ? `Show the ${section.label.toLowerCase()} rows` : "Nothing stored in this section"}
        >
          <Chevron size={12} style={{ color: C.faint }} />
          <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: C.text, fontFamily: FONT.mono }}>
            {section.label}
          </span>
          <span className="text-[11px] tabular-nums" style={{ color: rows.length ? C.amber : C.faint, fontFamily: FONT.mono }}>
            {rows.length}
          </span>
          {!section.removable && (
            <span className="text-[9px] uppercase tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
              REPORTED ONLY
            </span>
          )}
        </button>
        {section.removable && rows.length > 0 && (
          <Btn
            variant="danger"
            onClick={() => {
              if (!wipe.armed) { wipe.arm(); return; }
              wipe.disarm();
              onClear(section.key);
            }}
          >
            {wipe.armed ? `Click again — drops all ${rows.length}` : "Clear section"}
          </Btn>
        )}
      </div>

      {open && (
        <div className="border-t px-2 py-1.5 space-y-1" style={{ borderColor: C.line }}>
          <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
            {section.note}
          </p>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2 border px-1.5 py-1" style={{ borderColor: C.line, background: C.panel }}>
                <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: C.text, fontFamily: FONT.mono }}>{r.primary}</span>
                <span className="flex-1 min-w-0 truncate text-[10px] uppercase tracking-wider" style={{ color: C.dim, fontFamily: FONT.mono }}>
                  {r.secondary}
                </span>
                {section.removable && (
                  <button
                    onClick={() => onRemove(section.key, r.id)}
                    className="gx-focus shrink-0 px-1 hover:brightness-150"
                    style={{ color: C.faint }}
                    aria-label={`Remove ${r.primary} from ${section.label}`}
                    title={`Remove ${r.primary} — ${r.secondary}`}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DataLedger({
  data, tickerOf, onRemove, onClear,
}: {
  data: AppData;
  tickerOf: (id: string) => string;
  onRemove: (key: SectionKey, id: string) => void;
  onClear: (key: SectionKey) => void;
}) {
  const sections = bookLedger(data, tickerOf);
  return (
    <div className="space-y-1.5">
      <div style={{ ...microLabel, color: C.faint }}>
        EVERYTHING STORED — AND EVERY ROW YOU CAN DROP
      </div>
      {sections.map((s) => (
        <Section key={s.key} section={s} onRemove={onRemove} onClear={onClear} />
      ))}
      <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
        THE BOOK STORES YOUR INPUTS AND NOTHING ELSE. EVERY PRICE, FORECAST AND SCORE ON THE BOARD IS RECALCULATED
        FROM THESE ROWS EACH TIME IT LOADS, SO AN EXPORT CARRIES WHAT YOU TOLD IT — NEVER WHAT THE MODEL SAID BACK.
      </p>
    </div>
  );
}
