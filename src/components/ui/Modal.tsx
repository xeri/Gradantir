import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { C, microLabel } from "../../theme";

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0" style={{ background: "rgba(5,7,10,0.75)" }} onClick={onClose} />
      <div
        className={`gx-fade relative w-full ${wide ? "max-w-lg" : "max-w-md"} border`}
        style={{ background: C.panel, borderColor: C.lineBright, boxShadow: "0 0 0 1px #05070A, 0 24px 64px rgba(0,0,0,0.65)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: C.line }}>
          <h2 className="flex items-center gap-2" style={{ ...microLabel, color: C.amber }}>
            <span aria-hidden="true" className="w-1.5 h-1.5" style={{ background: C.amber }} />
            {title}
          </h2>
          <button onClick={onClose} aria-label="Close" className="gx-focus p-1 hover:brightness-150" style={{ color: C.faint }}>
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
