import { Component, type ErrorInfo, type ReactNode } from "react";
import { C, FONT, microLabel } from "../theme";
import { STORE_KEY } from "../constants";

/**
 * THE LAST STOP.
 *
 * This book lives in one browser and nowhere else. If anything below throws
 * during render, React unmounts the whole tree and the terminal goes white —
 * and because the render never completed, the save effect never ran, so the
 * bytes that caused it are still in localStorage and the next load does exactly
 * the same thing. Without a boundary that is an unrecoverable book.
 *
 * So the boundary's job is not to apologise, it is to hand the data back. The
 * raw stored JSON is offered as a download BEFORE any repair is suggested,
 * because a file on disk is the only thing here that survives being wrong.
 */
type State = { err: Error | null };

export class Boundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // Nothing to report to, but the console is the only forensic trail there is.
    console.error("Grade Exchange crashed during render", err, info.componentStack);
  }

  private raw(): string | null {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch {
      return null;
    }
  }

  private download = () => {
    const raw = this.raw();
    if (!raw) return;
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "grade-exchange-rescue.json";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  private reset = () => {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* if the store cannot be cleared, the reload below changes nothing —
         the message on screen is still the honest state of things */
    }
    location.reload();
  };

  render() {
    if (!this.state.err) return this.props.children;
    const hasBook = this.raw() != null;
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: C.bg, fontFamily: FONT.mono }}>
        <div className="w-full max-w-lg border" style={{ background: C.panel, borderColor: C.down }}>
          <div className="px-4 py-2 border-b" style={{ borderColor: C.line }}>
            <span style={{ ...microLabel, color: C.down }}>■ TRADING HALTED — THE TERMINAL HIT AN ERROR</span>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-[11px] uppercase tracking-wider leading-relaxed" style={{ color: C.dim }}>
              Something in the book made the board throw while drawing it. Your data has not been
              touched — nothing is saved while the screen is down.
            </p>
            <pre
              className="text-[10px] overflow-x-auto p-2 border whitespace-pre-wrap"
              style={{ background: C.bg, borderColor: C.line, color: C.faint }}
            >
              {this.state.err.message || String(this.state.err)}
            </pre>
            <p className="text-[11px] uppercase tracking-wider leading-relaxed" style={{ color: C.dim }}>
              Take the backup first. It is the raw stored book, and it is the only copy that
              outlives this browser.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={this.download}
                disabled={!hasBook}
                className="gx-focus border px-3 py-1.5 hover:brightness-125 disabled:opacity-40"
                style={{ ...microLabel, color: C.amber, borderColor: C.amber, background: "rgba(232,163,61,0.1)" }}
              >
                ↓ Download my book
              </button>
              <button
                onClick={() => location.reload()}
                className="gx-focus border px-3 py-1.5 hover:brightness-125"
                style={{ ...microLabel, color: C.text, borderColor: C.lineBright }}
              >
                ↻ Try again
              </button>
              <button
                onClick={this.reset}
                className="gx-focus border px-3 py-1.5 hover:brightness-125"
                style={{ ...microLabel, color: C.down, borderColor: C.line }}
              >
                ✕ Clear the book and start over
              </button>
            </div>
            <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint }}>
              Clearing is permanent. Only do it after the download has landed — you can import the
              file back from desk settings.
            </p>
          </div>
        </div>
      </div>
    );
  }
}
