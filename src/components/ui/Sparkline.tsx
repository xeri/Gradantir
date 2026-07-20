import { C, FONT } from "../../theme";

/** Inline price line for the last 14 results. */
export function Sparkline({ scores, color, w = 132, h = 38 }: { scores: number[]; color: string; w?: number; h?: number }) {
  if (!scores || scores.length < 2) {
    return (
      <div className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
        needs 2+ results
      </div>
    );
  }
  const vals = scores.slice(-14);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => [
    2 + (i / (vals.length - 1)) * (w - 6),
    h - 4 - ((v - min) / span) * (h - 10),
  ]);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `M ${pts[0][0]},${h - 1} L ${line.replace(/ /g, " L ")} L ${pts[pts.length - 1][0]},${h - 1} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: h }} aria-hidden="true">
      <path d={area} fill={color} opacity="0.08" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill={color} />
    </svg>
  );
}
