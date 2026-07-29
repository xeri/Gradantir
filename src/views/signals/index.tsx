import { useMemo } from "react";
import { C, FONT, microLabel } from "../../theme";
import { Panel } from "../../components/ui/Panel";
import { PricedBanner } from "../../components/ui/PricedBanner";
import { signalRead, type NextSitting, type SignalBook, type SignalRead, type SignalTermKey } from "../../lib/quant/signals/signalread";
import type { SignalSkill } from "../../lib/quant/signals/signalskill";
import type { GradeEntry, SubjectStat, Upcoming } from "../../types";

/**
 * D5 · THE SIGNALS BOARD — the life-signals channel (§D5), on its own floor.
 *
 * A read-only analytics view, the same register as the Scorecard: nothing
 * here is logged or edited (the quick-log panels, the traits/profile editors
 * and the VOI panel are separate boards), it only PRICES what the rest of
 * the terminal has already filed and shows the arithmetic honestly.
 *
 * `PricedBanner` carries the `signalWeighting` switch and the channel's own
 * earned weight — the same "say the cost before the instrument is touched"
 * discipline the Scorecard's three elicitation cards hold. Below it, one row
 * per live desk with one column per term: NOT the term's raw point read, but
 * its MARGINAL contribution — adj(full) minus adj(with that term dropped),
 * via the `{drop}` ablation seam `signalRead` exposes for exactly this. On a
 * book whose sum of terms never hits `SIGNAL_ADJ_CAP`, the two are numerically
 * identical (dropping one term of an unclamped sum just subtracts it); they
 * diverge only once the clamp is live, which is when "the raw read" would
 * have quietly stopped adding up to `ADJ` in the first place.
 *
 * The identity this shell defends is signalread.ts's own: the committed
 * fixture carries no signal data, so every desk's read collapses to adj 0,
 * terms [] — every marginal is 0, `ADJ` is 0.00, and `W·ADJ` (the earned
 * weight times that zero) is 0.00 too, whatever the prior weight itself
 * happens to be. Nothing here recomputes App's own board: `signalReads` is
 * the exact memo App.tsx already fitted (Task 12); only the per-term DROPPED
 * variants are computed fresh, right here, because they are the one thing
 * the board never had a reason to carry.
 */

const TERM_COLS: { key: SignalTermKey; label: string }[] = [
  { key: "stock", label: "STOCK" },
  { key: "mastery", label: "MASTERY" },
  { key: "rest", label: "REST" },
  { key: "disruption", label: "DISRUPT" },
  { key: "anxiety", label: "ANXIETY" },
  { key: "chronotype", label: "CHRONO" },
  { key: "attendance", label: "ATTEND" },
];

const ZERO_EPS = 0.005;
const fmtPts = (v: number) => (Math.abs(v) < ZERO_EPS ? "0.00" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`);
const toneOf = (v: number) => (Math.abs(v) < ZERO_EPS ? C.faint : v < 0 ? C.down : C.up);

/**
 * The soonest live exam sitting for a desk — mirrors `signalBoard`'s own
 * candidate resolution in signalread.ts exactly (filter to this subject's
 * future exams, soonest date then id wins). Duplicated rather than imported
 * because `signalBoard` does not expose it: the per-term ablation below has
 * to call `signalRead` directly (for the `{drop}` seam signalBoard has no
 * argument for), and needs the identical `next` a `signalBoard` call would
 * have resolved for the SAME baseline read this view reuses from App.tsx.
 */
function soonestNext(subjectId: string, upcoming: Upcoming[], asOf: string): NextSitting | null {
  const candidates = upcoming
    .filter((u) => u.subjectId === subjectId && u.type === "Exam" && u.date >= asOf)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const soonest = candidates[0] ?? null;
  return soonest == null ? null : { date: soonest.date, hour: soonest.hour ?? null, weight: soonest.weight ?? null };
}

const IDENTITY_READ = (subjectId: string): SignalRead => ({ subjectId, adj: 0, sdMult: 1, terms: [], reasons: [] });

export interface SignalsProps {
  /** The visible board — ticker, colour and archived status per desk. */
  stats: SubjectStat[];
  entries: GradeEntry[];
  upcoming: Upcoming[];
  signalBook: SignalBook;
  /** App's own board (Task 12) — the baseline read. Reused, never recomputed. */
  signalReads: Map<string, SignalRead>;
  /** The exact desk means `signalReads` was fitted against — needed to call
   *  `signalRead` again, honestly, for each per-term dropped variant. */
  modelMeans: Map<string, number | null>;
  signalFit: SignalSkill;
  signalOn: boolean;
  todayIso: string;
  onSetSignalWeighting: (on: boolean) => void;
  onOpenSubject?: (id: string) => void;
}

export function Signals({
  stats, entries, upcoming, signalBook, signalReads, modelMeans, signalFit, signalOn, todayIso,
  onSetSignalWeighting, onOpenSubject,
}: SignalsProps) {
  const rows = useMemo(() => {
    const live = stats.filter((s) => !s.sub.archived);
    return live.map((s) => {
      const sub = s.sub;
      const full = signalReads.get(sub.id) ?? IDENTITY_READ(sub.id);
      const subEntries = entries.filter((e) => e.subjectId === sub.id);
      const next = soonestNext(sub.id, upcoming, todayIso);
      const modelMean = modelMeans.get(sub.id) ?? null;
      const marginals = new Map<SignalTermKey, number>(
        TERM_COLS.map(({ key }) => {
          const dropped = signalRead(sub, signalBook, subEntries, next, modelMean, todayIso, { drop: new Set([key]) });
          return [key, full.adj - dropped.adj];
        }),
      );
      return { sub, adj: full.adj, wAdj: signalFit.w * full.adj, marginals };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, signalReads, entries, upcoming, modelMeans, signalBook, todayIso, signalFit.w]);

  return (
    <div className="space-y-4">
      <Panel title="SIGNALS — LIFE STATE PRICED INTO THE FORECAST">
        <PricedBanner
          on={signalOn}
          onToggle={onSetSignalWeighting}
          label="Signals priced into predictions"
          earned={{
            label: "SIGNALS CARRY",
            value: `${Math.round(signalFit.w * 100)}%`,
            tone: signalFit.w > 0 ? C.accent : C.faint,
          }}
          charge={
            <>
              STUDY STOCK, MASTERY, REST, DISRUPTION, ANXIETY, CHRONOTYPE AND ATTENDANCE FOLD INTO ONE SMALL SHIFT ON THE
              HOUSE'S NEXT-EXAM MEAN, WEIGHTED BY WHAT THE CHANNEL HAS EARNED — CAPPED, AND ALWAYS SHRUNK TOWARD THE DESK'S
              OWN CALL.{" "}
              {signalFit.rounds === 0
                ? "NOTHING SCORED YET — THE CHANNEL CARRIES THE UNPROVEN PRIOR UNTIL A ROUND RESOLVES WITH LIVE SIGNAL DATA ON FILE."
                : `OVER ${signalFit.rounds} SCORED ROUND${signalFit.rounds === 1 ? "" : "S"} IT CARRIES ${Math.round(signalFit.w * 100)}% OF THE SHIFT.`}
            </>
          }
          off={<>SIGNALS ARE OUT OF THE PRICING — THE TERMS BELOW ARE STILL READ, BUT NOTHING ON THE BOARD MOVES WITH THEM.</>}
        />
      </Panel>

      <Panel title="PER-DESK TERMS" pad={false}>
        {rows.length === 0 ? (
          <p className="p-3 text-[11px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
            NO LIVE DESK TO READ.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr>
                  <th className="px-2.5 py-2 text-left" style={{ ...microLabel, color: C.faint }}>TICKER</th>
                  {TERM_COLS.map((c) => (
                    <th key={c.key} className="px-2.5 py-2 text-right" style={{ ...microLabel, color: C.faint }}>{c.label}</th>
                  ))}
                  <th className="px-2.5 py-2 text-right" style={{ ...microLabel, color: C.faint }}>ADJ</th>
                  <th className="px-2.5 py-2 text-right" style={{ ...microLabel, color: C.faint }}>W·ADJ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.sub.id}
                    onClick={onOpenSubject ? () => onOpenSubject(r.sub.id) : undefined}
                    className={onOpenSubject ? "cursor-pointer border-b last:border-0 hover:bg-white/[0.025]" : "border-b last:border-0"}
                    style={{ borderColor: C.line }}
                    tabIndex={onOpenSubject ? 0 : undefined}
                    onKeyDown={onOpenSubject ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenSubject(r.sub.id); } } : undefined}
                    title={onOpenSubject ? `Open ${r.sub.name}` : undefined}
                  >
                    <td className="px-2.5 py-2 whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 shrink-0" style={{ background: r.sub.color }} />
                        <span className="text-xs font-bold tracking-[0.08em]" style={{ fontFamily: FONT.mono, color: r.sub.color }}>{r.sub.ticker}</span>
                      </span>
                    </td>
                    {TERM_COLS.map((c) => {
                      const v = r.marginals.get(c.key) ?? 0;
                      return (
                        <td key={c.key} className="px-2.5 py-2 text-right text-xs tabular-nums" style={{ fontFamily: FONT.mono, color: toneOf(v) }}>
                          {Math.abs(v) < ZERO_EPS ? "—" : fmtPts(v)}
                        </td>
                      );
                    })}
                    <td className="px-2.5 py-2 text-right text-xs font-bold tabular-nums" style={{ fontFamily: FONT.mono, color: toneOf(r.adj) }}>
                      {fmtPts(r.adj)}
                    </td>
                    <td className="px-2.5 py-2 text-right text-xs font-bold tabular-nums" style={{ fontFamily: FONT.mono, color: toneOf(r.wAdj) }}>
                      {fmtPts(r.wAdj)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-3 py-2 border-t text-[10px] tracking-wider leading-relaxed" style={{ borderColor: C.line, color: C.faint, fontFamily: FONT.mono }}>
          EACH TERM COLUMN IS ITS MARGINAL CONTRIBUTION IN POINTS — ADJ(FULL) MINUS ADJ(WITH THAT TERM DROPPED), NOT ITS
          RAW READ, SO A CLAMPED DESK STILL ADDS UP HONESTLY. ADJ = THE DESK'S OWN CLAMPED SHIFT. W·ADJ = WHAT ACTUALLY
          MOVES THE NEXT-EXAM MEAN ONCE THE EARNED WEIGHT ABOVE IS APPLIED.
        </p>
      </Panel>
    </div>
  );
}
