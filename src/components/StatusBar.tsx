import { useEffect, useState, useSyncExternalStore } from "react";
import { C, FONT } from "../theme";
import { DEFAULT_CALENDAR, teachingTermOf, type SchoolCalendar } from "../lib/calendar";
import { fmtCountdown, sessionInfo } from "../lib/session";
import { iso } from "../lib/utils";
import { derivationModeOff, derivationModeOn, subscribeDerivationMode, toggleDerivationMode } from "../lib/derivationMode";

const PHASE_COLOR = { pre: C.amber, open: C.up, post: C.amber, closed: C.faint } as const;

/** Fixed bottom strip: session facts on the left, clock + palette hint on the right. */
export function StatusBar({
  subjects,
  entries,
  delisted = 0,
  weighted,
  saveErr,
  calendar = DEFAULT_CALENDAR,
  now: fixedNow,
}: {
  subjects: number;
  entries: number;
  /** Closed desks — still priced into the book, just not trading. */
  delisted?: number;
  weighted: boolean;
  saveErr: boolean;
  calendar?: SchoolCalendar;
  /** Freezes the strip's clock. The app never passes it; tests always do. */
  now?: Date;
}) {
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTick(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const now = fixedNow ?? tick;
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const session = sessionInfo(now);
  // Where the school physically is — the teaching clock, not the filing one.
  const term = teachingTermOf(iso(now), calendar);
  const derive = useSyncExternalStore(subscribeDerivationMode, derivationModeOn, derivationModeOff);
  const cell = "px-3 py-1 border-r whitespace-nowrap";
  return (
    // Not a <footer>: the page already has one, and two body-scoped footers
    // publish two `contentinfo` landmarks. This strip is live desk state.
    <div
      role="status"
      aria-label="Desk status"
      className="fixed bottom-0 inset-x-0 z-30 border-t flex items-stretch overflow-x-auto text-[10px] font-bold uppercase tracking-[0.12em]"
      style={{ background: C.strip, borderColor: C.line, color: C.faint, fontFamily: FONT.mono }}
    >
      <span className={cell} style={{ borderColor: C.line, color: C.amber }}>
        {`T${term.ref.term} ${term.ref.year}`} · {term.week != null ? `WK ${term.week}` : "BREAK"}
      </span>
      <span className={cell} style={{ borderColor: C.line, color: PHASE_COLOR[session.phase] }}>
        ● {session.label} · {session.nextLabel} ({fmtCountdown(session.msToNext)})
      </span>
      <span className={cell} style={{ borderColor: C.line }}>{subjects} LISTED</span>
      {delisted > 0 && <span className={cell} style={{ borderColor: C.line }}>{delisted} DELISTED</span>}
      <span className={cell} style={{ borderColor: C.line }}>{entries} PRINTS</span>
      <span className={cell} style={{ borderColor: C.line, color: weighted ? C.dim : C.faint }}>
        WTD {weighted ? "ON" : "OFF"}
      </span>
      {/* "SAVE RETRY" promised a retry that never happens. The strip states the
          fact; the banner above the board is what actually explains it and
          hands the book back as a file. */}
      <span className={cell} style={{ borderColor: C.line, color: saveErr ? C.down : C.up }}>
        {saveErr ? "NOT SAVED" : "SAVED"}
      </span>
      {/* Never let the derivation layer be silently on: it changes what a
          click does inside cards and rows. */}
      <button
        onClick={toggleDerivationMode}
        className={`gx-focus ${cell} hover:brightness-125`}
        style={{
          borderColor: C.line,
          color: derive ? C.amber : C.faint,
          background: derive ? "rgba(232,163,61,0.1)" : "transparent",
        }}
        aria-pressed={derive}
        title="Show the equation behind every generated figure (Shift+D)"
      >
        ∂ DERIVE {derive ? "ON" : "OFF"}
      </button>
      <span className="flex-1" />
      <span className={`${cell} hidden sm:block border-l`} style={{ borderColor: C.line }}>CTRL+K COMMANDS</span>
      <span className="px-3 py-1 border-l" style={{ borderColor: C.line, color: C.dim }}>{clock}</span>
    </div>
  );
}
