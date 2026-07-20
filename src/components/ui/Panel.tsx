import type { ReactNode } from "react";
import { C, microLabel } from "../../theme";

/** Standard terminal panel: sharp corners, hairline border, amber header strip. */
export function Panel({
  title,
  right,
  children,
  pad = true,
  className = "",
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  pad?: boolean;
  className?: string;
}) {
  return (
    <section className={`border ${className}`} style={{ background: C.panel, borderColor: C.line }}>
      {title && (
        <header
          className="flex items-center justify-between gap-2 px-3 py-2 border-b"
          style={{ borderColor: C.line }}
        >
          <h3 className="flex items-center gap-2" style={{ ...microLabel, color: C.amber }}>
            <span aria-hidden="true" className="w-1.5 h-1.5" style={{ background: C.amber }} />
            {title}
          </h3>
          {right}
        </header>
      )}
      <div className={pad ? "p-3" : ""}>{children}</div>
    </section>
  );
}
