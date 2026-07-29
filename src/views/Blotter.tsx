import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { C, FONT } from "../theme";
import { Panel } from "../components/ui/Panel";
import { Sel } from "../components/ui/Field";
import { TypeBadge } from "../components/ui/TypeBadge";
import { TYPES, typePlural } from "../constants";
import { DEFAULT_CALENDAR, termShort, type SchoolCalendar } from "../lib/calendar";
import { entryTerm } from "../lib/periods";
import { round1, shortDateY } from "../lib/utils";
import type { GradeEntry, Subject } from "../types";

/** Every print in the book, filterable, with edit/strike controls. */
export function Blotter({
  subjects,
  entries,
  calendar = DEFAULT_CALENDAR,
  onEdit,
  onDelete,
}: {
  subjects: Subject[];
  entries: GradeEntry[];
  calendar?: SchoolCalendar;
  onEdit: (e: GradeEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [subFilter, setSubFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [armedDel, setArmedDel] = useState<string | null>(null);
  const subMap = Object.fromEntries(subjects.map((s) => [s.id, s]));
  /* The filter can outlive the desk it names — press D to draw the delisted
     book, filter to one of those desks, press D again and the roster no longer
     contains it. Resolving it during render leaves the <select> blank and the
     table empty with no way to tell why; falling back to "all" is honest. */
  const effSub = subFilter === "all" || subjects.some((s) => s.id === subFilter) ? subFilter : "all";
  const rows = entries
    .filter((e) => (effSub === "all" || e.subjectId === effSub) && (typeFilter === "all" || e.type === typeFilter))
    .sort((a, b) => (a.date > b.date ? -1 : 1));
  const hasAlpha = rows.some((e) => e.classAvg != null);

  return (
    <Panel title="BLOTTER" pad={false}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b" style={{ borderColor: C.line }}>
        <Sel
          ariaLabel="Filter by subject"
          value={effSub}
          onChange={setSubFilter}
          options={[{ value: "all", label: "ALL SUBJECTS" }, ...subjects.map((s) => ({ value: s.id, label: s.ticker }))]}
        />
        <Sel
          ariaLabel="Filter by type"
          value={typeFilter}
          onChange={setTypeFilter}
          options={[{ value: "all", label: "ALL TYPES" }, ...TYPES.map((t) => ({ value: t, label: typePlural(t).toUpperCase() }))]}
        />
        <span className="text-[10px] ml-auto uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
          {rows.length} ENTRIES
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.14em]" style={{ color: C.faint, fontFamily: FONT.mono }}>
              {[...["DATE", "FILED", "TICKER", "ASSESSMENT", "SCORE"], ...(hasAlpha ? ["α CLASS"] : []), ""].map((h, i) => (
                <th key={i} scope="col" className="px-3 py-2.5 font-bold border-b" style={{ borderColor: C.line }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const s = subMap[e.subjectId];
              if (!s) return null;
              const alpha = e.classAvg != null ? round1(e.score - e.classAvg) : null;
              return (
                <tr key={e.id} className="border-b last:border-0 hover:bg-white/[0.025]" style={{ borderColor: C.line }}>
                  <td className="px-3 py-2 whitespace-nowrap text-[11px]" style={{ fontFamily: FONT.mono, color: C.faint }}>
                    {shortDateY(e.date)}
                  </td>
                  {/* The term this print REPORTS ON — amber when it was filed
                      by hand, because that is a claim the calendar disagrees
                      with and the reader deserves to see it. */}
                  <td
                    className="px-3 py-2 whitespace-nowrap text-[11px] font-bold"
                    style={{ fontFamily: FONT.mono, color: e.term ? C.amber : C.faint }}
                    title={e.term ? "Filed by hand" : "Filed by the school calendar"}
                  >
                    {termShort(entryTerm(e, calendar))}{e.term ? " ✎" : ""}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2" style={{ background: s.color }} />
                      <span className="text-xs font-bold tracking-[0.08em]" style={{ fontFamily: FONT.mono, color: s.color }}>{s.ticker}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <TypeBadge type={e.type} />
                      {e.title && <span className="text-[11px] truncate max-w-40" style={{ color: C.dim }}>{e.title}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-bold text-xs" style={{ fontFamily: FONT.mono, color: C.text }}>{e.score.toFixed(1)}%</td>
                  {hasAlpha && (
                    <td className="px-3 py-2 text-xs" style={{ fontFamily: FONT.mono, color: alpha == null ? C.faint : alpha > 0.05 ? C.up : alpha < -0.05 ? C.down : C.dim }}>
                      {alpha == null ? "—" : `${alpha > 0 ? "+" : ""}${alpha.toFixed(1)}`}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <span className="flex items-center justify-end gap-1">
                      <button onClick={() => onEdit(e)} aria-label="Edit result" className="gx-focus p-1.5 hover:brightness-150" style={{ color: C.faint }}>
                        <Pencil size={13} />
                      </button>
                      {/* Armed-then-confirmed. This sits 4px from the edit
                          pencil, deletes a print outright with no undo, and the
                          save effect commits it instantly — while striking a
                          whole subject two panels away takes two clicks. */}
                      <button
                        onClick={() => (armedDel === e.id ? onDelete(e.id) : setArmedDel(e.id))}
                        onBlur={() => setArmedDel((id) => (id === e.id ? null : id))}
                        aria-label={armedDel === e.id ? "Confirm delete result" : "Delete result"}
                        title={armedDel === e.id ? "Click again to delete for good" : "Delete result"}
                        className="gx-focus p-1.5 hover:brightness-150"
                        style={{
                          color: C.down,
                          background: armedDel === e.id ? "rgba(224,102,46,0.18)" : "transparent",
                          outline: armedDel === e.id ? `1px solid ${C.down}` : undefined,
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={hasAlpha ? 7 : 6} className="px-4 py-10 text-center text-[11px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
                  Nothing matches these filters yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
