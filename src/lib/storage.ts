import { STORE_KEY } from "../constants";
import { sanitizeSettings } from "./io";
import type { AppData } from "../types";

/**
 * localStorage persistence. Tolerant loader: missing/garbled data returns
 * null (caller seeds the sample book); a partial shape gets defaults filled.
 */
export function loadData(): AppData | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.subjects) || !Array.isArray(d.entries)) return null;
    return {
      subjects: d.subjects,
      entries: d.entries,
      settings: sanitizeSettings(d.settings),
      sample: d.sample === true,
    };
  } catch {
    return null;
  }
}

export function saveData(data: AppData): boolean {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
