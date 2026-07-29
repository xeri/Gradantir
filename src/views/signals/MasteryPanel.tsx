import { useState } from "react";
import { C, FONT, microLabel } from "../../theme";
import { Field, inputCls, inputStyle } from "../../components/ui/Field";
import { Btn } from "../../components/ui/Btn";
import type { Subject, Topic } from "../../types";
import type { MasteryRead, TopicMastery } from "../../lib/quant/signals/mastery";

export type { Subject, Topic } from "../../types";

/**
 * D5 · MASTERY PANEL — a READ-ONLY window onto `mastery.ts`'s own output.
 *
 * Everything above the add/edit form is display only: per-topic mastery bars
 * and each desk's coverage %, read straight off the `SubjectMasteryRead` the
 * SIGNALS view computed once (calling `topicMastery`/`masteryRead` itself,
 * with the exact same per-subject filtering `signalRead` already applies) and
 * handed down as `masteryBySubject`. This component never imports or calls
 * either function — the same "the leaf renders, the view computes" split the
 * per-term marginal table one level up already holds, so the engine is
 * called from exactly one place per render pass rather than drifting out of
 * sync with whatever `signalRead` itself folds into the priced board.
 *
 * Topic add/edit is the one thing that DOES write here, and it is a discrete
 * event — a name, an optional weight, a set of prerequisite chips — filed on
 * submit exactly like LogPanels' three panels (T16), never a slider: there is
 * no drag to defend against, so no draft-then-commit split is needed. As with
 * every write in the life-signals layer, the id is struck in App.tsx alone;
 * this component hands back only the values a student typed or picked, plus
 * the EXISTING id of a topic already being edited (never a freshly minted
 * one — that topic already has an id, this just says which row to update).
 */

export interface SubjectMasteryRead {
  masteries: TopicMastery[];
  read: MasteryRead;
}

export interface MasteryPanelProps {
  /** Live desks only. */
  subjects: Subject[];
  /** Every topic across every live subject. */
  topics: Topic[];
  /** subjectId -> the mastery engine's own output, computed once by the view. */
  masteryBySubject: Map<string, SubjectMasteryRead>;
  onAddTopic: (subjectId: string, name: string, weightPct: number | null, prereqIds: string[]) => void;
  onEditTopic: (topicId: string, name: string, weightPct: number | null, prereqIds: string[]) => void;
}

const hintStyle = { color: C.faint, fontFamily: FONT.mono } as const;
const barTone = (v: number) => (v >= 0.7 ? C.up : v >= 0.4 ? C.amber : C.down);

function MasteryBar({ topic, m }: { topic: Topic; m: TopicMastery | undefined }) {
  const pct = Math.round((m?.mEff ?? 0) * 100);
  const untouched = !m || m.n === 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 truncate text-[11px] font-bold" style={{ color: C.text, fontFamily: FONT.mono }} title={topic.name}>
        {topic.name}
      </span>
      <div className="flex-1 h-3 border" style={{ borderColor: C.line, background: C.strip }}>
        <div className="h-full transition-[width]" style={{ width: `${pct}%`, background: untouched ? C.line : barTone(m!.mEff) }} />
      </div>
      <span className="w-8 text-right text-[10px] tabular-nums" style={{ color: C.dim, fontFamily: FONT.mono }}>{pct}%</span>
      <span className="w-20 shrink-0 text-right text-[10px] uppercase tracking-wider" style={hintStyle}>
        {untouched ? "NO MARKS YET" : `${m!.n} MARK${m!.n === 1 ? "" : "S"}`}
      </span>
    </div>
  );
}

function SubjectBlock({
  subject, topics, masteryRead, onEditTopic: startEdit,
}: {
  subject: Subject;
  topics: Topic[];
  masteryRead: SubjectMasteryRead | undefined;
  onEditTopic: (t: Topic) => void;
}) {
  const coverage = masteryRead?.read.coverage ?? null;
  const masteryByTopic = new Map((masteryRead?.masteries ?? []).map((m) => [m.topicId, m]));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 shrink-0" aria-hidden="true" style={{ background: subject.color }} />
          <span className="text-xs font-bold tracking-[0.08em]" style={{ fontFamily: FONT.mono, color: subject.color }}>{subject.name}</span>
        </span>
        <span className="text-[10px] uppercase tracking-wider" style={hintStyle}>
          {coverage == null ? "NO TOPICS LISTED" : `${Math.round(coverage * 100)}% COVERED`}
        </span>
      </div>
      {topics.length === 0 ? (
        <p className="text-[10px] uppercase tracking-wider leading-relaxed pl-4" style={hintStyle}>NO TOPICS LOGGED FOR THIS DESK YET.</p>
      ) : (
        <div className="space-y-1.5 pl-4">
          {topics.map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <div className="flex-1"><MasteryBar topic={t} m={masteryByTopic.get(t.id)} /></div>
              <button
                type="button"
                onClick={() => startEdit(t)}
                className="gx-focus text-[10px] font-bold uppercase tracking-wider hover:brightness-150"
                style={{ color: C.faint, fontFamily: FONT.mono }}
                aria-label={`Edit ${t.name}`}
              >
                EDIT
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MasteryPanel({ subjects, topics, masteryBySubject, onAddTopic, onEditTopic }: MasteryPanelProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [prereqIds, setPrereqIds] = useState<string[]>([]);
  const [err, setErr] = useState("");

  const subjectTopics = topics.filter((t) => t.subjectId === subjectId);
  /* A topic being edited cannot name itself as its own prerequisite. */
  const prereqChoices = subjectTopics.filter((t) => t.id !== editId);
  const togglePrereq = (id: string) => setPrereqIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const resetForm = () => { setEditId(null); setName(""); setWeight(""); setPrereqIds([]); setErr(""); };

  const startEdit = (t: Topic) => {
    setSubjectId(t.subjectId);
    setEditId(t.id);
    setName(t.name);
    setWeight(t.weightPct != null ? String(t.weightPct) : "");
    setPrereqIds(t.prereqIds ?? []);
    setErr("");
  };

  const submit = () => {
    if (!name.trim()) { setErr("Give the topic a name."); return; }
    let w: number | null = null;
    if (weight !== "") {
      const n = Number(weight);
      if (!Number.isFinite(n) || n < 0 || n > 100) { setErr("Weight runs from 0 to 100 — or leave it blank."); return; }
      w = n;
    }
    if (editId) onEditTopic(editId, name.trim(), w, prereqIds);
    else onAddTopic(subjectId, name.trim(), w, prereqIds);
    resetForm();
  };

  if (subjects.length === 0) {
    return (
      <p className="text-[11px] uppercase tracking-wider leading-relaxed" style={hintStyle}>
        LIST A SUBJECT TO TRACK ITS TOPIC MASTERY.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {subjects.map((s) => (
          <SubjectBlock
            key={s.id}
            subject={s}
            topics={topics.filter((t) => t.subjectId === s.id)}
            masteryRead={masteryBySubject.get(s.id)}
            onEditTopic={startEdit}
          />
        ))}
      </div>

      <div className="border-t pt-4" style={{ borderColor: C.line }}>
        <span className="block mb-2" style={{ ...microLabel, color: C.faint }}>{editId ? "EDIT TOPIC" : "ADD TOPIC"}</span>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="SUBJECT">
              <select
                className={inputCls + " cursor-pointer font-semibold"}
                style={inputStyle}
                value={subjectId}
                disabled={editId != null}
                onChange={(e) => { setSubjectId(e.target.value); setPrereqIds([]); }}
              >
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="WEIGHT % (OPT)">
              <input
                className={inputCls} style={inputStyle} type="number" min={0} max={100} step={1}
                value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="equal share"
              />
            </Field>
          </div>
          <Field label="TOPIC NAME">
            <input className={inputCls} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Quadratics" />
          </Field>
          {prereqChoices.length > 0 && (
            <div>
              <span className="block mb-1.5" style={{ ...microLabel, color: C.faint }}>PREREQUISITES (OPT)</span>
              <div className="flex flex-wrap gap-1.5">
                {prereqChoices.map((t) => {
                  const on = prereqIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => togglePrereq(t.id)}
                      aria-pressed={on}
                      className="gx-focus border px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        fontFamily: FONT.mono,
                        borderColor: on ? C.amber : C.lineBright,
                        color: on ? C.amber : C.faint,
                        background: on ? "rgba(232,163,61,0.1)" : "transparent",
                      }}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {err && <p className="text-xs font-semibold" style={{ color: C.down }}>{err}</p>}
          <div className="flex gap-2">
            <Btn variant="primary" onClick={submit} className="flex-1 justify-center">
              {editId ? "Save changes" : "Add topic"}
            </Btn>
            {editId && <Btn onClick={resetForm}>Cancel</Btn>}
          </div>
        </div>
      </div>
    </div>
  );
}
