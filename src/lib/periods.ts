import { MONTHS } from "../constants";
import { pDate, todayStr } from "./utils";
import type { PeriodMode } from "../types";

export interface PeriodKey {
  key: string;
  label: string;
}

/**
 * Bucket a date into a period. Terms follow calendar quarters
 * (T1 = Jan–Mar … T4 = Oct–Dec); semesters split the year in half.
 */
export function periodInfo(dateStr: string, mode: PeriodMode | string): PeriodKey {
  const dt = pDate(dateStr);
  const y = dt.getFullYear();
  const m = dt.getMonth();
  switch (mode) {
    case "month":
      return { key: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} ${String(y).slice(2)}` };
    case "term": {
      const t = Math.floor(m / 3) + 1;
      return { key: `${y}-T${t}`, label: `T${t} ${y}` };
    }
    case "semester": {
      const s = m < 6 ? 1 : 2;
      return { key: `${y}-S${s}`, label: `S${s} ${y}` };
    }
    case "year":
      return { key: `${y}`, label: `${y}` };
    default:
      return { key: dateStr, label: dateStr };
  }
}

export const currentTermKey = (): PeriodKey => periodInfo(todayStr(), "term");

export function prevTermKey(): PeriodKey {
  const now = new Date();
  const t = Math.floor(now.getMonth() / 3) + 1;
  return t === 1
    ? { key: `${now.getFullYear() - 1}-T4`, label: `T4 ${now.getFullYear() - 1}` }
    : { key: `${now.getFullYear()}-T${t - 1}`, label: `T${t - 1} ${now.getFullYear()}` };
}
