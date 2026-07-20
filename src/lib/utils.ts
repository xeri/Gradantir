import { MONTHS } from "../constants";

export const uid = () => "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const round1 = (v: number) => Math.round(v * 10) / 10;

export const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

export const stdev = (arr: number[]): number => {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1));
};

/** Parse "YYYY-MM-DD" as a local date (avoids UTC off-by-one). */
export const pDate = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const iso = (dt: Date): string =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

export const todayStr = () => iso(new Date());

/** "14 Mar" from a timestamp. */
export const shortDate = (t: number): string => {
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/** "14 Mar 26" from an ISO date string. */
export const shortDateY = (s: string): string => {
  const d = pDate(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
};
