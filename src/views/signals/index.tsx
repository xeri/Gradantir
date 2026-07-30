import { useMemo } from "react";
import { C, FONT, microLabel } from "../../theme";
import { Derive } from "../../components/ui/Derive";
import { Panel } from "../../components/ui/Panel";
import { PricedBanner } from "../../components/ui/PricedBanner";
import { LogPanels } from "./LogPanels";
import { MasteryPanel, type SubjectMasteryRead } from "./MasteryPanel";
import { TraitsEditor, type SubjectTraitsPatch } from "./TraitsEditor";
import { VoiPanel } from "./VoiPanel";
import { signalRead, type NextSitting, type SignalBook, type SignalRead, type SignalTermKey } from "../../lib/quant/signals/signalread";
import { topicMastery, masteryRead, type MasteryRead } from "../../lib/quant/signals/mastery";
import { studyStock, type StockRead } from "../../lib/quant/signals/stock";
import type { SignalSkill } from "../../lib/quant/signals/signalskill";
import type { VoiItem } from "../../lib/quant/signals/voi";
import type { DeriveCtx } from "../../lib/derive";
import type { DisruptionKind, GradeEntry, Profile, SessionKind, SubjectStat, Upcoming } from "../../types";

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

const IDENTITY_READ = (subjectId: string): SignalRead => ({ subjectId, adj: 0, rawSum: 0, sdMult: 1, terms: [], reasons: [] });
/** Mirrors `mastery.ts`'s own (unexported) `MASTERY_IDENTITY` — the fallback
 *  for a live subject `masteryBySubject` has not (yet) keyed, which should
 *  never happen since both maps iterate the identical `liveSubs`. */
const EMPTY_MASTERY: MasteryRead = { topics: [], coverage: null, predictedPaper: null, term: 0, unevenness: 0 };

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
  stats, entries, upcoming, signalBook, signalReads, modelMeans, signalFit, signalOn, todayIso, voi,
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
      return { sub, stat: s, adj: full.adj, wAdj: signalFit.w * full.adj, marginals };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, signalReads, entries, upcoming, modelMeans, signalBook, todayIso, signalFit.w]);

  /* MASTERY (T17) — computed HERE, once, and handed to `MasteryPanel` as a
     finished read: the panel itself never calls `topicMastery`/`masteryRead`,
     the same "the leaf renders, the view computes" split `rows` above already
     holds for the per-term marginals. Filtering mirrors `signalRead`'s own
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
     quotes the identical StockRead the STOCK column's marginal was computed
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
     Scorecard's `cardFacts` (both are D5). */
  const dctx = useMemo<DeriveCtx | undefined>(() => {
    if (!deriveCtx) return undefined;
    const masteryOf: Record<string, MasteryRead> = {};
    const modelMeanOf: Record<string, number | null> = {};
    for (const sub of liveSubs) {
      masteryOf[sub.id] = masteryBySubject.get(sub.id)?.read ?? EMPTY_MASTERY;
      modelMeanOf[sub.id] = modelMeans.get(sub.id) ?? null;
    }
    return {
      ...deriveCtx,
      signalReads,
      signalFit,
      voi,
      card: { ...deriveCtx.card, signalStock: stockBySubject, signalMastery: masteryOf, signalModelMean: modelMeanOf },
    };
  }, [deriveCtx, liveSubs, masteryBySubject, modelMeans, signalReads, signalFit, voi, stockBySubject]);

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
                      const cell = Math.abs(v) < ZERO_EPS ? "—" : fmtPts(v);
                      const derivedId = c.key === "stock" ? "signal.stock" : c.key === "mastery" ? "signal.mastery" : null;
                      return (
                        <td key={c.key} className="px-2.5 py-2 text-right text-xs tabular-nums" style={{ fontFamily: FONT.mono, color: toneOf(v) }}>
                          {derivedId && dctx ? (
                            <Derive id={derivedId} ctx={{ ...dctx, stat: r.stat }} passive>{cell}</Derive>
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
          EACH TERM COLUMN IS ITS MARGINAL CONTRIBUTION IN POINTS — ADJ(FULL) MINUS ADJ(WITH THAT TERM DROPPED), NOT ITS
          RAW READ, SO IT STAYS TRUE TO WHAT ACTUALLY MOVED THE CLAMPED SHIFT. WHERE TWO OR MORE TERMS JOINTLY HIT THE
          CAP, THE MARGINALS NO LONGER SUM TO ADJ — EACH ONE IS STILL HONEST ON ITS OWN. ADJ = THE DESK'S OWN CLAMPED
          SHIFT. W·ADJ = WHAT ACTUALLY MOVES THE NEXT-EXAM MEAN ONCE THE EARNED WEIGHT ABOVE IS APPLIED.
        </p>
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
