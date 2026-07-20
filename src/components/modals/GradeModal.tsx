import { useState } from "react";
import { C } from "../../theme";
import { Modal } from "../ui/Modal";
import { Btn } from "../ui/Btn";
import { Field, inputCls, inputStyle } from "../ui/Field";
import { TYPES } from "../../constants";
import { round1, todayStr, uid } from "../../lib/utils";
import type { AssessmentType, GradeEntry, Subject } from "../../types";

export function GradeModal({
  subjects,
  entry,
  defaultSubjectId,
  onSave,
  onClose,
}: {
  subjects: Subject[];
  entry?: GradeEntry;
  defaultSubjectId?: string;
  onSave: (e: GradeEntry) => void;
  onClose: () => void;
}) {
  const [subjectId, setSubjectId] = useState(entry?.subjectId || defaultSubjectId || subjects[0]?.id || "");
  const [type, setType] = useState<AssessmentType>(entry?.type || "Test");
  const [score, setScore] = useState(entry ? String(entry.score) : "");
  const [date, setDate] = useState(entry?.date || todayStr());
  const [title, setTitle] = useState(entry?.title || "");
  const [classAvg, setClassAvg] = useState(entry?.classAvg != null ? String(entry.classAvg) : "");
  const [err, setErr] = useState("");

  const save = () => {
    const n = Number(score);
    if (score === "" || Number.isNaN(n)) { setErr("Enter the result as a number."); return; }
    if (n < 0 || n > 100) { setErr("Results run from 0 to 100."); return; }
    if (!subjectId) { setErr("Pick a subject."); return; }
    if (!date) { setErr("Pick a date."); return; }
    let ca: number | null = null;
    if (classAvg !== "") {
      const c = Number(classAvg);
      if (Number.isNaN(c) || c < 0 || c > 100) { setErr("Class average runs from 0 to 100 — or leave it blank."); return; }
      ca = round1(c);
    }
    onSave({ id: entry?.id || uid(), subjectId, type, score: round1(n), date, title: title.trim(), classAvg: ca });
  };

  return (
    <Modal title={entry ? "EDIT RESULT" : "LOG A RESULT"} onClose={onClose}>
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
          <Field label="SCORE %">
            <input className={inputCls} style={inputStyle} type="number" min="0" max="100" step="0.5" value={score} onChange={(e) => setScore(e.target.value)} placeholder="82.5" autoFocus />
          </Field>
          <Field label="DATE">
            <input className={inputCls} style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CLASS AVG % (OPT)">
            <input className={inputCls} style={inputStyle} type="number" min="0" max="100" step="0.5" value={classAvg} onChange={(e) => setClassAvg(e.target.value)} placeholder="for α" />
          </Field>
          <Field label="LABEL (OPT)">
            <input className={inputCls} style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mid-year exam" />
          </Field>
        </div>
        {err && <p className="text-xs font-semibold" style={{ color: C.down }}>{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save}>{entry ? "Save changes" : "Log result"}</Btn>
        </div>
      </div>
    </Modal>
  );
}
