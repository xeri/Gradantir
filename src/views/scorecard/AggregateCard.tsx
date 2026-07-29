import { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { Btn } from "../../components/ui/Btn";
import { PricedBanner } from "../../components/ui/PricedBanner";
import { Card, Derived, LoggedRow } from "./Card";
import { ago, fmt1, signed } from "./format";
import { scoreMeanCall } from "../../lib/meancall";
import { entryTermKey } from "../../lib/periods";
import { SELF_POOL_CAP } from "../../lib/quant/params";
import { round1 } from "../../lib/utils";
import type { SchoolCalendar } from "../../lib/calendar";
import type { DeriveCtx } from "../../lib/derive";
import type { MeanPoolModel } from "../../lib/quant/meanpool";
import type { AggregateForecast, AppData, MeanCall, SubjectStat } from "../../types";

/**
 * THE AGGREGATE CALL (D4 → §28).
 *
 * Two things this card does that the rest of the board does not, and both are
 * about MEMORY:
 *
 * · It never clears itself. The draft is seeded from your standing call, so
 *   revising after the desk has printed its own number is one edit rather than a
 *   re-entry of everything. The old call is not overwritten — it is kept, listed
 *   and scored beside the new one.
 * · It shows the desk's number WHILE you type. That is the whole point of an
 *   input made after a prediction: what the engine already thinks is information,
 *   and pretending otherwise by hiding it produces a worse-calibrated call, not a
 *   more independent one. The register scores your revisions the same way either
 *   way, so anchoring is visible in the record rather than hidden from it.
 */

export function AggregateCard({
  stats, data, cal, roundKey, todayIso, fit, deskForecast, aggregateOn, dctx,
  tickerOf, onSave, onRemoveCall, onSetAggregateCallWeighting,
}: {
  stats: SubjectStat[];
  data: AppData;
  cal: SchoolCalendar;
  /** The round being FORECAST — the one a call can still be about. */
  roundKey: string;
  todayIso: string;
  /** What your past calls have earned against the desk's own aggregate. */
  fit: MeanPoolModel;
  /** The desk's unpooled forward aggregate — what you are agreeing or not with. */
  deskForecast: AggregateForecast | null;
  aggregateOn: boolean;
  dctx?: DeriveCtx;
  tickerOf: (id: string) => string;
  onSave: (roundKey: string, predAvg: number, ranking: string[]) => void;
  onRemoveCall: (id: string) => void;
  onSetAggregateCallWeighting: (on: boolean) => void;
}) {
  const live = stats.filter((s) => !s.sub.archived);
  const calls = useMemo(
    () => (data.meanCalls ?? [])
      .filter((m) => m.roundKey === roundKey)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1)),
    [data.meanCalls, roundKey],
  );
  const standing: MeanCall | null = calls[0] ?? null;

  /* The draft SURVIVES a submit and is seeded from your standing call. A revision
     is an edit of what you said, not a blank form. */
  const [predAvg, setPredAvg] = useState(() => (standing ? String(standing.predAvg) : ""));
  const [ranking, setRanking] = useState<string[]>(() => standing?.ranking ?? []);
  const [dirty, setDirty] = useState(false);
  /* A new round is a new question — but only a round change resets the boxes. */
  useEffect(() => {
    const cur = (data.meanCalls ?? [])
      .filter((m) => m.roundKey === roundKey)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
    setPredAvg(cur ? String(cur.predAvg) : "");
    setRanking(cur?.ranking ?? []);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundKey]);

  const toggle = (id: string) => {
    setDirty(true);
    setRanking((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  };

  const realizedById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of data.entries) if (e.type === "Exam" && entryTermKey(e, cal) === roundKey) map[e.subjectId] = e.score;
    return map;
  }, [data.entries, cal, roundKey]);

  const v = Number(predAvg);
  const valid = predAvg !== "" && !Number.isNaN(v) && v >= 0 && v <= 100 && ranking.length >= 2;
  const unchanged = !!standing && standing.predAvg === round1(v) && standing.ranking.join() === ranking.join();
  const submit = () => {
    if (!valid || unchanged) return;
    onSave(roundKey, round1(v), ranking);
    setDirty(false);
  };

  const desk = deskForecast?.pct ?? null;
  const gap = desk != null && predAvg !== "" && !Number.isNaN(v) ? v - desk : null;

  return (
    <Card
      icon={TrendingUp}
      title={`AGGREGATE CALL · ${roundKey}`}
      accent={C.up}
      help="Predict the overall exam average and force a strongest→weakest order — the level where the engine has real skill. Cheaper and better-calibrated than six point forecasts. Every call is kept: revise as often as you like and the record keeps both."
    >
      <div className="space-y-3">
        <PricedBanner
          on={aggregateOn}
          onToggle={onSetAggregateCallWeighting}
          label="Your aggregate call priced into predictions"
          earned={{
            label: "CALL CARRIES",
            value: `${Math.round(fit.w * 100)}%`,
            tone: fit.w > 0 ? C.up : C.accent,
            derive: dctx ? { id: "earn.aggregate", ctx: dctx } : null,
          }}
          charge={
            <>
              YOUR CALL IS POOLED INTO THE BOOK'S FORWARD AGGREGATE — THE NUMBER ON THE BAND AT THE TOP OF THE TERMINAL —
              AT UP TO {Math.round(SELF_POOL_CAP * 100)}% OF IT, AND NEVER INTO A SINGLE DESK'S MARK.
              DISAGREEING WITH THE DESK WIDENS THE BAND RATHER THAN SHARPENING IT: A CONTESTED AGGREGATE IS AN UNCERTAIN ONE.
              THE FORCED RANKING IS SCORED AND SHOWN BUT WEIGHS NOTHING HERE — ORDERING IS THE DUEL PILE'S JOB.
              {" "}
              {fit.n === 0
                ? "NOTHING SCORED YET, SO THE DESK OWNS THE WHOLE AGGREGATE UNTIL YOU BEAT IT ON A ROUND IT ALSO CALLED."
                : `OVER ${fit.n} SCORED ROUND${fit.n === 1 ? "" : "S"} YOU HAVE MISSED THE AVERAGE BY ${fmt1(fit.youScore)} AGAINST THE DESK'S ${fmt1(fit.modelScore)}${fit.rankCorr != null ? `, WITH A RANK ρ OF ${fmt1(fit.rankCorr)}` : ""}.`}
            </>
          }
          off={<>YOUR AGGREGATE CALL IS OUT OF THE PRICING — IT IS STILL LOGGED AND STILL SCORED AGAINST THE DESK, BUT NO FORECAST MOVES WITH IT.</>}
        />

        {/* What the desk says, right where you type your own number. */}
        {desk != null && (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border px-2 py-1.5" style={{ borderColor: C.line, background: C.panel2 }}>
            <span style={{ ...microLabel, color: C.faint }}>THE DESK SAYS</span>
            {/* The DESK's own forward aggregate, never the pooled one the band
                at the top of the terminal shows — this is the number your call
                is disagreeing with, so its note must be the desk's arithmetic. */}
            <Derived on={dctx ? { id: "book.forecast", ctx: { ...dctx, forecast: deskForecast } } : null}>
              <span className="text-lg font-black tabular-nums leading-none" style={{ color: C.accent, fontFamily: FONT.mono }}>{fmt1(desk)}%</span>
            </Derived>
            {deskForecast && (
              <span className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
                90% BAND {fmt1((100 * deskForecast.ci90.lo) / deskForecast.outOf)}–{fmt1((100 * deskForecast.ci90.hi) / deskForecast.outOf)}
              </span>
            )}
            {gap != null && Math.abs(gap) >= 0.05 && (
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: Math.abs(gap) > 5 ? C.amber : C.dim, fontFamily: FONT.mono }}>
                YOU ARE {signed(gap)} AGAINST IT
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block mb-1" style={{ ...microLabel, color: C.faint }}>OVERALL AVG %</span>
            <input
              type="number" min="0" max="100" step="1" value={predAvg}
              onChange={(e) => { setPredAvg(e.target.value); setDirty(true); }}
              className="gx-focus w-24 border px-2 py-1.5 text-sm rounded-none"
              style={{ background: C.panel2, borderColor: C.line, color: C.text, fontFamily: FONT.mono }}
              placeholder="e.g. 74"
            />
          </label>
          <Btn
            variant="primary"
            onClick={submit}
            disabled={!valid || unchanged}
            title={
              !valid ? "Give an average and rank at least two desks"
                : unchanged ? "This is exactly your standing call — change something to file a revision"
                  : standing ? "File this as a revision — your earlier call is kept" : "Log this call"
            }
          >
            <TrendingUp size={12} /> {standing ? "Log revision" : "Log call"}
          </Btn>
          {standing && dirty && !unchanged && (
            <span className="text-[10px] uppercase tracking-wider" style={{ color: C.amber, fontFamily: FONT.mono }}>
              UNFILED EDIT — YOUR STANDING CALL IS STILL {fmt1(standing.predAvg)}
            </span>
          )}
        </div>

        <div>
          <div style={{ ...microLabel, color: C.faint }} className="mb-1.5">RANK STRONGEST → WEAKEST (CLICK IN ORDER)</div>
          <div className="flex flex-wrap gap-1.5">
            {live.map((s) => {
              const pos = ranking.indexOf(s.sub.id);
              const picked = pos >= 0;
              return (
                <button
                  key={s.sub.id}
                  onClick={() => toggle(s.sub.id)}
                  className="gx-focus inline-flex items-center gap-1.5 border px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors"
                  style={{ borderColor: picked ? C.amber : C.lineBright, color: picked ? C.amber : C.dim, background: picked ? "rgba(232,163,61,0.1)" : "transparent", fontFamily: FONT.mono }}
                  title={picked ? "Click to remove from the ranking" : "Click to add next in the ranking"}
                >
                  {picked && <span className="tabular-nums" style={{ color: C.amber }}>{pos + 1}</span>}
                  {s.sub.ticker}
                </button>
              );
            })}
          </div>
        </div>

        {calls.length > 0 && (
          <div className="space-y-1 border-t pt-3" style={{ borderColor: C.line }}>
            <div style={{ ...microLabel, color: C.faint }}>
              EVERY CALL FILED FOR {roundKey} — NEWEST FIRST
            </div>
            {calls.map((m, i) => {
              const score = scoreMeanCall(m, realizedById);
              return (
                <LoggedRow
                  key={m.id}
                  primary={fmt1(m.predAvg)}
                  tone={i === 0 ? C.up : C.dim}
                  secondary={
                    <>
                      {i === 0 && <span style={{ color: C.up }}>STANDING · </span>}
                      {m.ranking.map(tickerOf).join(" > ") || "NO RANKING"} · {ago(m.createdAt, todayIso)}
                      {score.realizedAvg != null && (
                        <span style={{ color: C.faint }}>
                          {" "}— REALIZED {fmt1(score.realizedAvg)} (ERR{" "}
                          <Derived
                            on={dctx ? { id: "call.score", ctx: { ...dctx, card: { ...dctx.card, call: { predAvg: m.predAvg, ranking: m.ranking, score } } } } : null}
                          >
                            <span>{signed(score.error!)}</span>
                          </Derived>
                          ){score.rankCorr != null ? `, ρ ${fmt1(score.rankCorr)}` : ""}
                        </span>
                      )}
                    </>
                  }
                  onRemove={() => onRemoveCall(m.id)}
                  removeLabel={`Remove the call of ${fmt1(m.predAvg)} filed ${m.createdAt}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
