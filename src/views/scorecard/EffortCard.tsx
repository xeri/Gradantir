import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eraser, Pin, SlidersHorizontal } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { Btn } from "../../components/ui/Btn";
import { PricedBanner } from "../../components/ui/PricedBanner";
import { Card, Derived } from "./Card";
import { fmt1, signed } from "./format";
import { PREMIUM_CAPS } from "../../lib/quant/mark";
import {
  DEFAULT_HOURS_PER_WEEK, allocationGap, axisMaxFor, hoursToTokens, rebalance, renormalize,
  suggestAllocation, tokensToHours, type AllocationDraft, type WaterFill,
} from "../../lib/allocate";
import { SpiderAllocator, type Ring, type SpiderAxis } from "../../components/SpiderAllocator";
import { clamp, round1 } from "../../lib/utils";
import type { DeriveCtx, EffortFacts } from "../../lib/derive";
import type { Allocation, Signal } from "../../types";

const ALLOC_TOTAL = 100;

function Bars({ split, total, tickerOf, colorOf }: { split: Record<string, number>; total: number; tickerOf: (id: string) => string; colorOf: (id: string) => string }) {
  const ids = Object.keys(split).sort((a, b) => split[b] - split[a]);
  return (
    <div className="space-y-1">
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-2">
          <span className="w-12 text-[11px] font-bold shrink-0" style={{ color: C.text, fontFamily: FONT.mono }}>{tickerOf(id)}</span>
          <div className="flex-1 h-3 border" style={{ borderColor: C.line, background: C.strip }}>
            <div className="h-full transition-[width]" style={{ width: `${total ? (split[id] / total) * 100 : 0}%`, background: colorOf(id) }} />
          </div>
          <span className="w-8 text-right text-[11px] tabular-nums" style={{ color: C.dim, fontFamily: FONT.mono }}>{split[id]}</span>
        </div>
      ))}
    </div>
  );
}

/** The editable state of the card, held locally so a drag never touches storage. */
interface EffortDraft {
  plan: Record<string, number>;
  actual: Record<string, number> | null;
  hoursPerWeek: number;
}

const inputStyle = { background: C.panel2, borderColor: C.line, color: C.text, fontFamily: FONT.mono } as const;

/** One hour figure, committed on blur or Enter rather than on every keystroke. */
function HourBox({
  value, onCommit, label, tone = C.text, placeholder,
}: {
  /** null when nothing is recorded yet — an unfilled box, not a recorded zero. */
  value: number | null;
  onCommit: (v: number) => void;
  label: string;
  tone?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const settle = () => {
    const raw = text;
    setText(null);
    if (raw == null || raw.trim() === "") return;
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0) onCommit(v);
  };
  return (
    <input
      type="number" min="0" step="0.5" inputMode="decimal"
      value={text ?? (value == null ? "" : value.toFixed(1))}
      onChange={(e) => setText(e.target.value)}
      onBlur={settle}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setText(null); }}
      className="gx-focus w-16 border px-1.5 py-0.5 text-[11px] text-right tabular-nums rounded-none"
      style={{ ...inputStyle, color: tone }}
      aria-label={label}
      placeholder={placeholder}
    />
  );
}

export function EffortCard({
  signals, roundKey, allocation, effortOn, tickerOf, colorOf, onSave, onSetEffortWeighting, dctx,
}: {
  signals: Signal[];
  roundKey: string;
  allocation: Allocation | null;
  /** Whether the budget is priced into the mark at all — the card's own switch. */
  effortOn: boolean;
  tickerOf: (id: string) => string;
  colorOf: (id: string) => string;
  onSave: (roundKey: string, draft: AllocationDraft, note?: string) => void;
  onSetEffortWeighting: (on: boolean) => void;
  dctx?: DeriveCtx;
}) {
  /* Axes are sorted by ticker, not by pressure: a spider whose spokes swapped
     places as the priorities moved would be unreadable across two visits. */
  const axes: SpiderAxis[] = useMemo(
    () => signals.map((s) => ({ id: s.id, label: tickerOf(s.id), color: colorOf(s.id) }))
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signals],
  );
  const ids = axes.map((a) => a.id);
  /* The recommendation AND the solve behind it: §24 quotes the λ this week
     actually cleared rather than reverse-engineering one from the split. */
  const { suggested, fill } = useMemo(() => {
    const solve: WaterFill = { lambda: 0, active: [], flat: false };
    const split = suggestAllocation(signals.map((s) => ({ id: s.id, priority: s.priority })), ALLOC_TOTAL, solve);
    return { suggested: split, fill: solve };
  }, [signals]);

  const [draft, setDraft] = useState<EffortDraft | null>(null);
  const draftRef = useRef<EffortDraft | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [armed, setArmed] = useState<Ring>("plan");
  const [budgetText, setBudgetText] = useState<string | null>(null);
  /* A new reporting term is a new plan — nothing carries over. */
  useEffect(() => {
    setDraft(null); draftRef.current = null;
    setPinned([]); setArmed("plan"); setBudgetText(null);
  }, [roundKey]);

  const filed: EffortDraft = {
    plan: allocation ? renormalize(allocation.planned, ids, ALLOC_TOTAL) : suggested,
    actual: allocation?.actual ? Object.fromEntries(ids.map((id) => [id, Math.max(0, Math.round(allocation.actual![id] ?? 0))])) : null,
    hoursPerWeek: allocation?.hoursPerWeek ?? DEFAULT_HOURS_PER_WEEK,
  };
  const cur = draft ?? filed;
  const axisMax = axisMaxFor(ALLOC_TOTAL, axes.length);
  const hrs = (tok: number) => tokensToHours(tok, ALLOC_TOTAL, cur.hoursPerWeek);

  if (!signals.length) return null;

  /* Local while the pointer is down; filed once it settles. `saveData`
     serialises the whole book on every change, so a live-committed drag would
     write it sixty times a second. */
  const apply = (d: EffortDraft) => { draftRef.current = d; setDraft(d); };
  const file = (d: EffortDraft, note?: string) =>
    onSave(roundKey, { total: ALLOC_TOTAL, hoursPerWeek: d.hoursPerWeek, planned: d.plan, actual: d.actual }, note);
  const commit = (note?: string) => file(draftRef.current ?? cur, note);
  const applyAndFile = (d: EffortDraft, note?: string) => { apply(d); file(d, note); };

  const dragPlan = (plan: Record<string, number>) => apply({ ...cur, plan });
  const dragActual = (actual: Record<string, number>) => apply({ ...cur, actual });

  const setDeskPlanHours = (id: string, h: number) =>
    applyAndFile({ ...cur, plan: rebalance(cur.plan, id, hoursToTokens(h, ALLOC_TOTAL, cur.hoursPerWeek), { total: ALLOC_TOTAL, pinned }) });
  const setDeskActualHours = (id: string, h: number) =>
    applyAndFile({
      ...cur,
      actual: { ...(cur.actual ?? cur.plan), [id]: Math.max(0, Math.round(hoursToTokens(h, ALLOC_TOTAL, cur.hoursPerWeek))) },
    });

  const setBudget = () => {
    const raw = budgetText;
    setBudgetText(null);
    if (raw == null || raw.trim() === "") return;
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    applyAndFile({ ...cur, hoursPerWeek: round1(clamp(v, 0.5, 168)) }, "WEEKLY BUDGET SET");
  };

  /* Arming ACTUAL with nothing recorded seeds it off the plan you drew — the
     honest starting guess is that you did what you meant to. Not filed until
     you touch it, so an untouched seed never scores as zero drift. */
  const arm = (r: Ring) => {
    if (r === "actual" && !cur.actual) apply({ ...cur, actual: { ...cur.plan } });
    setArmed(r);
  };
  /* The way OUT of the actual ring. Most people never time themselves, and a
     half-remembered figure is priced as hard as a measured one — so wiping it
     is a first-class action, not something you reach for the import dialog to
     undo. Drops the drag back to the plan so the card cannot sit armed on a
     ring that no longer exists. */
  const clearActual = () => {
    setArmed("plan");
    applyAndFile({ ...cur, actual: null }, "ACTUAL HOURS CLEARED");
  };
  const togglePin = (id: string) => setPinned((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const gap = allocation ? allocationGap(allocation) : null;
  const plannedWeek = hrs(Object.values(cur.plan).reduce((a, b) => a + b, 0));
  const spentWeek = cur.actual ? hrs(Object.values(cur.actual).reduce((a, b) => a + b, 0)) : null;
  const seeded = !!cur.actual && !allocation?.actual;

  /* The spider's trace, for the two figures on this card the ENGINE produced
     rather than the student: the water-filled recommendation, and the drift
     between the filed plan and the filed actual. Everything the student dragged
     carries no note — a number you typed does not need explaining back to you. */
  const effortFacts: EffortFacts = {
    total: ALLOC_TOTAL,
    hoursPerWeek: cur.hoursPerWeek,
    plan: cur.plan,
    actual: cur.actual,
    model: suggested,
    fill,
    priority: Object.fromEntries(signals.map((s) => [s.id, s.priority])),
    gap,
    tickerOf: Object.fromEntries(axes.map((a) => [a.id, a.label])),
  };
  const effortRef = (subjectId: string) =>
    dctx ? { id: "effort.plan", ctx: { ...dctx, key: subjectId, card: { ...dctx.card, effort: effortFacts } } } : null;

  const ringBtn = (r: Ring, label: string, tone: string) => (
    <button
      onClick={() => arm(r)}
      className="gx-focus border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors"
      style={{
        fontFamily: FONT.mono,
        borderColor: armed === r ? tone : C.lineBright,
        color: armed === r ? tone : C.faint,
        background: armed === r ? `${tone}1A` : "transparent",
      }}
      aria-pressed={armed === r}
      title={r === "plan" ? "Drag the graph to reshape your plan" : "Drag the graph to record what you actually did"}
    >
      {label}
    </button>
  );

  return (
    <Card
      icon={SlidersHorizontal}
      title={`EFFORT BUDGET · ${roundKey}`}
      accent="#B06AF0"
      help="Drag a vertex and the other desks give way pro-rata — the plan is always a whole week. Pin a desk to freeze it. Effort is priced as a RESOURCING premium, never as a claim that an hour buys a point: a desk under an even share of your week is marked down, the actual ring about three times as hard as the plan."
      right={
        <Btn
          variant={allocation ? "ghost" : "primary"}
          onClick={() => applyAndFile({ ...cur, plan: suggested }, allocation ? "PLAN RESET TO MODEL RECOMMENDED" : "MODEL RECOMMENDED PLAN ADOPTED")}
          title="Overwrite the plan with the model's water-filled recommendation"
        >
          <SlidersHorizontal size={12} /> {allocation ? "Reset to model recommended" : "Adopt model recommended"}
        </Btn>
      }
    >
      <div className="space-y-3">
        {/* the one scalar for the week — every hour figure below is read off it */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2">
            <span style={{ ...microLabel, color: C.faint }}>WEEKLY STUDY TIME</span>
            <input
              type="number" min="0.5" step="0.5" inputMode="decimal"
              value={budgetText ?? cur.hoursPerWeek.toFixed(1)}
              onChange={(e) => setBudgetText(e.target.value)}
              onBlur={setBudget}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setBudgetText(null); }}
              className="gx-focus w-20 border px-2 py-1 text-[13px] font-bold text-right tabular-nums rounded-none"
              style={inputStyle}
              aria-label="Total study hours a week"
            />
            <span className="text-[10px] uppercase tracking-wider" style={{ color: C.dim, fontFamily: FONT.mono }}>H / WK</span>
          </label>
          <div className="flex items-center gap-1.5">
            <span style={{ ...microLabel, color: C.faint }}>DRAGGING</span>
            {ringBtn("plan", "Plan", C.accent)}
            {ringBtn("actual", "Actual", C.amber)}
          </div>
        </div>

        {/* Whether any of this reaches the board at all, and the way back out of
            the actual ring. Both live above the graph because they change what
            the graph MEANS, not what it shows. */}
        <PricedBanner
          on={effortOn}
          onToggle={onSetEffortWeighting}
          label="Effort priced into predictions"
          action={cur.actual ? (
            <Btn variant="ghost" onClick={clearActual} title="Wipe the actual ring — the plan and the weekly budget are untouched">
              <Eraser size={12} /> Clear actual hours
            </Btn>
          ) : null}
          charge={
            <>
              ACTUAL HOURS SKEW THE MARK HEAVILY — A DESK LOGGED AT NOTHING TAKES UP TO {PREMIUM_CAPS.effort.toFixed(1)} PTS OFF ITS PRICE.
              PLANNED HOURS SKEW IT TOO, AT ABOUT A THIRD ({PREMIUM_CAPS.plan.toFixed(1)} PTS MAX).
              {cur.actual
                ? " IF YOU ARE NOT GENUINELY TIMING YOURSELF, CLEAR ACTUAL — A GUESSED FIGURE IS PRICED EXACTLY AS HARD AS A MEASURED ONE."
                : " NO ACTUAL RECORDED, SO ONLY THE LIGHT PLAN CHARGE APPLIES. LEAVE IT THAT WAY UNLESS YOU ARE REALLY MEASURING."}
            </>
          }
          off={<>EFFORT IS OUT OF THE PRICING — THE SPIDER IS A PLANNING AID ONLY, AND NO MARK ON THE BOARD MOVES WITH IT.</>}
        />

        {axes.length >= 3 ? (
          <SpiderAllocator
            axes={axes}
            plan={cur.plan}
            actual={cur.actual}
            model={suggested}
            total={ALLOC_TOTAL}
            axisMax={axisMax}
            hoursPerWeek={cur.hoursPerWeek}
            pinned={pinned}
            armed={armed}
            onPlan={dragPlan}
            onActual={dragActual}
            onCommit={() => commit()}
            onTogglePin={togglePin}
          />
        ) : (
          /* Two spokes are a line, not a shape — the bars still read. */
          <Bars split={cur.plan} total={ALLOC_TOTAL} tickerOf={tickerOf} colorOf={colorOf} />
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t border-dashed" style={{ borderColor: C.faint }} /> MODEL</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2" style={{ borderColor: C.accent }} /> YOUR PLAN</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2" style={{ borderColor: C.amber }} /> ACTUAL</span>
        </div>

        {/* the numbers behind the shape — and the way past the outer ring */}
        <div>
          <div className="flex items-center gap-2 pb-1 border-b" style={{ ...microLabel, color: C.faint, borderColor: C.line }}>
            <span className="w-6" aria-hidden="true" />
            <span className="w-12">DESK</span>
            <span className="w-14 text-right">MODEL H</span>
            <span className="w-16 text-right">PLAN H</span>
            <span className="w-16 text-right">ACTUAL H</span>
            <span className="flex-1 text-right">GAP</span>
          </div>
          <div className="divide-y" style={{ borderColor: C.line }}>
            {axes.map((ax) => {
              const isPinned = pinned.includes(ax.id);
              const g = gap ? tokensToHours(gap.byId[ax.id] ?? 0, ALLOC_TOTAL, cur.hoursPerWeek) : null;
              return (
                <div key={ax.id} className="flex items-center gap-2 py-1">
                  <button
                    onClick={() => togglePin(ax.id)}
                    className="gx-focus w-6 flex items-center justify-center py-0.5 hover:brightness-150"
                    style={{ color: isPinned ? C.amber : C.faint }}
                    aria-pressed={isPinned}
                    title={isPinned ? `Unpin ${ax.label} — let it absorb again` : `Pin ${ax.label} — freeze it out of the rebalance`}
                  >
                    <Pin size={12} fill={isPinned ? C.amber : "none"} />
                  </button>
                  <span className="w-12 text-[11px] font-bold truncate" style={{ color: isPinned ? C.amber : C.text, fontFamily: FONT.mono }}>{ax.label}</span>
                  {/* What the water-fill would spend here — the only figure on
                      this row the engine produced, so the only one with a note. */}
                  <span className="w-14 text-right text-[10px] tabular-nums" style={{ color: C.faint, fontFamily: FONT.mono }}>
                    <Derived on={effortRef(ax.id)}>
                      <span>{fmt1(tokensToHours(suggested[ax.id] ?? 0, ALLOC_TOTAL, cur.hoursPerWeek))}</span>
                    </Derived>
                  </span>
                  <span className="w-16 flex justify-end">
                    <HourBox value={hrs(cur.plan[ax.id] ?? 0)} onCommit={(h) => setDeskPlanHours(ax.id, h)} label={`Planned hours a week on ${ax.label}`} tone={C.accent} />
                  </span>
                  <span className="w-16 flex justify-end">
                    <HourBox value={cur.actual ? hrs(cur.actual[ax.id] ?? 0) : null} onCommit={(h) => setDeskActualHours(ax.id, h)} label={`Actual hours a week on ${ax.label}`} tone={C.amber} placeholder="—" />
                  </span>
                  <span className="flex-1 text-right text-[10px] tabular-nums" style={{ color: g == null ? C.faint : Math.abs(g) > 1 ? C.amber : C.faint, fontFamily: FONT.mono }}>
                    {g == null ? "—" : `${signed(g)} H`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
          <span>
            PLANNED {fmt1(plannedWeek)} H
            {spentWeek != null && <span style={{ color: C.dim }}> · SPENT {fmt1(spentWeek)} H</span>}
            {gap && (
              <span style={{ color: gap.totalAbs > 20 ? C.amber : C.dim }}>
                {" "}· DRIFT{" "}
                <Derived on={dctx ? { id: "effort.drift", ctx: { ...dctx, card: { ...dctx.card, effort: effortFacts } } } : null}>
                  <span>{fmt1(tokensToHours(gap.totalAbs, ALLOC_TOTAL, cur.hoursPerWeek))}</span>
                </Derived>{" "}
                H
              </span>
            )}
          </span>
          {seeded ? (
            <button onClick={() => commit("ACTUAL EFFORT SAVED")} className="gx-focus inline-flex items-center gap-1 hover:brightness-150" style={{ color: C.up, fontFamily: FONT.mono }} title="File this as what you actually did">
              <Check size={11} /> SEEDED FROM YOUR PLAN — SAVE AS ACTUAL
            </button>
          ) : (
            <span>{gap ? "PLAN VS PRACTICE — YOUR CALIBRATION CONSTANT." : "ACTUAL HOURS ARE OPTIONAL — ONLY FILL THEM IN IF YOU GENUINELY TIMED THEM."}</span>
          )}
        </div>
      </div>
    </Card>
  );
}
