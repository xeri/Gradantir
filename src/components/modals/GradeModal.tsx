import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { Modal } from "../ui/Modal";
import { Btn } from "../ui/Btn";
import { Toggle } from "../ui/Toggle";
import { Field, inputCls, inputStyle } from "../ui/Field";
import { TYPES } from "../../constants";
import {
  DEFAULT_CALENDAR, reportingTermOf, spanOf, stepTerm, termKey, termLabel,
  type SchoolCalendar,
} from "../../lib/calendar";
import { round1, shortDateY, todayStr, uid } from "../../lib/utils";
import type { AssessmentType, GradeEntry, Subject } from "../../types";

const hasDepth = (e?: GradeEntry) =>
  e != null && (e.classAvg != null || e.yearAvg != null || e.rank != null || e.cohortN != null || e.worthPct != null);

export function GradeModal({
  subjects,
  entry,
  defaultSubjectId,
  calendar = DEFAULT_CALENDAR,
  topicMarkCount = 0,
  onSave,
  onClose,
}: {
  subjects: Subject[];
  entry?: GradeEntry;
  defaultSubjectId?: string;
  calendar?: SchoolCalendar;
  /** Topic marks currently filed against `entry` — moot for a new print,
   *  live only while editing one (B2 review finding: re-filing a print
   *  under a different desk breaks the dual FK `sanitizeTopicMark` checks,
   *  so those marks are about to be dropped the moment SUBJECT is changed). */
  topicMarkCount?: number;
  onSave: (e: GradeEntry) => void;
  onClose: () => void;
}) {
  const [subjectId, setSubjectId] = useState(entry?.subjectId || defaultSubjectId || subjects[0]?.id || "");
  const [type, setType] = useState<AssessmentType>(entry?.type || "Test");
  const [score, setScore] = useState(entry ? String(entry.score) : "");
  const [date, setDate] = useState(entry?.date || todayStr());
  const [title, setTitle] = useState(entry?.title || "");
  const [classAvg, setClassAvg] = useState(entry?.classAvg != null ? String(entry.classAvg) : "");
  const [yearAvg, setYearAvg] = useState(entry?.yearAvg != null ? String(entry.yearAvg) : "");
  const [rank, setRank] = useState(entry?.rank != null ? String(entry.rank) : "");
  const [cohortN, setCohortN] = useState(entry?.cohortN != null ? String(entry.cohortN) : "");
  const [worthPct, setWorthPct] = useState(entry?.worthPct != null ? String(entry.worthPct) : "");
  /* WHICH TERM DOES THIS REPORT ON? "" means follow the date — the calendar
     answers it, and re-answers it every time the date changes. Anything else
     is a hand-filed override that outlives any calendar edit. */
  const [term, setTerm] = useState(entry?.term ?? "");
  const [reliability, setReliability] = useState<string>(entry?.reliability ?? "");
  const [censored, setCensored] = useState<boolean>(entry?.censored ?? false);
  const [regimeBreak, setRegimeBreak] = useState<boolean>(entry?.regimeBreak ?? false);
  const [rankScope, setRankScope] = useState<string>(entry?.rankScope ?? "class");
  const [cohortSD, setCohortSD] = useState(entry?.cohortSD != null ? String(entry.cohortSD) : "");
  const [difficulty, setDifficulty] = useState<string>(entry?.difficulty ?? "normal");
  // Exams are where cohort data usually lives — lead with the section open there.
  const [depthOpen, setDepthOpen] = useState(entry?.type === "Exam" || (!entry && type === "Exam") || hasDepth(entry));
  const [err, setErr] = useState("");

  // Switching to Exam reveals the depth section; it never force-closes a user's choice.
  useEffect(() => {
    if (type === "Exam") setDepthOpen(true);
  }, [type]);

  /* The filing the calendar infers, and the six terms either side of it — a
     paper is never filed further from its date than that. */
  const auto = date ? reportingTermOf(date, calendar) : reportingTermOf(todayStr(), calendar);
  const autoKey = termKey(auto);
  const termOptions = [-3, -2, -1, 0, 1].map((n) => stepTerm(auto, n));
  const filed = term ? termOptions.find((r) => termKey(r) === term) ?? auto : auto;
  const filedSpan = spanOf(filed, calendar);

  const optPct = (v: string, label: string): { ok: boolean; value: number | null } => {
    if (v === "") return { ok: true, value: null };
    const n = Number(v);
    if (Number.isNaN(n) || n < 0 || n > 100) { setErr(`${label} runs from 0 to 100 — or leave it blank.`); return { ok: false, value: null }; }
    return { ok: true, value: round1(n) };
  };

  const save = () => {
    const n = Number(score);
    if (score === "" || Number.isNaN(n)) { setErr("Enter the result as a number."); return; }
    if (n < 0 || n > 100) { setErr("Results run from 0 to 100."); return; }
    if (!subjectId) { setErr("Pick a subject."); return; }
    if (!date) { setErr("Pick a date."); return; }
    const ca = optPct(classAvg, "Class average");
    if (!ca.ok) return;
    const ya = optPct(yearAvg, "Year-level average");
    if (!ya.ok) return;
    let wp: number | null = null;
    if (worthPct !== "") {
      const w = Number(worthPct);
      if (Number.isNaN(w) || w <= 0 || w > 100) { setErr("Worth runs from just above 0 to 100% of the final — or leave it blank."); return; }
      wp = round1(w);
    }
    let rk: number | null = null;
    let cn: number | null = null;
    if (cohortN !== "") {
      const c = Number(cohortN);
      if (!Number.isInteger(c) || c < 1) { setErr("Cohort size is a whole number of people."); return; }
      cn = c;
    }
    if (rank !== "") {
      const r = Number(rank);
      if (!Number.isInteger(r) || r < 1) { setErr("Placement is a whole number — 1 means top of the cohort."); return; }
      if (cn == null) { setErr("A placement needs a cohort size — how many sat it?"); return; }
      if (r > cn) { setErr(`Placement can't exceed the cohort (${r} of ${cn}?).`); return; }
      rk = r;
    }
    let csd: number | null = null;
    if (cohortSD !== "") {
      const s = Number(cohortSD);
      if (Number.isNaN(s) || s <= 0 || s > 50) { setErr("Cohort spread is a positive number of points (up to 50) — or leave it blank."); return; }
      csd = round1(s);
    }
    onSave({
      id: entry?.id || uid(), subjectId, type, score: round1(n), date, title: title.trim(),
      classAvg: ca.value, yearAvg: ya.value, rank: rk, cohortN: cn, worthPct: wp,
      // Only a genuine override is stored. Pinning the term the calendar would
      // have chosen anyway would freeze this result against a later fix.
      term: term && term !== autoKey ? term : null,
      // Absent/blank reliability = "official" — the engine treats it as precise.
      ...(reliability ? { reliability: reliability as GradeEntry["reliability"] } : {}),
      // Flags are only stored when set; unset degrades to ordinary behaviour.
      ...(censored ? { censored: true } : {}),
      ...(regimeBreak ? { regimeBreak: true } : {}),
      // Only the non-default year scope and a real cohort spread are stored.
      ...(rankScope === "year" ? { rankScope: "year" as const } : {}),
      ...(csd != null ? { cohortSD: csd } : {}),
      // Only a non-"normal" difficulty is stored.
      ...(difficulty === "easy" || difficulty === "hard" ? { difficulty: difficulty as "easy" | "hard" } : {}),
    });
  };

  const DepthChevron = depthOpen ? ChevronDown : ChevronRight;

  return (
    <Modal title={entry ? "EDIT RESULT" : "LOG A RESULT"} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="SUBJECT">
            <select className={inputCls + " cursor-pointer font-semibold"} style={inputStyle} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {entry != null && topicMarkCount > 0 && subjectId !== entry.subjectId && (
              <p className="mt-1 text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.down, fontFamily: FONT.mono }}>
                CHANGING SUBJECT DROPS {topicMarkCount} TOPIC MARK{topicMarkCount === 1 ? "" : "S"} FILED AGAINST
                THIS RESULT — ITS TOPICS STAY ON {subjects.find((s) => s.id === entry.subjectId)?.ticker ?? "THE ORIGINAL DESK"}.
              </p>
            )}
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
            {/* Setting a date re-files the result: the calendar knows which
                term it examined, so the term follows unless you overrule it. */}
            <input
              className={inputCls}
              style={inputStyle}
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setTerm(""); }}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="REPORTS ON">
            <select
              className={inputCls + " cursor-pointer font-semibold"}
              style={inputStyle}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              aria-label="Term this result reports on"
            >
              <option value="">AUTO · {termLabel(auto)}</option>
              {termOptions.map((r) => (
                <option key={termKey(r)} value={termKey(r)}>
                  {termLabel(r)}{termKey(r) === autoKey ? " (auto)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="LABEL (OPT)">
            <input className={inputCls} style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mid-year exam" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SCORE SOURCE">
            {/* Reliability tag: scales how hard this print pulls the ability
                estimate. Blank = official (precise); a remembered or estimated
                mark moves the price proportionally less. */}
            <select
              className={inputCls + " cursor-pointer font-semibold"}
              style={inputStyle}
              value={reliability}
              onChange={(e) => setReliability(e.target.value)}
              aria-label="How this score was obtained"
            >
              <option value="">OFFICIAL · PRECISE</option>
              <option value="returned">RETURNED SCRIPT</option>
              <option value="remembered">REMEMBERED</option>
              <option value="estimated">ESTIMATED</option>
              <option value="partial">PARTIAL · PROVISIONAL</option>
            </select>
          </Field>
          <Field label="FLAGS (OPT)">
            {/* CEILING: a boundary-censored mark (maxed/floored) — bounds ability
                rather than measuring it, so it pulls the price less. BREAK: a
                structural change here (new teacher/set/syllabus/cohort) — the
                engine fits only from this print onward and widens the band. */}
            <div className="flex flex-col gap-0.5 pt-0.5">
              <Toggle on={censored} onClick={() => setCensored((v) => !v)}>Ceiling / floor</Toggle>
              <Toggle on={regimeBreak} onClick={() => setRegimeBreak((v) => !v)}>Regime break</Toggle>
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="PAPER DIFFICULTY">
            {/* One-tap difficulty — used only when no class/year average is on the
                print, to credit a brutal paper up or discount an easy one. */}
            <select
              className={inputCls + " cursor-pointer font-semibold"}
              style={inputStyle}
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              aria-label="Perceived difficulty of the paper"
            >
              <option value="easy">EASIER THAN USUAL</option>
              <option value="normal">TYPICAL</option>
              <option value="hard">HARDER THAN USUAL</option>
            </select>
          </Field>
        </div>
        <p className="-mt-2 text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
          {term && term !== autoKey ? "FILED BY HAND · " : "FILED BY THE CALENDAR · "}
          {termLabel(filed)} RAN {shortDateY(filedSpan.start).toUpperCase()} – {shortDateY(filedSpan.end).toUpperCase()}
          {term && term !== autoKey ? ` · THE DATE ALONE WOULD SAY ${termLabel(auto).toUpperCase()}` : ""}
        </p>

        <div className="border" style={{ borderColor: C.line }}>
          <button
            type="button"
            onClick={() => setDepthOpen((o) => !o)}
            className="gx-focus w-full flex items-center gap-1.5 px-3 py-2 text-left"
            style={{ ...microLabel, color: depthOpen ? C.amber : C.faint, background: C.panel }}
            aria-expanded={depthOpen}
          >
            <DepthChevron size={12} /> MARKET DEPTH — CLASS &amp; COHORT (OPT)
          </button>
          {depthOpen && (
            <div className="p-3 space-y-3 border-t" style={{ borderColor: C.line }}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="CLASS AVG %">
                  <input className={inputCls} style={inputStyle} type="number" min="0" max="100" step="0.5" value={classAvg} onChange={(e) => setClassAvg(e.target.value)} placeholder="for α" />
                </Field>
                <Field label="YEAR AVG %">
                  <input className={inputCls} style={inputStyle} type="number" min="0" max="100" step="0.5" value={yearAvg} onChange={(e) => setYearAvg(e.target.value)} placeholder="year level" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="PLACEMENT">
                  <div className="flex items-center gap-1.5">
                    <input className={inputCls} style={inputStyle} type="number" min="1" step="1" value={rank} onChange={(e) => setRank(e.target.value)} placeholder="#3" aria-label="Place in cohort" />
                    <span className="text-[10px] uppercase shrink-0" style={{ color: C.faint, fontFamily: FONT.mono }}>of</span>
                    <input className={inputCls} style={inputStyle} type="number" min="1" step="1" value={cohortN} onChange={(e) => setCohortN(e.target.value)} placeholder="120" aria-label="Cohort size" />
                  </div>
                </Field>
                <Field label="WORTH % OF FINAL">
                  <input className={inputCls} style={inputStyle} type="number" min="0" max="100" step="1" value={worthPct} onChange={(e) => setWorthPct(e.target.value)} placeholder="e.g. 30" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="PLACEMENT SCOPE">
                  {/* Is the rank within your class or the whole year level? A
                      year-scoped rank is already a field position. */}
                  <select
                    className={inputCls + " cursor-pointer font-semibold"}
                    style={inputStyle}
                    value={rankScope}
                    onChange={(e) => setRankScope(e.target.value)}
                    aria-label="Whether the placement is within the class or the year"
                  >
                    <option value="class">WITHIN CLASS</option>
                    <option value="year">WITHIN YEAR LEVEL</option>
                  </select>
                </Field>
                <Field label="COHORT SPREAD σ">
                  {/* The SD of marks in the cohort — a direct read of the spread
                      the depth model otherwise infers from placements. */}
                  <input className={inputCls} style={inputStyle} type="number" min="0" max="50" step="0.5" value={cohortSD} onChange={(e) => setCohortSD(e.target.value)} placeholder="e.g. 11" aria-label="Cohort standard deviation" />
                </Field>
              </div>
              <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
                All optional — mostly for exams. Cohort data sharpens the engine: averages detrend hard papers, placements
                build your percentile, worth pins this print's share of the final grade.
              </p>
            </div>
          )}
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
