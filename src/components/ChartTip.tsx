import { C, FONT } from "../theme";
import { shortDate } from "../lib/utils";
import { COMP_KEY } from "../lib/composite";
import type { Subject } from "../types";

interface TipPayload {
  dataKey?: string | number;
  value?: number | null;
}

/** Recharts tooltip: rows sorted by value, series identified by ticker. */
export function ChartTip({
  active,
  payload,
  label,
  subMap,
  isTime,
}: {
  active?: boolean;
  payload?: TipPayload[];
  label?: string | number;
  subMap: Record<string, Subject>;
  isTime?: boolean;
}) {
  if (!active || !payload || !payload.length) return null;
  const rows: { name: string; color: string; v: number }[] = [];
  const seen = new Set<string>();
  for (const p of payload) {
    if (p.value == null || p.dataKey == null || seen.has(String(p.dataKey))) continue;
    seen.add(String(p.dataKey));
    const key = String(p.dataKey);
    const base = key.replace(/_(ma|fc)$/, "");
    const kind = key.endsWith("_ma") ? "avg" : key.endsWith("_fc") ? "est." : "";
    if (base === COMP_KEY) {
      rows.push({ name: "COMP" + (kind ? " · " + kind : ""), color: C.amber, v: p.value });
      continue;
    }
    const sub = subMap[base];
    if (!sub) continue;
    if (!kind && payload.some((q) => q.dataKey === base + "_ma" && q.value != null)) continue;
    rows.push({ name: sub.ticker + (kind ? " · " + kind : ""), color: sub.color, v: p.value });
  }
  rows.sort((a, b) => b.v - a.v);
  return (
    <div className="border px-3 py-2" style={{ background: C.strip, borderColor: C.lineBright, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1" style={{ color: C.faint, fontFamily: FONT.mono }}>
        {isTime ? shortDate(Number(label)) : label}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 text-xs py-0.5" style={{ fontFamily: FONT.mono }}>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2" style={{ background: r.color }} />
            <span className="font-semibold" style={{ color: C.dim }}>{r.name}</span>
          </span>
          <span className="font-bold" style={{ color: C.text }}>{r.v.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}
