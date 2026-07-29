import { useState } from "react";
import { C, FONT } from "../theme";
import { Panel } from "../components/ui/Panel";
import { SortHeader, type SortState } from "../components/ui/SortHeader";
import { RATING_COLOR, RATING_SHORT } from "../components/ui/RatingBadge";
import { REGIME_COLOR } from "../components/ui/RegimeTag";
import { DELISTED_STYLE, DelistedTag } from "../components/ui/DelistedTag";
import { Derive } from "../components/ui/Derive";
import type { DeriveCtx } from "../lib/derive";
import type { SubjectStat } from "../types";

type Num = number | null;
const fmt = (v: Num, dp = 1) => (v == null ? "—" : v.toFixed(dp));
const signed = (v: Num) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`);
const deltaColor = (v: Num) => (v == null ? C.faint : v > 0.05 ? C.up : v < -0.05 ? C.down : C.dim);

interface Col {
  key: string;
  label: string;
  get: (s: SubjectStat) => Num;
  render: (s: SubjectStat) => { text: string; color: string };
  /**
   * The derivation behind this column, where there is one. Columns that are
   * plain arithmetic (LAST, AVG, ATH, TGT, N) deliberately carry none — a
   * dotted underline has to mean "there is real machinery here".
   */
  derive?: string;
}

const COLS: Col[] = [
  { key: "px", label: "MARK", derive: "mark.price", get: (s) => s.quant?.price ?? null, render: (s) => ({ text: fmt(s.quant?.price ?? null), color: C.text }) },
  // No derive: ΔMARK is the arithmetic difference of two marks, and pointing it
  // at mark.price made the popover headline the MARK while the cell showed the
  // DELTA — the one thing the result invariant (derive/types.ts) forbids.
  { key: "dpx", label: "ΔMARK", get: (s) => s.priceDelta, render: (s) => ({ text: signed(s.priceDelta), color: deltaColor(s.priceDelta) }) },
  { key: "fv", label: "FV", derive: "fv.value", get: (s) => s.quant?.fv ?? null, render: (s) => ({ text: fmt(s.quant?.fv ?? null), color: C.dim }) },
  {
    key: "disc", label: "RISK", derive: "mark.discount",
    get: (s) => s.quant?.discount ?? null,
    render: (s) => ({
      text: s.quant == null ? "—" : s.quant.discount > 0.05 ? `−${s.quant.discount.toFixed(1)}` : "PAR",
      color: s.quant == null ? C.faint : REGIME_COLOR[s.quant.regime],
    }),
  },
  {
    key: "regime", label: "REGIME", derive: "mark.regime",
    // Sorts on the discount — the number the regime is read off.
    get: (s) => s.quant?.discount ?? null,
    render: (s) => ({ text: s.quant?.regime ?? "—", color: s.quant ? REGIME_COLOR[s.quant.regime] : C.faint }),
  },
  {
    key: "rating", label: "RATING", derive: "rating.score",
    // Sorted on the consensus z*, not the label — STRONG BUY 1.4 outranks 1.1.
    get: (s) => (s.rating.rating === "N/A" ? null : s.rating.score),
    render: (s) => ({ text: RATING_SHORT[s.rating.rating], color: RATING_COLOR[s.rating.rating] }),
  },
  {
    key: "pt", label: "PT", derive: "rating.target",
    get: (s) => s.rating.target,
    render: (s) => ({
      text: s.rating.target == null ? "—" : `${s.rating.target.toFixed(1)}${s.rating.upside != null ? ` ${s.rating.upside > 0 ? "+" : ""}${s.rating.upside.toFixed(1)}%` : ""}`,
      color: s.rating.upside == null ? C.faint : s.rating.upside > 0.05 ? C.up : s.rating.upside < -0.05 ? C.down : C.dim,
    }),
  },
  { key: "last", label: "LAST", get: (s) => s.latest?.score ?? null, render: (s) => ({ text: fmt(s.latest?.score ?? null), color: C.dim }) },
  { key: "avg", label: "AVG", get: (s) => s.curAvg, render: (s) => ({ text: fmt(s.curAvg), color: C.text }) },
  { key: "prev", label: "PREV", get: (s) => s.prevAvg, render: (s) => ({ text: fmt(s.prevAvg), color: C.dim }) },
  { key: "dterm", label: "Δ TERM", get: (s) => s.periodDelta, render: (s) => ({ text: signed(s.periodDelta), color: deltaColor(s.periodDelta) }) },
  { key: "sd", label: "σ", get: (s) => s.sd, render: (s) => ({ text: `±${s.sd.toFixed(1)}`, color: s.sd >= 7 ? C.amber : C.dim }) },
  { key: "est", label: "NXT EXAM", derive: "oracle.next", get: (s) => s.quant?.nextExam.mean ?? null, render: (s) => ({ text: s.quant ? `${s.quant.nextExam.mean.toFixed(1)}±${s.quant.nextExam.sd.toFixed(1)}` : "—", color: s.quant ? C.accent : C.faint }) },
  { key: "pctl", label: "FIELD %ILE", derive: "depth.field", get: (s) => s.percentile, render: (s) => ({ text: s.percentile == null ? "—" : s.percentile.toFixed(0), color: s.percentile == null ? C.faint : s.percentile >= 50 ? C.up : C.down }) },
  // No derive: depth.classz headlines the standard SCORE z_cls (σ), not the
  // class percentile this column prints, so its popover figure disagreed with
  // the cell. The percentile is the raw reported placement anyway.
  { key: "cpctl", label: "CLASS %ILE", get: (s) => s.classPercentile, render: (s) => ({ text: s.classPercentile == null ? "—" : s.classPercentile.toFixed(0), color: s.classPercentile == null ? C.faint : C.dim }) },
  { key: "tgt", label: "TGT", get: (s) => s.sub.target, render: (s) => ({ text: fmt(s.sub.target, 0), color: C.dim }) },
  {
    key: "gap", label: "GAP",
    get: (s) => (s.sub.target != null && s.curAvg != null ? s.curAvg - s.sub.target : null),
    render: (s) => {
      const g = s.sub.target != null && s.curAvg != null ? s.curAvg - s.sub.target : null;
      return { text: signed(g), color: deltaColor(g) };
    },
  },
  { key: "ath", label: "ATH", get: (s) => s.ath, render: (s) => ({ text: fmt(s.ath), color: C.dim }) },
  { key: "dath", label: "ΔATH", get: (s) => s.fromAth, render: (s) => ({ text: signed(s.fromAth), color: s.fromAth != null && s.fromAth >= -0.05 ? C.up : C.dim }) },
  // No derive: this column is the average edge OVER the cohort (a level), while
  // factor.alpha headlines Δα, the collapse in that edge (a change). Two different
  // numbers — the popover claimed the change while the cell showed the level.
  { key: "alpha", label: "α", get: (s) => s.alpha, render: (s) => ({ text: s.alpha == null ? "—" : signed(s.alpha), color: deltaColor(s.alpha) }) },
  { key: "n", label: "N", get: (s) => s.entries.length, render: (s) => ({ text: String(s.entries.length), color: C.faint }) },
];

/** The market-watch table: every subject, every figure, sortable. */
export function Screener({
  stats,
  onOpenSubject,
  deriveCtx,
}: {
  stats: SubjectStat[];
  onOpenSubject: (id: string) => void;
  deriveCtx?: DeriveCtx;
}) {
  const [sort, setSort] = useState<SortState>({ key: "ticker", dir: "asc" });

  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "ticker" ? "asc" : "desc" }));

  const rows = [...stats].sort((a, b) => {
    if (sort.key === "ticker") {
      const c = a.sub.ticker.localeCompare(b.sub.ticker);
      return sort.dir === "asc" ? c : -c;
    }
    const col = COLS.find((c) => c.key === sort.key);
    if (!col) return 0;
    const av = col.get(a);
    const bv = col.get(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls always sink
    if (bv == null) return -1;
    return sort.dir === "desc" ? bv - av : av - bv;
  });

  return (
    <Panel title={`SCREENER · ${stats[0]?.curLabel ?? ""}`} pad={false}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1500px] border-collapse">
          <thead>
            <tr>
              <SortHeader label="TICKER" sortKey="ticker" sort={sort} onSort={onSort} align="left" />
              {COLS.map((c) => (
                <SortHeader key={c.key} label={c.label} sortKey={c.key} sort={sort} onSort={onSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const closed = s.sub.archived === true;
              return (
              <tr
                key={s.sub.id}
                onClick={() => onOpenSubject(s.sub.id)}
                className="cursor-pointer border-b last:border-0 hover:bg-white/[0.025]"
                style={{ borderColor: C.line, ...(closed ? DELISTED_STYLE : null) }}
                tabIndex={0}
                /* Space activates too — a control that answers Enter but not
                   Space is neither a button nor a link to anyone using one. */
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenSubject(s.sub.id); }
                }}
                /* NO aria-label here. On a row it REPLACES the entire subtree,
                   so the screener's 21 columns of mark, rating, percentile and
                   alpha collapsed to "Open Mathematics" and nothing else. The
                   row's own cells are the accessible name. */
                title={`Open ${s.sub.name}${closed ? " (delisted)" : ""}`}
              >
                <td className="px-2.5 py-2 whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 shrink-0" style={{ background: closed ? C.faint : s.sub.color }} />
                    <span
                      className="text-xs font-bold tracking-[0.08em]"
                      style={{ fontFamily: FONT.mono, color: closed ? C.dim : s.sub.color, textDecoration: closed ? "line-through" : undefined }}
                    >
                      {s.sub.ticker}
                    </span>
                    <span className="text-[10px] uppercase truncate max-w-28 hidden md:inline" style={{ color: C.faint }}>{s.sub.name}</span>
                    {closed && <DelistedTag closedAt={s.latest?.date} />}
                  </span>
                </td>
                {COLS.map((c) => {
                  const { text, color } = c.render(s);
                  return (
                    <td key={c.key} className="px-2.5 py-2 text-right text-xs whitespace-nowrap" style={{ fontFamily: FONT.mono, color }}>
                      {/* Passive inside a focusable <tr>: hover reads the maths,
                          a click still opens the drawer. */}
                      {c.derive && deriveCtx ? (
                        <Derive id={c.derive} ctx={{ ...deriveCtx, stat: s }} passive>{text}</Derive>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 border-t text-[10px] tracking-wider" style={{ borderColor: C.line, color: C.faint, fontFamily: FONT.mono }}>
        MARK = FAIR VALUE LESS EVERY LIVE RISK CHARGE — WHAT THE DESK TRADES AT · FV = QUANT CAPABILITY ESTIMATE OVER ALL PRINTS · RISK = TOTAL DISCOUNT, REGIME READS OFF IT · RATING = ANALYST CONSENSUS VS THE BOOK (SORTS ON z*) · PT = CONSENSUS PRICE TARGET AT THE HORIZON · NXT EXAM = ORACLE ± SD · %ILE = MEAN COHORT PERCENTILE · α = AVERAGE EDGE OVER CLASS · CLICK A ROW FOR THE PREMIA WATERFALL · HOVER A MODELLED CELL FOR ITS DERIVATION (⇧D LIGHTS THEM ALL)
      </p>
    </Panel>
  );
}
