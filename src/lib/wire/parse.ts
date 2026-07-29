import { parseImport, type ImportPayload } from "../io";
import { PROMPT_VERSION } from "./prompt";

/**
 * Reading a wire reply (§29). The payload is designed so the EXISTING import
 * pipeline does all the real validation — `parseImport` already accepts the
 * wire envelope (it checks `app` and `data` and ignores keys it does not
 * know) — so this module's whole job is charity toward imperfect models:
 * find the JSON in a paste that may carry fences or prose, and read the
 * `meta` channel the sanitizers rightly ignore.
 */

export interface WireMeta {
  warnings: string[];
  questions: string[];
  skipped: string[];
  sources: string[];
}

/** The raw (unsanitized) section shapes, kept for the review's own counting. */
export interface WireRaw {
  subjects: unknown[];
  entries: unknown[];
  upcoming: unknown[];
  allocations: unknown[];
  duels: unknown[];
  meanCalls: unknown[];
  topics: unknown[];
  topicMarks: unknown[];
  sessions: unknown[];
  rest: unknown[];
  disruptions: unknown[];
}

export type WireParse =
  | {
      ok: true;
      payload: ImportPayload;
      meta: WireMeta;
      /** The promptVersion the reply echoed, or null (bare payload). */
      promptVersion: number | null;
      /** True when the reply was built against a DIFFERENT prompt version. */
      versionMismatch: boolean;
      raw: WireRaw;
    }
  | { ok: false; error: string };

/**
 * Find the JSON object in a paste. Models are told "no fences, no prose",
 * and the good ones comply — this exists for the rest: strip fence-marker
 * lines, then slice from the first `{` to the last `}`. Braces inside JSON
 * strings are safe because the slice is outermost.
 */
export function extractJson(text: string): string | null {
  const unfenced = text
    .split("\n")
    .filter((ln) => !ln.trimStart().startsWith("```"))
    .join("\n");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return unfenced.slice(start, end + 1);
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

const strings = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && !!s.trim()) : [];

const rows = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

export function parseWire(text: string): WireParse {
  const slice = extractJson(text);
  if (!slice) return { ok: false, error: "No JSON object found in the paste." };

  // The same slice goes to the real importer — one validator, one truth.
  const res = parseImport(slice);
  if (!res.ok) return res;

  // The wire's own layer: meta, version echo, raw counts. All best-effort —
  // a bare {subjects, entries} from a model that forgot the envelope still
  // imports; it just has nothing to say for itself.
  let meta: WireMeta = { warnings: [], questions: [], skipped: [], sources: [] };
  let promptVersion: number | null = null;
  let raw: WireRaw = {
    subjects: [], entries: [], upcoming: [], allocations: [], duels: [], meanCalls: [],
    topics: [], topicMarks: [], sessions: [], rest: [], disruptions: [],
  };
  try {
    const top = JSON.parse(slice) as unknown;
    if (isRecord(top)) {
      const body = isRecord(top.data) ? top.data : top;
      raw = {
        subjects: rows(body.subjects),
        entries: rows(body.entries),
        upcoming: rows(body.upcoming),
        allocations: rows(body.allocations),
        duels: rows(body.duels),
        meanCalls: rows(body.meanCalls),
        topics: rows(body.topics),
        topicMarks: rows(body.topicMarks),
        sessions: rows(body.sessions),
        rest: rows(body.rest),
        disruptions: rows(body.disruptions),
      };
      if (typeof top.promptVersion === "number" && isFinite(top.promptVersion)) {
        promptVersion = top.promptVersion;
      }
      if (isRecord(top.meta)) {
        meta = {
          warnings: strings(top.meta.warnings),
          questions: strings(top.meta.questions),
          skipped: strings(top.meta.skipped),
          sources: strings(top.meta.sources),
        };
      }
    }
  } catch {
    // parseImport accepted it, so this cannot throw — but charity costs nothing.
  }

  return {
    ok: true,
    payload: res.payload,
    meta,
    promptVersion,
    versionMismatch: promptVersion != null && promptVersion !== PROMPT_VERSION,
    raw,
  };
}
