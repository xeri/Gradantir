import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { C, FONT } from "../theme";
import { clamp } from "../lib/utils";
import { rebalance, tokensToHours } from "../lib/allocate";

/**
 * The effort spider (D1) — a radar you drag rather than read.
 *
 * Three polygons over one set of axes: the model's water-filled suggestion as a
 * ghost, YOUR PLAN as the fixed-sum ring you drag, and ACTUAL SPENT as the free
 * ring you fill in afterwards. Dragging the plan is total-preserving — the other
 * desks give way pro-rata (see `rebalance`) — so the shape you are drawing is
 * always a real week. Dragging the actual moves one vertex only, because you
 * spent what you spent; a polygon that overflows the plan's is an overrun, and
 * saying so is the entire point of the card.
 *
 * The axis scale is fixed by the desk count alone, so a vertex never slides out
 * from under the pointer mid-drag. Pointer positions are projected onto the
 * grabbed axis, which keeps the drag fluid when the finger wanders off it.
 */

const CX = 160;
const CY = 160;
const R = 104;
const LABEL_R = R + 24;
const RINGS = [0.25, 0.5, 0.75, 1];

export interface SpiderAxis {
  id: string;
  label: string;
  color: string;
}

export type Ring = "plan" | "actual";

export interface SpiderAllocatorProps {
  axes: SpiderAxis[];
  /** Fixed-sum plan, in tokens. */
  plan: Record<string, number>;
  /** Free actual spend, in tokens — may over- or under-run the budget. */
  actual: Record<string, number> | null;
  /** The model's suggested split, drawn as a ghost. */
  model: Record<string, number> | null;
  total: number;
  axisMax: number;
  hoursPerWeek: number;
  /** Desks frozen by the user: they neither move nor absorb. */
  pinned: string[];
  /** Which polygon the pointer edits. */
  armed: Ring;
  onPlan: (next: Record<string, number>) => void;
  onActual: (next: Record<string, number>) => void;
  /** Called once an interaction settles, so a drag files exactly one write. */
  onCommit: () => void;
  onTogglePin: (id: string) => void;
}

const angleOf = (i: number, n: number) => (i / n) * 2 * Math.PI - Math.PI / 2;

const pointAt = (i: number, n: number, r: number): [number, number] => {
  const a = angleOf(i, n);
  return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
};

export function SpiderAllocator({
  axes, plan, actual, model, total, axisMax, hoursPerWeek, pinned, armed,
  onPlan, onActual, onCommit, onTogglePin,
}: SpiderAllocatorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const n = axes.length;
  const frozen = new Set(pinned);
  const live = armed === "plan" ? plan : (actual ?? plan);

  const radiusOf = (v: number) => (axisMax > 0 ? clamp(v, 0, axisMax) / axisMax : 0) * R;
  const hoursOf = (v: number) => tokensToHours(v, total, hoursPerWeek);

  const polygon = (vals: Record<string, number> | null): string =>
    !vals ? "" : axes.map((ax, i) => {
      const [x, y] = pointAt(i, n, radiusOf(vals[ax.id] ?? 0));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

  /* ── editing ──────────────────────────────────────────────────────── */

  const write = (id: string, v: number) => {
    if (armed === "plan") onPlan(rebalance(plan, id, v, { total, pinned }));
    else onActual({ ...(actual ?? plan), [id]: Math.max(0, Math.round(v)) });
  };

  /** Pointer → a value on axis `i`, by projection onto that axis. */
  const valueAt = (e: PointerEvent, i: number): number | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const a = angleOf(i, n);
    const r = (p.x - CX) * Math.cos(a) + (p.y - CY) * Math.sin(a);
    return clamp((r / R) * axisMax, 0, axisMax);
  };

  const grab = (e: PointerEvent<SVGCircleElement>, ax: SpiderAxis, i: number) => {
    if (armed === "plan" && frozen.has(ax.id)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragId(ax.id);
    const v = valueAt(e, i);
    if (v != null) write(ax.id, v);
  };

  const drag = (e: PointerEvent<SVGCircleElement>, ax: SpiderAxis, i: number) => {
    if (dragId !== ax.id) return;
    const v = valueAt(e, i);
    if (v != null) write(ax.id, v);
  };

  const release = (e: PointerEvent<SVGCircleElement>, ax: SpiderAxis) => {
    if (dragId !== ax.id) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragId(null);
    onCommit();
  };

  const key = (e: KeyboardEvent<SVGCircleElement>, ax: SpiderAxis) => {
    if (armed === "plan" && frozen.has(ax.id)) return;
    const cur = live[ax.id] ?? 0;
    const step = e.shiftKey ? 5 : 1;
    const to =
      e.key === "ArrowUp" || e.key === "ArrowRight" ? cur + step
      : e.key === "ArrowDown" || e.key === "ArrowLeft" ? cur - step
      : e.key === "PageUp" ? cur + 5
      : e.key === "PageDown" ? cur - 5
      : e.key === "Home" ? 0
      : e.key === "End" ? axisMax
      : null;
    if (to == null) return;
    e.preventDefault();
    write(ax.id, to);
    onCommit();
  };

  /* ── render ───────────────────────────────────────────────────────── */

  const web = RINGS.map((k) => (
    <polygon
      key={k}
      points={axes.map((_, i) => pointAt(i, n, R * k).map((c) => c.toFixed(1)).join(",")).join(" ")}
      fill="none"
      stroke={k === 1 ? C.lineBright : C.line}
      strokeWidth={k === 1 ? 1 : 0.75}
    />
  ));

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 320 320"
      className="w-full max-w-[420px] mx-auto block select-none"
      style={{ touchAction: "none" }}
      role="group"
      aria-label={`Effort spider — drag a desk to move ${armed === "plan" ? "your plan" : "your actual spend"}`}
    >
      {web}

      {/* spokes + gridline hours on the top axis */}
      {axes.map((ax, i) => {
        const [x, y] = pointAt(i, n, R);
        return <line key={ax.id} x1={CX} y1={CY} x2={x} y2={y} stroke={C.line} strokeWidth={0.75} />;
      })}
      {RINGS.map((k) => (
        <text
          key={`t${k}`}
          x={CX + 3}
          y={CY - R * k + 3}
          fontSize={8}
          fill={C.faint}
          style={{ fontFamily: FONT.mono }}
        >
          {hoursOf(axisMax * k).toFixed(1)}h
        </text>
      ))}

      {/* the model's suggestion — a ghost you are free to ignore */}
      {model && (
        <polygon points={polygon(model)} fill="none" stroke={C.faint} strokeWidth={1} strokeDasharray="3 3" opacity={0.75} />
      )}

      {/* actual spent — filled, and allowed to overflow the plan */}
      {actual && (
        <polygon points={polygon(actual)} fill={C.amber} fillOpacity={armed === "actual" ? 0.22 : 0.13} stroke={C.amber} strokeWidth={armed === "actual" ? 1.75 : 1.25} />
      )}

      {/* the plan */}
      <polygon points={polygon(plan)} fill={C.accent} fillOpacity={armed === "plan" ? 0.14 : 0.07} stroke={C.accent} strokeWidth={armed === "plan" ? 1.75 : 1.25} />

      {/* handles on the armed ring */}
      {axes.map((ax, i) => {
        const v = live[ax.id] ?? 0;
        const [x, y] = pointAt(i, n, radiusOf(v));
        const isPinned = frozen.has(ax.id);
        const locked = armed === "plan" && isPinned;
        const over = v > axisMax + 1e-9;
        const [ox, oy] = pointAt(i, n, R + 9);
        return (
          <g key={ax.id}>
            {/* a desk pushed past the outer ring still reads, as a caret */}
            {over && (
              <polygon
                points="0,-5 4.5,2 -4.5,2"
                transform={`translate(${ox.toFixed(1)} ${oy.toFixed(1)}) rotate(${((angleOf(i, n) * 180) / Math.PI + 90).toFixed(1)})`}
                fill={armed === "plan" ? C.accent : C.amber}
              />
            )}
            <circle
              cx={x}
              cy={y}
              r={dragId === ax.id ? 7 : 5}
              fill={locked ? C.panel : armed === "plan" ? C.accent : C.amber}
              stroke={locked ? C.faint : C.strip}
              strokeWidth={1.5}
              className={locked ? "gx-focus" : "gx-focus cursor-grab"}
              style={{ cursor: locked ? "not-allowed" : dragId === ax.id ? "grabbing" : "grab" }}
              tabIndex={0}
              role="slider"
              aria-label={`${armed === "plan" ? "Planned" : "Actual"} effort on ${ax.label}`}
              aria-valuemin={0}
              aria-valuemax={Math.round(Math.max(axisMax, v))}
              aria-valuenow={Math.round(v)}
              aria-valuetext={`${hoursOf(v).toFixed(1)} hours a week on ${ax.label}${locked ? ", pinned" : ""}`}
              aria-disabled={locked || undefined}
              onPointerDown={(e) => grab(e, ax, i)}
              onPointerMove={(e) => drag(e, ax, i)}
              onPointerUp={(e) => release(e, ax)}
              onPointerCancel={(e) => release(e, ax)}
              onKeyDown={(e) => key(e, ax)}
            />
          </g>
        );
      })}

      {/* tickers — click one to pin its desk out of the rebalance */}
      {axes.map((ax, i) => {
        const [x, y] = pointAt(i, n, LABEL_R);
        const anchor = x < CX - 6 ? "end" : x > CX + 6 ? "start" : "middle";
        const isPinned = frozen.has(ax.id);
        return (
          <g key={ax.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
            <text
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={10}
              fontWeight={700}
              fill={isPinned ? C.amber : ax.color}
              style={{ fontFamily: FONT.mono, cursor: "pointer", letterSpacing: "0.06em" }}
              onClick={() => onTogglePin(ax.id)}
            >
              {isPinned ? "▪ " : ""}{ax.label}
            </text>
            <text
              textAnchor={anchor}
              y={11}
              dominantBaseline="middle"
              fontSize={9}
              fill={C.faint}
              style={{ fontFamily: FONT.mono, pointerEvents: "none" }}
            >
              {hoursOf(plan[ax.id] ?? 0).toFixed(1)}h
            </text>
          </g>
        );
      })}
    </svg>
  );
}
