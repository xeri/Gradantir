import { clamp, iso, round1, uid } from "./utils";
import { PALETTE } from "../constants";
import { DEFAULT_SETTINGS } from "../constants";
import type { AppData, AssessmentType, GradeEntry, Subject } from "../types";

/** Deterministic LCG so the demo book is identical on every load. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Def extends Subject {
  start: number;
  slope: number;
  vol: number;
  /** Typical edge over the class average (drives alpha). */
  alphaBias: number;
}

/**
 * Seeded demo portfolio: ~18 months of results per subject ending near
 * `end` (today by default), skipping the Dec–Jan summer break. Roughly 60%
 * of entries carry a class average so alpha stats demo immediately.
 */
export function makeSample(end: Date = new Date()): AppData {
  const defs: Def[] = [
    { id: "s-math", name: "Mathematics", ticker: "MATH", color: PALETTE[0], target: 85, start: 71, slope: 0.55, vol: 4, alphaBias: 3 },
    { id: "s-eng", name: "English", ticker: "ENG", color: PALETTE[1], target: 85, start: 80, slope: 0.12, vol: 3, alphaBias: 1 },
    { id: "s-phys", name: "Physics", ticker: "PHYS", color: PALETTE[3], target: 80, start: 76, slope: -0.35, vol: 5, alphaBias: -2 },
    { id: "s-hist", name: "History", ticker: "HIST", color: PALETTE[5], target: null, start: 74, slope: 0.22, vol: 8.5, alphaBias: 0 },
    { id: "s-bio", name: "Biology", ticker: "BIO", color: PALETTE[2], target: 90, start: 83, slope: 0.16, vol: 3, alphaBias: 4 },
  ];
  const rand = seeded(20260720);
  const begin = new Date(end.getFullYear(), end.getMonth() - 17, 1);
  const entries: GradeEntry[] = [];

  const push = (def: Def, dt: Date, i: number, forceType?: AssessmentType) => {
    const r = rand();
    const type: AssessmentType = forceType ?? (r < 0.2 ? "Quiz" : r < 0.55 ? "Assignment" : r < 0.85 ? "Test" : "Exam");
    let score = def.start + def.slope * i + (rand() - 0.5) * 2 * def.vol;
    if (type === "Exam") score -= 1.5;
    score = clamp(round1(score), 0, 100);
    const hasClass = rand() < 0.6;
    const classAvg = hasClass ? clamp(round1(score - def.alphaBias + (rand() - 0.5) * 5), 0, 100) : null;
    entries.push({ id: uid(), subjectId: def.id, date: iso(dt), type, score, title: "", classAvg });
  };

  const subjects: Subject[] = defs.map((def) => {
    let dt = new Date(begin.getFullYear(), begin.getMonth(), 8 + Math.floor(rand() * 10));
    let i = 0;
    let last: Date | null = null;
    while (dt <= end) {
      push(def, dt, i);
      last = dt;
      i += 1;
      dt = new Date(dt.getTime() + (17 + rand() * 17) * 864e5);
      // Summer break: nothing lands in December or January.
      if (dt.getMonth() === 11) dt = new Date(dt.getFullYear() + 1, 1, 3 + Math.floor(rand() * 7));
      else if (dt.getMonth() === 0) dt = new Date(dt.getFullYear(), 1, 3 + Math.floor(rand() * 7));
    }
    // Keep the tape fresh: guarantee a result within the last two weeks.
    if (last && end.getTime() - last.getTime() > 16 * 864e5) {
      const recent = new Date(end.getTime() - Math.floor(rand() * 10 + 1) * 864e5);
      push(def, recent, i, rand() < 0.5 ? "Test" : "Assignment");
    }
    const { start: _s, slope: _sl, vol: _v, alphaBias: _a, ...sub } = def;
    return sub;
  });

  return { subjects, entries, settings: { ...DEFAULT_SETTINGS, weights: { ...DEFAULT_SETTINGS.weights } }, sample: true };
}
