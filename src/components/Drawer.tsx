import { useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, Plus, Trash2, X } from "lucide-react";
import { C, FONT, microLabel } from "../theme";
import { SubjectChart } from "./charts/SubjectChart";
import { Delta } from "./ui/Delta";
import { Derive } from "./ui/Derive";
import { DelistedTag } from "./ui/DelistedTag";
import { RATING_COLOR, RatingBadge } from "./ui/RatingBadge";
import { RegimeTag } from "./ui/RegimeTag";
import { TypeBadge } from "./ui/TypeBadge";
import { DepthLadder } from "./DepthLadder";
import { Btn } from "./ui/Btn";
import { useArmed } from "./ui/useArmed";
import { useDialogFocus } from "./ui/useDialogFocus";
import { useEscapeLayer } from "../lib/escapeStack";
import { Field, Sel, inputStyle } from "./ui/Field";
import { TYPES } from "../constants";
import { currentTermKey, entryTermKey } from "../lib/periods";
import { neededScore, weightFor } from "../lib/weights";
import { RATINGS, ratingMove } from "../lib/quant/ratings";
import { clamp, round1, shortDateY } from "../lib/utils";
import type { DeriveCtx } from "../lib/derive";
import type { AssessmentType, GradeEntry, RatingResult, Settings, Subject, SubjectStat } from "../types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border" style={{ background: C.panel, borderColor: C.line }}>
      <div className="px-3 py-1.5 border-b" style={{ ...microLabel, borderColor: C.line, color: C.amber }}>{title}</div>
      <div className="p-3">{children}</div>
    </div>
  );
}

const WEIGHT_LABELS: Record<string, string> = { kalman: "KALMAN", ewma: "EWMA", shrunk: "MEAN", trend: "TREND" };

/** The sell-side page: consensus, the split behind it, and every analyst's target. */
function Coverage({ rating, price, ctx }: { rating: RatingResult; price: number; ctx: DeriveCtx }) {
  const covered = rating.views.length > 0;
  const bars = RATINGS.filter((r) => r !== "N/A");
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Derive id="rating.score" ctx={ctx}>
          <RatingBadge rating={rating.rating} size="lg" />
        </Derive>
        {rating.target != null && (
          <span className="flex items-baseline gap-1.5" style={{ fontFamily: FONT.mono }}>
            <span className="text-[10px]" style={{ color: C.faint }}>PT</span>
            <Derive id="rating.target" ctx={ctx}>
              <span className="text-xl font-bold" style={{ color: C.text }}>{rating.target.toFixed(1)}</span>
            </Derive>
            {rating.upside != null && (
              <span className="text-xs font-bold" style={{ color: rating.upside > 0.05 ? C.up : rating.upside < -0.05 ? C.down : C.dim }}>
                {rating.upside > 0 ? "+" : ""}{rating.upside.toFixed(1)}%
              </span>
            )}
          </span>
        )}
        {rating.targetLo != null && rating.targetHi != null && (
          <span className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
            RANGE {rating.targetLo.toFixed(1)}–{rating.targetHi.toFixed(1)}
          </span>
        )}
      </div>

      {covered && (
        <>
          <div className="flex h-1.5 mt-3" style={{ background: C.panel2 }}>
            {bars.map((r) => {
              const n = rating.distribution[r];
              if (!n) return null;
              return <span key={r} style={{ width: `${(100 * n) / rating.views.length}%`, background: RATING_COLOR[r] }} />;
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 mt-1.5 text-[9px] font-bold tracking-[0.12em]" style={{ fontFamily: FONT.mono }}>
            {bars.filter((r) => rating.distribution[r] > 0).map((r) => (
              <span key={r} style={{ color: RATING_COLOR[r] }}>{rating.distribution[r]} {r}</span>
            ))}
          </div>

          <div className="mt-3 space-y-1">
            {rating.views.map((v) => (
              <Derive key={v.name} id="rating.return" ctx={ctx} className="flex items-center gap-2 border px-2 py-1" style={{ background: C.panel2, borderColor: C.line }}>
                <span className="w-14 text-[10px] font-bold tracking-[0.08em] shrink-0" style={{ fontFamily: FONT.mono, color: C.dim }}>
                  {WEIGHT_LABELS[v.name] ?? v.name.toUpperCase()}
                </span>
                <span className="w-9 text-[9px] shrink-0" style={{ fontFamily: FONT.mono, color: C.faint }}>{v.weight}%</span>
                <span className="flex-1 text-[9px] font-bold tracking-[0.1em]" style={{ fontFamily: FONT.mono, color: RATING_COLOR[v.rating] }}>
                  {v.rating}
                </span>
                <span className="text-[10px] shrink-0" style={{ fontFamily: FONT.mono, color: C.faint }}>z {v.z > 0 ? "+" : ""}{v.z.toFixed(2)}</span>
                <span className="w-12 text-right text-xs font-bold shrink-0" style={{ fontFamily: FONT.mono, color: C.text }}>
                  {v.target.toFixed(1)}
                </span>
              </Derive>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-3">
            <span style={{ ...microLabel, color: C.faint }}>CONVICTION</span>
            <span className="flex-1 h-1" style={{ background: C.panel2 }}>
              <span className="block h-full" style={{ width: `${rating.conviction}%`, background: rating.conviction >= 50 ? C.amber : C.faint }} />
            </span>
            <Derive id="rating.conviction" ctx={ctx}>
              <span className="text-[10px] font-bold" style={{ fontFamily: FONT.mono, color: C.dim }}>{rating.conviction}</span>
            </Derive>
          </div>
          <div className="mt-1.5 text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.dim, fontFamily: FONT.mono }}>
            EXPECTED {rating.expected > 0 ? "+" : ""}{rating.expected.toFixed(2)} ·{" "}
            <Derive id="rating.benchmark" ctx={ctx}>BOOK {rating.benchmark > 0 ? "+" : ""}{rating.benchmark.toFixed(2)}</Derive> ·
            RISK ±{rating.risk.toFixed(2)} PTS OVER {rating.horizon}D<br />
            <Derive id="rating.score" ctx={ctx}>z* {rating.score > 0 ? "+" : ""}{rating.score.toFixed(2)}</Derive> · HOLD BAND ±{rating.band.toFixed(2)} · SPLIT {rating.dispersion.toFixed(2)} · MARK {price.toFixed(1)}
          </div>
        </>
      )}

      <div className="mt-1.5 text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>{rating.note}</div>
      <p className="text-[10px] mt-1.5 uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
        Four forecasters, four analysts — each weighted by how well it actually predicted the prints it had
        not seen. A rating is their consensus risk-adjusted excess return OVER THE BOOK, so a term where
        everything rises is not a book full of buys. Direction, not urgency — WORK ON answers urgency.
      </p>
    </>
  );
}

/** Full quote page for one subject, slid in from the right. */
export function Drawer({
  stat,
  settings,
  deriveCtx,
  onClose,
  onSetTarget,
  onSetCourseworkPct,
  onArchiveSubject,
  onRestoreSubject,
  succeededBy,
  onDeleteSubject,
  onAddGrade,
  onEditEntry,
}: {
  stat: SubjectStat;
  settings: Settings;
  /** Book-level facts the derivation popovers read; the desk is added here. */
  deriveCtx: DeriveCtx;
  onClose: () => void;
  onSetTarget: (sid: string, target: number | null) => void;
  onSetCourseworkPct: (sid: string, pct: number | null) => void;
  onArchiveSubject: (sid: string) => void;
  onRestoreSubject: (sid: string) => void;
  /**
   * The successor that has taken this desk's tape over, if one has printed.
   * Non-null means relisting is off the table — see the lineage rule in
   * `lib/lineage.ts`. Computed by App, which is the only place holding the whole
   * roster and tape at once.
   */
  succeededBy?: Subject | null;
  onDeleteSubject: (sid: string) => void;
  onAddGrade: (sid: string) => void;
  onEditEntry: (e: GradeEntry) => void;
}) {
  const {
    sub, entries, latest, curAvg, periodDelta, sd, volatility, curLabel,
    ath, athDate, fromAth, alpha, alphaCount, alphaRef, quant, priceDelta, gradeProj,
    percentile, percentileCount, classPercentile, depth,
    rating, ratingPrev,
  } = stat;
  const [wish, setWish] = useState<string>(String(sub.target ?? 85));
  const [nextType, setNextType] = useState<AssessmentType>("Test");
  const [targetDraft, setTargetDraft] = useState<string>(sub.target != null ? String(sub.target) : "");
  const [cwDraft, setCwDraft] = useState<string>(sub.courseworkPct != null ? String(sub.courseworkPct) : "");
  const delArm = useArmed();
  const panelRef = useRef<HTMLElement>(null);

  useEscapeLayer(onClose);
  useDialogFocus(panelRef);

  const closed = sub.archived === true;
  const move = ratingMove(ratingPrev, rating.rating);
  /* This desk's slice of the shared derivation context. */
  const dctx = useMemo<DeriveCtx>(() => ({ ...deriveCtx, stat }), [deriveCtx, stat]);
  const curEntries = entries.filter(
    (e) => entryTermKey(e, settings.calendar) === currentTermKey(settings.calendar).key,
  );
  const n = curEntries.length;
  const needed = round1(neededScore(curEntries, settings, Number(wish) || 0, nextType));

  let whatIf: { text: string; color: string };
  if (needed > 100) whatIf = { text: `${needed.toFixed(1)} — OUT OF REACH IN ONE PRINT. CLOSE THE GAP ACROSS THE NEXT FEW.`, color: C.down };
  else if (needed <= 0) whatIf = { text: "ALREADY LOCKED IN — ANY SCORE HOLDS IT.", color: C.up };
  else whatIf = { text: `NEED ${needed.toFixed(1)}% ON THE NEXT ${nextType.toUpperCase()}.`, color: C.text };

  const gradeCopy =
    gradeProj.mode === "worth"
      ? `WORTH-WEIGHTED · COVERS ${gradeProj.worthCoverage?.toFixed(0)}% OF THE FINAL`
      : gradeProj.mode === "blend"
        ? `BLEND · ${sub.courseworkPct}% COURSEWORK / ${100 - (sub.courseworkPct ?? 0)}% EXAMS`
        : gradeProj.grade != null
          ? "EXAMS ONLY — COURSEWORK IS SIGNAL, NOT GRADE"
          : "NO EXAMS PRINTED YET — COURSEWORK PRICES CAPABILITY, NOT THE GRADE";

  /* z-[45]: above an expanded chart (40), below the modals (50). */
  return (
    <div className="fixed inset-0 z-[45]" role="dialog" aria-modal="true" aria-label={`${sub.name} details`}>
      <div className="absolute inset-0" style={{ background: "rgba(5,7,10,0.75)" }} onClick={onClose} />
      <aside ref={panelRef} tabIndex={-1} className="gx-fade absolute inset-y-0 right-0 w-full sm:max-w-xl overflow-y-auto border-l outline-none" style={{ background: C.bg, borderColor: C.lineBright }}>
        <div className="h-1" style={{ background: closed ? C.lineBright : sub.color }} />
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div
                className="text-[11px] font-bold tracking-[0.16em]"
                style={{ color: closed ? C.dim : sub.color, fontFamily: FONT.mono, textDecoration: closed ? "line-through" : undefined }}
              >
                {sub.ticker}
              </div>
              <h2 className="text-xl font-black tracking-tight uppercase" style={{ fontFamily: FONT.display, color: C.text }}>{sub.name}</h2>
              <div className="mt-1.5">
                {closed ? <DelistedTag closedAt={latest?.date} size="lg" /> : <RatingBadge rating={rating.rating} />}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="gx-focus p-1.5 hover:brightness-150" style={{ color: C.faint }}>
              <X size={18} />
            </button>
          </div>

          {closed && (
            <div className="border px-3 py-2" style={{ borderColor: C.lineBright, background: C.panel }}>
              <div style={{ ...microLabel, color: C.dim }}>
                CLOSED BOOK · {entries.length} PRINT{entries.length === 1 ? "" : "S"}
                {latest ? ` · LAST ${shortDateY(latest.date)}` : ""}
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
                Frozen at its final mark. Every print still counts toward the aggregate, the composite and the
                depth fit for the terms you sat it — it just takes no new results and carries no live rating.
              </p>
            </div>
          )}

          <Section title="QUOTE">
            {quant && (
              <div className="mb-3 pb-3 border-b" style={{ borderColor: C.line }}>
                <div className="flex items-baseline gap-2.5">
                  <Derive id="mark.price" ctx={dctx}>
                    <span className="text-3xl font-bold leading-none" style={{ fontFamily: FONT.mono, color: C.text }}>
                      {quant.price.toFixed(1)}
                    </span>
                  </Derive>
                  <span className="text-[10px]" style={{ color: C.faint, fontFamily: FONT.mono }}>
                    MARK ± <Derive id="fv.interval" ctx={dctx}>{quant.sd.toFixed(1)}</Derive>
                  </span>
                  <Delta v={priceDelta} size="lg" nullText="NEW" />
                  <span className="ml-auto">
                    <Derive id="mark.regime" ctx={dctx}><RegimeTag regime={quant.regime} /></Derive>
                  </span>
                </div>
                <div className="mt-1" style={{ ...microLabel, color: C.faint }}>
                  MARKED FROM <Derive id="fv.value" ctx={dctx}>FV {quant.fv.toFixed(1)}</Derive> ·{" "}
                  <Derive id="fv.interval" ctx={dctx}>90% CI {quant.ci90.lo.toFixed(1)}–{quant.ci90.hi.toFixed(1)}</Derive> · LAST EXAM{" "}
                  {quant.lastExamPct != null ? `${quant.lastExamPct.toFixed(1)}%` : "—"}
                </div>
              </div>
            )}
            <SubjectChart
              entries={entries}
              color={sub.color}
              target={sub.target}
              quant={quant}
              height={230}
              onPick={onEditEntry}
            />
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[
                { l: "LAST PRINT", v: latest ? latest.score.toFixed(1) : "—" },
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
            {(alpha != null || athDate || percentile != null) && (
              <div className="mt-2 pt-2 border-t text-[10px] uppercase tracking-wider space-y-0.5" style={{ borderColor: C.line, fontFamily: FONT.mono, color: C.faint }}>
                {athDate && <div>HIGH PRINTED {shortDateY(athDate).toUpperCase()}</div>}
                {alpha != null && (
                  <div>
                    <Derive id="factor.alpha" ctx={dctx}>
                      α VS {alphaRef === "class" ? "CLASS" : "YEAR LEVEL"}{" "}
                      <span style={{ color: alpha > 0.05 ? C.up : alpha < -0.05 ? C.down : C.dim }}>
                        {alpha > 0 ? "+" : ""}{alpha.toFixed(1)}
                      </span>
                    </Derive>{" "}
                    OVER {alphaCount} PRINT{alphaCount === 1 ? "" : "S"}
                  </div>
                )}
                {percentile != null && (
                  <div>
                    <Derive id="depth.field" ctx={dctx}>
                      FIELD %ILE <span style={{ color: percentile >= 50 ? C.up : C.down }}>{percentile.toFixed(0)}</span>
                    </Derive>
                    {classPercentile != null && (
                      <> · <Derive id="depth.classz" ctx={dctx}>CLASS %ILE <span style={{ color: C.dim }}>{classPercentile.toFixed(0)}</span></Derive></>
                    )}
                    {" "}OVER {percentileCount} RANKED EXAM{percentileCount === 1 ? "" : "S"}
                  </div>
                )}
              </div>
            )}
          </Section>

          {quant && (
            <Section title="RISK PREMIA · MARK-TO-MARKET">
              <div className="space-y-1" style={{ fontFamily: FONT.mono }}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="uppercase tracking-[0.12em]" style={{ color: C.dim }}>FAIR VALUE</span>
                  <Derive id="fv.value" ctx={dctx}>
                    <span className="font-bold" style={{ color: C.text }}>{quant.fv.toFixed(1)}</span>
                  </Derive>
                </div>
                {quant.premia.length === 0 && (
                  <div className="text-[10px] uppercase tracking-wider py-1" style={{ color: C.up }}>
                    NO RISK CHARGES — THE DESK TRADES AT PAR
                  </div>
                )}
                {quant.premia.map((l) => (
                  <Derive key={l.key} id={`premium.${l.key}`} ctx={dctx} className="flex items-baseline gap-2 text-[11px]">
                    <span className="uppercase tracking-[0.1em] shrink-0" style={{ color: C.dim }}>
                      {l.pts >= 0 ? "−" : "+"} {l.label}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[10px] uppercase tracking-wider" style={{ color: C.faint }}>
                      {l.note}
                    </span>
                    <span className="font-bold shrink-0" style={{ color: l.pts >= 0 ? C.down : C.up }}>
                      {l.pts >= 0 ? "−" : "+"}{Math.abs(l.pts).toFixed(1)}
                    </span>
                  </Derive>
                ))}
                <div className="flex items-baseline justify-between border-t pt-1.5 mt-1.5 text-xs" style={{ borderColor: C.line }}>
                  <span className="uppercase tracking-[0.12em] flex items-center gap-2" style={{ color: C.dim }}>
                    <Derive id="mark.discount" ctx={dctx}>= MARK</Derive>
                    <Derive id="mark.regime" ctx={dctx}><RegimeTag regime={quant.regime} /></Derive>
                  </span>
                  <Derive id="mark.attribution" ctx={dctx}>
                    <span className="font-bold text-sm" style={{ color: C.amber }}>{quant.price.toFixed(1)}</span>
                  </Derive>
                </div>
              </div>
              <p className="text-[10px] mt-2 uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
                The mark is what a risk-averse market would pay for this desk today: fair value minus every live
                risk charge. Charges bill at full weight, credits are damped, and nothing trades above fair value —
                the deepest discounts are where work pays most. Hover any line for its equation.
              </p>
            </Section>
          )}

          {depth && (
            <Section title="MARKET DEPTH · THE ORDER BOOK">
              <DepthLadder depth={depth} color={sub.color} deriveCtx={dctx} />
            </Section>
          )}

          {quant && (
            <Section title="ORACLE · NEXT EXAM">
              <div className="flex items-baseline gap-2">
                <Derive id="oracle.next" ctx={dctx}>
                  <span className="text-3xl font-bold" style={{ fontFamily: FONT.mono, color: C.accent }}>{quant.nextExam.mean.toFixed(1)}%</span>
                </Derive>
                <span className="text-xs" style={{ color: C.faint, fontFamily: FONT.mono }}>± {quant.nextExam.sd.toFixed(1)}</span>
                {Math.abs(quant.carry) >= 0.05 && (
                  <Derive id="oracle.carry" ctx={dctx}>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
                      CARRY VS FV {quant.carry > 0 ? "+" : ""}{quant.carry.toFixed(1)}
                    </span>
                  </Derive>
                )}
              </div>
              {/* These are the NEXT-EXAM intervals; fv.interval headlines the
                  FAIR-VALUE CI, a different range. The oracle.next popover on the
                  mean above already derives these CIs in its steps, so this line
                  is left as plain text rather than lighting a contradicting figure. */}
              <div className="mt-1.5 text-[10px] uppercase tracking-wider" style={{ color: C.dim, fontFamily: FONT.mono }}>
                50% CI {quant.nextExam.ci50.lo.toFixed(1)}–{quant.nextExam.ci50.hi.toFixed(1)} · 90% CI{" "}
                {quant.nextExam.ci90.lo.toFixed(1)}–{quant.nextExam.ci90.hi.toFixed(1)}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
                <Derive id="fv.ensemble" ctx={dctx}>
                  ENSEMBLE {Object.entries(quant.weights).filter(([, w]) => w > 0).map(([k, w]) => `${WEIGHT_LABELS[k] ?? k.toUpperCase()} ${w}`).join(" · ")}
                </Derive>
              </div>
              <p className="text-[10px] mt-1.5 uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
                Every print — coursework included — prices your capability; the exam offset recalibrates it to exam
                conditions. Intervals honestly widen when data is thin. A guide, not a promise.
              </p>
            </Section>
          )}

          <Section
            title={
              move ? `ANALYST COVERAGE · ${move}D FROM ${ratingPrev}` : "ANALYST COVERAGE"
            }
          >
            <Coverage rating={rating} price={quant?.price ?? 0} ctx={dctx} />
          </Section>

          <Section title="GRADE PROJECTION">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold" style={{ fontFamily: FONT.mono, color: gradeProj.grade != null ? C.text : C.faint }}>
                {gradeProj.grade != null ? `${gradeProj.grade.toFixed(1)}%` : "—"}
              </span>
            </div>
            <div className="mt-1" style={{ ...microLabel, color: C.faint }}>{gradeCopy}</div>
            {(gradeProj.examAvg != null || gradeProj.courseworkAvg != null) && (
              <div className="mt-1.5 text-[10px] uppercase tracking-wider" style={{ color: C.dim, fontFamily: FONT.mono }}>
                EXAMS {gradeProj.examAvg != null ? gradeProj.examAvg.toFixed(1) : "—"} · COURSEWORK{" "}
                {gradeProj.courseworkAvg != null ? gradeProj.courseworkAvg.toFixed(1) : "—"}
              </div>
            )}
            <div className="flex items-end gap-2 mt-3 pt-2 border-t" style={{ borderColor: C.line }}>
              <Field label="COURSEWORK % OF FINAL">
                <input
                  type="number" min="0" max="100" value={cwDraft} onChange={(e) => setCwDraft(e.target.value)}
                  className="gx-focus w-24 border px-2 py-1.5 text-sm font-bold text-center rounded-none"
                  style={{ ...inputStyle }} placeholder="signal"
                />
              </Field>
              <Btn variant="primary" onClick={() => onSetCourseworkPct(sub.id, cwDraft === "" ? null : clamp(Number(cwDraft), 0, 100))}>
                Set
              </Btn>
              {sub.courseworkPct != null && (
                <Btn onClick={() => { setCwDraft(""); onSetCourseworkPct(sub.id, null); }}>Clear</Btn>
              )}
            </div>
            <p className="mt-1.5 text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
              Blank = exams decide the grade; coursework still feeds the price. Per-result WORTH % overrides this split.
            </p>
          </Section>

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
                    {e.rank != null && e.cohortN != null && (
                      <span className="text-[10px]" style={{ color: C.faint }}>#{e.rank}/{e.cohortN}</span>
                    )}
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
            {!closed && (
              <Btn className="mt-2.5" onClick={() => onAddGrade(sub.id)}>
                <Plus size={12} /> Log result
              </Btn>
            )}
          </Section>

          <div className="pt-1 pb-3 space-y-2">
            {closed ? (
              /* A desk whose successor has already printed cannot come back:
                 the successor carries this tape now, and seating both would
                 count every print behind the split twice — in the aggregate,
                 the composite index and every cross-desk figure drawn from
                 them. Saying so is the point; a disabled button that does
                 nothing teaches nobody why. */
              succeededBy ? (
                <p
                  className="text-[10px] uppercase tracking-[0.14em] leading-relaxed"
                  style={{ color: C.faint, fontFamily: FONT.mono }}
                >
                  <span style={{ color: C.amber }}>■</span> {succeededBy.ticker} carries this tape now —
                  relisting {sub.ticker} would count its history twice. Trade {succeededBy.ticker}, or list a new subject.
                </p>
              ) : (
                <button
                  onClick={() => onRestoreSubject(sub.id)}
                  className="gx-focus text-[10px] font-bold uppercase tracking-[0.14em] flex items-center gap-1.5"
                  style={{ color: C.up, fontFamily: FONT.mono }}
                >
                  <ArchiveRestore size={12} /> Relist — trade this desk again
                </button>
              )
            ) : (
              <button
                onClick={() => onArchiveSubject(sub.id)}
                className="gx-focus text-[10px] font-bold uppercase tracking-[0.14em] flex items-center gap-1.5"
                style={{ color: C.amber, fontFamily: FONT.mono }}
              >
                <Archive size={12} /> Delist — stop trading it, keep every print in the book
              </button>
            )}
            <button
              onClick={() => (delArm.armed ? onDeleteSubject(sub.id) : delArm.arm())}
              className="gx-focus text-[10px] font-bold uppercase tracking-[0.14em] flex items-center gap-1.5"
              style={{ color: C.down, fontFamily: FONT.mono }}
            >
              <Trash2 size={12} /> {delArm.armed ? "Click again to strike every print for good" : "Delete subject and its prints"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
