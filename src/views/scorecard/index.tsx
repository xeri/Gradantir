import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { C, FONT } from "../../theme";
import { backtestBook } from "../../lib/quant/eval/backtest";
import { meanSkill } from "../../lib/quant/eval/skill";
import { ablateMembers, ablatePremia } from "../../lib/quant/eval/ablation";
import { classifyUpcoming } from "../../lib/upcoming";
import { elicitationScoreboard } from "../../lib/elicit";
import { DEFAULT_CALENDAR } from "../../lib/calendar";
import { NO_WEIGHT } from "../../lib/quant/earned";
import { IDENTITY_MEAN_POOL } from "../../lib/quant/meanpool";
import { SkillCard, type SkillReport } from "./SkillCard";
import { YouVsDeskCard } from "./YouVsDeskCard";
import { ForwardCard } from "./ForwardCard";
import { GapCard } from "./GapCard";
import { EffortCard } from "./EffortCard";
import { ReadinessCard } from "./ReadinessCard";
import { AggregateCard } from "./AggregateCard";
import { AblationCard, type AblationReport } from "./AblationCard";
import { eloRank } from "../../lib/duel";
import type { AllocationDraft } from "../../lib/allocate";
import type { DeriveCtx, ScorecardFacts } from "../../lib/derive";
import type { StudentT } from "../../lib/quant/bayes";
import type { MeanPoolModel } from "../../lib/quant/meanpool";
import type { SelfWeightModel } from "../../lib/quant/pool";
import { IDENTITY_AI_POOL, type AiWeightModel } from "../../lib/quant/aipool";
import type { ReadinessSkill } from "../../lib/quant/readiness";
import type { AggregateForecast, AppData, Signal, SubjectStat, Upcoming } from "../../types";

/** A readiness fit that has scored nothing — the identity, for a caller with no register. */
const NO_READINESS: ReadinessSkill = { ...NO_WEIGHT, hitRate: null, modelHitRate: null };

export interface ScorecardProps {
  data: AppData;
  stats: SubjectStat[];
  /**
   * The board BEFORE the credibility pool (§27). Every "you vs the desk"
   * comparison scores against this: pooling your own call into the desk's and
   * then asking whether you beat the desk would have you competing with a
   * forecast you part-wrote, and the gap would close on its own.
   */
  rawStats: SubjectStat[];
  signals: Signal[];
  todayIso: string;
  /** The reporting term being FILED — what the effort budget is drawn for. */
  roundKey: string;
  /** The round being FORECAST — what an aggregate call can still be about. */
  forecastRoundKey: string;
  /** The desk's own forward aggregate, unpooled — what your call disagrees with. */
  deskForecast: AggregateForecast | null;
  /** What your record has earned your call, fitted off `rawStats`. */
  selfFit: SelfWeightModel;
  selfOn: boolean;
  /** What the wire's forecasts have earned (§29). Absent = the identity. */
  aiFit?: AiWeightModel;
  /** The wire's switch — OPT-IN, unlike the others. Absent = off. */
  aiOn?: boolean;
  /** The wire's measured marginal charge, in points, for the banner copy. */
  aiCharge?: { desks: number; maxAbsMove: number };
  onSetAiWeighting?: (on: boolean) => void;
  /** What the duel pile has earned against realized exam orderings. */
  readyFit?: ReadinessSkill;
  readinessOn?: boolean;
  /** What your aggregate calls have earned against the desk's own. */
  meanFit?: MeanPoolModel;
  aggregateOn?: boolean;
  onSetSelfWeighting: (on: boolean) => void;
  onSetEffortWeighting: (on: boolean) => void;
  onSetReadinessWeighting: (on: boolean) => void;
  onSetAggregateCallWeighting: (on: boolean) => void;
  onAddSitting: () => void;
  onEditSitting: (u: Upcoming) => void;
  onDeleteSitting: (id: string) => void;
  onRecordDuel: (aId: string, bId: string, winnerId: string) => void;
  onResetDuels: () => void;
  onRemoveDuel: (id: string) => void;
  onSaveAllocation: (roundKey: string, draft: AllocationDraft) => void;
  onSaveMeanCall: (roundKey: string, predAvg: number, ranking: string[]) => void;
  onRemoveMeanCall: (id: string) => void;
  onOpenSubject: (id: string) => void;
  /**
   * The book-level derivation context. Every figure on this board that the
   * ENGINE produced — a proper score, an earned weight, an Elo rating, a
   * water-filled allocation — hangs its research note off this (§24).
   */
  deriveCtx?: DeriveCtx;
}

/**
 * D5 · THE SCORECARD — where the engine is graded and where you are.
 *
 * Card order is an argument, not a layout: how well the desk forecasts, how well
 * you do against it, what is coming, and then the three cards that take an input
 * from you AND PRICE IT. Those three carry the same banner (`PricedBanner`) for
 * the same reason — before you touch the instrument you are told, in points,
 * what it will move.
 */
export function Scorecard(props: ScorecardProps) {
  const { data, stats, signals, todayIso, roundKey } = props;
  const cal = data.settings.calendar ?? DEFAULT_CALENDAR;
  const statById = useMemo(() => new Map(stats.map((s) => [s.sub.id, s])), [stats]);
  const tickerOf = (id: string) => statById.get(id)?.sub.ticker ?? id;
  const colorOf = (id: string) => statById.get(id)?.sub.color ?? C.dim;

  /* Confirmation flashes — every write says so. */
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1900);
    return () => clearTimeout(id);
  }, [flash]);

  /* The walk-forward skill backtest is seconds of work: compute it AFTER the
     page paints (so the view lands instantly), keyed only to the tape. */
  const [skill, setSkill] = useState<SkillReport | null>(null);
  useEffect(() => {
    setSkill(null);
    let alive = true;
    const id = setTimeout(() => {
      const book = backtestBook(data.subjects, data.entries);
      const mean = meanSkill(data.subjects, data.entries, cal);
      if (alive) setSkill({ book, mean });
    }, 40);
    return () => { alive = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.subjects, data.entries, data.settings, todayIso]);

  /* Ablation is the heaviest piece and rarely needed — strictly on demand. */
  const [ablation, setAblation] = useState<AblationReport | null>(null);
  const [ablating, setAblating] = useState(false);
  useEffect(() => { setAblation(null); }, [data.subjects, data.entries, data.settings]);
  const runAblation = () => {
    setAblating(true);
    setTimeout(() => {
      setAblation({
        members: ablateMembers(data.subjects, data.entries),
        premia: ablatePremia(data.subjects, data.entries, data.settings),
      });
      setAblating(false);
    }, 40);
  };

  const { resolved, pending } = useMemo(
    () => classifyUpcoming(data.upcoming ?? [], data.entries, todayIso),
    [data.upcoming, data.entries, todayIso],
  );
  /* The DESK's own call, never the pooled one — see `rawStats` on the props. */
  const rawById = useMemo(() => new Map(props.rawStats.map((s) => [s.sub.id, s])), [props.rawStats]);
  const modelFor = useMemo(() => (r: { upcoming: Upcoming }): StudentT | null => {
    const q = rawById.get(r.upcoming.subjectId)?.quant;
    return q ? { mean: q.nextExam.mean, scale: q.nextExam.sd, df: q.df } : null;
  }, [rawById]);
  const elicit = useMemo(() => elicitationScoreboard(resolved, modelFor), [resolved, modelFor]);

  /* Flash-wrapped writes. */
  const recordDuel = (a: string, b: string, w: string) => { props.onRecordDuel(a, b, w); setFlash(`DUEL LOGGED · ${tickerOf(w)} MORE READY`); };
  const resetDuels = () => { props.onResetDuels(); setFlash("DUEL RECORD CLEARED"); };
  const removeDuel = (id: string) => { props.onRemoveDuel(id); setFlash("DUEL DROPPED · RANKING REFIT"); };
  /* Every settled drag files, but only the deliberate acts announce themselves —
     a toast on each vertex release would be noise, not confirmation. */
  const saveAllocation = (rk: string, draft: AllocationDraft, note?: string) => {
    props.onSaveAllocation(rk, draft);
    if (note) setFlash(note);
  };
  const saveMeanCall = (rk: string, predAvg: number, ranking: string[]) => {
    props.onSaveMeanCall(rk, predAvg, ranking);
    setFlash("AGGREGATE CALL LOGGED");
  };
  const removeMeanCall = (id: string) => { props.onRemoveMeanCall(id); setFlash("CALL DROPPED FROM THE RECORD"); };
  const switchFlash = (on: boolean, onText: string, offText: string) => setFlash(on ? onText : offText);
  const setEffortWeighting = (on: boolean) => {
    props.onSetEffortWeighting(on);
    switchFlash(on, "EFFORT PRICED INTO THE MARK", "EFFORT OUT OF THE MARK");
  };
  const setSelfWeighting = (on: boolean) => {
    props.onSetSelfWeighting(on);
    switchFlash(on, "YOUR CALL PRICED INTO THE FORECAST", "FORECAST IS THE DESK'S ALONE");
  };
  const setAiWeighting = (on: boolean) => {
    props.onSetAiWeighting?.(on);
    switchFlash(on, "THE WIRE PRICED INTO THE FORECAST", "THE WIRE IS SCORED, NOT PRICED");
  };
  const setReadinessWeighting = (on: boolean) => {
    props.onSetReadinessWeighting(on);
    switchFlash(on, "READINESS PRICED INTO THE MARK", "READINESS OUT OF THE MARK");
  };
  const setAggregateCallWeighting = (on: boolean) => {
    props.onSetAggregateCallWeighting(on);
    switchFlash(on, "YOUR CALL PRICED INTO THE AGGREGATE", "AGGREGATE IS THE DESK'S ALONE");
  };

  /* Everything this board measured, bundled once for the derivation layer —
     the scorecard has no `trace.ts` of its own because its figures come out of
     four separate engines, so this IS its trace (see lib/derive/facts.ts).
     Rebuilt only when a measurement moves, never per render. */
  const cardFacts = useMemo<ScorecardFacts>(
    () => ({
      book: skill?.book ?? null,
      mean: skill?.mean ?? null,
      elicit,
      selfFit: props.selfFit,
      aiFit: props.aiFit ?? IDENTITY_AI_POOL,
      readyFit: props.readyFit ?? NO_READINESS,
      meanFit: props.meanFit ?? IDENTITY_MEAN_POOL,
      ablation: ablation ? [...ablation.members, ...ablation.premia] : null,
      deskForecast: props.deskForecast,
      elo: {
        rows: eloRank(data.duels ?? [], stats.filter((s) => !s.sub.archived).map((s) => s.sub.id)),
        duels: (data.duels ?? []).length,
        tickerOf: Object.fromEntries(stats.map((s) => [s.sub.id, s.sub.ticker])),
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skill, elicit, ablation, props.selfFit, props.aiFit, props.readyFit, props.meanFit, props.deskForecast, data.duels, stats],
  );

  /**
   * Two contexts, because two boards on this card report two different numbers.
   * `dctx` carries the scorecard's own facts. `rawCtx` additionally swaps in the
   * UNPOOLED board — the forward calendar prints the desk's own call, and a note
   * that quoted the pooled one would disagree with the figure it sits under.
   */
  const dctx = useMemo<DeriveCtx | undefined>(
    () => (props.deriveCtx ? { ...props.deriveCtx, card: cardFacts } : undefined),
    [props.deriveCtx, cardFacts],
  );
  const rawCtx = useMemo<DeriveCtx | undefined>(
    () => (dctx ? { ...dctx, stats: props.rawStats, selfPool: null, selfStakes: undefined } : undefined),
    [dctx, props.rawStats],
  );
  /** A channel's note has to know whether the channel is actually live. */
  const withSwitch = (on: boolean): DeriveCtx | undefined =>
    dctx ? { ...dctx, card: { ...cardFacts, on } } : undefined;

  return (
    <div className="space-y-4">
      {/* confirmation toast */}
      <div aria-live="polite" className="h-0 relative">
        {flash && (
          <div
            className="gx-fade absolute right-0 -top-1 z-10 flex items-center gap-1.5 border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ background: "rgba(47,217,128,0.12)", borderColor: C.up, color: C.up, fontFamily: FONT.mono }}
          >
            <Check size={11} /> {flash}
          </div>
        )}
      </div>

      <SkillCard skill={skill} dctx={dctx} />
      <YouVsDeskCard
        elicit={elicit}
        hasSittings={(data.upcoming ?? []).length > 0}
        hasAiCalls={(data.upcoming ?? []).some((u) => !!u.aiPred)}
        selfFit={props.selfFit}
        selfOn={props.selfOn}
        aiFit={props.aiFit ?? IDENTITY_AI_POOL}
        aiOn={props.aiOn === true}
        aiCharge={props.aiCharge}
        onSetSelfWeighting={setSelfWeighting}
        onSetAiWeighting={setAiWeighting}
        dctx={withSwitch(props.selfOn)}
        aiDctx={withSwitch(props.aiOn === true)}
      />
      <ForwardCard
        pending={pending}
        resolved={resolved}
        allUpcoming={data.upcoming ?? []}
        tickerOf={tickerOf}
        colorOf={colorOf}
        modelFor={modelFor}
        onAdd={props.onAddSitting}
        onEdit={props.onEditSitting}
        onDelete={props.onDeleteSitting}
        dctx={rawCtx}
      />
      <GapCard stats={stats} onOpenSubject={props.onOpenSubject} dctx={dctx} />
      <EffortCard
        signals={signals}
        roundKey={roundKey}
        allocation={data.allocations?.find((a) => a.roundKey === roundKey) ?? null}
        effortOn={data.settings.effortWeighting !== false}
        tickerOf={tickerOf}
        colorOf={colorOf}
        onSave={saveAllocation}
        onSetEffortWeighting={setEffortWeighting}
        dctx={withSwitch(data.settings.effortWeighting !== false)}
      />
      <ReadinessCard
        subjects={data.subjects}
        duels={data.duels ?? []}
        fit={props.readyFit ?? NO_READINESS}
        readinessOn={data.settings.readinessWeighting !== false}
        todayIso={todayIso}
        onRecordDuel={recordDuel}
        onResetDuels={resetDuels}
        onRemoveDuel={removeDuel}
        onSetReadinessWeighting={setReadinessWeighting}
        dctx={withSwitch(data.settings.readinessWeighting !== false)}
      />
      <AggregateCard
        stats={stats}
        data={data}
        cal={cal}
        roundKey={props.forecastRoundKey}
        todayIso={todayIso}
        fit={props.meanFit ?? IDENTITY_MEAN_POOL}
        deskForecast={props.deskForecast}
        aggregateOn={data.settings.aggregateCallWeighting !== false}
        tickerOf={tickerOf}
        onSave={saveMeanCall}
        onRemoveCall={removeMeanCall}
        onSetAggregateCallWeighting={setAggregateCallWeighting}
        dctx={withSwitch(data.settings.aggregateCallWeighting !== false)}
      />
      <AblationCard ablation={ablation} ablating={ablating} onRun={runAblation} dctx={dctx} />
    </div>
  );
}
