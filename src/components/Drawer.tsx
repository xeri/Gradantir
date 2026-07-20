import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { C, FONT, microLabel } from "../theme";
import { Sparkline } from "./ui/Sparkline";
import { Delta } from "./ui/Delta";
import { TypeBadge } from "./ui/TypeBadge";
import { Btn } from "./ui/Btn";
import { Field, Sel, inputStyle } from "./ui/Field";
import { TYPES } from "../constants";
import { currentTermKey, periodInfo } from "../lib/periods";
import { neededScore, weightFor } from "../lib/weights";
import { clamp, round1, shortDateY } from "../lib/utils";
import type { AssessmentType, GradeEntry, Settings, SubjectStat } from "../types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border" style={{ background: C.panel, borderColor: C.line }}>
      <div className="px-3 py-1.5 border-b" style={{ ...microLabel, borderColor: C.line, color: C.amber }}>{title}</div>
      <div className="p-3">{children}</div>
    </div>
  );
}

/** Full quote page for one subject, slid in from the right. */
export function Drawer({
  stat,
  settings,
  onClose,
  onSetTarget,
  onDeleteSubject,
  onAddGrade,
  onEditEntry,
}: {
  stat: SubjectStat;
  settings: Settings;
  onClose: () => void;
  onSetTarget: (sid: string, target: number | null) => void;
  onDeleteSubject: (sid: string) => void;
  onAddGrade: (sid: string) => void;
  onEditEntry: (e: GradeEntry) => void;
}) {
  const { sub, entries, scores, latest, curAvg, periodDelta, sd, volatility, forecast, curLabel, ath, athDate, fromAth, alpha, alphaCount } = stat;
  const [wish, setWish] = useState<string>(String(sub.target ?? 85));
  const [nextType, setNextType] = useState<AssessmentType>("Test");
  const [targetDraft, setTargetDraft] = useState<string>(sub.target != null ? String(sub.target) : "");
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const curEntries = entries.filter((e) => periodInfo(e.date, "term").key === currentTermKey().key);
  const n = curEntries.length;
  const needed = round1(neededScore(curEntries, settings, Number(wish) || 0, nextType));

  let whatIf: { text: string; color: string };
  if (needed > 100) whatIf = { text: `${needed.toFixed(1)} — OUT OF REACH IN ONE PRINT. CLOSE THE GAP ACROSS THE NEXT FEW.`, color: C.down };
  else if (needed <= 0) whatIf = { text: "ALREADY LOCKED IN — ANY SCORE HOLDS IT.", color: C.up };
  else whatIf = { text: `NEED ${needed.toFixed(1)}% ON THE NEXT ${nextType.toUpperCase()}.`, color: C.text };

  const trendWord = forecast ? (forecast.slope > 0.15 ? "CLIMBING" : forecast.slope < -0.15 ? "SLIDING" : "HOLDING FLAT") : null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={`${sub.name} details`}>
      <div className="absolute inset-0" style={{ background: "rgba(5,7,10,0.75)" }} onClick={onClose} />
      <aside className="gx-fade absolute inset-y-0 right-0 w-full sm:max-w-md overflow-y-auto border-l" style={{ background: C.bg, borderColor: C.lineBright }}>
        <div className="h-1" style={{ background: sub.color }} />
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] font-bold tracking-[0.16em]" style={{ color: sub.color, fontFamily: FONT.mono }}>{sub.ticker}</div>
              <h2 className="text-xl font-black tracking-tight uppercase" style={{ fontFamily: FONT.display, color: C.text }}>{sub.name}</h2>
            </div>
            <button onClick={onClose} aria-label="Close" className="gx-focus p-1.5 hover:brightness-150" style={{ color: C.faint }}>
              <X size={18} />
            </button>
          </div>

          <Section title="QUOTE">
            <Sparkline scores={scores} color={sub.color} w={340} h={64} />
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[
                { l: "LAST", v: latest ? latest.score.toFixed(1) : "—" },
                { l: `AVG ${curLabel}`, v: curAvg != null ? curAvg.toFixed(1) : "—" },
                { l: "SPREAD", v: `±${sd.toFixed(1)}` },
              ].map((x, i) => (
                <div key={i}>
                  <div style={{ ...microLabel, color: C.faint }}>{x.l}</div>
                  <div className="text-base font-bold" style={{ fontFamily: FONT.mono, color: C.text }}>{x.v}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <div>
                <div style={{ ...microLabel, color: C.faint }}>VOL</div>
                <div className="text-[11px] font-bold uppercase mt-0.5" style={{ fontFamily: FONT.mono, color: sd >= 7 ? C.amber : C.dim }}>{volatility}</div>
              </div>
              <div>
                <div style={{ ...microLabel, color: C.faint }}>VS LAST TERM</div>
                <div className="mt-0.5"><Delta v={periodDelta} /></div>
              </div>
              <div>
                <div style={{ ...microLabel, color: C.faint }}>ATH</div>
                <div className="text-[11px] font-bold mt-0.5" style={{ fontFamily: FONT.mono, color: C.dim }}>
                  {ath != null ? ath.toFixed(1) : "—"}
                  {fromAth != null && fromAth < -0.05 && <span style={{ color: C.faint }}> ({fromAth.toFixed(1)})</span>}
                  {fromAth != null && fromAth >= -0.05 && <span style={{ color: C.up }}> ● AT HIGH</span>}
                </div>
              </div>
            </div>
            {(alpha != null || athDate) && (
              <div className="mt-2 pt-2 border-t text-[10px] uppercase tracking-wider space-y-0.5" style={{ borderColor: C.line, fontFamily: FONT.mono, color: C.faint }}>
                {athDate && <div>HIGH PRINTED {shortDateY(athDate).toUpperCase()}</div>}
                {alpha != null && (
                  <div>
                    α VS CLASS{" "}
                    <span style={{ color: alpha > 0.05 ? C.up : alpha < -0.05 ? C.down : C.dim }}>
                      {alpha > 0 ? "+" : ""}{alpha.toFixed(1)}
                    </span>{" "}
                    OVER {alphaCount} PRINT{alphaCount === 1 ? "" : "S"}
                  </div>
                )}
              </div>
            )}
          </Section>

          {forecast && (
            <Section title="NEXT RESULT ESTIMATE">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold" style={{ fontFamily: FONT.mono, color: C.accent }}>{forecast.pred.toFixed(1)}%</span>
                <span className="text-xs" style={{ color: C.faint, fontFamily: FONT.mono }}>± {forecast.sigma.toFixed(1)}</span>
              </div>
              <p className="text-[10px] mt-1.5 uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
                Trend over last {Math.min(10, entries.length)} results — {trendWord} at {Math.abs(forecast.slope).toFixed(1)} pts per assessment. A guide, not a promise.
              </p>
            </Section>
          )}

          <Section title="WHAT DO I NEED?">
            <div className="flex items-center gap-2 text-xs flex-wrap" style={{ fontFamily: FONT.mono, color: C.dim }}>
              <span className="uppercase">Finish {curLabel} at</span>
              <input
                type="number" min="0" max="100" value={wish} onChange={(e) => setWish(e.target.value)}
                className="gx-focus w-16 border px-2 py-1 text-sm font-bold text-center rounded-none"
                style={{ ...inputStyle }} aria-label="Desired term average"
              />
              <span className="uppercase">% via a</span>
              <Sel ariaLabel="Next assessment type" value={nextType} onChange={(v) => setNextType(v as AssessmentType)}
                options={TYPES.map((t) => ({ value: t, label: t.toUpperCase() }))} />
            </div>
            <p className="text-xs mt-2.5 font-bold" style={{ color: whatIf.color, fontFamily: FONT.mono }}>→ {whatIf.text}</p>
            <p className="text-[10px] mt-1.5 uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
              {n} result{n === 1 ? "" : "s"} logged this term
              {settings.weighted ? ` · weighted (next ${nextType.toLowerCase()} ×${weightFor(nextType, settings)})` : " · equal weights"}
            </p>
          </Section>

          <Section title="TARGET">
            <div className="flex items-end gap-2">
              <Field label="TARGET %">
                <input
                  type="number" min="0" max="100" value={targetDraft} onChange={(e) => setTargetDraft(e.target.value)}
                  className="gx-focus w-24 border px-2 py-1.5 text-sm font-bold text-center rounded-none"
                  style={{ ...inputStyle }} placeholder="none"
                />
              </Field>
              <Btn variant="primary" onClick={() => onSetTarget(sub.id, targetDraft === "" ? null : clamp(Number(targetDraft), 0, 100))}>
                Set
              </Btn>
              {sub.target != null && (
                <Btn onClick={() => { setTargetDraft(""); onSetTarget(sub.id, null); }}>Clear</Btn>
              )}
            </div>
          </Section>

          <Section title="RECENT PRINTS">
            <div className="space-y-1.5">
              {entries.slice(-6).reverse().map((e) => (
                <button
                  key={e.id}
                  onClick={() => onEditEntry(e)}
                  className="gx-focus w-full flex items-center justify-between border px-2.5 py-1.5 text-left hover:brightness-110"
                  style={{ background: C.panel2, borderColor: C.line }}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <TypeBadge type={e.type} />
                    <span className="text-[11px] truncate" style={{ color: C.dim, fontFamily: FONT.mono }}>
                      {e.title || shortDateY(e.date)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0" style={{ fontFamily: FONT.mono }}>
                    {e.classAvg != null && (
                      <span className="text-[10px]" style={{ color: e.score - e.classAvg > 0 ? C.up : C.down }}>
                        α{e.score - e.classAvg > 0 ? "+" : ""}{round1(e.score - e.classAvg).toFixed(1)}
                      </span>
                    )}
                    <span className="text-sm font-bold" style={{ color: C.text }}>{e.score.toFixed(1)}%</span>
                  </span>
                </button>
              ))}
              {entries.length === 0 && (
                <p className="text-[11px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
                  Nothing logged yet — this line starts with the first print.
                </p>
              )}
            </div>
            <Btn className="mt-2.5" onClick={() => onAddGrade(sub.id)}>
              <Plus size={12} /> Log result
            </Btn>
          </Section>

          <div className="pt-1 pb-3">
            <button
              onClick={() => (confirmDel ? onDeleteSubject(sub.id) : setConfirmDel(true))}
              className="gx-focus text-[10px] font-bold uppercase tracking-[0.14em] flex items-center gap-1.5"
              style={{ color: C.down, fontFamily: FONT.mono }}
            >
              <Trash2 size={12} /> {confirmDel ? "Click again to delist and strike every print" : "Delist subject"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
