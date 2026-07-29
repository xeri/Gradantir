import { useState } from "react";
import { C, FONT } from "../../theme";

/** Inline price line for the last 14 results — hover to read any print off it. */
export function Sparkline({
  scores,
  color,
  w = 132,
  h = 38,
  labels,
}: {
  scores: number[];
  color: string;
  w?: number;
  h?: number;
  /** Optional per-point captions (dates, titles) shown in the hover readout. */
  labels?: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (!scores || scores.length < 2) {
    return (
      <div className="text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
        needs 2+ results
      </div>
    );
  }
  const take = Math.min(14, scores.length);
  const vals = scores.slice(-take);
  const capts = labels ? labels.slice(-take) : null;
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

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * w;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - x) < Math.abs(pts[best][0] - x)) best = i;
    setHover(best);
  };

  const hi = hover;
  const hp = hi != null ? pts[hi] : null;
  const flip = hp != null && hp[0] > w * 0.6;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full touch-none"
      style={{ maxHeight: h }}
      role="img"
      aria-label={`Last ${vals.length} results, ${min.toFixed(1)} to ${max.toFixed(1)} percent`}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <path d={area} fill={color} opacity="0.08" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill={color} />
      {hp && hi != null && (
        <g pointerEvents="none">
          <line x1={hp[0]} y1={0} x2={hp[0]} y2={h} stroke={C.lineBright} strokeWidth="1" strokeDasharray="2 2" />
          <circle cx={hp[0]} cy={hp[1]} r="3" fill={C.bg} stroke={color} strokeWidth="1.6" />
          <text
            x={flip ? hp[0] - 4 : hp[0] + 4}
            y={9}
            textAnchor={flip ? "end" : "start"}
            style={{ fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, fill: C.text }}
          >
            {vals[hi].toFixed(1)}
            {capts?.[hi] ? ` · ${capts[hi]}` : ""}
          </text>
        </g>
      )}
    </svg>
  );
}
