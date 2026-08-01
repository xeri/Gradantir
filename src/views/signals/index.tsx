import { useMemo } from "react";
import { C, FONT, microLabel } from "../../theme";
import { Derive } from "../../components/ui/Derive";
import { Panel } from "../../components/ui/Panel";
import { PricedBanner } from "../../components/ui/PricedBanner";
import { ChannelPanel } from "./ChannelPanel";
import { LogPanels } from "./LogPanels";
import { MasteryPanel, type SubjectMasteryRead } from "./MasteryPanel";
import { TraitsEditor, type SubjectTraitsPatch } from "./TraitsEditor";
import { VoiPanel } from "./VoiPanel";
import { type SignalBook, type SignalRead, type SignalTermKey } from "../../lib/quant/signals/signalread";
import { shapleyOf } from "../../lib/quant/signals/shapley";
import { SIGNAL_ADJ_CAP } from "../../lib/quant/signals/params";
import { topicMastery, masteryRead, type MasteryRead } from "../../lib/quant/signals/mastery";
import { studyStock, type StockRead } from "../../lib/quant/signals/stock";
import type { SignalSkill } from "../../lib/quant/signals/signalskill";
import type { SignalChannelFit } from "../../lib/quant/signals/channels";
import type { VoiItem } from "../../lib/quant/signals/voi";
import type { DeriveCtx } from "../../lib/derive";
import type { DisruptionKind, GradeEntry, Profile, SessionKind, SubjectStat } from "../../types";

/**
 * D5 · THE SIGNALS BOARD — the life-signals channel (§D5), on its own floor.
 *
 * Mostly a read-only analytics view, the same register as the Scorecard:
 * nothing above the fold is logged or edited, it only PRICES what the rest
 * of the terminal has already filed and shows the arithmetic honestly. The
 * one exception is `LogPanels` at the bottom (T16) — quick-log intake for
 * the three highest-frequency inputs (study session, rest night, disruption),
 * mounted here because this is the one floor that shows what they price
 * into. The traits/profile editors and the VOI panel remain separate boards.
 *
 * `PricedBanner` carries the `signalWeighting` switch and the channel's own
 * earned weight — the same "say the cost before the instrument is touched"
 * discipline the Scorecard's three elicitation cards hold. Below it, one row
 * per live desk with one column per term: NOT the term's raw point read, but
 * its SHAPLEY VALUE in the clamped game `shapley.ts` decomposes (audit Part I
 * §3) — the share of `ADJ` attributable to that channel, averaged over every
 * order the channels could have arrived in. The columns sum to `ADJ` exactly,
 * clamp binding or not.
 *
 * That replaced a drop-one marginal, adj(full) − adj(with that term dropped),
 * which could not: with two terms at +3 against a ±4 cap each marginal read
 * +1 and the row summed to +2 beside an `ADJ` of +4 — and this footer plus a
 * whole README §30 section existed to excuse it. Unclamped the two readings
 * coincide exactly, which is why the old column was defensible on most books
 * and wrong on precisely the ones where the layer had the most to say.
 *
 * ONE read per desk, not eight: `SignalRead.rawTerms` carries the player list,
 * so the game needs no ablation re-runs. `signalRead`'s `{drop}` seam stays
 * where it is — VOI's real-ablation work (M9) is its remaining caller.
 *
 * Below the per-desk table, the CHANNEL CREDIBILITY scoreboard (audit Part I
 * §2.5): what each of the seven channels has been MEASURED to be worth against
 * what it was AUTHORED to be worth, over how many scored rounds, and what
 * dropping it would cost the book's walk-forward CRPS. The seven terms used to
 * share one earned weight, so a student could not tell whether mastery was
 * carrying the layer while chronotype was noise — and got no benefit if so.
 *
 * The identity this shell defends is signalread.ts's own: the committed
 * fixture carries no signal data, so every desk's read collapses to adj 0,
 * terms [], rawTerms [] — every φ is 0, `ADJ` is 0.00, and `W·ADJ` (the earned
 * weight times that zero) is 0.00 too, whatever the prior weight itself
 * happens to be. Nothing here recomputes App's own board: `signalReads` is
 * the exact memo App.tsx already fitted (Task 12).
 *
 * T19 threads the derivation layer through: ADJ/W·ADJ, the STOCK and MASTERY
 * columns, and every VOI row carry a `<Derive>` trigger. `stockBySubject`
 * mirrors `masteryBySubject`'s own precedent exactly — computed once here,
 * handed down via `lib/derive/facts.ts`'s `ScorecardFacts.signalStock`/
 * `signalMastery`/`signalModelMean`, so `signal.stock`/`signal.mastery`
 * quote the identical StockRead/MasteryRead this view already built rather
 * than calling `studyStock`/`topicMastery`/`masteryRead` a second time.
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

const IDENTITY_READ = (subjectId: string): SignalRead => ({ subjectId, adj: 0, rawSum: 0, sdMult: 1, terms: [], rawTerms: [], reasons: [] });
/** Mirrors `mastery.ts`'s own (unexported) `MASTERY_IDENTITY` — the fallback
 *  for a live subject `masteryBySubject` has not (yet) keyed, which should
 *  never happen since both maps iterate the identical `liveSubs`. */
const EMPTY_MASTERY: MasteryRead = { topics: [], coverage: null, predictedPaper: null, term: 0, unevenness: 0 };

export interface SignalsProps {
  /** The visible board — ticker, colour and archived status per desk. */
  stats: SubjectStat[];
  entries: GradeEntry[];
  signalBook: SignalBook;
  /** App's own board (Task 12) — the baseline read. Reused, never recomputed. */
  signalReads: Map<string, SignalRead>;
  /** The exact desk means `signalReads` was fitted against — what
   *  `masteryBySubject` compares the book's own whole-paper call to, and what
   *  `signal.mastery`'s derivation quotes as the house's side. */
  modelMeans: Map<string, number | null>;
  signalFit: SignalSkill;
  /** The per-channel credibility fit (audit Part I §2) — App's own memo,
   *  reused. The multipliers it carries are already folded into `signalReads`;
   *  this is the scoreboard's copy of the same fit, never a second one. */
  signalChannels: SignalChannelFit;
  signalOn: boolean;
  todayIso: string;
  /** App's own `voi` memo (T18) — the VOI ranker's (T11) top-8 output,
   *  already scored and sorted. Reused, never recomputed here. */
  voi: VoiItem[];
  onSetSignalWeighting: (on: boolean) => void;
  onOpenSubject?: (id: string) => void;
  /** Quick-log intake (T16) — App.tsx assigns the id (`uid()`); every date is
   *  a value the student chose in the panel (defaulted, but editable), never
   *  a live clock read here or in App.tsx's handlers. */
  onLogSession: (subjectId: string, date: string, minutes: number, kind: SessionKind, topicIds: string[]) => void;
  onLogRest: (date: string, hours: number, bedtime: string | null) => void;
  onLogDisruption: (date: string, kind: DisruptionKind, days: number | null, note: string | null) => void;
  /** Topic add/edit (T17) — file-on-submit, LogPanels' own discipline: App.tsx
   *  assigns the id for a new topic; editing hands back the topic's own,
   *  already-known id. */
  onAddTopic: (subjectId: string, name: string, weightPct: number | null, prereqIds: string[]) => void;
  onEditTopic: (topicId: string, name: string, weightPct: number | null, prereqIds: string[]) => void;
  /** Person-level profile (chronotype, test anxiety) — not tied to any one desk. */
  profile: Profile | null;
  /** Traits/profile editor (T17) — draft-then-commit sliders; exactly one
   *  book write per commit, never per drag frame. */
  onSaveTraits: (subjectId: string, patch: SubjectTraitsPatch) => void;
  onSaveProfile: (profile: Profile) => void;
  /** T19 — the derivation layer's shared context. Absent (a drawer-less test
   *  harness) just means every figure on this floor renders bare. */
  deriveCtx?: DeriveCtx;
}

export function Signals({
  stats, entries, signalBook, signalReads, modelMeans, signalFit, signalChannels, signalOn, todayIso, voi,
  onSetSignalWeighting, onOpenSubject, onLogSession, onLogRest, onLogDisruption,
  onAddTopic, onEditTopic, profile, onSaveTraits, onSaveProfile, deriveCtx,
}: SignalsProps) {
  /* The live roster to log against — a delisted desk has no line to log a
     study session onto. Rest and disruptions are not subject-scoped at all,
     so only the session panel actually reads this. */
  const liveSubs = useMemo(() => stats.filter((s) => !s.sub.archived).map((s) => s.sub), [stats]);
  const rows = useMemo(() => {
    const live = stats.filter((s) => !s.sub.archived);
    return live.map((s) => {
      const full = signalReads.get(s.sub.id) ?? IDENTITY_READ(s.sub.id);
      // ONE read, not eight. Each column is this term's SHAPLEY value in the
      // clamped game over `rawTerms` — the share of `adj` attributable to it,
      // averaged over every order the channels could have arrived in. The
      // columns sum to ADJ exactly whether or not the clamp is binding, which
      // the drop-one marginals this replaced could not do (shapley.ts's
      // header carries the two-terms-at-+3 counterexample).
      const shapley = shapleyOf(full.rawTerms, SIGNAL_ADJ_CAP);
      return { sub: s.sub, stat: s, adj: full.adj, wAdj: signalFit.w * full.adj, shapley };
    });
  }, [stats, signalReads, signalFit.w]);

  /* MASTERY (T17) — computed HERE, once, and handed to `MasteryPanel` as a
     finished read: the panel itself never calls `topicMastery`/`masteryRead`,
     the same "the leaf renders, the view computes" split `rows` above already
     holds for the per-term Shapley columns. Filtering mirrors `signalRead`'s own
     convention exactly (topics by subjectId, marks by the resulting topic id
     set, sessions by subjectId) so this is the identical per-subject slice
     `signalRead` folds the mastery term from — just with the intermediate
     struct kept, which `SignalRead` itself never publishes. */
  const masteryBySubject = useMemo(() => {
    const out = new Map<string, SubjectMasteryRead>();
    for (const sub of liveSubs) {
      const subjTopics = signalBook.topics.filter((t) => t.subjectId === sub.id);
      const subjTopicIds = new Set(subjTopics.map((t) => t.id));
      const subjMarks = signalBook.topicMarks.filter((mk) => subjTopicIds.has(mk.topicId));
      const subjSessions = signalBook.sessions.filter((s) => s.subjectId === sub.id);
      const modelMean = modelMeans.get(sub.id) ?? null;
      const masteries = topicMastery(subjTopics, subjMarks, subjSessions, entries, sub.traits ?? null, sub.mix ?? null, todayIso);
      const read = masteryRead(subjTopics, masteries, modelMean, sub.attendancePct ?? null, todayIso);
      out.set(sub.id, { masteries, read });
    }
    return out;
  }, [liveSubs, signalBook, entries, modelMeans, todayIso]);

  /* STOCK (T19) — the same "computed here once, handed down as a finished
     read" split as `masteryBySubject` above, so `signal.stock`'s derivation
     quotes the identical StockRead the STOCK column's own share was computed
     from, never a second call into `studyStock`. */
  const stockBySubject = useMemo(() => {
    const out: Record<string, StockRead> = {};
    for (const sub of liveSubs) {
      const subjSessions = signalBook.sessions.filter((s) => s.subjectId === sub.id);
      out[sub.id] = studyStock(subjSessions, signalBook.rest, sub.mix ?? null, todayIso);
    }
    return out;
  }, [liveSubs, signalBook, todayIso]);

  /* The derivation context this floor hands every trigger — App's own board
     facts (Task 12/T19: signalReads/signalFit/voi) plus the SIGNALS board's
     own facts (T19), threaded via `ScorecardFacts` exactly like the
     Scorecard's `cardFacts` (both are D5). `signalShapley` is `rows`' own
     decomposition, reused rather than recomputed a second time, so
     `signal.stock`/`signal.mastery` can report the SAME share the
     STOCK/MASTERY columns themselves show when keyed `"shapley"` — never the
     raw channel read, which is a different number with a different formatter
     (see signals.ts's own `fmtShare`). */
  const dctx = useMemo<DeriveCtx | undefined>(() => {
    if (!deriveCtx) return undefined;
    const masteryOf: Record<string, MasteryRead> = {};
    const modelMeanOf: Record<string, number | null> = {};
    for (const sub of liveSubs) {
      masteryOf[sub.id] = masteryBySubject.get(sub.id)?.read ?? EMPTY_MASTERY;
      modelMeanOf[sub.id] = modelMeans.get(sub.id) ?? null;
    }
    const shapleyOfDesk: Record<string, Partial<Record<SignalTermKey, number>>> = {};
    for (const r of rows) shapleyOfDesk[r.sub.id] = Object.fromEntries(r.shapley);
    return {
      ...deriveCtx,
      signalReads,
      signalFit,
      voi,
      card: {
        ...deriveCtx.card,
        signalStock: stockBySubject,
        signalMastery: masteryOf,
        signalModelMean: modelMeanOf,
        signalShapley: shapleyOfDesk,
      },
    };
  }, [deriveCtx, liveSubs, masteryBySubject, modelMeans, signalReads, signalFit, voi, stockBySubject, rows]);

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
                      const v = r.shapley.get(c.key) ?? 0;
                      const cell = Math.abs(v) < ZERO_EPS ? "—" : fmtPts(v);
                      const derivedId = c.key === "stock" ? "signal.stock" : c.key === "mastery" ? "signal.mastery" : null;
                      return (
                        <td key={c.key} className="px-2.5 py-2 text-right text-xs tabular-nums" style={{ fontFamily: FONT.mono, color: toneOf(v) }}>
                          {derivedId && dctx ? (
                            <Derive id={derivedId} ctx={{ ...dctx, stat: r.stat, key: "shapley" }} passive>{cell}</Derive>
                          ) : (
                            cell
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2.5 py-2 text-right text-xs font-bold tabular-nums" style={{ fontFamily: FONT.mono, color: toneOf(r.adj) }}>
                      {dctx ? (
                        <Derive id="signal.adjust" ctx={{ ...dctx, stat: r.stat, key: "adj" }} passive>{fmtPts(r.adj)}</Derive>
                      ) : (
                        fmtPts(r.adj)
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-right text-xs font-bold tabular-nums" style={{ fontFamily: FONT.mono, color: toneOf(r.wAdj) }}>
                      {dctx ? (
                        <Derive id="signal.adjust" ctx={{ ...dctx, stat: r.stat, key: "wadj" }} passive>{fmtPts(r.wAdj)}</Derive>
                      ) : (
                        fmtPts(r.wAdj)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-3 py-2 border-t text-[10px] tracking-wider leading-relaxed" style={{ borderColor: C.line, color: C.faint, fontFamily: FONT.mono }}>
          EACH TERM COLUMN IS ITS SHAPLEY VALUE IN POINTS — THIS DESK'S CLAMPED SHIFT SPLIT ACROSS THE CHANNELS THAT
          CAUSED IT, AVERAGED OVER EVERY ORDER THEY COULD HAVE ARRIVED IN. THE COLUMNS SUM TO ADJ EXACTLY, WHETHER OR
          NOT THE ±{SIGNAL_ADJ_CAP}PT CAP IS BINDING. ADJ = THE DESK'S OWN CLAMPED SHIFT. W·ADJ = WHAT ACTUALLY MOVES
          THE NEXT-EXAM MEAN ONCE THE EARNED WEIGHT ABOVE IS APPLIED.
        </p>
      </Panel>

      <Panel title="CHANNEL CREDIBILITY — WHAT EACH SIGNAL HAS EARNED" pad={false}>
        <ChannelPanel fit={signalChannels} />
      </Panel>

      <LogPanels
        subjects={liveSubs}
        topics={signalBook.topics}
        todayIso={todayIso}
        onLogSession={onLogSession}
        onLogRest={onLogRest}
        onLogDisruption={onLogDisruption}
      />

      <Panel title="TOPIC MASTERY">
        <MasteryPanel
          subjects={liveSubs}
          topics={signalBook.topics}
          masteryBySubject={masteryBySubject}
          onAddTopic={onAddTopic}
          onEditTopic={onEditTopic}
        />
      </Panel>

      <Panel title="TRAITS & PROFILE">
        <TraitsEditor
          subjects={liveSubs}
          profile={profile}
          onSaveTraits={onSaveTraits}
          onSaveProfile={onSaveProfile}
        />
      </Panel>

      <Panel title="WHAT TO LOG NEXT — VOI">
        <VoiPanel items={voi} deriveCtx={dctx} />
      </Panel>
    </div>
  );
}
