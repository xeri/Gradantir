import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { Modal } from "../ui/Modal";
import { Btn } from "../ui/Btn";
import { Toggle } from "../ui/Toggle";
import { inputStyle } from "../ui/Field";
import { TYPES } from "../../constants";
import { parseImport, serializeExport, type ImportPayload } from "../../lib/io";
import { todayStr } from "../../lib/utils";
import type { AppData, Settings } from "../../types";

export function SettingsModal({
  data,
  onSaveSettings,
  onReplace,
  onMerge,
  onClearAll,
  onClose,
}: {
  data: AppData;
  onSaveSettings: (s: Settings) => void;
  onReplace: (p: ImportPayload) => void;
  onMerge: (p: ImportPayload) => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Settings>({ weighted: data.settings.weighted, weights: { ...data.settings.weights } });
  const [pending, setPending] = useState<ImportPayload | null>(null);
  const [ioMsg, setIoMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
    a.click();
    URL.revokeObjectURL(url);
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

  const label = { ...microLabel, color: C.faint } as const;

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
          <div className="mb-2" style={label}>DATA</div>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={exportJson}><Download size={12} /> Export JSON</Btn>
            <Btn onClick={() => fileRef.current?.click()}><Upload size={12} /> Import JSON</Btn>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Btn
              variant="danger"
              onClick={() => {
                if (!confirmClear) { setConfirmClear(true); return; }
                onClearAll();
              }}
            >
              {confirmClear ? "Click again — wipes everything" : "Clear book"}
            </Btn>
          </div>
          {ioMsg && (
            <p className="mt-2.5 text-[11px] font-semibold" style={{ color: ioMsg.bad ? C.down : C.dim, fontFamily: FONT.mono }}>
              {ioMsg.text}
            </p>
          )}
          {pending && (
            <div className="flex gap-2 mt-2">
              <Btn variant="primary" onClick={() => onReplace(pending)}>Replace book</Btn>
              <Btn onClick={() => onMerge(pending)}>Merge in</Btn>
              <Btn onClick={() => { setPending(null); setIoMsg(null); }}>Cancel</Btn>
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
