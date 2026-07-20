import { DEFAULT_SETTINGS, PALETTE, TYPES } from "../constants";
import { clamp, round1, uid } from "./utils";
import type { AppData, AssessmentType, GradeEntry, Settings, Subject } from "../types";

export const EXPORT_VERSION = 2;

export interface ExportEnvelope {
  app: "grade-exchange";
  version: number;
  exportedAt: string;
  data: { subjects: Subject[]; entries: GradeEntry[]; settings: Settings };
}

export function serializeExport(data: AppData): string {
  const env: ExportEnvelope = {
    app: "grade-exchange",
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: { subjects: data.subjects, entries: data.entries, settings: data.settings },
  };
  return JSON.stringify(env, null, 2);
}

export interface ImportPayload {
  subjects: Subject[];
  entries: GradeEntry[];
  settings: Settings | null;
  /** Entries discarded during validation (bad shape, unknown subject…). */
  dropped: number;
}

export type ImportResult = { ok: true; payload: ImportPayload } | { ok: false; error: string };

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

export function sanitizeSettings(raw: unknown): Settings {
  const out: Settings = { weights: { ...DEFAULT_SETTINGS.weights }, weighted: DEFAULT_SETTINGS.weighted };
  if (!isRecord(raw)) return out;
  if (typeof raw.weighted === "boolean") out.weighted = raw.weighted;
  if (isRecord(raw.weights)) {
    for (const t of TYPES) {
      const w = raw.weights[t];
      if (typeof w === "number" && isFinite(w) && w > 0 && w <= 100) out.weights[t] = Math.round(w * 100) / 100;
    }
  }
  return out;
}

function sanitizeSubject(raw: unknown, index: number): Subject | null {
  if (!isRecord(raw)) return null;
  const { id, name, ticker } = raw;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) return null;
  const tk = typeof ticker === "string" && ticker.trim() ? ticker.trim().toUpperCase().slice(0, 5) : name.trim().slice(0, 4).toUpperCase();
  const color = typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : PALETTE[index % PALETTE.length];
  const target = typeof raw.target === "number" && isFinite(raw.target) ? clamp(round1(raw.target), 0, 100) : null;
  return { id, name: name.trim(), ticker: tk, color, target };
}

function sanitizeEntry(raw: unknown, subjectIds: Set<string>): GradeEntry | null {
  if (!isRecord(raw)) return null;
  const { subjectId, date, type, score } = raw;
  if (typeof subjectId !== "string" || !subjectIds.has(subjectId)) return null;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (typeof type !== "string" || !(TYPES as string[]).includes(type)) return null;
  if (typeof score !== "number" || !isFinite(score)) return null;
  const classAvg = typeof raw.classAvg === "number" && isFinite(raw.classAvg) ? clamp(round1(raw.classAvg), 0, 100) : null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    subjectId,
    date,
    type: type as AssessmentType,
    score: clamp(round1(score), 0, 100),
    title: typeof raw.title === "string" ? raw.title.slice(0, 120) : "",
    classAvg,
  };
}

/** Parse + validate a JSON export (envelope or bare {subjects, entries}). */
export function parseImport(json: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (!isRecord(raw)) return { ok: false, error: "Unrecognised file — expected a Grade Exchange export." };
  const body = isRecord(raw.data) && raw.app === "grade-exchange" ? raw.data : raw;
  if (!isRecord(body) || !Array.isArray(body.subjects) || !Array.isArray(body.entries)) {
    return { ok: false, error: "Unrecognised file — no subjects/entries found." };
  }
  const subjects: Subject[] = [];
  const seen = new Set<string>();
  body.subjects.forEach((s, i) => {
    const sub = sanitizeSubject(s, i);
    if (sub && !seen.has(sub.id)) { seen.add(sub.id); subjects.push(sub); }
  });
  if (!subjects.length) return { ok: false, error: "No valid subjects in that file." };
  const ids = new Set(subjects.map((s) => s.id));
  let dropped = body.subjects.length - subjects.length;
  const entries: GradeEntry[] = [];
  const seenE = new Set<string>();
  for (const e of body.entries) {
    const entry = sanitizeEntry(e, ids);
    if (entry && !seenE.has(entry.id)) { seenE.add(entry.id); entries.push(entry); }
    else dropped++;
  }
  const settings = "settings" in body && body.settings != null ? sanitizeSettings(body.settings) : null;
  return { ok: true, payload: { subjects, entries, settings, dropped } };
}

/** Replace the book with the import. */
export function replaceData(payload: ImportPayload): AppData {
  return {
    subjects: payload.subjects,
    entries: payload.entries,
    settings: payload.settings ?? { ...DEFAULT_SETTINGS, weights: { ...DEFAULT_SETTINGS.weights } },
    sample: false,
  };
}

/** Merge the import into the current book — incoming rows win on id conflicts. */
export function mergeData(current: AppData, payload: ImportPayload): AppData {
  const subMap = new Map(current.subjects.map((s) => [s.id, s]));
  for (const s of payload.subjects) subMap.set(s.id, s);
  const entMap = new Map(current.entries.map((e) => [e.id, e]));
  for (const e of payload.entries) entMap.set(e.id, e);
  return {
    subjects: [...subMap.values()],
    entries: [...entMap.values()],
    settings: payload.settings ?? current.settings,
    sample: false,
  };
}
