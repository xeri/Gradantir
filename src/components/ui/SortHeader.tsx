import { C, FONT } from "../../theme";

export interface SortState {
  key: string;
  dir: "asc" | "desc";
}

/** Clickable column header for the screener table. */
export function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "right",
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
      className={`px-2.5 py-2 border-b whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`}
      style={{ borderColor: C.line }}
    >
      <button
        onClick={() => onSort(sortKey)}
        className="gx-focus text-[10px] font-bold tracking-[0.14em] inline-flex items-center gap-1"
        style={{ fontFamily: FONT.mono, color: active ? C.amber : C.faint }}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span aria-hidden="true" className="text-[8px] w-2">{active ? (sort.dir === "desc" ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
}
