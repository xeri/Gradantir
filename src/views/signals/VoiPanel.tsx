import { C, FONT, microLabel } from "../../theme";
import { Derive } from "../../components/ui/Derive";
import type { DeriveCtx } from "../../lib/derive";
import type { VoiItem } from "../../lib/quant/signals/voi";

/**
 * D5 · VOI PANEL — a READ-ONLY window onto `valueOfInformation`'s own ranked
 * output (voi.ts, T11): "what to log next" to buy forecast precision,
 * weighed against the logging effort it costs. The same "the leaf renders,
 * the view computes" split every other SIGNALS leaf holds (`MasteryPanel`,
 * the per-term Shapley table) — this component never calls
 * `valueOfInformation` itself, only renders the `VoiItem[]` App.tsx's own
 * `voi` memo already computed and ranked.
 *
 * Every `VoiItem.action` string is already terminal copy with its own
 * computed gain baked in (voi.ts's `plusMinus1`) — printed byte-for-byte,
 * never re-worded or re-derived here. The one number this panel adds on top
 * is `effortMin`, a plain minute count the item already carries raw (not
 * copy), so there is nothing to re-round or misstate. Order is the ranker's
 * own score-desc order, never re-sorted client-side.
 *
 * T19 — each row carries a `<Derive id="signal.voi">` trigger, keyed by its
 * own array index (`ctx.key`) rather than a subject id: several rows here are
 * book-wide (rest, profile) and carry no subject at all.
 */

export interface VoiPanelProps {
  items: VoiItem[];
  /** Absent (no App-level derivation context yet) just means the rows render bare. */
  deriveCtx?: DeriveCtx;
}

const rowStyle = { borderColor: C.line } as const;
const rankStyle = { color: C.faint, fontFamily: FONT.mono } as const;
const actionStyle = { color: C.text, fontFamily: FONT.mono } as const;
const effortStyle = { color: C.faint, fontFamily: FONT.mono } as const;

export function VoiPanel({ items, deriveCtx }: VoiPanelProps) {
  if (items.length === 0) {
    return (
      <p className="text-[11px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
        NOTHING LEFT TO LOG — EVERY CHANNEL THIS RANKER SCANS IS ALREADY INSTRUMENTED.
      </p>
    );
  }
  return (
    <div>
      {items.map((it, i) => (
        <div
          key={`${it.domain}-${it.subjectId ?? "book"}-${i}`}
          className="flex items-center gap-3 border-b last:border-0 py-2"
          style={rowStyle}
        >
          <span className="w-5 shrink-0 text-right text-[10px] tabular-nums" style={rankStyle}>{i + 1}</span>
          <span className="flex-1 text-[11px] font-bold uppercase tracking-wide leading-snug" style={actionStyle}>
            {deriveCtx ? (
              <Derive id="signal.voi" ctx={{ ...deriveCtx, key: String(i) }}>{it.action}</Derive>
            ) : (
              it.action
            )}
          </span>
          <span className="w-20 shrink-0 text-right text-[10px] uppercase tabular-nums tracking-wider" style={effortStyle}>
            {it.effortMin} MIN
          </span>
        </div>
      ))}
      <p className="pt-2 text-[10px] uppercase tracking-wider leading-relaxed" style={{ ...microLabel, color: C.faint, letterSpacing: "0.06em", fontWeight: 400 }}>
        RANKED BY FORECAST GAIN WEIGHED AGAINST LOGGING EFFORT, WITH DIMINISHING RETURNS AS EFFORT GROWS — HIGHEST
        VALUE FIRST, NOT A LITERAL PER-MINUTE RATE.
      </p>
    </div>
  );
}
