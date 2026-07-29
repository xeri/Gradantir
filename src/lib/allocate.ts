import type { Allocation } from "../types";

/**
 * Effort allocation (D1). A fixed token budget spread over the live desks by a
 * CONCAVE-response optimizer: study time has diminishing returns, so the value
 * of pouring x tokens into a desk of pressure w is modelled as w·ln(1+x). Under
 * a fixed sum Σx = total this is classic water-filling — the pressing desks get
 * more, the slack ones can drop to zero, and nobody is dumped the whole budget.
 *
 * This is a PLANNING aid over the advisor's `priority`, not a causal claim: a
 * single student's book cannot identify the effort→grade response, so the app
 * never fits one. The value tracked instead is the planned−actual gap, a
 * person-stable calibration constant.
 */

/**
 * Default weekly study budget, in hours — the ruler the token split is read
 * against. Tokens stay the stored unit (100 tokens IS the week); hours are the
 * unit you think in, so every figure on the spider is labelled in both.
 */
export const DEFAULT_HOURS_PER_WEEK = 14;

/** Largest-remainder rounding of a real split to whole tokens summing to total. */
function roundTokens(x: number[], ids: string[], total: number): Record<string, number> {
  const floor = x.map((v) => Math.floor(v));
  let rem = total - floor.reduce((a, b) => a + b, 0);
  const order = x.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f || a.i - b.i);
  const out = floor.slice();
  for (let k = 0; rem > 0 && k < order.length; k++, rem--) out[order[k].i]++;
  const rec: Record<string, number> = {};
  ids.forEach((id, i) => { rec[id] = out[i]; });
  return rec;
}

/**
 * The solved water level and the set it funded.
 *
 * Published rather than recoverable: the active set is decided by a shrinking
 * loop, and reading it back off the rounded token split would get a desk that
 * cleared λ but rounded to zero wrong. §24 quotes this.
 */
export interface WaterFill {
  /** λ — the level; a desk with pressure at or below it is funded nothing. */
  lambda: number;
  /** Desk ids that cleared λ. */
  active: string[];
  /** True when every pressure was zero and the budget was split evenly. */
  flat: boolean;
}

export function suggestAllocation(
  weights: { id: string; priority: number }[],
  total: number,
  /** Optional out-parameter: the solve itself, for the derivation layer. */
  fill?: WaterFill,
): Record<string, number> {
  const ids = weights.map((w) => w.id);
  if (fill) { fill.lambda = 0; fill.active = []; fill.flat = false; }
  if (total <= 0) return roundTokens(ids.map(() => 0), ids, 0);

  const w = weights.map((x) => Math.max(0, x.priority));
  const sumW = w.reduce((a, b) => a + b, 0);
  // Flat pressure ⇒ the concave objective is indifferent; split evenly.
  if (sumW <= 0) {
    if (fill) { fill.active = [...ids]; fill.flat = true; }
    return roundTokens(ids.map(() => total / ids.length), ids, total);
  }

  // Water-fill: x_i = max(0, w_i/λ − 1), λ chosen so Σx_i = total. Shrink the
  // active set until every kept desk clears the threshold w_i > λ.
  let active = w.map((_, i) => i).sort((i, j) => w[j] - w[i] || i - j);
  const x = new Array(w.length).fill(0);
  while (active.length) {
    const sumWA = active.reduce((a, i) => a + w[i], 0);
    const lambda = sumWA / (total + active.length);
    const keep = active.filter((i) => w[i] > lambda);
    if (keep.length === active.length) {
      for (const i of active) x[i] = w[i] / lambda - 1;
      if (fill) { fill.lambda = lambda; fill.active = active.map((i) => ids[i]); }
      break;
    }
    active = keep;
  }
  return roundTokens(x, ids, total);
}

/** The editable body of an effort plan — what the card hands back to be filed. */
export interface AllocationDraft {
  total: number;
  hoursPerWeek: number;
  planned: Record<string, number>;
  actual?: Record<string, number> | null;
}

export interface RebalanceOpts {
  /** The fixed sum the split must keep hitting. */
  total: number;
  /** Desks frozen by the user: they neither move nor absorb anyone else's move. */
  pinned?: Iterable<string>;
}

/**
 * Drag one desk to `next` and make the rest give way, keeping Σ = total.
 *
 * The others yield PRO-RATA — in proportion to what they currently hold — so
 * dragging one vertex rescales the shape of the remaining plan instead of
 * reshaping it. Pinned desks are held out of the pool entirely, which also caps
 * the drag: you can only take what the unpinned desks are able to give up. A
 * pool that is already all-zero has no proportions to preserve, so it takes the
 * slack back evenly; a desk starved to zero beside a live one stays starved
 * until it is dragged out itself.
 *
 * Total-preserving at every frame, in whole tokens, so a drag can be committed
 * straight to storage without a reconciliation pass.
 */
export function rebalance(
  current: Record<string, number>,
  id: string,
  next: number,
  opts: RebalanceOpts,
): Record<string, number> {
  const { total } = opts;
  const pinned = new Set(opts.pinned ?? []);
  const others = Object.keys(current).filter((k) => k !== id);
  // A pin on the dragged desk is ignored — you are moving it on purpose.
  const free = others.filter((k) => !pinned.has(k));
  const held = others.filter((k) => pinned.has(k));

  const heldSum = held.reduce((a, k) => a + (current[k] ?? 0), 0);
  const value = Math.max(0, Math.min(Math.round(total - heldSum), Math.round(next)));
  const poolTarget = Math.max(0, Math.round(total - heldSum - value));

  const freeSum = free.reduce((a, k) => a + (current[k] ?? 0), 0);
  const x = freeSum > 0
    ? free.map((k) => ((current[k] ?? 0) / freeSum) * poolTarget)
    : free.map(() => (free.length ? poolTarget / free.length : 0));

  const out: Record<string, number> = { [id]: value, ...roundTokens(x, free, poolTarget) };
  for (const k of held) out[k] = current[k];
  return out;
}

/**
 * Restrict a stored plan to the desks that are still listed and make it spend
 * the whole budget again. A desk archived mid-term leaves its tokens behind;
 * they are handed back to the survivors in proportion rather than quietly lost,
 * which is what keeps `planned` summing to `total` across a book edit. A desk
 * that was not in the plan at all starts at zero — the model suggestion, one
 * button away, is the right way to seat it.
 */
export function renormalize(plan: Record<string, number>, ids: string[], total: number): Record<string, number> {
  const base = ids.map((id) => Math.max(0, Math.round(plan[id] ?? 0)));
  const sum = base.reduce((a, b) => a + b, 0);
  if (sum === total) return roundTokens(base, ids, total);
  if (sum <= 0) return suggestAllocation(ids.map((id) => ({ id, priority: 0 })), total);
  return roundTokens(base.map((v) => (v / sum) * total), ids, total);
}

/**
 * The spider's outer ring, in tokens.
 *
 * Deliberately a function of the desk count alone, never of the values on the
 * graph: an axis that rescaled to fit the plan would move the vertex out from
 * under the finger dragging it. Three times an even share is generous room to
 * push one desk out, snapped to a round gridline step and never past the whole
 * budget. A drag is bounded by the ring; typing an hour figure is not, which is
 * where a genuinely lopsided week gets expressed.
 */
export function axisMaxFor(total: number, n: number): number {
  if (!(total > 0) || n <= 0) return 0;
  const step = Math.max(1, Math.round(total / 20));
  const want = Math.max((3 * total) / n, total / 3);
  return Math.min(total, Math.ceil(want / step) * step);
}

/** A token holding read off as its slice of the weekly hour budget. */
export function tokensToHours(tokens: number, total: number, hoursPerWeek: number): number {
  if (!(total > 0) || !(hoursPerWeek > 0)) return 0;
  return (tokens / total) * hoursPerWeek;
}

/** A typed hour figure converted back to the token unit the plan is stored in. */
export function hoursToTokens(hours: number, total: number, hoursPerWeek: number): number {
  if (!(total > 0) || !(hoursPerWeek > 0)) return 0;
  return (hours / hoursPerWeek) * total;
}

/** Planned−actual, per desk and in total — the calibration signal D1 tracks. */
export function allocationGap(alloc: Allocation): { byId: Record<string, number>; totalAbs: number } | null {
  if (!alloc.actual) return null;
  const actual = alloc.actual;
  const ids = new Set([...Object.keys(alloc.planned), ...Object.keys(actual)]);
  const byId: Record<string, number> = {};
  let totalAbs = 0;
  for (const id of ids) {
    const g = (alloc.planned[id] ?? 0) - (actual[id] ?? 0);
    byId[id] = g;
    totalAbs += Math.abs(g);
  }
  return { byId, totalAbs };
}
