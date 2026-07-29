import { useState } from "react";
import { C } from "../../theme";
import { Modal } from "../ui/Modal";
import { Btn } from "../ui/Btn";
import { Field, inputCls, inputStyle } from "../ui/Field";
import { PALETTE } from "../../constants";
import { clamp, uid } from "../../lib/utils";
import type { Subject } from "../../types";

export function SubjectModal({
  subjects,
  onSave,
  onClose,
}: {
  subjects: Subject[];
  onSave: (s: Subject) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [tickerTouched, setTickerTouched] = useState(false);
  const used = new Set(subjects.map((s) => s.color));
  const [color, setColor] = useState(PALETTE.find((c) => !used.has(c)) || PALETTE[subjects.length % PALETTE.length]);
  const [target, setTarget] = useState("");
  const [coursework, setCoursework] = useState("");
  const [err, setErr] = useState("");

  const handleName = (v: string) => {
    setName(v);
    if (!tickerTouched) setTicker(v.replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase());
  };
  const save = () => {
    if (!name.trim()) { setErr("Give the subject a name."); return; }
    const tk = (ticker.trim() || name.slice(0, 4)).toUpperCase();
    if (subjects.some((s) => s.ticker === tk)) { setErr(`Ticker ${tk} is taken — pick another.`); return; }
    if (coursework !== "" && (Number.isNaN(Number(coursework)) || Number(coursework) < 0 || Number(coursework) > 100)) {
      setErr("Coursework share runs from 0 to 100 — or leave it blank.");
      return;
    }
    onSave({
      id: uid(), name: name.trim(), ticker: tk, color,
      target: target === "" ? null : clamp(Number(target), 0, 100),
      courseworkPct: coursework === "" ? null : clamp(Number(coursework), 0, 100),
    });
  };

  return (
    <Modal title="LIST A NEW SUBJECT" onClose={onClose}>
      <div className="space-y-4">
        <Field label="SUBJECT NAME">
          <input className={inputCls} style={inputStyle} value={name} onChange={(e) => handleName(e.target.value)} placeholder="e.g. Chemistry" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="TICKER">
            <input
              className={inputCls} style={inputStyle} value={ticker} maxLength={5}
              onChange={(e) => { setTickerTouched(true); setTicker(e.target.value.toUpperCase()); }} placeholder="CHEM"
            />
          </Field>
          <Field label="TARGET % (OPT)">
            <input className={inputCls} style={inputStyle} type="number" min="0" max="100" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="85" />
          </Field>
        </div>
        <Field label="COURSEWORK % OF FINAL (OPT)">
          <input className={inputCls} style={inputStyle} type="number" min="0" max="100" value={coursework} onChange={(e) => setCoursework(e.target.value)} placeholder="signal only" />
          <span className="block mt-1.5 text-[10px] uppercase tracking-wider" style={{ color: C.faint }}>
            Leave blank if exams decide the grade — coursework still feeds the price.
          </span>
        </Field>
        <Field label="LINE COLOR">
          {/* A single-select swatch grid: radiogroup, not a row of buttons, so a
              screen reader announces the set and which swatch is chosen — the
              selection was carried only by a border and a scale before. */}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Line color">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                className="gx-focus w-7 h-7 border-2 transition-transform"
                style={{ background: c, borderColor: color === c ? C.text : "transparent", transform: color === c ? "scale(1.1)" : "none" }}
              />
            ))}
          </div>
        </Field>
        {err && <p className="text-xs font-semibold" style={{ color: C.down }}>{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save}>List subject</Btn>
        </div>
      </div>
    </Modal>
  );
}
