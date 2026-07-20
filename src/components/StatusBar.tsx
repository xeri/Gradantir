import { useEffect, useState } from "react";
import { C, FONT } from "../theme";
import { currentTermKey } from "../lib/periods";

/** Fixed bottom strip: session facts on the left, clock + palette hint on the right. */
export function StatusBar({
  subjects,
  entries,
  weighted,
  saveErr,
}: {
  subjects: number;
  entries: number;
  weighted: boolean;
  saveErr: boolean;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const cell = "px-3 py-1 border-r whitespace-nowrap";
  return (
    <footer
      className="fixed bottom-0 inset-x-0 z-30 border-t flex items-stretch overflow-x-auto text-[10px] font-bold uppercase tracking-[0.12em]"
      style={{ background: C.strip, borderColor: C.line, color: C.faint, fontFamily: FONT.mono }}
    >
      <span className={cell} style={{ borderColor: C.line, color: C.amber }}>{currentTermKey().label} SESSION</span>
      <span className={cell} style={{ borderColor: C.line }}>{subjects} LISTED</span>
      <span className={cell} style={{ borderColor: C.line }}>{entries} PRINTS</span>
      <span className={cell} style={{ borderColor: C.line, color: weighted ? C.dim : C.faint }}>
        WTD {weighted ? "ON" : "OFF"}
      </span>
      <span className={cell} style={{ borderColor: C.line, color: saveErr ? C.down : C.up }}>
        {saveErr ? "SAVE RETRY" : "SAVED"}
      </span>
      <span className="flex-1" />
      <span className={`${cell} hidden sm:block border-l`} style={{ borderColor: C.line }}>CTRL+K COMMANDS</span>
      <span className="px-3 py-1 border-l" style={{ borderColor: C.line, color: C.dim }}>{clock}</span>
    </footer>
  );
}
