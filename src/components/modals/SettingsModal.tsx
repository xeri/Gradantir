import { useRef, useState } from "react";
import { ArchiveRestore, Download, Radio, Trash2, Upload } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { Modal } from "../ui/Modal";
import { Btn } from "../ui/Btn";
import { useArmed } from "../ui/useArmed";
import { Toggle } from "../ui/Toggle";
import { inputStyle } from "../ui/Field";
import { TYPES } from "../../constants";
import { parseImport, serializeExport, type ImportPayload } from "../../lib/io";
import { DataLedger } from "./DataLedger";
import type { SectionKey } from "../../lib/ledger";
import { yearSpread } from "../../lib/quant/depth";
import { freshCalendar, teachingTermOf, termsOf, type TermSpan } from "../../lib/calendar";
import { currentTermKey } from "../../lib/periods";
import { clamp, pDate, todayStr } from "../../lib/utils";
import type { AppData, DepthModel, DepthSettings, Settings } from "../../types";

/** Whole weeks a term runs, inclusive — the sanity check on a hand-typed year. */
const weeksOf = (s: TermSpan): number =>
  Math.max(1, Math.round((pDate(s.end).getTime() - pDate(s.start).getTime()) / 604800000) + 1);

const validYear = (spans: TermSpan[] | undefined): boolean =>
  Array.isArray(spans) && spans.length === 4 && spans.every((s) => s.start <= s.end);

export function SettingsModal({
  data,
  depth,
  onSaveSettings,
  onReplace,
  onMerge,
  onClearAll,
  onRestoreSubject,
  onDeleteSubject,
  onRemoveItem,
  onClearSection,
  onOpenWire,
  onClose,
  today = todayStr(),
}: {
  data: AppData;
  depth: DepthModel | null;
  /** Freezes "where the school is today". The app never passes it; tests do. */
  today?: string;
  onSaveSettings: (s: Settings) => void;
  onReplace: (p: ImportPayload) => void;
  onMerge: (p: ImportPayload) => void;
  onClearAll: () => void;
  onRestoreSubject: (sid: string) => void;
  onDeleteSubject: (sid: string) => void;
  /** Drop one elicited row from the ledger. */
  onRemoveItem: (key: SectionKey, id: string) => void;
  onClearSection: (key: SectionKey) => void;
  /** Swap this modal for the wire — the AI intake desk (§29). */
  onOpenWire?: () => void;
  onClose: () => void;
}) {
  const tickerOf = (id: string) => data.subjects.find((s) => s.id === id)?.ticker ?? id;
  const [draft, setDraft] = useState<Settings>({
    weighted: data.settings.weighted,
    weights: { ...data.settings.weights },
    depth: { ...data.settings.depth },
    calendar: {
      settleDays: data.settings.calendar.settleDays,
      years: Object.fromEntries(
        Object.entries(data.settings.calendar.years).map(([y, spans]) => [y, spans.map((s) => ({ ...s }))]),
      ),
    },
  });
  /* THE CALENDAR EDITOR. One year at a time, four rows, real dates. A year the
     school has published is stored verbatim; a year it has not is shown
     projected off the nearest one it did — edit it and it becomes published. */
  const [calYear, setCalYear] = useState(() => pDate(today).getFullYear());
  const yearSpans = termsOf(calYear, draft.calendar);
  const published = validYear(draft.calendar.years[String(calYear)]);
  const teaching = teachingTermOf(today, draft.calendar);
  const filing = currentTermKey(draft.calendar, today);

  const setTermDate = (i: number, edge: "start" | "end", value: string) => {
    // A half-typed or cleared date is not a term boundary, so the book keeps the
    // one it has — but the draft identity still has to change. These inputs are
    // controlled, and returning without a state update means no re-render, which
    // leaves the DOM field stuck on the user's empty string while `draft` still
    // holds the old date: the field then looks cleared and saves the old value.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { setDraft((d) => ({ ...d })); return; }
    setDraft((d) => {
      const spans = termsOf(calYear, d.calendar).map((s) => ({ ...s }));
      spans[i] = { ...spans[i], [edge]: value };
      // A term that closes before it opens is a typo, not a school year: the
      // edited edge wins and the term collapses onto that single day, whichever
      // edge was dragged across the other.
      if (spans[i].end < spans[i].start) {
        spans[i] = { start: value, end: value };
      }
      return { ...d, calendar: { ...d.calendar, years: { ...d.calendar.years, [String(calYear)]: spans } } };
    });
  };

  const resetYear = () =>
    setDraft((d) => {
      const years = { ...d.calendar.years };
      const fresh = freshCalendar().years[String(calYear)];
      if (fresh) years[String(calYear)] = fresh.map((s) => ({ ...s }));
      else delete years[String(calYear)];
      return { ...d, calendar: { ...d.calendar, years } };
    });

  const [pending, setPending] = useState<ImportPayload | null>(null);
  const [ioMsg, setIoMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const clearArm = useArmed();
  const replaceArm = useArmed();
  const [confirmKill, setConfirmKill] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const archived = data.subjects.filter((s) => s.archived);

  const setWeight = (t: (typeof TYPES)[number], v: string) => {
    const num = Number(v);
    setDraft((d) => ({ ...d, weights: { ...d.weights, [t]: Number.isNaN(num) ? d.weights[t] : Math.max(0.1, Math.min(10, num)) } }));
  };

  const exportJson = () => {
    const blob = new Blob([serializeExport({ ...data, settings: draft })], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grade-exchange-${todayStr()}.json`;
    // Firefox only honours a click on an anchor that is in the document, and
    // revoking synchronously can pull the blob out from under a download that
    // has not committed yet. This is the one button standing between a book
    // that lives in localStorage and a backup, so it does not get to be flaky.
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setIoMsg({ text: "Export downloaded." });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const res = parseImport(await file.text());
    if (!res.ok) {
      setPending(null);
      setIoMsg({ text: res.error, bad: true });
    } else {
      setPending(res.payload);
      setIoMsg({
        text: `Found ${res.payload.subjects.length} subjects, ${res.payload.entries.length} entries` +
          (res.payload.dropped ? ` (${res.payload.dropped} invalid rows skipped)` : "") + ". Replace the book or merge in?",
      });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const setDepth = (patch: Partial<DepthSettings>) =>
    setDraft((d) => ({ ...d, depth: { ...d.depth, ...patch } }));

  const label = { ...microLabel, color: C.faint } as const;
  const numCls = "gx-focus w-20 border px-1.5 py-1 text-xs font-bold text-center rounded-none";

  /* What the current knobs imply, live — the knobs are abstract, this is not. */
  const sigmaClass = depth?.fitted ? depth.sigmaClass : null;
  const sigmaYear = sigmaClass != null ? yearSpread(sigmaClass, draft.depth) : null;
  const impliedYear = draft.depth.yearSize ?? (depth ? Math.max(1, draft.depth.streamsPerLevel) * depth.medianCohort : null);

  return (
    <Modal title="DESK SETTINGS" onClose={onClose} wide>
      <div className="space-y-5">
        <div>
          <div className="mb-2" style={label}>ASSESSMENT WEIGHTS</div>
          <div className="flex items-center gap-2 flex-wrap">
            {TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ fontFamily: FONT.mono, color: C.dim }}>
                {t}
                <input
                  type="number" min="0.1" max="10" step="0.5"
                  value={draft.weights[t]}
                  onChange={(e) => setWeight(t, e.target.value)}
                  disabled={!draft.weighted}
                  className="gx-focus w-16 border px-1.5 py-1 text-xs font-bold text-center rounded-none disabled:opacity-40"
                  style={inputStyle}
                  aria-label={`${t} weight`}
                />
              </label>
            ))}
            <Toggle on={draft.weighted} onClick={() => setDraft((d) => ({ ...d, weighted: !d.weighted }))}>Weighted</Toggle>
          </div>
          <p className="mt-1.5 text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
            Heavier types count for more in every average, the composite, and the target calculator.
          </p>
        </div>

        <div className="border-t pt-4" style={{ borderColor: C.line }}>
          <div className="mb-2" style={label}>MARKET DEPTH — COHORT GEOMETRY</div>

          {depth?.fitted && (
            <div
              className="mb-3 border px-2.5 py-2 text-[10px] uppercase tracking-wider leading-relaxed"
              style={{
                fontFamily: FONT.mono,
                background: depth.streamed ? "rgba(232,163,61,0.07)" : C.panel2,
                borderColor: depth.streamed ? "rgba(232,163,61,0.35)" : C.line,
                color: depth.streamed ? C.amber : C.faint,
              }}
            >
              {depth.streamed ? (
                <>
                  <span className="font-bold">STREAMING DETECTED</span> — your classes average{" "}
                  <span className="font-bold">{depth.premiumMean >= 0 ? "+" : ""}{depth.premiumMean}</span> ±{depth.premiumSe} PTS
                  against the year level over {depth.groups.length} periods. Placements alone will misread your position —
                  set the geometry below so the field can be priced.
                </>
              ) : (
                <>
                  NO STREAMING SIGNAL — your classes sit within noise of the year level ({depth.premiumMean >= 0 ? "+" : ""}
                  {depth.premiumMean} ±{depth.premiumSe} PTS). The defaults below are already right.
                </>
              )}
              <div className="mt-1" style={{ color: C.faint }}>
                FITTED ON {depth.n} PLACEMENTS · WITHIN-CLASS SPREAD σ {depth.sigmaClass} PTS · RESIDUAL {depth.rmse} PTS
              </div>
            </div>
          )}

          <div className="flex items-end gap-3 flex-wrap">
            {[
              { k: "streamsPerLevel" as const, lab: "Streams", hint: "classes per year level", min: 1, max: 200, step: 1 },
              { k: "yearSize" as const, lab: "Year size", hint: "blank = streams × class size", min: 2, max: 100000, step: 1 },
            ].map(({ k, lab, hint, min, max, step }) => (
              <label key={k} className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ fontFamily: FONT.mono, color: C.dim }}>
                {lab}
                <input
                  type="number" min={min} max={max} step={step}
                  value={draft.depth[k] ?? ""}
                  placeholder={k === "yearSize" ? String(impliedYear ?? "") : ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") { setDepth({ [k]: k === "yearSize" ? null : 1 } as Partial<DepthSettings>); return; }
                    const n = Math.round(Number(raw));
                    if (Number.isFinite(n)) setDepth({ [k]: Math.max(min, Math.min(max, n)) } as Partial<DepthSettings>);
                  }}
                  className={numCls}
                  style={inputStyle}
                  aria-label={`${lab} — ${hint}`}
                />
                <span style={{ color: C.faint, fontWeight: 400 }}>{hint}</span>
              </label>
            ))}

            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider grow min-w-[190px]" style={{ fontFamily: FONT.mono, color: C.dim }}>
              <span>Streaming tightness · {draft.depth.streamTightness.toFixed(2)}</span>
              <input
                type="range" min="0" max="1" step="0.05"
                value={draft.depth.streamTightness}
                onChange={(e) => setDepth({ streamTightness: Number(e.target.value) })}
                className="gx-focus w-full accent-current"
                style={{ accentColor: C.amber }}
                aria-label="Streaming tightness"
              />
              <span style={{ color: C.faint, fontWeight: 400 }}>0 = classes are random slices · 1 = sorted strictly by mark</span>
            </label>
          </div>

          <p className="mt-2 text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
            A placement is a statement about a class. These three say how a class relates to the year level, which is what
            turns it into a field position — the depth ladder, the field percentile, and the peer premium all read from here.
            {sigmaYear != null && (
              <>
                {" "}Currently: year-level spread <span style={{ color: C.dim }}>σ {sigmaYear.toFixed(1)} PTS</span>
                {impliedYear != null && <> across <span style={{ color: C.dim }}>{impliedYear} students</span></>}
                {draft.depth.streamsPerLevel === 1 || draft.depth.streamTightness === 0
                  ? " — the class is treated as the whole field."
                  : "."}
              </>
            )}
          </p>
        </div>

        <div className="border-t pt-4" style={{ borderColor: C.line }}>
          <span style={label}>AGGREGATE COVARIANCE</span>
          <label className="mt-2 flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ fontFamily: FONT.mono, color: C.dim }}>
            <span>Subject affinity ρ · {(draft.subjectCorr ?? 0).toFixed(2)}</span>
            <input
              type="range" min="0" max="0.9" step="0.05"
              value={draft.subjectCorr ?? 0}
              onChange={(e) => setDraft((d) => ({ ...d, subjectCorr: Number(e.target.value) }))}
              className="gx-focus w-full accent-current"
              style={{ accentColor: C.amber }}
              aria-label="Subject affinity correlation"
            />
            <span style={{ color: C.faint, fontWeight: 400 }}>
              0 = desks independent (quadrature) · higher = a bad term hits the whole book, widening the PREDICTION &amp; COMPOSITE bands
            </span>
          </label>
        </div>

        <div className="border-t pt-4" style={{ borderColor: C.line }}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span style={label}>SCHOOL CALENDAR</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCalYear((y) => y - 1)}
                className="gx-focus inline-flex items-center justify-center min-w-6 min-h-6 border px-1.5 py-0.5 text-[10px] font-bold hover:brightness-125"
                style={{ ...inputStyle, fontFamily: FONT.mono }}
                aria-label="Previous year"
              >
                ‹
              </button>
              <span className="text-xs font-bold tabular-nums" style={{ fontFamily: FONT.mono, color: C.amber }}>{calYear}</span>
              <button
                onClick={() => setCalYear((y) => y + 1)}
                className="gx-focus inline-flex items-center justify-center min-w-6 min-h-6 border px-1.5 py-0.5 text-[10px] font-bold hover:brightness-125"
                style={{ ...inputStyle, fontFamily: FONT.mono }}
                aria-label="Next year"
              >
                ›
              </button>
            </div>
          </div>

          <div className="space-y-1">
            {yearSpans.map((span, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-6 text-[10px] font-bold shrink-0" style={{ fontFamily: FONT.mono, color: C.amber }}>T{i + 1}</span>
                <input
                  type="date"
                  className="gx-focus border px-1.5 py-1 text-[11px] rounded-none flex-1 min-w-0"
                  style={inputStyle}
                  value={span.start}
                  onChange={(e) => setTermDate(i, "start", e.target.value)}
                  aria-label={`Term ${i + 1} ${calYear} opens`}
                />
                <span className="text-[10px] shrink-0" style={{ color: C.faint, fontFamily: FONT.mono }}>→</span>
                <input
                  type="date"
                  className="gx-focus border px-1.5 py-1 text-[11px] rounded-none flex-1 min-w-0"
                  style={inputStyle}
                  value={span.end}
                  onChange={(e) => setTermDate(i, "end", e.target.value)}
                  aria-label={`Term ${i + 1} ${calYear} closes`}
                />
                <span className="w-14 text-right text-[9px] shrink-0 uppercase" style={{ color: C.faint, fontFamily: FONT.mono }}>
                  {weeksOf(span)} WKS
                </span>
              </div>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider" style={{ fontFamily: FONT.mono, color: C.dim }}>
              RESULTS SETTLE WITHIN
              <input
                type="number"
                min={0}
                max={90}
                step={7}
                value={draft.calendar.settleDays}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    calendar: { ...d.calendar, settleDays: clamp(Math.round(Number(e.target.value) || 0), 0, 90) },
                  }))
                }
                className="gx-focus border px-1.5 py-1 text-xs font-bold rounded-none w-16"
                style={inputStyle}
                aria-label="Days a result may land after a term opens and still file against the term before"
              />
              DAYS OF A TERM OPENING
            </label>
            {!published && (
              <span className="text-[9px] uppercase tracking-wider" style={{ color: C.amber, fontFamily: FONT.mono }}>
                PROJECTED — NOT PUBLISHED DATES
              </span>
            )}
            <button
              onClick={resetYear}
              className="gx-focus text-[9px] font-bold uppercase tracking-wider underline hover:brightness-125"
              style={{ color: C.faint, fontFamily: FONT.mono }}
            >
              RESET {calYear}
            </button>
          </div>

          <p className="mt-2 text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
            Exams are sat before a term ends and handed back after it — so a result files against the term it EXAMINED,
            not the term its date lands in. Anything dated inside {draft.calendar.settleDays} days of a term opening
            belongs to the term before. Today: teaching <span style={{ color: C.dim }}>T{teaching.ref.term} {teaching.ref.year}
            {teaching.week != null ? ` WK ${teaching.week}` : " (BREAK)"}</span>, filing{" "}
            <span style={{ color: C.dim }}>{filing.label}</span>. Any result can still be re-filed by hand from its own row.
          </p>
        </div>

        <div className="border-t pt-4" style={{ borderColor: C.line }}>
          <div className="mb-2" style={label}>ARCHIVED DESKS</div>
          {archived.length === 0 ? (
            <p className="text-[11px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
              Nothing in the vault. Archive a subject from its quote drawer when a year wraps up — its prints stay
              on file but leave every board and index.
            </p>
          ) : (
            <div className="space-y-1.5">
              {archived.map((s) => {
                const count = data.entries.filter((e) => e.subjectId === s.id).length;
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 border px-2.5 py-1.5"
                    style={{ background: C.panel2, borderColor: C.line }}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 shrink-0" style={{ background: s.color }} />
                      <span className="text-xs font-bold tracking-[0.08em] shrink-0" style={{ fontFamily: FONT.mono, color: s.color }}>{s.ticker}</span>
                      <span className="text-[11px] truncate uppercase tracking-wide" style={{ color: C.faint }}>{s.name}</span>
                      <span className="text-[10px] shrink-0" style={{ color: C.faint, fontFamily: FONT.mono }}>
                        {count} PRINT{count === 1 ? "" : "S"}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <Btn onClick={() => onRestoreSubject(s.id)}><ArchiveRestore size={12} /> Restore</Btn>
                      <Btn
                        variant="danger"
                        onClick={() => {
                          if (confirmKill !== s.id) { setConfirmKill(s.id); return; }
                          setConfirmKill(null);
                          onDeleteSubject(s.id);
                        }}
                      >
                        <Trash2 size={12} /> {confirmKill === s.id ? "Sure?" : "Delete forever"}
                      </Btn>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t pt-4" style={{ borderColor: C.line }}>
          <div className="mb-2" style={label}>DATA</div>
          <div className="mb-3">
            <DataLedger data={data} tickerOf={tickerOf} onRemove={onRemoveItem} onClear={onClearSection} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={exportJson}><Download size={12} /> Export JSON</Btn>
            <Btn onClick={() => fileRef.current?.click()}><Upload size={12} /> Import JSON</Btn>
            {onOpenWire && <Btn onClick={onOpenWire}><Radio size={12} /> The Wire — import via AI</Btn>}
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Btn
              variant="danger"
              onClick={() => {
                if (!clearArm.armed) { clearArm.arm(); return; }
                onClearAll();
              }}
            >
              {clearArm.armed ? "Click again — wipes everything" : "Clear book"}
            </Btn>
          </div>
          {ioMsg && (
            <p className="mt-2.5 text-[11px] font-semibold" style={{ color: ioMsg.bad ? C.down : C.dim, fontFamily: FONT.mono }}>
              {ioMsg.text}
            </p>
          )}
          {pending && (
            <div className="flex flex-wrap gap-2 mt-2">
              {/* Replace DISCARDS the current book outright and the save effect
                  commits it before this modal closes — it sat one misclick away
                  from "Merge in" with no confirm, while "Clear book" beside it
                  takes two. Same weight, and the label says what is at stake. */}
              <Btn
                variant="danger"
                onClick={() => {
                  if (!replaceArm.armed) { replaceArm.arm(); return; }
                  onReplace(pending);
                }}
              >
                {replaceArm.armed
                  ? `Click again — discards ${data.subjects.length} subject${data.subjects.length === 1 ? "" : "s"} and ${data.entries.length} result${data.entries.length === 1 ? "" : "s"}`
                  : "Replace book"}
              </Btn>
              <Btn variant="primary" onClick={() => onMerge(pending)}>Merge in</Btn>
              <Btn onClick={() => { setPending(null); setIoMsg(null); replaceArm.disarm(); }}>Cancel</Btn>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t pt-4" style={{ borderColor: C.line }}>
          <Btn onClick={onClose}>Close</Btn>
          <Btn variant="primary" onClick={() => { onSaveSettings(draft); onClose(); }}>Save settings</Btn>
        </div>
      </div>
    </Modal>
  );
}
