import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Settings2, TerminalSquare } from "lucide-react";
import { C, FONT, microLabel } from "./theme";
import { TickerTape } from "./components/TickerTape";
import { StatusBar } from "./components/StatusBar";
import { Drawer } from "./components/Drawer";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { SubjectModal } from "./components/modals/SubjectModal";
import { GradeModal } from "./components/modals/GradeModal";
import { SettingsModal } from "./components/modals/SettingsModal";
import { Btn } from "./components/ui/Btn";
import { Overview } from "./views/Overview";
import { Charts } from "./views/Charts";
import { Compare } from "./views/Compare";
import { Screener } from "./views/Screener";
import { Blotter } from "./views/Blotter";
import { computeStats } from "./lib/stats";
import { compositeNow } from "./lib/composite";
import { loadData, saveData } from "./lib/storage";
import { makeSample } from "./lib/sample";
import { currentTermKey } from "./lib/periods";
import { mergeData, replaceData, type ImportPayload } from "./lib/io";
import { DEFAULT_SETTINGS } from "./constants";
import type { AppData, GradeEntry, Settings, Subject } from "./types";

type View = "overview" | "charts" | "compare" | "screener" | "blotter";
type ModalState =
  | { type: "subject" }
  | { type: "grade"; entry?: GradeEntry; subjectId?: string }
  | { type: "settings" }
  | null;

const TABS: { id: View; label: string }[] = [
  { id: "overview", label: "OVERVIEW" },
  { id: "charts", label: "CHARTS" },
  { id: "compare", label: "COMPARE" },
  { id: "screener", label: "SCREENER" },
  { id: "blotter", label: "BLOTTER" },
];

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState<View>("overview");
  const [modal, setModal] = useState<ModalState>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [saveErr, setSaveErr] = useState(false);

  useEffect(() => {
    setData(loadData() ?? makeSample());
  }, []);

  useEffect(() => {
    if (!data) return;
    setSaveErr(!saveData(data));
  }, [data]);

  const stats = useMemo(() => (data ? computeStats(data.subjects, data.entries, data.settings) : []), [data]);
  const index = useMemo(() => compositeNow(stats), [stats]);

  /* keyboard: Ctrl+K palette; bare 1–5 tabs and N log-result when not typing */
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (paletteOpen || modal || drawerId) return;
      const i = Number(e.key);
      if (i >= 1 && i <= TABS.length) setView(TABS[i - 1].id);
      else if (e.key.toLowerCase() === "n") setModal({ type: "grade" });
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [paletteOpen, modal, drawerId]);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg, fontFamily: FONT.mono }}>
        <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: C.faint }}>OPENING THE EXCHANGE…</div>
      </div>
    );
  }

  const { subjects, entries, settings } = data;
  const update = (patch: Partial<AppData>) => setData((d) => (d ? { ...d, ...patch } : d));

  const addSubject = (sub: Subject) => { update({ subjects: [...subjects, sub] }); setModal(null); };
  const saveGrade = (entry: GradeEntry) => {
    const exists = entries.some((e) => e.id === entry.id);
    update({ entries: exists ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry] });
    setModal(null);
  };
  const deleteEntry = (id: string) => update({ entries: entries.filter((e) => e.id !== id) });
  const setTarget = (sid: string, target: number | null) =>
    update({ subjects: subjects.map((s) => (s.id === sid ? { ...s, target } : s)) });
  const deleteSubject = (sid: string) => {
    update({ subjects: subjects.filter((s) => s.id !== sid), entries: entries.filter((e) => e.subjectId !== sid) });
    setDrawerId(null);
  };
  const saveSettings = (s: Settings) => update({ settings: s });
  const startFresh = () => {
    setData({ subjects: [], entries: [], settings: { ...DEFAULT_SETTINGS, weights: { ...DEFAULT_SETTINGS.weights } }, sample: false });
    setDrawerId(null);
    setModal(null);
  };
  const doReplace = (p: ImportPayload) => { setData(replaceData(p)); setModal(null); setDrawerId(null); };
  const doMerge = (p: ImportPayload) => { setData((d) => (d ? mergeData(d, p) : d)); setModal(null); };

  const commands: Command[] = [
    ...TABS.map((t, i) => ({ id: "go-" + t.id, label: `GO TO ${t.label}`, hint: String(i + 1), run: () => setView(t.id) })),
    { id: "log", label: "LOG RESULT", hint: "N", run: () => setModal({ type: "grade" }) },
    { id: "list", label: "LIST SUBJECT", run: () => setModal({ type: "subject" }) },
    { id: "settings", label: "DESK SETTINGS · DATA", run: () => setModal({ type: "settings" }) },
    { id: "wtd", label: `WEIGHTED AVERAGES ${settings.weighted ? "OFF" : "ON"}`, run: () => saveSettings({ ...settings, weighted: !settings.weighted }) },
    ...subjects.map((s) => ({ id: "q-" + s.id, label: `QUOTE ${s.ticker} — ${s.name}`, run: () => setDrawerId(s.id) })),
  ];

  const drawerStat = drawerId ? stats.find((s) => s.sub.id === drawerId) : null;
  const cur = currentTermKey();

  return (
    <div className="min-h-screen pb-10" style={{ background: C.bg, color: C.text, fontFamily: FONT.display }}>
      {stats.some((s) => s.latest) && <TickerTape stats={stats} index={index} />}

      <div className="max-w-6xl mx-auto px-3 sm:px-5">
        <header className="flex flex-wrap items-end justify-between gap-3 pt-5 pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight leading-none uppercase" style={{ fontFamily: FONT.display }}>
              GRADE<span style={{ color: C.amber }}>·</span>EXCHANGE<span className="gx-cursor" aria-hidden="true" />
            </h1>
            <p className="mt-1.5" style={{ ...microLabel, color: C.faint }}>
              {cur.label} SESSION · SUBJECTS TRADED LIKE A BOOK
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Btn onClick={() => setModal({ type: "subject" })}><Plus size={12} /> Subject</Btn>
            {subjects.length > 0 && (
              <Btn variant="primary" onClick={() => setModal({ type: "grade" })}><Plus size={12} /> Log result</Btn>
            )}
            <Btn onClick={() => setModal({ type: "settings" })} aria-label="Desk settings"><Settings2 size={13} /></Btn>
          </div>
        </header>

        {data.sample && (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border px-3 py-2 mb-4 text-[11px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(232,163,61,0.07)", borderColor: "rgba(232,163,61,0.35)", color: C.amber, fontFamily: FONT.mono }}
          >
            <span>DEMO BOOK LOADED — SAMPLE DATA SO EVERY PANEL HAS A PULSE.</span>
            <button onClick={startFresh} className="gx-focus underline">CLEAR IT — TRADE MY OWN SUBJECTS</button>
            <button onClick={() => update({ sample: false })} className="gx-focus" style={{ color: "#A8873F" }}>KEEP EXPLORING</button>
          </div>
        )}

        <nav className="flex gap-0.5 border-b mb-4 overflow-x-auto" style={{ borderColor: C.line }} aria-label="Views">
          {TABS.map((t, i) => {
            const active = view === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className="gx-focus flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold tracking-[0.12em] whitespace-nowrap border-b-2 -mb-px transition-colors"
                style={{ fontFamily: FONT.mono, color: active ? C.amber : C.faint, borderColor: active ? C.amber : "transparent" }}
                aria-current={active ? "page" : undefined}
              >
                <span style={{ color: active ? C.amber : C.line }}>{i + 1}</span>·{t.label}
              </button>
            );
          })}
        </nav>

        {subjects.length === 0 ? (
          <div className="border p-10 sm:p-14 text-center" style={{ background: C.panel, borderColor: C.line }}>
            <TerminalSquare size={30} className="mx-auto mb-3" style={{ color: C.faint }} />
            <h2 className="text-lg font-black tracking-tight uppercase mb-1" style={{ fontFamily: FONT.display }}>The floor is quiet</h2>
            <p className="text-xs mb-5 max-w-md mx-auto uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
              List a subject to open the exchange. Every result logged becomes a print on its line.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Btn variant="primary" onClick={() => setModal({ type: "subject" })}><Plus size={12} /> List a subject</Btn>
              <Btn onClick={() => setData(makeSample())}><RefreshCw size={12} /> Load demo book</Btn>
            </div>
          </div>
        ) : (
          <div className="gx-fade" key={view}>
            {view === "overview" && (
              <Overview
                stats={stats}
                entries={entries}
                settings={settings}
                index={index}
                onOpenSubject={setDrawerId}
                onAddSubject={() => setModal({ type: "subject" })}
              />
            )}
            {view === "charts" && <Charts subjects={subjects} entries={entries} settings={settings} />}
            {view === "compare" && <Compare subjects={subjects} entries={entries} settings={settings} />}
            {view === "screener" && <Screener stats={stats} onOpenSubject={setDrawerId} />}
            {view === "blotter" && (
              <Blotter subjects={subjects} entries={entries} onEdit={(e) => setModal({ type: "grade", entry: e })} onDelete={deleteEntry} />
            )}
          </div>
        )}

        <footer className="mt-8 pb-4 text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
          Scores out of 100 · terms follow calendar quarters · forecasts are trend lines, not certainties · data lives in this browser — export from settings to back it up.
        </footer>
      </div>

      <StatusBar subjects={subjects.length} entries={entries.length} weighted={settings.weighted} saveErr={saveErr} />

      {drawerStat && (
        <Drawer
          key={drawerId}
          stat={drawerStat}
          settings={settings}
          onClose={() => setDrawerId(null)}
          onSetTarget={setTarget}
          onDeleteSubject={deleteSubject}
          onAddGrade={(sid) => setModal({ type: "grade", subjectId: sid })}
          onEditEntry={(e) => setModal({ type: "grade", entry: e })}
        />
      )}
      {modal?.type === "subject" && <SubjectModal subjects={subjects} onSave={addSubject} onClose={() => setModal(null)} />}
      {modal?.type === "grade" && subjects.length > 0 && (
        <GradeModal subjects={subjects} entry={modal.entry} defaultSubjectId={modal.subjectId} onSave={saveGrade} onClose={() => setModal(null)} />
      )}
      {modal?.type === "settings" && (
        <SettingsModal
          data={data}
          onSaveSettings={saveSettings}
          onReplace={doReplace}
          onMerge={doMerge}
          onClearAll={startFresh}
          onClose={() => setModal(null)}
        />
      )}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
