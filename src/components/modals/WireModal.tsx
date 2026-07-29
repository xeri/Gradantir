import { useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, Download, Radio } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { Modal } from "../ui/Modal";
import { Btn } from "../ui/Btn";
import { Toggle } from "../ui/Toggle";
import { useArmed } from "../ui/useArmed";
import { buildWirePrompt, type WireOpts } from "../../lib/wire/prompt";
import { parseWire, type WireParse } from "../../lib/wire/parse";
import { filterPayload, rehydrateSubjects, reviewWire } from "../../lib/wire/review";
import type { WireSectionKey } from "../../lib/wire/schema";
import { downloadText } from "../../lib/download";
import { todayStr } from "../../lib/utils";
import type { ImportPayload } from "../../lib/io";
import type { AppData } from "../../types";

/**
 * THE WIRE — the AI intake desk (§29), in three stages inside one modal:
 *
 *   BUILD   choose sources and switches; nothing leaves the terminal.
 *   COPY    the generated prompt, headed for whichever AI the student uses.
 *   PASTE   the AI's JSON reply, validated by the SAME pipeline as a file
 *           import, accounted for line by line, then merged on the student's
 *           say-so — with the elicitation sections flagged, because those
 *           score the STUDENT's skill and only they can vouch for them.
 *
 * All state is local: Back never loses a pasted reply, Escape closes the
 * layer like every other modal, and nothing touches the book until the
 * existing doMerge/doReplace callbacks are invoked with a filtered payload.
 */

type Stage = "build" | "copy" | "paste";

const stageTitle: Record<Stage, string> = {
  build: "1 · BUILD THE PROMPT",
  copy: "2 · CARRY IT TO YOUR AI",
  paste: "3 · BRING BACK THE REPLY",
};

const SECTION_LABEL: Record<WireSectionKey, string> = {
  subjects: "SUBJECTS",
  entries: "RESULTS",
  upcoming: "SITTINGS",
  allocations: "EFFORT BUDGETS",
  duels: "DUELS",
  meanCalls: "AGGREGATE CALLS",
  topics: "TOPICS",
  topicMarks: "TOPIC MARKS",
  sessions: "STUDY SESSIONS",
  rest: "SLEEP",
  disruptions: "DISRUPTIONS",
};

export function WireModal({
  data,
  today = todayStr(),
  onReplace,
  onMerge,
  onClose,
}: {
  data: AppData;
  /** Freezes "today". The app never passes it; tests do. */
  today?: string;
  onReplace: (p: ImportPayload) => void;
  onMerge: (p: ImportPayload) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>("build");
  const [docs, setDocs] = useState(true);
  const [interview, setInterview] = useState(true);
  const [forecasts, setForecasts] = useState(false);
  const [embedHistory, setEmbedHistory] = useState(false);
  const [err, setErr] = useState("");

  const [copied, setCopied] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState<Extract<WireParse, { ok: true }> | null>(null);
  const [include, setInclude] = useState<Partial<Record<WireSectionKey, boolean>>>({});
  const [includeForecasts, setIncludeForecasts] = useState(false);
  const replaceArm = useArmed();

  const opts: WireOpts = useMemo(
    () => ({ sources: { documents: docs, interview }, forecasts, embedHistory }),
    [docs, interview, forecasts, embedHistory],
  );
  const prompt = useMemo(
    () => (stage === "build" ? "" : buildWirePrompt(opts, data, today)),
    [stage, opts, data, today],
  );

  const advance = () => {
    if (!docs && !interview) { setErr("Pick at least one source — documents, an interview, or both."); return; }
    setErr("");
    setStage("copy");
  };

  const copyPrompt = async () => {
    let ok = false;
    try {
      await navigator.clipboard?.writeText(prompt);
      ok = true;
    } catch { /* fall through to the selection fallback */ }
    if (!ok && promptRef.current) {
      promptRef.current.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1900);
    }
  };

  const validate = () => {
    replaceArm.disarm();
    const res = parseWire(pasteText);
    if (!res.ok) {
      setParsed(null);
      setErr(res.error);
      return;
    }
    setErr("");
    setParsed(res);
    setInclude({});
    setIncludeForecasts(forecasts);
  };

  // LIVE, not computed once at validate() time: reviewWire takes `include` so
  // a cascade-blocked section (e.g. TOPIC MARKS once TOPICS is unticked)
  // shows 0 the moment the student flips the toggle, instead of a stale
  // count that would merge nothing while still reading "N NEW".
  const review = useMemo(() => (parsed ? reviewWire(parsed, data, include) : null), [parsed, data, include]);

  // Re-hydration runs on BOTH apply paths: even a replace is the same student's
  // same desks, and an echo that dropped a subject field must never wipe it.
  const payloadForApply = (): ImportPayload | null =>
    parsed ? rehydrateSubjects(filterPayload(parsed.payload, include, includeForecasts), data) : null;

  const faintNote = (text: string) => (
    <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
      {text}
    </p>
  );

  return (
    <Modal title="THE WIRE — AI INTAKE" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Radio size={13} style={{ color: C.accent }} aria-hidden />
          <span style={{ ...microLabel, color: C.accent }}>{stageTitle[stage]}</span>
        </div>

        {stage === "build" && (
          <div className="space-y-3">
            {faintNote("The wire writes a prompt for ANY external AI. You carry it over with your reports, the AI answers with structured data, and the terminal files what survives validation.")}
            <div className="border p-3 space-y-2" style={{ borderColor: C.line }}>
              <span style={{ ...microLabel, color: C.dim }}>SOURCES — WHAT THE AI WORKS FROM</span>
              <Toggle on={docs} onClick={() => setDocs((v) => !v)}>Documents — reports, transcripts, screenshots it mines</Toggle>
              <Toggle on={interview} onClick={() => setInterview((v) => !v)}>Interview — it debriefs you, subject by subject</Toggle>
            </div>
            <div className="border p-3 space-y-2" style={{ borderColor: C.line }}>
              <span style={{ ...microLabel, color: C.dim }}>THE AI'S OWN FORECASTS</span>
              <Toggle on={forecasts} onClick={() => setForecasts((v) => !v)}>Let the AI file its own calls on upcoming sittings</Toggle>
              {forecasts && (
                <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.amber, fontFamily: FONT.mono }}>
                  ITS CALLS ARE SCORED AGAINST REAL MARKS — AND ONCE PROVEN, PRICED INTO THE FORECAST AT AN EARNED, CAPPED WEIGHT (SWITCH ON THE SCORECARD). A STRONGER MODEL TENDS TO EARN A BETTER RECORD.
                </p>
              )}
            </div>
            <div className="border p-3 space-y-2" style={{ borderColor: C.line }}>
              <span style={{ ...microLabel, color: C.dim }}>PRIVACY</span>
              <Toggle on={embedHistory} onClick={() => setEmbedHistory((v) => !v)}>Embed my score history in the prompt</Toggle>
              <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: embedHistory ? C.amber : C.faint, fontFamily: FONT.mono }}>
                {embedHistory
                  ? "THE PROMPT WILL CONTAIN YOUR MARKS. BETTER AI FORECASTS, LESS PRIVACY — YOUR TRADE TO MAKE."
                  : "THE PROMPT CARRIES YOUR SUBJECT LIST, TERM DATES AND TODAY'S DATE — NEVER YOUR MARKS."}
              </p>
            </div>
            {err && <p className="text-xs font-semibold" style={{ color: C.down }}>{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Btn onClick={onClose}>Cancel</Btn>
              <Btn variant="primary" onClick={advance}>Build the prompt</Btn>
            </div>
          </div>
        )}

        {stage === "copy" && (
          <div className="space-y-3">
            <textarea
              ref={promptRef}
              readOnly
              value={prompt}
              aria-label="The generated wire prompt"
              className="gx-focus w-full border p-2.5 rounded-none resize-none h-56 text-[11px] leading-relaxed"
              style={{ background: C.panel2, borderColor: C.line, color: C.dim, fontFamily: FONT.mono }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Btn variant="primary" onClick={copyPrompt}>
                {copied ? <><Check size={12} /> Copied</> : <><ClipboardCopy size={12} /> Copy prompt</>}
              </Btn>
              <Btn onClick={() => downloadText(`the-wire-${today}.txt`, prompt, "text/plain")}>
                <Download size={12} /> Download .txt
              </Btn>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
                {prompt.length.toLocaleString()} CHARS
              </span>
            </div>
            {faintNote("Paste it into your AI of choice, attach your reports or portal screenshots (or just answer its questions), and bring its JSON reply back here.")}
            <div className="flex justify-end gap-2 pt-1">
              <Btn onClick={() => setStage("build")}>Back</Btn>
              <Btn variant="primary" onClick={() => setStage("paste")}>I have the reply</Btn>
            </div>
          </div>
        )}

        {stage === "paste" && (
          <div className="space-y-3">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              aria-label="Paste the AI's JSON reply"
              placeholder='Paste the AI’s reply here — the JSON object, fences and all.'
              className="gx-focus w-full border p-2.5 rounded-none resize-none h-40 text-[11px] leading-relaxed"
              style={{ background: C.panel2, borderColor: C.line, color: C.text, fontFamily: FONT.mono }}
            />
            <div className="flex justify-between gap-2">
              <Btn onClick={() => { setStage("copy"); }}>Back</Btn>
              <Btn variant="primary" onClick={validate}>Validate</Btn>
            </div>
            {err && <p className="text-xs font-semibold" style={{ color: C.down }}>{err}</p>}

            {parsed && review && (
              <div className="space-y-3">
                {parsed.versionMismatch && (
                  <p className="text-[10px] uppercase tracking-wider leading-relaxed border px-2.5 py-1.5" style={{ color: C.amber, borderColor: C.amber, fontFamily: FONT.mono }}>
                    THE REPLY WAS BUILT AGAINST A DIFFERENT PROMPT VERSION — REVIEW WITH EXTRA CARE, OR REBUILD THE PROMPT AND RE-RUN.
                  </p>
                )}
                <div className="border" style={{ borderColor: C.line }}>
                  <div className="px-3 py-2 border-b" style={{ borderColor: C.line, background: C.panel }}>
                    <span style={{ ...microLabel, color: C.accent }}>THE MANIFEST — WHAT LANDS IF YOU FILE IT</span>
                  </div>
                  <div className="p-3 space-y-1.5">
                    {review.sections.filter((s) => s.found > 0 || s.kept > 0).map((s) => (
                      <div key={s.key} className="flex flex-wrap items-center justify-between gap-2 border-b py-1 last:border-0" style={{ borderColor: C.line }}>
                        <span className="text-[11px] uppercase tracking-wider" style={{ color: C.dim, fontFamily: FONT.mono }}>
                          {SECTION_LABEL[s.key]}
                        </span>
                        <span className="flex items-center gap-3 text-[11px] tabular-nums" style={{ fontFamily: FONT.mono }}>
                          <span style={{ color: C.up }}>{s.added} NEW</span>
                          {s.updated > 0 && <span style={{ color: C.accent }}>{s.updated} UPDATED</span>}
                          {s.dropped > 0 && <span style={{ color: C.down }}>{s.dropped} DROPPED</span>}
                          {s.key !== "subjects" && (
                            <Toggle on={include[s.key] !== false} onClick={() => setInclude((v) => ({ ...v, [s.key]: v[s.key] === false }))}>
                              file
                            </Toggle>
                          )}
                        </span>
                      </div>
                    ))}
                    {review.keptTotal === 0 && faintNote("NOTHING SURVIVED VALIDATION — CHECK THE REASONS BELOW AND ASK YOUR AI TO CORRECT ITS REPLY.")}
                    {review.sections.some((s) => s.reasons.length > 0) && (
                      <div className="pt-1 space-y-0.5">
                        {review.sections.flatMap((s) => s.reasons).map((r, i) => (
                          <p key={i} className="text-[10px] leading-relaxed" style={{ color: C.down, fontFamily: FONT.mono }}>{r}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {review.sections.some((s) => s.elicitation && s.kept > 0) && (
                  <p className="text-[10px] uppercase tracking-wider leading-relaxed border px-2.5 py-1.5" style={{ color: C.amber, borderColor: C.amber, fontFamily: FONT.mono }}>
                    SITTINGS, BUDGETS, DUELS AND CALLS SCORE <em>YOUR</em> FORECASTING SKILL — FILE THEM ONLY IF YOU ACTUALLY MADE THESE CALLS AND THE AI MERELY WROTE THEM DOWN.
                  </p>
                )}

                {review.aiPredCount > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <Toggle on={includeForecasts} onClick={() => setIncludeForecasts((v) => !v)}>
                      File the AI's {review.aiPredCount} forecast{review.aiPredCount === 1 ? "" : "s"}
                    </Toggle>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
                      SCORED ALWAYS · PRICED ONLY VIA THE SCORECARD SWITCH
                    </span>
                  </div>
                )}

                {(parsed.meta.warnings.length > 0 || parsed.meta.questions.length > 0 || parsed.meta.skipped.length > 0) && (
                  <div className="border p-3 space-y-2" style={{ borderColor: C.line }}>
                    {parsed.meta.warnings.length > 0 && (
                      <div>
                        <span style={{ ...microLabel, color: C.amber }}>THE AI'S WARNINGS</span>
                        {parsed.meta.warnings.map((w, i) => <p key={i} className="text-[11px] leading-relaxed" style={{ color: C.dim, fontFamily: FONT.mono }}>· {w}</p>)}
                      </div>
                    )}
                    {parsed.meta.questions.length > 0 && (
                      <div>
                        <span style={{ ...microLabel, color: C.accent }}>IT ASKS</span>
                        {parsed.meta.questions.map((q, i) => <p key={i} className="text-[11px] leading-relaxed" style={{ color: C.dim, fontFamily: FONT.mono }}>· {q}</p>)}
                      </div>
                    )}
                    {parsed.meta.skipped.length > 0 && (
                      <div>
                        <span style={{ ...microLabel, color: C.faint }}>IT COULD NOT ENCODE</span>
                        {parsed.meta.skipped.map((s, i) => <p key={i} className="text-[11px] leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>· {s}</p>)}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <Btn
                    variant="danger"
                    disabled={review.keptTotal === 0}
                    onClick={() => {
                      const p = payloadForApply();
                      if (!p) return;
                      if (!replaceArm.armed) { replaceArm.arm(); return; }
                      onReplace(p);
                    }}
                  >
                    {replaceArm.armed
                      ? `Click again — discards ${data.subjects.length} subject${data.subjects.length === 1 ? "" : "s"} and ${data.entries.length} result${data.entries.length === 1 ? "" : "s"}`
                      : "Replace book"}
                  </Btn>
                  <Btn
                    variant="primary"
                    disabled={review.keptTotal === 0}
                    onClick={() => {
                      const p = payloadForApply();
                      if (p) onMerge(p);
                    }}
                  >
                    Merge in
                  </Btn>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
