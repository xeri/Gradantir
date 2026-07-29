import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Eraser, Play, RotateCcw, Swords } from "lucide-react";
import { C, FONT, microLabel } from "../theme";
import { Btn } from "./ui/Btn";
import { Derive } from "./ui/Derive";
import { useArmed } from "./ui/useArmed";
import { DUEL_ROUND, eloRank, nextPair, pairKey, type Readiness } from "../lib/duel";
import type { DeriveCtx } from "../lib/derive";
import type { Duel, Subject } from "../types";

/**
 * The forced-choice readiness arena (D2). One question, two desks, no scale to
 * game — and deliberately no ratings on screen while you answer, because a
 * visible "MATH 1180 / PHYS 840" tells you what the book already thinks and you
 * will drift toward agreeing with it. The pile only means something if each pick
 * is blind. Ratings come back at the end of the round, with the movement your
 * five answers caused.
 *
 * Nothing is written until CONFIRM: a pick can be reset, so a mis-click on a
 * 140px block costs nothing.
 */

type Phase = "idle" | "brief" | "duel" | "complete";

/** Sorts after every real ISO date, so a provisional duel lands last in the
 *  Elo walk exactly where the book will put it a render later. Never stored. */
const PROVISIONAL_DATE = "9999-12-31";

export interface DuelArenaProps {
  /** Live desks only — an archived desk has no readiness worth asking about. */
  subjects: Subject[];
  duels: Duel[];
  onRecordDuel: (aId: string, bId: string, winnerId: string) => void;
  /** Drops every duel on record and returns the board to base. */
  onResetDuels: () => void;
  /**
   * The scorecard's derivation context. With it, each rating in the ranking
   * opens the Elo update and the Bradley-Terry reading the premium charges on.
   */
  dctx?: DeriveCtx;
}

export function DuelArena({ subjects, duels, onRecordDuel, onResetDuels, dctx }: DuelArenaProps) {
  const liveIds = useMemo(() => subjects.map((s) => s.id), [subjects]);
  const byId = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const ranking = useMemo(() => eloRank(duels, liveIds), [duels, liveIds]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [pair, setPair] = useState<[string, string] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [served, setServed] = useState<string[]>([]);
  const [logged, setLogged] = useState(0);
  /** The board as it stood before the round, for the movement column after it. */
  const [before, setBefore] = useState<Readiness[] | null>(null);
  const arena = useRef<HTMLDivElement>(null);
  /* Dropping the pile is unrecoverable — there is no undo and no export of
     duels alone — so it takes two clicks, and forgets if you wander off. */
  const wipe = useArmed();

  /* Each step tears down the button that got you there, dropping focus onto the
     body — which leaves a keyboard user stranded and the ←/→ pick dead until
     they click something. Catch focus on the arena itself as the phase turns. */
  useEffect(() => {
    if (phase !== "idle") arena.current?.focus({ preventScroll: true });
  }, [phase]);

  const begin = () => {
    const first = nextPair(duels, liveIds);
    if (!first) return;
    setBefore(ranking);
    setServed([]);
    setLogged(0);
    setPicked(null);
    setPair(first);
    setPhase("duel");
  };

  const confirm = () => {
    if (!pair || !picked) return;
    const [a, b] = pair;
    onRecordDuel(a, b, picked);

    const nextServed = [...served, pairKey(a, b)];
    const count = logged + 1;
    setServed(nextServed);
    setLogged(count);
    setPicked(null);
    if (count >= DUEL_ROUND) {
      setPair(null);
      setPhase("complete");
      return;
    }
    // The parent has not re-rendered us yet, so the duel just filed is still
    // missing from `duels`. Hand it to the pairer directly rather than choose
    // the next matchup off a board that is one answer out of date.
    const provisional: Duel = { id: `provisional-${count}`, aId: a, bId: b, winnerId: picked, createdAt: PROVISIONAL_DATE };
    setPair(nextPair([...duels, provisional], liveIds, new Set(nextServed)));
  };

  const exit = () => {
    setPhase("idle");
    setPair(null);
    setPicked(null);
  };

  /* ←/→ pick, Enter confirms. Bound to the arena, not the window, so it cannot
     reach past this card into the command palette. Enter over a focused button
     is left to that button's own activation instead of firing twice. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (phase !== "duel" || !pair) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setPicked(pair[e.key === "ArrowLeft" ? 0 : 1]);
    } else if (e.key === "Enter" && picked && !(e.target as HTMLElement).closest("button")) {
      e.preventDefault();
      confirm();
    }
  };

  const a = pair ? byId.get(pair[0]) : null;
  const b = pair ? byId.get(pair[1]) : null;
  /* A desk delisted mid-round leaves a matchup that no longer means anything;
     drop back to the board rather than duel over a name that is gone. */
  const live = phase === "duel" && a && b;
  const idle = phase === "idle" || (phase === "duel" && !live);

  return (
    <div ref={arena} tabIndex={-1} onKeyDown={onKeyDown} className="outline-none">
      {idle && (
        <>
          <Ranking rows={ranking} byId={byId} dctx={dctx} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: C.line }}>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
              {duels.length} DUEL{duels.length === 1 ? "" : "S"} ON RECORD
            </span>
            <div className="flex items-center gap-2">
              {duels.length > 0 && (
                <Btn
                  variant="danger"
                  onClick={() => {
                    if (!wipe.armed) { wipe.arm(); return; }
                    wipe.disarm();
                    onResetDuels();
                  }}
                >
                  <Eraser size={11} /> {wipe.armed ? `CLICK AGAIN — DROPS ALL ${duels.length}` : "RESET RECORD"}
                </Btn>
              )}
              <Btn variant="primary" onClick={() => { wipe.disarm(); setPhase("brief"); }}>
                <Play size={11} /> START DUELS
              </Btn>
            </div>
          </div>
        </>
      )}

      {phase === "brief" && <Brief onBegin={begin} onCancel={exit} />}

      {live && (
        <>
          <Progress logged={logged} />
          <p className="mt-3 mb-2 text-center text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: C.text, fontFamily: FONT.mono }}>
            WHICH ARE YOU MORE READY TO SIT?
          </p>
          <div className="flex items-stretch gap-2">
            <Block sub={a} state={picked == null ? "open" : picked === a.id ? "won" : "lost"} onPick={() => setPicked(a.id)} />
            <div className="flex items-center text-[10px] font-black tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>VS</div>
            <Block sub={b} state={picked == null ? "open" : picked === b.id ? "won" : "lost"} onPick={() => setPicked(b.id)} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setPicked(null)}
              disabled={picked == null}
              className="gx-focus inline-flex items-center gap-1 px-1 py-0.5 text-[10px] uppercase tracking-[0.14em] underline underline-offset-2 disabled:opacity-30 disabled:pointer-events-none"
              style={{ color: C.faint, fontFamily: FONT.mono, background: "transparent" }}
            >
              <RotateCcw size={10} /> reset
            </button>
            <Btn variant="primary" onClick={confirm} disabled={picked == null}>
              CONFIRM <Arrow />
            </Btn>
          </div>
          <p className="mt-2 text-right text-[9px] uppercase tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
            ← → TO PICK · NOTHING FILES UNTIL YOU CONFIRM
          </p>
        </>
      )}

      {phase === "complete" && (
        <>
          <div className="mb-3 flex items-center gap-2 border px-2.5 py-1.5" style={{ background: "rgba(47,217,128,0.10)", borderColor: C.up }}>
            <Check size={12} style={{ color: C.up }} />
            <span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: C.up, fontFamily: FONT.mono }}>
              ROUND COMPLETE · {DUEL_ROUND} LOGGED
            </span>
          </div>
          <Ranking rows={ranking} byId={byId} before={before} dctx={dctx} />
          <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3" style={{ borderColor: C.line }}>
            <Btn onClick={exit}>EXIT &amp; VIEW RESULTS</Btn>
            <Btn variant="primary" onClick={begin}>
              <Swords size={11} /> ANOTHER {DUEL_ROUND}
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}

const Arrow = () => <span aria-hidden>→</span>;

function Brief({ onBegin, onCancel }: { onBegin: () => void; onCancel: () => void }) {
  const steps = [
    "Two desks, one question: which are you more ready to sit? Answer on gut — a considered answer is a rationalised one.",
    `${DUEL_ROUND} per round. The pairs are the ones the book cannot separate, so every pick buys information rather than confirming the obvious.`,
    "Ratings stay hidden until the round closes, so nothing anchors your answer. The pile then fits an Elo ranking you can hold against the model's.",
  ];
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2" style={{ ...microLabel, color: C.amber }}>
        <Swords size={12} /> FORCED CHOICE · NO SCALE TO GAME
      </h3>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-[11px] leading-relaxed" style={{ color: C.dim, fontFamily: FONT.mono }}>
            <span className="shrink-0 font-black tabular-nums" style={{ color: C.amber }}>{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3" style={{ borderColor: C.line }}>
        <Btn onClick={onCancel}>cancel</Btn>
        <Btn variant="primary" onClick={onBegin}>BEGIN ROUND <Arrow /></Btn>
      </div>
    </div>
  );
}

function Progress({ logged }: { logged: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span style={{ ...microLabel, color: C.faint }}>
        DUEL {logged + 1} / {DUEL_ROUND}
      </span>
      <span className="flex gap-1" aria-hidden>
        {Array.from({ length: DUEL_ROUND }, (_, i) => (
          <span key={i} className="h-1.5 w-4" style={{ background: i < logged ? C.amber : C.line }} />
        ))}
      </span>
    </div>
  );
}

/** One of the two big blocks. Green when you took it, red when you passed. */
function Block({ sub, state, onPick }: { sub: Subject; state: "open" | "won" | "lost"; onPick: () => void }) {
  const tone = state === "won" ? C.up : state === "lost" ? C.down : C.lineBright;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={state === "won"}
      aria-label={`More ready for ${sub.ticker}, ${sub.name}`}
      className="gx-focus relative flex min-h-[140px] flex-1 flex-col items-center justify-center gap-1 border-2 px-3 py-6 transition-[background-color,border-color,opacity] hover:brightness-125"
      style={{
        borderColor: tone,
        background: state === "won" ? "rgba(47,217,128,0.12)" : state === "lost" ? "rgba(255,84,73,0.07)" : C.panel2,
        opacity: state === "lost" ? 0.6 : 1,
      }}
    >
      <span className="absolute left-2 top-2 h-2 w-2" style={{ background: sub.color }} aria-hidden />
      <span
        className="text-[28px] font-black leading-none tracking-[0.06em]"
        style={{ fontFamily: FONT.mono, color: state === "open" ? C.text : tone }}
      >
        {sub.ticker}
      </span>
      <span className="text-center text-[10px] uppercase tracking-[0.14em]" style={{ fontFamily: FONT.mono, color: C.faint }}>
        {sub.name}
      </span>
      <span className="mt-1 h-3 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ fontFamily: FONT.mono, color: tone }}>
        {state === "won" ? "✓ MORE READY" : state === "lost" ? "LESS READY" : ""}
      </span>
    </button>
  );
}

function Ranking({ rows, byId, before, dctx }: { rows: Readiness[]; byId: Map<string, Subject>; before?: Readiness[] | null; dctx?: DeriveCtx }) {
  const top = rows[0]?.rating ?? 1000;
  const moveOf = (id: string): number => {
    if (!before) return 0;
    const was = before.findIndex((r) => r.id === id);
    const now = rows.findIndex((r) => r.id === id);
    return was < 0 || now < 0 ? 0 : was - now;
  };
  return (
    <div className="space-y-1">
      {rows.map((r, i) => {
        const move = moveOf(r.id);
        return (
          <div key={r.id} className="flex items-center gap-2 text-[11px]" style={{ fontFamily: FONT.mono }}>
            <span className="w-5 text-right tabular-nums" style={{ color: C.faint }}>{i + 1}</span>
            <span className="w-12 font-bold" style={{ color: C.text }}>{byId.get(r.id)?.ticker ?? r.id}</span>
            {before && (
              <span
                className="w-7 text-right tabular-nums"
                style={{ color: move > 0 ? C.up : move < 0 ? C.down : C.faint }}
                title={move === 0 ? "Unmoved this round" : `Moved ${Math.abs(move)} place${Math.abs(move) === 1 ? "" : "s"} ${move > 0 ? "up" : "down"}`}
              >
                {move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : "—"}
              </span>
            )}
            <div className="h-2.5 flex-1 border" style={{ borderColor: C.line, background: C.strip }}>
              <div className="h-full transition-[width]" style={{ width: `${Math.max(4, Math.min(100, 50 + (r.rating - top)))}%`, background: C.accent }} />
            </div>
            {dctx ? (
              <Derive id="duel.elo" ctx={{ ...dctx, key: r.id }} className="w-16 text-right tabular-nums" style={{ color: C.dim }}>
                {Math.round(r.rating)}
              </Derive>
            ) : (
              <span className="w-16 text-right tabular-nums" style={{ color: C.dim }}>{Math.round(r.rating)}</span>
            )}
            <span className="w-12 text-right" style={{ color: C.faint }}>{r.wins}-{r.losses}</span>
          </div>
        );
      })}
    </div>
  );
}
