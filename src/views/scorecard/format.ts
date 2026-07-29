import { C } from "../../theme";

/** The scorecard's number language, shared by every card on it. */

export const fmt1 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(1));
export const signed = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(1);
export const pct0 = (x: number) => `${Math.round(x * 100)}%`;

/** Green when you beat the desk, red when it beats you (lower is better). */
export const edgeColor = (you: number | null, model: number | null): string => {
  if (you == null || model == null) return C.dim;
  if (you < model - 1e-9) return C.up;
  if (you > model + 1e-9) return C.down;
  return C.dim;
};

/** "3 DAYS AGO" — how long a logged input has been on the book. */
export function ago(iso: string, todayIso: string): string {
  const days = Math.round((Date.parse(todayIso) - Date.parse(iso)) / 86400000);
  if (!Number.isFinite(days)) return iso;
  if (days <= 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  if (days < 14) return `${days} DAYS AGO`;
  if (days < 60) return `${Math.round(days / 7)} WEEKS AGO`;
  return `${Math.round(days / 30)} MONTHS AGO`;
}
