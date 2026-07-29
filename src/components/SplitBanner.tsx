import { useState } from "react";
import { C, FONT, microLabel } from "../theme";
import { shortDateY } from "../lib/utils";
import type { SplitPlan } from "../lib/lineage";

/**
 * One prompt, one click. The book has spotted two desks reporting the same run
 * of prints — one subject that was split without its history being split with
 * it — and it cannot resolve that on its own without guessing what the desk
 * used to be called.
 *
 * Deliberately a question, not a notification. Merging deletes duplicated
 * prints, and a book is somebody's school career; the app states what it found,
 * shows the evidence, and lets the student decide. "Keep both" is remembered so
 * it never asks twice.
 */
export function SplitBanner({
  plan,
  onMerge,
  onDismiss,
}: {
  plan: SplitPlan;
  onMerge: (ticker: string, name: string) => void;
  onDismiss: () => void;
}) {
  const [ticker, setTicker] = useState(plan.suggestedTicker);
  const [name, setName] = useState("");
  const tickers = plan.members.map((m) => m.ticker);
  const last = tickers[tickers.length - 1];
  const list = tickers.length > 1 ? `${tickers.slice(0, -1).join(", ")} AND ${last}` : last;

  return (
    <div
      className="border mb-4"
      style={{ background: "rgba(232,163,61,0.07)", borderColor: "rgba(232,163,61,0.35)", fontFamily: FONT.mono }}
    >
      <div className="px-3 py-1.5 border-b" style={{ borderColor: "rgba(232,163,61,0.25)" }}>
        <span style={{ ...microLabel, color: C.amber }}>LISTING ANOMALY · ONE DESK, TWO NAMES?</span>
      </div>

      <div className="px-3 py-2.5 text-[11px] leading-relaxed" style={{ color: C.text }}>
        <p>
          <b>{list}</b> report the same {plan.shared.length} results
          {plan.divergesAt ? <> before {shortDateY(plan.divergesAt).toUpperCase()}</> : null}, then
          go their own way. That is the signature of one subject that SPLIT — not two subjects that
          happened to score alike.
        </p>
        <p className="mt-1.5" style={{ color: C.faint }}>
          Until it is settled, every cross-desk figure counts those {plan.shared.length} results
          once per desk: the aggregate is scored out of {100 * plan.members.length} where the book
          only sat {100 * (plan.members.length - 1)}, and the pooled prior sees one tape as{" "}
          {plan.members.length} identical subjects.
        </p>

        <div className="mt-2.5 flex flex-wrap items-end gap-x-3 gap-y-2">
          <label className="flex flex-col gap-1">
            <span style={{ ...microLabel, color: C.faint }}>WHAT WAS IT CALLED?</span>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 5))}
              aria-label="Ancestor ticker"
              className="gx-focus px-2 py-1 w-24 text-xs font-bold border"
              style={{ background: C.bg, borderColor: C.lineBright, color: C.text, fontFamily: FONT.mono }}
            />
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <span style={{ ...microLabel, color: C.faint }}>FULL NAME (OPTIONAL)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Business &amp; Economics"
              aria-label="Ancestor name"
              className="gx-focus px-2 py-1 text-xs border"
              style={{ background: C.bg, borderColor: C.lineBright, color: C.text, fontFamily: FONT.mono }}
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onMerge(ticker, name)}
              disabled={!ticker.trim()}
              className="gx-focus px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] border disabled:opacity-40"
              style={{ background: C.amber, borderColor: C.amber, color: C.bg }}
            >
              Merge into one desk
            </button>
            <button
              onClick={onDismiss}
              className="gx-focus px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] border"
              style={{ borderColor: C.lineBright, color: C.faint }}
            >
              Keep both
            </button>
          </div>
        </div>

        <p className="mt-2" style={{ ...microLabel, color: C.faint }}>
          MERGING MOVES THOSE {plan.shared.length} RESULTS TO THE OLD DESK AND KEEPS ONE COPY —
          {" "}{list} EACH KEEP EVERYTHING THEY PRINTED SINCE, AND STILL CHART THE YEARS BEHIND THEM.
        </p>
      </div>
    </div>
  );
}
