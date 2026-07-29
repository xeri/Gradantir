import { LEGACY_STORE_KEY, QUARANTINE_KEY, STORE_KEY } from "../constants";
import { sanitizeBook, sanitizeSettings } from "./io";
import type { AppData } from "../types";

/**
 * localStorage persistence. Tolerant loader: missing/garbled data returns
 * null (caller seeds the sample book); a partial shape gets defaults filled.
 * v2 books are read from their old key once and re-saved under the v3 key;
 * the v2 key is left in place so an older build can still roll back.
 */

/**
 * Parse a raw stored JSON string into a tolerant AppData, or null. Pure.
 *
 * Rows are held to the same standard an import is (`sanitizeBook`). A stored
 * book is the accretion of every schema this app has shipped, and one bad row —
 * a `null` left in `entries`, a score that JSON round-tripped as a string —
 * reaches `computeStats` during render. That throws, React tears the tree down,
 * and because the save effect never runs the same bytes white-screen the
 * terminal on every load after it. Dropping the row loses one print; not
 * dropping it loses the book.
 */
export function coerceStored(json: string): AppData | null {
  try {
    const d = JSON.parse(json);
    if (!d || typeof d !== "object" || !Array.isArray(d.subjects) || !Array.isArray(d.entries)) return null;
    const arr = (v: unknown) => (Array.isArray(v) ? v : []);
    /* `d.forecasts` from an older build is deliberately dropped: the register is
       derived from the tape now, not stored (§26). Leaving it in would let a
       model run from a previous version keep correcting today's board. */
    const { subjects, entries, upcoming, allocations, duels, meanCalls } = sanitizeBook(
      d.subjects, d.entries,
      { upcoming: arr(d.upcoming), allocations: arr(d.allocations), duels: arr(d.duels), meanCalls: arr(d.meanCalls) },
    );
    return {
      subjects,
      entries,
      settings: sanitizeSettings(d.settings),
      sample: d.sample === true,
      ...(upcoming.length ? { upcoming } : {}),
      ...(allocations.length ? { allocations } : {}),
      ...(duels.length ? { duels } : {}),
      ...(meanCalls.length ? { meanCalls } : {}),
    };
  } catch {
    return null;
  }
}

/** The raw bytes of a book that would not parse, if one was ever set aside. */
export function quarantinedRaw(): string | null {
  try {
    return localStorage.getItem(QUARANTINE_KEY);
  } catch {
    return null;
  }
}

export function clearQuarantine(): void {
  try {
    localStorage.removeItem(QUARANTINE_KEY);
  } catch {
    /* nothing to do — the banner simply reappears next load */
  }
}

export function loadData(): AppData | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const current = raw ? coerceStored(raw) : null;
    if (current) return current;
    /* Present-but-unreadable is NOT the same as absent, and the caller cannot
       tell them apart from a null. It seeds the sample book, and the save
       effect commits that over the top within a tick — turning a book that a
       human could still have rescued out of the raw JSON into nothing at all.
       Set the bytes aside first so the loss stays recoverable. */
    if (raw) {
      try {
        localStorage.setItem(QUARANTINE_KEY, raw);
      } catch {
        /* out of room: the original bytes are still under STORE_KEY until the
           next save, which is the best that can be done here */
      }
    }
    const legacy = localStorage.getItem(LEGACY_STORE_KEY);
    if (!legacy) return null;
    const migrated = coerceStored(legacy);
    if (migrated) saveData(migrated);
    return migrated;
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
