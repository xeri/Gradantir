import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { Panel } from "../../components/ui/Panel";
import { Btn } from "../../components/ui/Btn";
import { Field, inputCls, inputStyle } from "../../components/ui/Field";
import { addDays, round1 } from "../../lib/utils";
import type { DisruptionKind, SessionKind, Subject, Topic } from "../../types";

/**
 * D5 · QUICK-LOG PANELS — the SIGNALS view's own intake, for the three
 * highest-frequency life-signal inputs. Everything else (topics/topic marks,
 * the person profile) is filed elsewhere; these three are logged often
 * enough to earn a one-click form right on the board they price into.
 *
 * DISCRETE EVENTS, FILE-ON-SUBMIT — the opposite discipline from a slider:
 * nothing here writes per keystroke, and one submit is exactly one call to
 * its own `onLog*` prop. The id is App.tsx's alone (`uid()` never appears
 * here) — a panel hands back only the VALUES a student typed or picked.
 * `todayIso` is a value already captured by App off its own clock, threaded
 * down only to SEED a date input's default; the panel never reads a live
 * clock itself, and every seeded value is freely overridable.
 *
 * REST'S DATE IS THE NIGHT THE READING IS FOR — not the morning it is typed.
 * This is `RestLog`'s own documented convention (types.ts), the one
 * `rest.ts`'s acute term relies on (a night-before-exam row is looked up at
 * `examDate - 1`, never `examDate`), and the one the wire's intake prompt
 * states verbatim. The realistic use of this panel is RETROSPECTIVE — a
 * student wakes and logs last night — so the date input defaults to
 * `todayIso - 1`, not `todayIso`: dating it "today" would silently file the
 * reading one day late and the acute short-sleep charge would never fire for
 * the single most valuable use of the panel. The field is a real, visible,
 * editable date rather than an implicit stamp, because a student backfilling
 * two nights ago (or logging an afternoon nap) needs to see and change it.
 * Rest is additionally deduped by date one level up (App.tsx replaces a
 * same-night row outright, per io.ts's sanitizer convention) — the copy
 * under the form names the night it is filing for and says so.
 *
 * Study session defaults its date to `todayIso` (logging one is usually an
 * act about today) but is equally editable, for the same backfill reason.
 * Disruption's date is a genuine student choice from the start — it is
 * often logged days after the disruption began.
 *
 * UI bounds mirror io.ts's sanitizer clamps (session minutes 1-600, rest
 * hours 0-14, disruption days 1-60) so an out-of-range value is refused with
 * an inline message instead of being silently clamped on save.
 */

const SESSION_KIND_OPTIONS: { value: SessionKind; label: string }[] = [
  { value: "recall", label: "RECALL" },
  { value: "practice", label: "PRACTICE" },
  { value: "reading", label: "READING" },
  { value: "class", label: "CLASS" },
  { value: "tutoring", label: "TUTORING" },
];

const DISRUPTION_KIND_OPTIONS: { value: DisruptionKind; label: string }[] = [
  { value: "illness", label: "ILLNESS" },
  { value: "family", label: "FAMILY" },
  { value: "event", label: "EVENT" },
  { value: "other", label: "OTHER" },
];

export interface LogPanelsProps {
  /** Live desks only — nothing here can log a session against a delisted one. */
  subjects: Subject[];
  /** Every live topic, across every subject — filtered to the chosen subject inside. */
  topics: Topic[];
  /** App's own captured "now" — seeds every panel's date input only. */
  todayIso: string;
  onLogSession: (subjectId: string, date: string, minutes: number, kind: SessionKind, topicIds: string[]) => void;
  onLogRest: (date: string, hours: number, bedtime: string | null) => void;
  onLogDisruption: (date: string, kind: DisruptionKind, days: number | null, note: string | null) => void;
}

const errStyle = { color: C.down } as const;
const hintStyle = { color: C.faint, fontFamily: FONT.mono } as const;

function SessionPanel({
  subjects, topics, todayIso, onLog,
}: {
  subjects: Subject[];
  topics: Topic[];
  todayIso: string;
  onLog: (subjectId: string, date: string, minutes: number, kind: SessionKind, topicIds: string[]) => void;
}) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [date, setDate] = useState(todayIso);
  const [minutes, setMinutes] = useState("");
  const [kind, setKind] = useState<SessionKind>("practice");
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [err, setErr] = useState("");

  const subjectTopics = useMemo(() => topics.filter((t) => t.subjectId === subjectId), [topics, subjectId]);
  const toggleTopic = (id: string) =>
    setTopicIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  if (subjects.length === 0) {
    return (
      <Panel title="LOG STUDY SESSION">
        <p className="text-[11px] uppercase tracking-wider leading-relaxed" style={hintStyle}>
          LIST A SUBJECT TO LOG A STUDY SESSION AGAINST IT.
        </p>
      </Panel>
    );
  }

  const submit = () => {
    if (!date) { setErr("Pick a date."); return; }
    const n = Number(minutes);
    if (minutes === "" || !Number.isFinite(n) || n < 1 || n > 600) {
      setErr("Minutes run from 1 to 600.");
      return;
    }
    onLog(subjectId, date, Math.round(n), kind, topicIds);
    setMinutes("");
    setTopicIds([]);
    setErr("");
  };

  return (
    <Panel title="LOG STUDY SESSION">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="SUBJECT">
            <select
              className={inputCls + " cursor-pointer font-semibold"}
              style={inputStyle}
              value={subjectId}
              onChange={(e) => { setSubjectId(e.target.value); setTopicIds([]); }}
            >
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="DATE">
            <input
              className={inputCls} style={inputStyle} type="date"
              value={date} onChange={(e) => setDate(e.target.value)} aria-label="Session date"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="MINUTES">
            <input
              className={inputCls} style={inputStyle} type="number" min={1} max={600} step={5}
              value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="45" autoFocus
            />
          </Field>
          <Field label="KIND">
            <select
              className={inputCls + " cursor-pointer font-semibold"} style={inputStyle}
              value={kind} onChange={(e) => setKind(e.target.value as SessionKind)}
            >
              {SESSION_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
        {subjectTopics.length > 0 && (
          <div>
            <span className="block mb-1.5" style={{ ...microLabel, color: C.faint }}>TOPICS COVERED (OPT)</span>
            <div className="flex flex-wrap gap-1.5">
              {subjectTopics.map((t) => {
                const on = topicIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTopic(t.id)}
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
        {err && <p className="text-xs font-semibold" style={errStyle}>{err}</p>}
        <Btn variant="primary" onClick={submit} className="w-full justify-center">Log session</Btn>
      </div>
    </Panel>
  );
}

function RestPanel({
  todayIso, onLog,
}: {
  todayIso: string;
  onLog: (date: string, hours: number, bedtime: string | null) => void;
}) {
  /* Defaults to LAST NIGHT, not today: this panel's realistic use is a
     student waking up and logging the night that just ended, and RestLog's
     date is "the night the reading is FOR" — see the file doc comment. */
  const [date, setDate] = useState(addDays(todayIso, -1));
  const [hours, setHours] = useState("");
  const [bedtime, setBedtime] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    if (!date) { setErr("Pick the night this reading is for."); return; }
    const n = Number(hours);
    if (hours === "" || !Number.isFinite(n) || n < 0 || n > 14) {
      setErr("Hours run from 0 to 14.");
      return;
    }
    onLog(date, round1(n), bedtime || null);
    setHours("");
    setBedtime("");
    setErr("");
  };

  return (
    <Panel title="LOG REST NIGHT">
      <div className="space-y-3">
        <Field label="FOR THE NIGHT OF">
          <input
            className={inputCls} style={inputStyle} type="date"
            value={date} onChange={(e) => setDate(e.target.value)} aria-label="The night this reading is for" autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HOURS SLEPT">
            <input
              className={inputCls} style={inputStyle} type="number" min={0} max={14} step={0.25}
              value={hours} onChange={(e) => setHours(e.target.value)} placeholder="7.5"
            />
          </Field>
          <Field label="BEDTIME (OPT)">
            <input
              className={inputCls} style={inputStyle} type="time"
              value={bedtime} onChange={(e) => setBedtime(e.target.value)} aria-label="Bedtime"
            />
          </Field>
        </div>
        <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={hintStyle}>
          {date ? `FILING FOR THE NIGHT OF ${date}` : "PICK A NIGHT"} — RE-FILING THE SAME NIGHT REPLACES IT, NOT A SECOND READING.
        </p>
        {err && <p className="text-xs font-semibold" style={errStyle}>{err}</p>}
        <Btn variant="primary" onClick={submit} className="w-full justify-center">Log rest</Btn>
      </div>
    </Panel>
  );
}

function DisruptionPanel({
  todayIso, onLog,
}: {
  todayIso: string;
  onLog: (date: string, kind: DisruptionKind, days: number | null, note: string | null) => void;
}) {
  const [date, setDate] = useState(todayIso);
  const [kind, setKind] = useState<DisruptionKind>("illness");
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    if (!date) { setErr("Pick a date."); return; }
    let d: number | null = null;
    if (days !== "") {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 1 || n > 60) { setErr("Days run from 1 to 60 — or leave it blank."); return; }
      d = n;
    }
    onLog(date, kind, d, note.trim() || null);
    setDays("");
    setNote("");
    setErr("");
  };

  return (
    <Panel title="LOG DISRUPTION">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="STARTED">
            <input
              className={inputCls} style={inputStyle} type="date"
              value={date} onChange={(e) => setDate(e.target.value)} aria-label="Started"
            />
          </Field>
          <Field label="KIND">
            <select
              className={inputCls + " cursor-pointer font-semibold"} style={inputStyle}
              value={kind} onChange={(e) => setKind(e.target.value as DisruptionKind)} aria-label="Kind"
            >
              {DISRUPTION_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="DAYS (OPT)">
          <input
            className={inputCls} style={inputStyle} type="number" min={1} max={60} step={1}
            value={days} onChange={(e) => setDays(e.target.value)} placeholder="3" aria-label="Days"
          />
        </Field>
        <Field label="NOTE (OPT)">
          <input
            className={inputCls} style={inputStyle} value={note}
            onChange={(e) => setNote(e.target.value)} maxLength={160} placeholder="flu, off school" aria-label="Note"
          />
        </Field>
        {err && <p className="text-xs font-semibold" style={errStyle}>{err}</p>}
        <Btn variant="primary" onClick={submit} className="w-full justify-center">Log disruption</Btn>
      </div>
    </Panel>
  );
}

export function LogPanels({ subjects, topics, todayIso, onLogSession, onLogRest, onLogDisruption }: LogPanelsProps) {
  /* Same "every write says so" discipline the Scorecard's cards hold — a
     shared flash rather than one per panel, since only one form is ever
     submitted at a time. */
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1900);
    return () => clearTimeout(id);
  }, [flash]);

  return (
    <div>
      <div aria-live="polite" className="h-0 relative">
        {flash && (
          <div
            className="gx-fade absolute right-0 -top-1 z-10 flex items-center gap-1.5 border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ background: "rgba(47,217,128,0.12)", borderColor: C.up, color: C.up, fontFamily: FONT.mono }}
          >
            <Check size={11} /> {flash}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SessionPanel
          subjects={subjects}
          topics={topics}
          todayIso={todayIso}
          onLog={(subjectId, date, minutes, kind, topicIds) => { onLogSession(subjectId, date, minutes, kind, topicIds); setFlash("SESSION LOGGED"); }}
        />
        <RestPanel
          todayIso={todayIso}
          onLog={(date, hours, bedtime) => { onLogRest(date, hours, bedtime); setFlash("REST LOGGED"); }}
        />
        <DisruptionPanel
          todayIso={todayIso}
          onLog={(date, kind, days, note) => { onLogDisruption(date, kind, days, note); setFlash("DISRUPTION LOGGED"); }}
        />
      </div>
    </div>
  );
}
