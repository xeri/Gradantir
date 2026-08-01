import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Plus, Radio, RefreshCw, Settings2, TerminalSquare } from "lucide-react";
import { C, FONT, microLabel } from "./theme";
import { TickerTape } from "./components/TickerTape";
import { StatusBar } from "./components/StatusBar";
import { AggregateBand } from "./components/AggregateBand";
import { SplitBanner } from "./components/SplitBanner";
import { Drawer } from "./components/Drawer";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { SubjectModal } from "./components/modals/SubjectModal";
import { GradeModal } from "./components/modals/GradeModal";
import { SittingModal } from "./components/modals/SittingModal";
import { SettingsModal } from "./components/modals/SettingsModal";
import { WireModal } from "./components/modals/WireModal";
import { Btn } from "./components/ui/Btn";
import { Modal } from "./components/ui/Modal";
import { Overview } from "./views/Overview";
import { Charts } from "./views/Charts";
import { Compare } from "./views/Compare";
import { Screener } from "./views/Screener";
import { Blotter } from "./views/Blotter";
import { Scorecard } from "./views/scorecard";
import { Signals } from "./views/signals";
import { applyBias, computeStats } from "./lib/stats";
import { fitBias } from "./lib/quant/biascal";
import { replayRegister } from "./lib/quant/eval/replay";
import { readinessSkill } from "./lib/quant/readiness";
import { aggregateCallFor, meanCallSkill, poolAggregate } from "./lib/quant/meanpool";
import {
  aggregateForecast, aggregateHistory, compositeIndex, examAggregate, examAggregateHistory, pricesAsOf,
} from "./lib/quant/aggregate";
import { advise } from "./lib/quant/advisor";
import { IDENTITY_POOL, fitSelfWeight, stakedSittings } from "./lib/quant/pool";
import { IDENTITY_AI_POOL, aiChargePts, fitAiWeight, poolBoardJoint } from "./lib/quant/aipool";
import { applySignals } from "./lib/quant/signals/apply";
import { emptySignalBook, signalBoard, type SignalBook } from "./lib/quant/signals/signalread";
import { NO_SIGNAL_SKILL, signalRounds, signalSkill } from "./lib/quant/signals/signalskill";
import { NO_CHANNEL_FIT, fitSignalChannels } from "./lib/quant/signals/channels";
import { valueOfInformation } from "./lib/quant/signals/voi";
import { classifyUpcoming } from "./lib/upcoming";
import { fitDepth } from "./lib/quant/depth";
import { listedAsOf } from "./lib/listing";
import { applySplit, detectSplits, splitTopicMarkLoss, supersededBy } from "./lib/lineage";
import { clearQuarantine, loadData, quarantinedRaw, saveData } from "./lib/storage";
import { clearSection, removeFromBook, type SectionKey } from "./lib/ledger";
import { makeSample } from "./lib/sample";
import { freshBook } from "./lib/defaults";
import { currentTermKey } from "./lib/periods";
import type { AllocationDraft } from "./lib/allocate";
import { buildRounds, pendingRound } from "./lib/rounds";
import { DEFAULT_CALENDAR, reportOpens, reportingTermOf, teachingTermOf } from "./lib/calendar";
import { sessionInfo } from "./lib/session";
import { addDays, todayStr, uid } from "./lib/utils";
import { mergeData, replaceData, serializeExport, type ImportPayload } from "./lib/io";
import { downloadText } from "./lib/download";
import {
  derivationModeOff, derivationModeOn, subscribeDerivationMode, toggleDerivationMode,
} from "./lib/derivationMode";
import type { DeriveCtx } from "./lib/derive";
import type { SubjectTraitsPatch } from "./views/signals/TraitsEditor";
import type {
  AppData, Disruption, DisruptionKind, ForecastLog, GradeEntry, Profile, RestLog, Settings, SessionKind, StudySession,
  Subject, Topic, Upcoming,
} from "./types";

type View = "overview" | "charts" | "compare" | "screener" | "blotter" | "scoreboard" | "signals";
type ModalState =
  | { type: "subject" }
  | { type: "grade"; entry?: GradeEntry; subjectId?: string }
  | { type: "sitting"; sitting?: Upcoming; subjectId?: string }
  | { type: "settings" }
  | { type: "wire" }
  | null;

const TABS: { id: View; label: string }[] = [
  { id: "overview", label: "OVERVIEW" },
  { id: "charts", label: "CHARTS" },
  { id: "compare", label: "COMPARE" },
  { id: "screener", label: "SCREENER" },
  { id: "blotter", label: "BLOTTER" },
  { id: "scoreboard", label: "SCORECARD" },
  { id: "signals", label: "SIGNALS" },
];

const PHASE_COLOR = { pre: C.amber, open: C.up, post: C.amber, closed: C.faint } as const;

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState<View>("overview");
  const [modal, setModal] = useState<ModalState>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  /* Review-only, and deliberately not persisted: you come back to the live book. */
  const [showDelisted, setShowDelisted] = useState(false);

  /* Set aside by `loadData` when a stored book would not parse. It is raw JSON,
     so it is worth offering back before anything else overwrites the slot. */
  const [rescue, setRescue] = useState<string | null>(null);

  useEffect(() => {
    setData(loadData() ?? makeSample());
    setRescue(quarantinedRaw());
  }, []);

  useEffect(() => {
    if (!data) return;
    setSaveErr(!saveData(data));
  }, [data]);

  useEffect(() => {
    const id = setInterval(() => setClockNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  /* The book is WHOLE. A delisted desk keeps every print it made: it feeds the
     pooled prior, the depth fit and every historical sum it was present for.
     Four slices come off that book, and nothing below re-derives them:

       stats     every desk — what the engine prices against
       booked    the desks still reporting today — the headline instruments
       live      the desks you can still log against
       visible   what the boards draw (delisted only when you ask to see them)  */
  const cal = data?.settings.calendar ?? DEFAULT_CALENDAR;

  /* THE REGISTER, DERIVED (§26). The engine's own predictions are not stored,
     exported or merged: they are replayed from the tape, walk-forward, so the
     bias correction is reproducible and cannot be set by a stale model run or
     somebody else's imported book.

     It is seconds of work on a full book, so it lands AFTER first paint — the
     same treatment the skill backtest gets. Everything downstream is the exact
     identity on an empty register, so the first frame is simply the uncorrected
     board rather than a wrong one. */
  const [register, setRegister] = useState<ForecastLog[]>([]);
  /* Keyed to the ROSTER, TAPE and SETTINGS alone — the only things a replay reads.
     Logging a duel or filing a budget must not re-run it: those change what the
     board is priced against, never what the model would have forecast.
     `Subject.traits` and `Settings.profile` (D5's life-signals inputs) ride
     these same two keys — a trait lives on a subject, a profile on settings —
     but `replayRegister` never reads either: it walks the exam tape and
     scores the bias model, nothing about the signal channel. Editing a trait
     or the profile therefore still re-runs this effect; it is churn, not a
     correctness issue, since the result is identical either way — narrowing
     the key further to exclude them would save a redundant replay but is not
     required for this feature to be correct. */
  useEffect(() => {
    if (!data) return;
    let alive = true;
    const id = setTimeout(() => {
      const logs = replayRegister(data.subjects, data.entries, data.settings, todayStr());
      if (alive) setRegister(logs);
    }, 40);
    return () => { alive = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.subjects, data?.entries, data?.settings]);

  /* What the register has taught the engine about itself, and what it has let
     the student's own inputs earn. All three read the SAME as-of calls, which is
     the only way "did you beat the desk?" can be asked honestly. */
  const bias = useMemo(() => fitBias(register, "exam"), [register]);
  const readyFit = useMemo(
    () => readinessSkill(data?.duels ?? [], data?.entries ?? [], register, cal),
    [data?.duels, data?.entries, register, cal],
  );
  const meanFit = useMemo(
    () => meanCallSkill(data?.meanCalls ?? [], data?.entries ?? [], register, cal),
    [data?.meanCalls, data?.entries, register, cal],
  );

  /* `rawStats` is the un-corrected board — what the bias measures against, so it
     never grades its own correction; `stats` is the display board, corrected only
     once the register has learned something. Identity register ⇒ the two are the
     same array. Both price the elicited inputs, which live outside the bias path
     entirely (the readiness premium moves the MARK, never the next-exam call). */
  const elicited = useMemo(
    () => ({ allocations: data?.allocations, duels: data?.duels, readinessSkill: readyFit.w }),
    [data?.allocations, data?.duels, readyFit.w],
  );
  /* KEYED ON WHAT THEY READ, NOT ON THE BOOK.
     `update` spreads, so every slice it does not patch keeps its identity — and
     every memo below is therefore keyed on its actual inputs rather than on
     `data`. Keyed on the whole book instead, scheduling a sitting, filing an
     aggregate call or dismissing the demo banner repriced the entire engine,
     and answering ONE duel re-ran the repriced history and the composite index
     as well, neither of which a duel can move. The replay effect above has
     always been written this way; the rest of the board now matches it. */
  const rawStats = useMemo(
    () => (data ? computeStats(data.subjects, data.entries, data.settings, undefined, undefined, elicited) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.subjects, data?.entries, data?.settings, elicited],
  );
  /* Corrected from the priced board, NOT repriced with the bias in hand. The
     two are byte-identical (stats.applyBias, locked against a full recompute on
     the fixture book) — but pricing the book is the most expensive thing the
     terminal does, and doing it twice per edit meant every logged result, every
     settings toggle and every duel paid for the whole engine twice over. */
  const stats = useMemo(() => applyBias(rawStats, bias), [rawStats, bias]);

  /* THE LIFE-SIGNALS BOOK (D5). One small bundle off the five raw slices plus
     the person-level profile — no allocation churn beyond the memo itself,
     since `emptySignalBook`'s frozen empty arrays are reused whenever a slice
     is absent, so a book that has never touched the feature keeps the exact
     identity signalread.ts documents as load-bearing. */
  const signalBook = useMemo<SignalBook>(
    () => (data
      ? {
          topics: data.topics ?? emptySignalBook.topics,
          topicMarks: data.topicMarks ?? emptySignalBook.topicMarks,
          sessions: data.sessions ?? emptySignalBook.sessions,
          rest: data.rest ?? emptySignalBook.rest,
          disruptions: data.disruptions ?? emptySignalBook.disruptions,
          profile: data.settings.profile ?? null,
        }
      : emptySignalBook),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.topics, data?.topicMarks, data?.sessions, data?.rest, data?.disruptions, data?.settings.profile],
  );
  /* The house's OWN nextExam mean per desk (`stats` — bias-corrected,
     pre-signal), hoisted out of the read below so the SIGNALS view can call
     `signalRead` again, honestly, for its own per-term `{drop}` ablation —
     against the identical mean the baseline read below was fitted against. */
  const modelMeans = useMemo(
    () => new Map(stats.map((s) => [s.sub.id, s.quant?.nextExam.mean ?? null])),
    [stats],
  );
  /* The walk-forward replay, ONCE (audit Part I §2). Both fits below read the
     same rounds: the shape fit searches the per-channel multipliers over them
     and the scale fit scores the result. Two-board invariant: this reads the
     REGISTER and the raw subjects/entries only — never `pooled`, never even
     `stats` — the same discipline the self/wire pools hold against
     `rawStats`, just with no board argument to get wrong in the first place. */
  const signalRoundsMemo = useMemo(
    () => (data ? signalRounds(register, signalBook, data.subjects, data.entries) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [register, signalBook, data?.subjects, data?.entries],
  );
  /* SHAPE (audit Part I §2). Which of the seven channels has actually been
     predicting, as a multiplier on its own authored weight with prior 1.
     Fitted BEFORE the scale below and normalised to mean 1, because w · a_k
     is a product and only the product is identified from one student's book.
     `signalWeighting` follows the other student-input switches' polarity:
     absent => ON. */
  const signalChannels = useMemo(
    () => (data ? fitSignalChannels(signalRoundsMemo, data.settings.signalWeighting !== false) : NO_CHANNEL_FIT),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signalRoundsMemo, data?.settings.signalWeighting],
  );
  /* SCALE — the channel's earned weight (D5), fitted on the RESHAPED adj, so
     the weight is earned by the same adjustment the board is about to apply. */
  const signalFit = useMemo(
    () => (data
      ? signalSkill(signalRoundsMemo, signalChannels.weights, data.settings.signalWeighting !== false)
      : NO_SIGNAL_SKILL),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signalRoundsMemo, signalChannels, data?.settings.signalWeighting],
  );
  /* The per-desk life-signals read, priced against the house's OWN nextExam
     mean so mastery's "book says X vs desk Y" comparison is against the same
     number the board is about to show — and at the fitted channel weights, so
     the SIGNALS table's Shapley columns decompose the adjustment that ships. */
  const signalReads = useMemo(
    () => (data
      ? signalBoard(data.subjects, signalBook, data.entries, data.upcoming ?? [], modelMeans, todayStr(), signalChannels.weights)
      : new Map()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.subjects, signalBook, data?.entries, data?.upcoming, modelMeans, signalChannels],
  );
  /* Signals modify the HOUSE side: shifts `stats`' own nextExam by the earned
     weight, feeding the existing pool memo below. `rawStats` stays untouched
     — every fit above still reads raw/register, never this. Identity (same
     array reference) when the switch is off or no desk's read actually
     moves anything, the same discipline `applyBias`/`poolBoardJoint` hold. */
  const signalled = useMemo(
    () => applySignals(stats, signalReads, signalFit.w, data?.settings.signalWeighting !== false),
    [stats, signalReads, signalFit.w, data?.settings.signalWeighting],
  );

  /* The credibility pool (§27). Where the desk has been persistently off and
     the student's own calls have not, the next-exam forecast cedes weight to
     them — earned from the realized scores, capped, and widening the band
     whenever the two disagree.

     Fitted against `rawStats` on purpose, twice over: the register must keep
     measuring the DESK's error rather than the pool's, and a forecaster cannot
     be allowed to grade a paper it half-wrote. Everything the boards draw reads
     `pooled`; everything that SCORES the engine reads `rawStats`. */
  const rawById = useMemo(() => new Map(rawStats.map((s) => [s.sub.id, s])), [rawStats]);
  const selfFit = useMemo(() => {
    if (!data || data.settings.selfWeighting === false) return IDENTITY_POOL;
    const { resolved } = classifyUpcoming(data.upcoming ?? [], data.entries, todayStr());
    return fitSelfWeight(resolved, (r) => {
      const q = rawById.get(r.upcoming.subjectId)?.quant;
      return q ? { mean: q.nextExam.mean, scale: q.nextExam.sd, df: q.df } : null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.settings.selfWeighting, data?.upcoming, data?.entries, rawById]);
  /* The wire's channel (§29) — same integrity rules as the self pool, fitted
     against the RAW board, and OPT-IN: the switch is the inverse of the other
     four, absent ⇒ OFF. `aiPred` lives on `upcoming`, outside the register
     effect's inputs, so the wire can never touch the record it is judged by. */
  const aiFit = useMemo(() => {
    if (!data || data.settings.aiWeighting !== true) return IDENTITY_AI_POOL;
    const { resolved } = classifyUpcoming(data.upcoming ?? [], data.entries, todayStr());
    return fitAiWeight(resolved, (r) => {
      const q = rawById.get(r.upcoming.subjectId)?.quant;
      return q ? { mean: q.nextExam.mean, scale: q.nextExam.sd, df: q.df } : null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.settings.aiWeighting, data?.upcoming, data?.entries, rawById]);
  const pooled = useMemo(
    () => (data ? poolBoardJoint(signalled, data.upcoming ?? [], data.entries, todayStr(), selfFit, aiFit) : signalled),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.upcoming, data?.entries, signalled, selfFit, aiFit],
  );
  /* What the wire is moving in points right now — measured, for the card copy.
     B5 (audit Part I §4): measured against `signalled`, the board the student
     is actually looking at and the board `poolBoardJoint` pools into two memos
     above — never the pre-signals `stats`. Measuring the wire's move against a
     board that is not on screen reports a displacement nobody can see, and
     ignores every life-signals shift on the desk being moved. */
  const aiCharge = useMemo(
    () => (data && aiFit.w > 0
      ? aiChargePts(signalled, data.upcoming ?? [], data.entries, todayStr(), selfFit, aiFit)
      : { desks: 0, maxAbsMove: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.upcoming, data?.entries, signalled, selfFit, aiFit],
  );

  const booked = useMemo(() => listedAsOf(pooled, todayStr(), cal), [pooled, cal]);
  const live = useMemo(() => pooled.filter((s) => !s.sub.archived), [pooled]);
  const delisted = useMemo(() => pooled.filter((s) => s.sub.archived), [pooled]);
  const visible = useMemo(() => (showDelisted ? pooled : live), [showDelisted, pooled, live]);
  const liveSubs = useMemo(() => live.map((s) => s.sub), [live]);
  const liveEntryCount = useMemo(() => live.reduce((a, s) => a + s.entries.length, 0), [live]);
  const visibleSubs = useMemo(() => visible.map((s) => s.sub), [visible]);
  const visibleEntries = useMemo(() => {
    if (!data) return [];
    const ids = new Set(visible.map((s) => s.sub.id));
    return data.entries.filter((e) => ids.has(e.subjectId));
  }, [data, visible]);

  /* THE VOI RANKER (D5/T11) — App's own `voi` memo, the plan's last
     composition slot Task 12 deliberately left open. Subjects: live desks
     only (`liveSubs` — an archived desk earns no "log more" nudge). Desks:
     this round's per-desk SD off `stats` (the house's own bias-corrected,
     pre-signal board), mirroring `modelMeans`'s own convention one level up
     but for the ranker's sd-scaled heuristics rather than the signal
     engine's mean-shift term — built inline rather than a named memo, since
     nothing else reads this particular map. */
  const voi = useMemo(() => {
    if (!data) return [];
    const desks = new Map(stats.map((s) => [s.sub.id, s.quant?.nextExam.sd ?? null]));
    return valueOfInformation(liveSubs, signalBook, desks, todayStr());
  }, [data, stats, liveSubs, signalBook]);

  /* The three headline instruments: realized exams, the next round, the price
     index. All three read `booked` — a closed desk cannot report a stale exam
     into today's number, and nobody forecasts an exam you will never sit. */
  const agg = useMemo(() => examAggregate(booked), [booked]);
  // The subject-affinity prior (0 when unset) widens the aggregate bands beyond
  // independence — a term that goes badly tends to hit every desk at once.
  const rho = data?.settings.subjectCorr ?? 0;
  const deskAggFc = useMemo(() => aggregateForecast(booked, agg, rho), [booked, agg, rho]);
  const index = useMemo(() => {
    if (!data) return null;
    // "VS LAST TERM" means the last term that CLOSED — the day before this
    // term's filing window opened, not an arbitrary calendar quarter-end.
    const prevTermEnd = addDays(reportOpens(reportingTermOf(todayStr(), cal), cal), -1);
    return compositeIndex(booked, pricesAsOf(data.subjects, data.entries, data.settings, prevTermEnd), rho);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.subjects, data?.entries, data?.settings, booked, cal, rho]);
  /* The depth fit is book-wide, so the boards share one — computeStats runs its
     own copy internally, but the peer-premium tape and the settings diagnostic
     need it out here too. Every ranked print counts, closed desks included:
     a class you sat two years ago is still evidence about the field. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const depth = useMemo(() => (data ? fitDepth(data.entries, data.settings) : null), [data?.entries, data?.settings]);
  const examHist = useMemo(
    () => (data ? examAggregateHistory(data.subjects, data.entries, todayStr(), cal) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.subjects, data?.entries, cal],
  );
  const compHist = useMemo(
    () => (data ? aggregateHistory(data.subjects, data.entries, data.settings, todayStr()) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.subjects, data?.entries, data?.settings],
  );
  /* THE ROUNDS: which terms this book actually prints in, learned from the
     book itself, and therefore which one the oracle is forecasting. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rounds = useMemo(() => (data ? buildRounds(data.entries, cal) : []), [data?.entries, cal]);
  const pending = useMemo(() => pendingRound(rounds, todayStr(), cal), [rounds, cal]);
  /* THE AGGREGATE POOL (§28). Your standing call on the overall average for the
     round being forecast, pooled into the desk's own sum by the weight your past
     calls have earned. Book level only — the call is about the average, and
     allocating it back over the desks would invent opinions you never stated. */
  const aggCall = useMemo(
    () => aggregateCallFor(data?.meanCalls, pending?.key ?? null, data?.settings.aggregateCallWeighting !== false),
    [data?.meanCalls, pending?.key, data?.settings.aggregateCallWeighting],
  );
  const aggFc = useMemo(() => poolAggregate(deskAggFc, aggCall, meanFit), [deskAggFc, aggCall, meanFit]);
  /* Work-on never sends you to study a subject you have dropped. */
  const signals = useMemo(
    () => advise(booked.filter((s) => s.quant).map((s) => ({ sub: s.sub, quant: s.quant!, entries: s.entries })), todayStr(), cal),
    [booked, cal],
  );
  const session = sessionInfo(clockNow);

  /* DERIVATION MODE: one board-wide switch that underlines every figure with
     mathematics behind it. Read here so the shell can flag it, and stamped on
     <body> so the CSS can light every trigger without a re-render per node. */
  const deriveMode = useSyncExternalStore(subscribeDerivationMode, derivationModeOn, derivationModeOff);
  useEffect(() => {
    document.body.dataset.derive = deriveMode ? "1" : "0";
  }, [deriveMode]);

  /* One shared derivation context: the book-level facts every research note
     may need. Views clone it with their own `stat` before handing it down. */
  const selfStakes = useMemo(() => {
    if (!data) return {};
    const out: Record<string, NonNullable<Upcoming["selfPred"]>> = {};
    for (const [id, u] of stakedSittings(data.upcoming ?? [], data.entries, todayStr())) {
      if (u.selfPred) out[id] = u.selfPred;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.upcoming, data?.entries]);
  const deriveCtx = useMemo<DeriveCtx>(
    () => ({
      stats: booked, index, forecast: aggFc, depthModel: depth, signals,
      settings: data?.settings, selfPool: selfFit, selfStakes,
      signalReads, signalFit, voi,
    }),
    [booked, index, aggFc, depth, signals, data?.settings, selfFit, selfStakes, signalReads, signalFit, voi],
  );

  /* keyboard: Ctrl+K palette; bare 1–5 tabs, N log-result, D delisted,
     Shift+D the derivation layer — all only when not typing */
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      // Shift+D reaches the whole terminal, drawer included: the drawer is
      // where most of the mathematics is, so locking it out would be perverse.
      if (e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        toggleDerivationMode();
        return;
      }
      if (paletteOpen || modal || drawerId) return;
      // Shift is a modifier here, not a bare key: Shift+N was opening the log
      // ticket, and Shift+D already means something else entirely.
      if (e.shiftKey) return;
      const i = Number(e.key);
      if (i >= 1 && i <= TABS.length) setView(TABS[i - 1].id);
      else if (e.key.toLowerCase() === "n") setModal({ type: "grade" });
      else if (e.key.toLowerCase() === "d") setShowDelisted((s) => !s);
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [paletteOpen, modal, drawerId]);

  /* One desk that split without its history splitting with it makes every
     cross-desk figure count that history once per successor. Detection is
     conservative — three identical prints minimum — and never acts on its own.
     Stays above the loading gate: every hook must run on both passes. */
  const splits = useMemo(
    () => (data ? detectSplits(data.subjects, data.entries, data.settings.ignoredSplits ?? []) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.subjects, data?.entries, data?.settings.ignoredSplits],
  );

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg, fontFamily: FONT.mono }}>
        <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: C.faint }}>OPENING THE EXCHANGE…</div>
      </div>
    );
  }

  const { subjects, entries, settings } = data;
  const update = (patch: Partial<AppData>) => setData((d) => (d ? { ...d, ...patch } : d));

  const mergeSplit = (ticker: string, name: string) => {
    setData((d) => (d && splits[0] ? applySplit(d, splits[0], ticker, name) : d));
  };
  const dismissSplit = () => {
    if (!data || !splits[0]) return;
    update({
      settings: {
        ...data.settings,
        ignoredSplits: [...(data.settings.ignoredSplits ?? []), splits[0].key],
      },
    });
  };

  const addSubject = (sub: Subject) => { update({ subjects: [...subjects, sub] }); setModal(null); };
  const saveGrade = (entry: GradeEntry) => {
    const prior = entries.find((e) => e.id === entry.id);
    const exists = prior != null;
    // B2 review finding: re-filing a print under a different desk is a
    // plausible correction (the SUBJECT select is live on edit), but the
    // entry keeps its id while its topic marks' dual FK (io.ts's
    // sanitizeTopicMark) now disagrees on subject — so those marks would be
    // dropped SILENTLY on the next load. Dropping them HERE, in the same
    // write, is the honest version: the student sees it happen at the
    // moment of the edit (GradeModal's own inline warning), not three days
    // later with no explanation.
    const subjectChanged = prior != null && prior.subjectId !== entry.subjectId;
    update({
      entries: exists ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry],
      ...(subjectChanged
        ? { topicMarks: (data.topicMarks ?? []).filter((m) => m.entryId !== entry.id) }
        : {}),
    });
    setModal(null);
  };
  const deleteEntry = (id: string) => update({ entries: entries.filter((e) => e.id !== id) });

  /* The forward calendar + behavioural layer. Ids and the clock enter only here
     (App is the one place a real "now" is allowed), so the pure libs stay
     deterministic. Allocations upsert by round; sittings/duels/calls append. */
  const upcoming = data.upcoming ?? [];
  const saveSitting = (u: Upcoming) => {
    const exists = upcoming.some((x) => x.id === u.id);
    update({ upcoming: exists ? upcoming.map((x) => (x.id === u.id ? u : x)) : [...upcoming, u] });
    setModal(null);
  };
  const deleteSitting = (id: string) => update({ upcoming: upcoming.filter((u) => u.id !== id) });
  const recordDuel = (aId: string, bId: string, winnerId: string) =>
    update({ duels: [...(data.duels ?? []), { id: uid(), aId, bId, winnerId, createdAt: todayStr() }] });
  /* The readiness pile is an opinion, not a measurement: once it has gone stale
     — a term turns, the desks are not the ones you rated — the honest move is to
     drop it whole rather than let old answers keep voting. One answer at a time
     is the other half of that: a mis-click is a correction, not a surrender. */
  const resetDuels = () => update({ duels: [] });
  /* Every elicited row is removable, one row at a time, wherever it is listed —
     the card that took it and the data ledger both come through here. */
  const removeItem = (section: SectionKey, id: string) =>
    setData((d) => (d ? removeFromBook(d, section, id) : d));
  const clearBookSection = (section: SectionKey) =>
    setData((d) => (d ? clearSection(d, section) : d));
  const saveAllocation = (rKey: string, draft: AllocationDraft) => {
    const list = data.allocations ?? [];
    const prev = list.find((a) => a.roundKey === rKey);
    const next = {
      id: prev?.id ?? `alloc-${rKey}`, roundKey: rKey,
      total: draft.total, hoursPerWeek: draft.hoursPerWeek, planned: draft.planned,
      createdAt: prev?.createdAt ?? todayStr(),
      ...(draft.actual && Object.keys(draft.actual).length ? { actual: draft.actual } : {}),
    };
    update({ allocations: prev ? list.map((a) => (a.roundKey === rKey ? next : a)) : [...list, next] });
  };
  /* Absent means ON, so the flags are only ever stored when switched off. */
  const setPricing = (key: keyof Settings) => (on: boolean) =>
    update({ settings: { ...data.settings, [key]: on ? undefined : false } });
  const setEffortWeighting = setPricing("effortWeighting");
  const setSelfWeighting = setPricing("selfWeighting");
  const setReadinessWeighting = setPricing("readinessWeighting");
  const setAggregateCallWeighting = setPricing("aggregateCallWeighting");
  const setSignalWeighting = setPricing("signalWeighting");
  /* The wire's switch is the inverse of the factory above — absent means OFF,
     stored only when switched on — so it is written by hand, not through it. */
  const setAiWeighting = (on: boolean) =>
    update({ settings: { ...data.settings, aiWeighting: on ? true : undefined } });
  /* Calls APPEND, never overwrite. A revision made after the desk printed its
     own number is the most informative thing on the card — losing the call it
     revised would erase exactly the comparison worth keeping. */
  const saveMeanCall = (rKey: string, predAvg: number, ranking: string[]) =>
    update({ meanCalls: [...(data.meanCalls ?? []), { id: uid(), roundKey: rKey, predAvg, ranking, createdAt: todayStr() }] });
  /* THE QUICK-LOG PANELS (§D5, T16). Three discrete events, file-on-submit —
     the panel hands back only the values a student typed or picked; the id
     is struck here, the one place `uid()` is allowed. Every date below is a
     value the STUDENT chose in the panel (each defaults to today, or to
     last night for rest — see LogPanels.tsx's own doc comment for why —
     but is always editable), never `todayStr()` read fresh in this handler:
     a backfilled session or a delayed rest log must file under the day it
     actually describes, not the day it was typed. */
  const logSession = (subjectId: string, date: string, minutes: number, kind: SessionKind, topicIds: string[]) => {
    const session: StudySession = {
      id: uid(), subjectId, date, minutes, kind,
      ...(topicIds.length ? { topicIds } : {}),
    };
    update({ sessions: [...(data.sessions ?? []), session] });
  };
  /* Rest is DEDUPED BY DATE (io.ts's own sanitizer convention, mirrored here
     so the same-night replace is true within a session too, not just after
     the next reload's re-sanitize): a resubmit for the same night replaces
     the existing row outright rather than appending a second reading for
     one night. */
  const logRest = (date: string, hours: number, bedtime: string | null) => {
    const rest: RestLog = { id: uid(), date, hours, ...(bedtime ? { bedtime } : {}) };
    update({ rest: [...(data.rest ?? []).filter((r) => r.date !== date), rest] });
  };
  const logDisruption = (date: string, kind: DisruptionKind, days: number | null, note: string | null) => {
    const disruption: Disruption = {
      id: uid(), date, kind, ...(days != null ? { days } : {}), ...(note ? { note } : {}),
    };
    update({ disruptions: [...(data.disruptions ?? []), disruption] });
  };
  /* TOPIC ADD/EDIT (T17) — file-on-submit, LogPanels' own discipline (T16):
     the panel hands back only the values a student typed or picked; the id
     for a NEW topic is struck here, the one place `uid()` is allowed. Editing
     carries the topic's own, already-known id — nothing here re-generates it. */
  const addTopic = (subjectId: string, name: string, weightPct: number | null, prereqIds: string[]) => {
    const topic: Topic = {
      id: uid(), subjectId, name, ...(weightPct != null ? { weightPct } : {}), ...(prereqIds.length ? { prereqIds } : {}),
    };
    update({ topics: [...(data.topics ?? []), topic] });
  };
  const editTopic = (topicId: string, name: string, weightPct: number | null, prereqIds: string[]) =>
    update({
      topics: (data.topics ?? []).map((t) => {
        if (t.id !== topicId) return t;
        const { weightPct: _w, prereqIds: _p, ...rest } = t;
        return { ...rest, name, ...(weightPct != null ? { weightPct } : {}), ...(prereqIds.length ? { prereqIds } : {}) };
      }),
    });
  /* TRAITS/PROFILE EDITOR (T17) — draft-then-commit sliders file exactly ONE
     book write per commit (TraitsEditor.tsx's own doc comment), never one per
     drag frame. `saveSubjectTraits` patches one desk's shape priors in the
     SAME `update()` call that also files a profile change would use, so
     dragging ANY one control on the panel is still exactly one `setData`.
     `patch` (T17 review fix) carries only the group(s) the student actually
     dragged since the last commit — traits/mix/belief/attendancePct are each
     OPTIONAL, and a key that is absent is left exactly as it was on the
     subject. Writing all four unconditionally would stamp DEFAULT_TRAITS/
     DEFAULT_MIX/DEFAULT_ATTENDANCE onto three priors the student never
     touched, and the mastery engine treats "never set" and "set to a neutral
     default" as different states (mastery.ts's prereq gate, params.ts's
     halfLifeOf), so that silent stamp would measurably move the desk's
     priced mastery term. */
  const saveSubjectTraits = (sid: string, patch: SubjectTraitsPatch) =>
    update({
      subjects: subjects.map((s) => {
        if (s.id !== sid) return s;
        const next = { ...s };
        if (patch.traits !== undefined) next.traits = patch.traits;
        if (patch.mix !== undefined) next.mix = patch.mix;
        if (patch.belief !== undefined) next.belief = patch.belief;
        if (patch.attendancePct !== undefined) next.attendancePct = patch.attendancePct;
        return next;
      }),
    });
  const saveProfile = (profile: Profile) => update({ settings: { ...data.settings, profile } });
  const setTarget = (sid: string, target: number | null) =>
    update({ subjects: subjects.map((s) => (s.id === sid ? { ...s, target } : s)) });
  const setCourseworkPct = (sid: string, courseworkPct: number | null) =>
    update({ subjects: subjects.map((s) => (s.id === sid ? { ...s, courseworkPct } : s)) });
  const archiveSubject = (sid: string) => {
    update({ subjects: subjects.map((s) => (s.id === sid ? { ...s, archived: true } : s)) });
    setDrawerId(null);
  };
  /* Relisting is refused for a desk whose successor has already printed: the
     successor carries that tape now, and seating both counts every print behind
     the split twice, in the aggregate and in every cross-desk figure. The drawer
     explains this in place of the button, but the rule lives here too — the
     invariant that would have caught it (`assertRoster`) is compiled out of a
     production build, so it can only ever warn a developer, never a student. */
  const restoreSubject = (sid: string) => {
    const sub = subjects.find((s) => s.id === sid);
    if (!sub || supersededBy(sub, subjects, entries)) return;
    update({
      subjects: subjects.map((s) => {
        if (s.id !== sid) return s;
        const { archived: _a, ...rest } = s;
        return rest;
      }),
    });
  };
  const deleteSubject = (sid: string) => {
    update({
      // A successor still pointing at a deleted ancestor prices off a tape that
      // no longer exists, and the guard that would catch it is compiled out of
      // a production build — so it fails silently, on the board, forever.
      // `parseImport` already cuts dangling pointers; deletion has to as well.
      subjects: subjects
        .filter((s) => s.id !== sid)
        .map((s) => (s.formerly === sid ? { ...s, formerly: null } : s)),
      entries: entries.filter((e) => e.subjectId !== sid),
      // B3 review finding: the dead desk's topics and sessions stayed in
      // state after this cascade — surviving in the Data Ledger under an
      // empty ticker, in an export taken before reload, and vanishing only
      // on the NEXT load (io.ts's sanitizer cuts them then, same as it
      // always would have). Same one-line-per-slice fix the entries filter
      // already gets, applied at the moment of deletion rather than three
      // days later.
      topics: (data.topics ?? []).filter((t) => t.subjectId !== sid),
      sessions: (data.sessions ?? []).filter((s) => s.subjectId !== sid),
    });
    setDrawerId(null);
  };
  const saveSettings = (s: Settings) => update({ settings: s });
  const startFresh = () => {
    setData(freshBook());
    setDrawerId(null);
    setModal(null);
  };
  const doReplace = (p: ImportPayload) => { setData(replaceData(p)); setModal(null); setDrawerId(null); };
  const doMerge = (p: ImportPayload) => { setData((d) => (d ? mergeData(d, p) : d)); setModal(null); };

  const commands: Command[] = [
    ...TABS.map((t, i) => ({ id: "go-" + t.id, label: `GO TO ${t.label}`, hint: String(i + 1), run: () => setView(t.id) })),
    { id: "log", label: "LOG RESULT", hint: "N", run: () => setModal({ type: "grade" }) },
    { id: "sitting", label: "SCHEDULE A SITTING — FORWARD CALENDAR", run: () => setModal({ type: "sitting" }) },
    { id: "list", label: "LIST SUBJECT", run: () => setModal({ type: "subject" }) },
    { id: "settings", label: "DESK SETTINGS · DATA", run: () => setModal({ type: "settings" }) },
    { id: "wire", label: "IMPORT VIA AI — THE WIRE", run: () => setModal({ type: "wire" }) },
    { id: "wtd", label: `WEIGHTED AVERAGES ${settings.weighted ? "OFF" : "ON"}`, run: () => saveSettings({ ...settings, weighted: !settings.weighted }) },
    {
      id: "derive",
      label: `DERIVATION MODE ${deriveMode ? "OFF" : "ON"} — SHOW THE MATHEMATICS`,
      hint: "⇧D",
      run: toggleDerivationMode,
    },
    ...(delisted.length
      ? [{
          id: "delisted",
          label: `${showDelisted ? "HIDE" : "SHOW"} ${delisted.length} DELISTED DESK${delisted.length === 1 ? "" : "S"}`,
          hint: "D",
          run: () => setShowDelisted((s) => !s),
        }]
      : []),
    /* Every desk is quotable from the palette, closed ones included — the
       fastest way to review a book you no longer trade. */
    ...stats.map((s) => ({
      id: "q-" + s.sub.id,
      label: `QUOTE ${s.sub.ticker} — ${s.sub.name}${s.sub.archived ? " · DELISTED" : ""}`,
      run: () => setDrawerId(s.sub.id),
    })),
  ];

  const drawerStat = drawerId ? stats.find((s) => s.sub.id === drawerId) : null;
  /* The picker quotes the live book — but an EDIT must always contain the desk
     the entry already belongs to. A delisted desk still shows its tape in the
     drawer and its prints in the blotter, and both offer edit; hand the modal a
     roster without that desk and the <select> holds a value with no matching
     <option>, so it silently displays somebody else's subject. */
  const editEntry = modal?.type === "grade" ? modal.entry : undefined;
  const editSub = editEntry ? subjects.find((s) => s.id === editEntry.subjectId) : undefined;
  const gradeSubs = editSub && !liveSubs.some((s) => s.id === editSub.id) ? [...liveSubs, editSub] : liveSubs;
  /* Same rule for the sitting picker: an edited sitting on a delisted desk must
     keep that desk in the roster so its <select> resolves. */
  const editSitting = modal?.type === "sitting" ? modal.sitting : undefined;
  const sittingSub = editSitting ? subjects.find((s) => s.id === editSitting.subjectId) : undefined;
  const sittingSubs = sittingSub && !liveSubs.some((s) => s.id === sittingSub.id) ? [...liveSubs, sittingSub] : liveSubs;
  /* Two clocks, both true: the term the school is TEACHING and the term now
     TAKING results. In the opening weeks of a term they disagree, and saying
     so is the whole point — "T3 · WK 1 · FILING T2" is the honest read. */
  const teaching = teachingTermOf(todayStr(), cal);
  const filing = currentTermKey(cal);

  return (
    <div className="min-h-screen pb-10" style={{ background: C.bg, color: C.text, fontFamily: FONT.display }}>
      {/* The tape quotes the live book only — a closed desk has no bid. */}
      {booked.some((s) => s.quant) && (
        <TickerTape stats={booked} agg={agg} forecast={aggFc} composite={index} depth={depth} phase={session.phase} />
      )}

      <div className="max-w-6xl mx-auto px-3 sm:px-5">
        <header className="flex flex-wrap items-end justify-between gap-3 pt-5 pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight leading-none uppercase" style={{ fontFamily: FONT.display }}>
              GRADE<span style={{ color: C.amber }}>·</span>EXCHANGE<span className="gx-cursor" aria-hidden="true" />
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1" style={{ ...microLabel, color: C.faint }}>
              <span>
                T{teaching.ref.term} {teaching.ref.year}
                {teaching.week != null ? ` · WK ${teaching.week}` : " · BREAK"}
                {filing.key !== `${teaching.ref.year}-T${teaching.ref.term}` ? ` · FILING ${filing.label}` : ""}
                {" · "}
                <span style={{ color: PHASE_COLOR[session.phase] }}>● {session.label}</span> · SUBJECTS TRADED LIKE A BOOK
              </span>
              {delisted.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{delisted.length} DELISTED</span>
                  <button
                    onClick={() => setShowDelisted((s) => !s)}
                    className="gx-focus border px-1.5 py-0.5 hover:brightness-125"
                    style={{
                      ...microLabel,
                      fontSize: 9,
                      color: showDelisted ? C.amber : C.faint,
                      borderColor: showDelisted ? C.amber : C.lineBright,
                      background: showDelisted ? "rgba(232,163,61,0.1)" : "transparent",
                    }}
                    aria-pressed={showDelisted}
                    title="Closed desks still price the book — this only draws them (D)"
                  >
                    {showDelisted ? "HIDE" : "SHOW"}
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Btn onClick={() => setModal({ type: "subject" })}><Plus size={12} /> Subject</Btn>
            {live.length > 0 && (
              <Btn variant="primary" onClick={() => setModal({ type: "grade" })}><Plus size={12} /> Log result</Btn>
            )}
            {/* No roster precondition — an empty book is the wire's best customer. */}
            <Btn
              className="gx-wire-btn"
              onClick={() => setModal({ type: "wire" })}
              style={{ color: C.accent, borderColor: C.accent, background: "rgba(83,177,253,0.10)" }}
            >
              <Radio size={12} /> AI import
            </Btn>
            <Btn onClick={() => setModal({ type: "settings" })} aria-label="Desk settings"><Settings2 size={13} /></Btn>
          </div>
        </header>

        {live.length > 0 && (
          <AggregateBand
            agg={agg}
            forecast={aggFc}
            history={examHist}
            pending={pending}
            onOpenSubject={setDrawerId}
            deriveCtx={deriveCtx}
          />
        )}

        {/* Keyed on the plan: the banner seeds its ticker/name fields from the
            plan ONCE, so resolving one split and dropping straight into the next
            would otherwise carry the first ancestor's name onto the second. */}
        {splits[0] && (
          <SplitBanner
            key={splits[0].key}
            plan={splits[0]}
            topicMarkLoss={splitTopicMarkLoss(splits[0], data.entries, data.topicMarks)}
            onMerge={mergeSplit}
            onDismiss={dismissSplit}
          />
        )}

        {/* NOTHING IS BEING KEPT. `setItem` does not only throw on a full
            quota: Safari in private browsing, and any browser with site data
            blocked, throw on every write. The terminal goes on working
            perfectly in that state — the board prices, results log — and all of
            it dies with the tab. The status strip's one cell said "SAVE RETRY",
            which was both easy to miss and untrue; nothing retries. So say it
            in a sentence, and offer the only thing that survives: a file. */}
        {saveErr && (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border px-3 py-2 mb-4 text-[11px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(224,102,46,0.08)", borderColor: C.down, color: C.down, fontFamily: FONT.mono }}
            role="alert"
          >
            <span>
              THIS BROWSER IS REFUSING TO STORE THE BOOK — YOUR RESULTS ARE NOT BEING SAVED AND WILL GO WHEN THE TAB CLOSES.
            </span>
            <button
              onClick={() => downloadText(`grade-exchange-${todayStr()}.json`, serializeExport(data))}
              className="gx-focus underline"
            >
              DOWNLOAD MY BOOK
            </button>
          </div>
        )}

        {/* A book that would not parse was set aside rather than overwritten.
            Hand it back as a file — it is unreadable to this app but a human,
            or a later build, can still get results out of raw JSON. */}
        {rescue && (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border px-3 py-2 mb-4 text-[11px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(224,102,46,0.08)", borderColor: C.down, color: C.down, fontFamily: FONT.mono }}
          >
            <span>A PREVIOUS BOOK COULDN'T BE READ AND WAS SET ASIDE, NOT DELETED.</span>
            <button
              onClick={() => downloadText("grade-exchange-recovered.json", rescue)}
              className="gx-focus underline"
            >
              DOWNLOAD IT
            </button>
            <button
              onClick={() => { clearQuarantine(); setRescue(null); }}
              className="gx-focus"
              style={{ color: C.faint }}
            >
              DISCARD
            </button>
          </div>
        )}

        {data.sample && (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border px-3 py-2 mb-4 text-[11px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(232,163,61,0.07)", borderColor: "rgba(232,163,61,0.35)", color: C.amber, fontFamily: FONT.mono }}
          >
            <span>DEMO BOOK LOADED — SAMPLE DATA SO EVERY PANEL HAS A PULSE.</span>
            <button onClick={startFresh} className="gx-focus underline">CLEAR IT — TRADE MY OWN SUBJECTS</button>
            <button onClick={() => update({ sample: false })} className="gx-focus" style={{ color: "#A8873F" }}>KEEP EXPLORING</button>
          </div>
        )}

        {live.length > 0 && liveEntryCount === 0 && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 border px-3 py-2.5 mb-4"
            style={{ background: C.panel, borderColor: C.line }}
          >
            <span style={{ ...microLabel, color: C.dim }}>
              {live.length} DESK{live.length === 1 ? "" : "S"} LISTED — EVERY LINE OPENS WITH ITS FIRST PRINT.
            </span>
            <Btn variant="primary" onClick={() => setModal({ type: "grade" })}><Plus size={12} /> Log a result (N)</Btn>
          </div>
        )}

        <nav className="flex gap-0.5 border-b mb-4 overflow-x-auto" style={{ borderColor: C.line }} aria-label="Views">
          {TABS.map((t, i) => {
            const active_ = view === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className="gx-focus flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold tracking-[0.12em] whitespace-nowrap border-b-2 -mb-px transition-colors"
                style={{ fontFamily: FONT.mono, color: active_ ? C.amber : C.faint, borderColor: active_ ? C.amber : "transparent" }}
                aria-current={active_ ? "page" : undefined}
              >
                {/* C.line here rendered the keyboard hint at 1.29:1 — below
                    even the 3:1 non-text floor, i.e. invisible. */}
                <span style={{ color: active_ ? C.amber : C.faint }}>{i + 1}</span>·{t.label}
              </button>
            );
          })}
        </nav>

        {/* Every view rendered outside any landmark, so screen-reader users had
            no way to jump to the content. */}
        <main>
        {visible.length === 0 ? (
          <div className="border p-10 sm:p-14 text-center" style={{ background: C.panel, borderColor: C.line }}>
            <TerminalSquare size={30} className="mx-auto mb-3" style={{ color: C.faint }} />
            <h2 className="text-lg font-black tracking-tight uppercase mb-1" style={{ fontFamily: FONT.display }}>The floor is quiet</h2>
            <p className="text-xs mb-5 max-w-md mx-auto uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
              {stats.length === 0
                ? "List a subject to open the exchange. Every result logged becomes a print on its line."
                : `Every desk on this book is delisted. The prints are all still here — draw them, or list a new subject.`}
            </p>
            <div className="flex items-center justify-center gap-2">
              <Btn variant="primary" onClick={() => setModal({ type: "subject" })}><Plus size={12} /> List a subject</Btn>
              {/* The demo book REPLACES subjects and entries, and the save effect
                  persists it before you can blink. "Nothing visible" is not
                  "nothing here" — a book whose desks are all delisted is a full
                  book — so this only ever appears when there is truly nothing
                  to destroy. Otherwise the way out is to draw what you have. */}
              {stats.length === 0 ? (
                <Btn onClick={() => setData(makeSample())}><RefreshCw size={12} /> Load demo book</Btn>
              ) : (
                <Btn onClick={() => setShowDelisted(true)}>
                  <RefreshCw size={12} /> Show {delisted.length} delisted desk{delisted.length === 1 ? "" : "s"}
                </Btn>
              )}
            </div>
          </div>
        ) : (
          <div className="gx-fade" key={view}>
            {view === "overview" && (
              <Overview
                stats={visible}
                booked={booked}
                index={index}
                history={compHist}
                depth={depth}
                signals={signals}
                delistedCount={delisted.length}
                showDelisted={showDelisted}
                onToggleDelisted={() => setShowDelisted((s) => !s)}
                onOpenSubject={setDrawerId}
                onAddSubject={() => setModal({ type: "subject" })}
                onOpenSettings={() => setModal({ type: "settings" })}
                onOpenCharts={() => setView("charts")}
                deriveCtx={deriveCtx}
              />
            )}
            {view === "charts" && (
              <Charts subjects={visibleSubs} entries={visibleEntries} settings={settings} onOpenSubject={setDrawerId} deriveCtx={deriveCtx} />
            )}
            {view === "compare" && <Compare stats={visible} settings={settings} onOpenSubject={setDrawerId} deriveCtx={deriveCtx} />}
            {view === "screener" && <Screener stats={visible} onOpenSubject={setDrawerId} deriveCtx={deriveCtx} />}
            {view === "blotter" && (
              <Blotter
                subjects={visibleSubs}
                entries={visibleEntries}
                calendar={cal}
                onEdit={(e) => setModal({ type: "grade", entry: e })}
                onDelete={deleteEntry}
              />
            )}
            {view === "scoreboard" && (
              <Scorecard
                data={data}
                stats={booked}
                signals={signals}
                todayIso={todayStr()}
                roundKey={filing.key}
                forecastRoundKey={pending?.key ?? filing.key}
                deskForecast={deskAggFc}
                onAddSitting={() => setModal({ type: "sitting" })}
                onEditSitting={(u) => setModal({ type: "sitting", sitting: u })}
                onDeleteSitting={deleteSitting}
                onRecordDuel={recordDuel}
                onResetDuels={resetDuels}
                onRemoveDuel={(id) => removeItem("duels", id)}
                rawStats={rawStats}
                selfFit={selfFit}
                selfOn={data.settings.selfWeighting !== false}
                aiFit={aiFit}
                aiOn={data.settings.aiWeighting === true}
                aiCharge={aiCharge}
                onSetAiWeighting={setAiWeighting}
                readyFit={readyFit}
                meanFit={meanFit}
                onSaveAllocation={saveAllocation}
                onSetEffortWeighting={setEffortWeighting}
                onSetSelfWeighting={setSelfWeighting}
                onSetReadinessWeighting={setReadinessWeighting}
                onSetAggregateCallWeighting={setAggregateCallWeighting}
                onSaveMeanCall={saveMeanCall}
                onRemoveMeanCall={(id) => removeItem("meanCalls", id)}
                onOpenSubject={setDrawerId}
                deriveCtx={deriveCtx}
              />
            )}
            {view === "signals" && (
              <Signals
                stats={visible}
                entries={data.entries}
                signalBook={signalBook}
                signalReads={signalReads}
                modelMeans={modelMeans}
                signalFit={signalFit}
                signalChannels={signalChannels}
                signalOn={data.settings.signalWeighting !== false}
                todayIso={todayStr()}
                voi={voi}
                onSetSignalWeighting={setSignalWeighting}
                onOpenSubject={setDrawerId}
                onLogSession={logSession}
                onLogRest={logRest}
                onLogDisruption={logDisruption}
                onAddTopic={addTopic}
                onEditTopic={editTopic}
                profile={data.settings.profile ?? null}
                onSaveTraits={saveSubjectTraits}
                onSaveProfile={saveProfile}
                deriveCtx={deriveCtx}
              />
            )}
          </div>
        )}
        </main>

        <footer className="mt-8 pb-4 text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
          Scores out of 100 · results file against the term they examine, not the date they land · prices are model estimates, not certainties · data lives in this browser — export from settings to back it up.
        </footer>
      </div>

      <StatusBar
        subjects={live.length}
        entries={liveEntryCount}
        delisted={delisted.length}
        weighted={settings.weighted}
        saveErr={saveErr}
        calendar={cal}
      />

      {drawerStat && (
        <Drawer
          key={drawerId}
          stat={drawerStat}
          settings={settings}
          deriveCtx={deriveCtx}
          onClose={() => setDrawerId(null)}
          onSetTarget={setTarget}
          onSetCourseworkPct={setCourseworkPct}
          onArchiveSubject={archiveSubject}
          onRestoreSubject={restoreSubject}
          succeededBy={drawerStat.sub.archived ? supersededBy(drawerStat.sub, subjects, entries) : null}
          onDeleteSubject={deleteSubject}
          onAddGrade={(sid) => setModal({ type: "grade", subjectId: sid })}
          onEditEntry={(e) => setModal({ type: "grade", entry: e })}
        />
      )}
      {modal?.type === "subject" && <SubjectModal subjects={subjects} onSave={addSubject} onClose={() => setModal(null)} />}
      {/* Delisted desks are absent from the picker for a NEW result: that IS the
          "not updated" rule. This branch must never render nothing — an open
          modal state with no modal on screen swallows Escape and every bare
          shortcut below, and there is no way left to clear it. */}
      {modal?.type === "grade" && (
        gradeSubs.length > 0 ? (
          <GradeModal
            subjects={gradeSubs}
            entry={modal.entry}
            defaultSubjectId={modal.subjectId}
            calendar={cal}
            topicMarkCount={modal.entry ? (data.topicMarks ?? []).filter((m) => m.entryId === modal.entry!.id).length : 0}
            onSave={saveGrade}
            onClose={() => setModal(null)}
          />
        ) : (
          <Modal title="LOG A RESULT" onClose={() => setModal(null)}>
            <div className="space-y-4">
              <p className="text-[11px] uppercase tracking-wider leading-relaxed" style={{ color: C.dim, fontFamily: FONT.mono }}>
                {delisted.length > 0
                  ? "Every desk on this book is delisted. Relist one, or list a new subject, before logging a result against it."
                  : "No subject is listed yet — a result has to print on a line. List a subject first."}
              </p>
              <div className="flex justify-end gap-2">
                <Btn onClick={() => setModal(null)}>Cancel</Btn>
                <Btn variant="primary" onClick={() => setModal({ type: "subject" })}><Plus size={12} /> List a subject</Btn>
              </div>
            </div>
          </Modal>
        )
      )}
      {modal?.type === "sitting" && (
        sittingSubs.length > 0 ? (
          <SittingModal
            subjects={sittingSubs}
            sitting={modal.sitting}
            defaultSubjectId={modal.subjectId}
            onSave={saveSitting}
            onClose={() => setModal(null)}
          />
        ) : (
          <Modal title="SCHEDULE A SITTING" onClose={() => setModal(null)}>
            <div className="space-y-4">
              <p className="text-[11px] uppercase tracking-wider leading-relaxed" style={{ color: C.dim, fontFamily: FONT.mono }}>
                No subject is listed yet — a sitting has to sit on a desk. List a subject first.
              </p>
              <div className="flex justify-end gap-2">
                <Btn onClick={() => setModal(null)}>Cancel</Btn>
                <Btn variant="primary" onClick={() => setModal({ type: "subject" })}><Plus size={12} /> List a subject</Btn>
              </div>
            </div>
          </Modal>
        )
      )}
      {modal?.type === "settings" && (
        <SettingsModal
          data={data}
          depth={depth}
          onSaveSettings={saveSettings}
          onReplace={doReplace}
          onMerge={doMerge}
          onClearAll={startFresh}
          onRestoreSubject={restoreSubject}
          onDeleteSubject={deleteSubject}
          onRemoveItem={removeItem}
          onClearSection={clearBookSection}
          onOpenWire={() => setModal({ type: "wire" })}
          onClose={() => setModal(null)}
        />
      )}
      {/* The wire needs no roster precondition — an empty book is a valid
          intake target — so this branch always puts a modal on screen. */}
      {modal?.type === "wire" && (
        <WireModal data={data} onReplace={doReplace} onMerge={doMerge} onClose={() => setModal(null)} />
      )}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
