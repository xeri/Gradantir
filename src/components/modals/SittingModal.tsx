import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { Modal } from "../ui/Modal";
import { Btn } from "../ui/Btn";
import { Toggle } from "../ui/Toggle";
import { Field, inputCls, inputStyle } from "../ui/Field";
import { TYPES } from "../../constants";
import { STAKE_BANDS, STAKE_CHIPS } from "../../lib/elicit";
import { round1, todayStr, uid } from "../../lib/utils";
import type { AssessmentType, SelfPrediction, Subject, Upcoming } from "../../types";

const bandLabel = ([lo, hi]: readonly [number, number]): string =>
  lo === 0 ? `< ${hi}` : hi === 100 ? `${lo}+` : `${lo}–${hi}`;

export function SittingModal({
  subjects,
  sitting,
  defaultSubjectId,
  onSave,
  onClose,
}: {
  subjects: Subject[];
  sitting?: Upcoming;
  defaultSubjectId?: string;
  onSave: (u: Upcoming) => void;
  onClose: () => void;
}) {
  const [subjectId, setSubjectId] = useState(sitting?.subjectId || defaultSubjectId || subjects[0]?.id || "");
  const [type, setType] = useState<AssessmentType>(sitting?.type || "Exam");
  const [date, setDate] = useState(sitting?.date || todayStr());
  const [title, setTitle] = useState(sitting?.title || "");
  const [weight, setWeight] = useState(sitting?.weight != null ? String(sitting.weight) : "");
  const [coverage, setCoverage] = useState(sitting?.syllabusCoverage ?? 50);

  const [selfPoint, setSelfPoint] = useState(sitting?.selfPred?.point != null ? String(sitting.selfPred.point) : "");
  const [ranged, setRanged] = useState(sitting?.selfPred?.lo != null && sitting?.selfPred?.hi != null);
  const [selfLo, setSelfLo] = useState(sitting?.selfPred?.lo != null ? String(sitting.selfPred.lo) : "");
  const [selfHi, setSelfHi] = useState(sitting?.selfPred?.hi != null ? String(sitting.selfPred.hi) : "");
  const [teacher, setTeacher] = useState(sitting?.teacherPred != null ? String(sitting.teacherPred) : "");

  const [chips, setChips] = useState<number[]>(
    sitting?.chips && sitting.chips.length === STAKE_BANDS.length ? sitting.chips : STAKE_BANDS.map(() => 0),
  );
  const staked = chips.reduce((a, c) => a + c, 0);
  const left = STAKE_CHIPS - staked;
  const setChip = (i: number, d: number) =>
    setChips((cs) => {
      const next = cs.slice();
      const v = next[i] + d;
      if (v < 0 || (d > 0 && left <= 0)) return cs;
      next[i] = v;
      return next;
    });

  const [err, setErr] = useState("");

  const optPct = (v: string, label: string, allowZero = true): { ok: boolean; value: number | null } => {
    if (v === "") return { ok: true, value: null };
    const n = Number(v);
    const floor = allowZero ? 0 : 0.0001;
    if (Number.isNaN(n) || n < floor || n > 100) { setErr(`${label} runs 0–100 — or leave it blank.`); return { ok: false, value: null }; }
    return { ok: true, value: round1(n) };
  };

  const save = () => {
    if (!subjectId) { setErr("Pick a subject."); return; }
    if (!date) { setErr("Pick a date."); return; }
    const w = optPct(weight, "Worth", false);
    if (!w.ok) return;
    const sp = optPct(selfPoint, "Your prediction");
    if (!sp.ok) return;
    let selfPred: SelfPrediction | null = null;
    if (sp.value != null) {
      selfPred = { point: sp.value };
      if (ranged) {
        const lo = optPct(selfLo, "Range low"); if (!lo.ok) return;
        const hi = optPct(selfHi, "Range high"); if (!hi.ok) return;
        if (lo.value != null && hi.value != null) {
          if (hi.value <= lo.value) { setErr("The range high must exceed the low."); return; }
          selfPred = { point: sp.value, lo: lo.value, hi: hi.value };
        }
      }
    }
    const tp = optPct(teacher, "Teacher prediction");
    if (!tp.ok) return;

    onSave({
      id: sitting?.id || uid(),
      subjectId, type, date, title: title.trim(),
      ...(w.value != null ? { weight: w.value } : {}),
      ...(coverage !== 50 || sitting?.syllabusCoverage != null ? { syllabusCoverage: coverage } : {}),
      ...(selfPred ? { selfPred } : {}),
      ...(tp.value != null ? { teacherPred: tp.value } : {}),
      ...(staked > 0 ? { chips } : {}),
      // The wire's call is read-only here — an edit must not destroy it.
      ...(sitting?.aiPred ? { aiPred: sitting.aiPred } : {}),
    });
  };

  return (
    <Modal title={sitting ? "EDIT SITTING" : "SCHEDULE A SITTING"} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="SUBJECT">
            <select className={inputCls + " cursor-pointer font-semibold"} style={inputStyle} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="TYPE">
            <select className={inputCls + " cursor-pointer font-semibold"} style={inputStyle} value={type} onChange={(e) => setType(e.target.value as AssessmentType)}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="DATE SAT">
            <input className={inputCls} style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="WORTH % OF FINAL (OPT)">
            <input className={inputCls} style={inputStyle} type="number" min="0" max="100" step="1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g. 50" />
          </Field>
        </div>
        <Field label="LABEL (OPT)">
          <input className={inputCls} style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="End-of-year exam" />
        </Field>

        <Field label={`SYLLABUS COVERED · ${coverage}%`}>
          <input
            type="range" min="0" max="100" step="5" value={coverage}
            onChange={(e) => setCoverage(Number(e.target.value))}
            className="w-full accent-amber-500"
            style={{ accentColor: C.amber }}
            aria-label="Share of the syllabus covered"
          />
        </Field>

        <div className="border" style={{ borderColor: C.line }}>
          <div className="px-3 py-2 border-b" style={{ borderColor: C.line, background: C.panel }}>
            <span style={{ ...microLabel, color: C.accent }}>YOUR CALL — SCORED AGAINST THE DESK</span>
          </div>
          <div className="p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="YOUR PREDICTION %">
                <input className={inputCls} style={inputStyle} type="number" min="0" max="100" step="1" value={selfPoint} onChange={(e) => setSelfPoint(e.target.value)} placeholder="what will you get?" />
              </Field>
              <Field label="TEACHER'S PREDICTION % (OPT)">
                <input className={inputCls} style={inputStyle} type="number" min="0" max="100" step="1" value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="second forecaster" />
              </Field>
            </div>
            <Toggle on={ranged} onClick={() => setRanged((v) => !v)}>Give a 90% range</Toggle>
            {ranged && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="RANGE LOW %">
                  <input className={inputCls} style={inputStyle} type="number" min="0" max="100" step="1" value={selfLo} onChange={(e) => setSelfLo(e.target.value)} placeholder="worst case" />
                </Field>
                <Field label="RANGE HIGH %">
                  <input className={inputCls} style={inputStyle} type="number" min="0" max="100" step="1" value={selfHi} onChange={(e) => setSelfHi(e.target.value)} placeholder="best case" />
                </Field>
              </div>
            )}
          </div>
        </div>

        {sitting?.aiPred && (
          <div className="border" style={{ borderColor: C.line }}>
            <div className="px-3 py-2 border-b" style={{ borderColor: C.line, background: C.panel }}>
              <span style={{ ...microLabel, color: C.accent }}>THE WIRE'S CALL — FILED BY THE AI DESK</span>
            </div>
            <div className="p-3 space-y-1.5">
              <p className="text-sm font-semibold tabular-nums" style={{ color: C.text, fontFamily: FONT.mono }}>
                {sitting.aiPred.point}%
                {sitting.aiPred.lo != null && sitting.aiPred.hi != null && (
                  <span style={{ color: C.dim }}>{"  "}[{sitting.aiPred.lo}–{sitting.aiPred.hi}]</span>
                )}
              </p>
              {sitting.aiPred.basis && (
                <p className="text-[11px] leading-relaxed" style={{ color: C.dim, fontFamily: FONT.mono }}>{sitting.aiPred.basis}</p>
              )}
              <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
                Read-only — re-run the wire to revise it.
              </p>
            </div>
          </div>
        )}

        <div className="border" style={{ borderColor: C.line }}>
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: C.line, background: C.panel }}>
            <span style={{ ...microLabel, color: C.accent }}>STAKE 10 CHIPS (OPT)</span>
            <span style={{ ...microLabel, color: left > 0 ? C.amber : C.faint }}>{left} LEFT</span>
          </div>
          <div className="p-3 space-y-1.5">
            {STAKE_BANDS.map((band, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 text-right text-[11px]" style={{ color: C.dim, fontFamily: FONT.mono }}>{bandLabel(band)}</span>
                <button onClick={() => setChip(i, -1)} disabled={chips[i] <= 0} className="gx-focus border p-1 disabled:opacity-30" style={{ borderColor: C.lineBright, color: C.dim }} aria-label={`Fewer chips on ${bandLabel(band)}`}>
                  <Minus size={11} />
                </button>
                <div className="flex-1 h-3 flex items-center gap-0.5" aria-hidden="true">
                  {Array.from({ length: chips[i] }).map((_, k) => (
                    <span key={k} className="inline-block w-2.5 h-2.5" style={{ background: C.amber }} />
                  ))}
                </div>
                <span className="w-5 text-center text-[11px] tabular-nums" style={{ color: chips[i] > 0 ? C.amber : C.faint, fontFamily: FONT.mono }}>{chips[i]}</span>
                <button onClick={() => setChip(i, 1)} disabled={left <= 0} className="gx-focus border p-1 disabled:opacity-30" style={{ borderColor: C.lineBright, color: C.dim }} aria-label={`More chips on ${bandLabel(band)}`}>
                  <Plus size={11} />
                </button>
              </div>
            ))}
            <p className="text-[10px] uppercase tracking-wider leading-relaxed pt-1" style={{ color: C.faint, fontFamily: FONT.mono }}>
              Lay your chips where you think the mark lands. Scored by a proper rule against the desk once it prints.
            </p>
          </div>
        </div>

        {err && <p className="text-xs font-semibold" style={{ color: C.down }}>{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save}>{sitting ? "Save sitting" : "Schedule it"}</Btn>
        </div>
      </div>
    </Modal>
  );
}
