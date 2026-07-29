import { clamp, iso, pDate, round1, uid } from "./utils";
import { DEFAULT_CALENDAR, inSession, termsOf, type SchoolCalendar } from "./calendar";
import { freshSettings } from "../constants";
import { DEFAULT_SUBJECT_DEFS } from "./defaults";
import type { AppData, AssessmentType, Duel, GradeEntry, Subject, Upcoming } from "../types";

/** Deterministic LCG so the demo book is identical on every load. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Sim {
  target: number | null;
  courseworkPct: number | null;
  start: number;
  slope: number;
  vol: number;
  /** Typical edge over the class average (drives alpha). */
  alphaBias: number;
  /** Fixed cohort size for exam rankings. */
  cohortN: number;
}

/** Per-desk simulation personalities, keyed by ticker. */
const SIM: Record<string, Sim> = {
  MATH: { target: 85, courseworkPct: null, start: 71, slope: 0.55, vol: 4, alphaBias: 3, cohortN: 140 },
  ENG: { target: 85, courseworkPct: 60, start: 80, slope: 0.12, vol: 3, alphaBias: 1, cohortN: 155 },
  PHYS: { target: 80, courseworkPct: null, start: 76, slope: -0.35, vol: 5, alphaBias: -2, cohortN: 96 },
  ECON: { target: null, courseworkPct: null, start: 77, slope: 0.3, vol: 6, alphaBias: 2, cohortN: 120 },
  BUS: { target: 85, courseworkPct: 40, start: 82, slope: -0.1, vol: 4, alphaBias: 1, cohortN: 110 },
  GEO: { target: null, courseworkPct: null, start: 72, slope: 0.45, vol: 7, alphaBias: 0, cohortN: 90 },
};

/** What a school calls the paper it sets at the end of each term. */
const ROUND_TITLE = ["Term 1 exams", "Mid-year exams", "Term 3 exams", "End-of-year exams"];

/**
 * Seeded demo portfolio over the six default desks: ~18 months of results
 * ending near `end`, laid out on the SCHOOL CALENDAR — coursework lands on
 * days the school was actually open, and every term closes with an exam round
 * every desk sits on the same day, titled the way a school titles it. That is
 * what gives the demo board real rounds (T1 · MID · EOY) to draw and forecast.
 * ~60% of entries carry a class average; most exams carry rank/cohort and many
 * a year-level average, so every quant surface has a pulse. ENG and BUS demo
 * the coursework blend.
 */
export function makeSample(end: Date = new Date(), cal: SchoolCalendar = DEFAULT_CALENDAR): AppData {
  const rand = seeded(20260720);
  const begin = new Date(end.getFullYear(), end.getMonth() - 17, 1);
  const endIso = iso(end);
  const entries: GradeEntry[] = [];

  const push = (sub: Subject, sim: Sim, dt: Date, i: number, forceType?: AssessmentType, title = "") => {
    const r = rand();
    const type: AssessmentType = forceType ?? (r < 0.25 ? "Quiz" : r < 0.65 ? "Assignment" : "Test");
    let score = sim.start + sim.slope * i + (rand() - 0.5) * 2 * sim.vol;
    if (type === "Exam") score -= 1.5;
    score = clamp(round1(score), 0, 100);
    const hasClass = rand() < 0.6;
    const classAvg = hasClass ? clamp(round1(score - sim.alphaBias + (rand() - 0.5) * 5), 0, 100) : null;
    let yearAvg: number | null = null;
    let rank: number | null = null;
    let cohortN: number | null = null;
    let worthPct: number | null = null;
    if (type === "Exam") {
      const ref = classAvg ?? clamp(score - sim.alphaBias, 0, 100);
      if (rand() < 0.7) {
        cohortN = sim.cohortN;
        // Roughly the share of the cohort ahead of this score, plus jitter.
        const frac = clamp(0.5 - (score - ref) / 40, 0.01, 0.99);
        rank = clamp(Math.round(frac * cohortN + (rand() - 0.5) * 6), 1, cohortN);
      }
      if (rand() < 0.5) yearAvg = clamp(round1(ref - 1 + (rand() - 0.5) * 4), 0, 100);
      if (rand() < 0.4) worthPct = 20 + Math.floor(rand() * 11);
    }
    entries.push({ id: uid(), subjectId: sub.id, date: iso(dt), type, score, title, classAvg, yearAvg, rank, cohortN, worthPct });
  };

  /** The next day school is open, or null if that is past the end of the demo. */
  const openOnOrAfter = (dt: Date): Date | null => {
    const d = new Date(dt.getTime());
    for (let i = 0; i < 120; i++) {
      if (d > end) return null;
      if (inSession(iso(d), cal)) return new Date(d.getTime());
      d.setDate(d.getDate() + 1);
    }
    return null;
  };

  /* Every term that has closed by `end` sat an exam round on its last day. */
  const rounds: { date: Date; title: string }[] = [];
  for (let y = begin.getFullYear(); y <= end.getFullYear(); y++) {
    termsOf(y, cal).forEach((span, i) => {
      if (span.end < iso(begin) || span.end > endIso) return;
      rounds.push({ date: pDate(span.end), title: ROUND_TITLE[i] });
    });
  }
  rounds.sort((a, b) => a.date.getTime() - b.date.getTime());

  const subjects: Subject[] = DEFAULT_SUBJECT_DEFS.map((def) => {
    const sim = SIM[def.ticker];
    const sub: Subject = { ...def, target: sim.target, courseworkPct: sim.courseworkPct };
    const roll = [...rounds];
    let dt = openOnOrAfter(new Date(begin.getFullYear(), begin.getMonth(), 8 + Math.floor(rand() * 10)));
    let i = 0;
    let last: Date | null = null;
    while (dt && dt <= end) {
      // Any exam round the coursework has just walked past is sat first, so
      // the tape stays in date order and the round lands on its real day.
      while (roll.length && roll[0].date <= dt) {
        const r = roll.shift()!;
        push(sub, sim, r.date, i++, "Exam", r.title);
        last = r.date;
      }
      push(sub, sim, dt, i++);
      last = dt;
      dt = openOnOrAfter(new Date(dt.getTime() + (17 + rand() * 17) * 864e5));
    }
    for (const r of roll) {
      if (r.date > end) break;
      push(sub, sim, r.date, i++, "Exam", r.title);
      if (!last || r.date > last) last = r.date;
    }
    // Keep the tape fresh: guarantee a result within the last two weeks.
    if (last && end.getTime() - last.getTime() > 16 * 864e5) {
      const recent = openOnOrAfter(new Date(end.getTime() - Math.floor(rand() * 10 + 4) * 864e5));
      if (recent) push(sub, sim, recent, i, rand() < 0.5 ? "Test" : "Assignment");
    }
    return sub;
  });

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  /* Give the SCORECARD a pulse too: one already-sat sitting whose call the
     register can score against the desk, two still ahead, and a few readiness
     duels — enough that the behavioural panels demo, not sit empty. */
  const exams = entries.filter((e) => e.type === "Exam");
  const recent = exams[exams.length - 1];
  const upcoming: Upcoming[] = [];
  if (recent) {
    const p = clamp(round1(recent.score + 5), 0, 100);
    upcoming.push({
      id: uid(), subjectId: recent.subjectId, date: recent.date, type: "Exam", title: "Mock — my call",
      selfPred: { point: p, lo: clamp(p - 8, 0, 100), hi: clamp(p + 8, 0, 100) },
      teacherPred: clamp(round1(recent.score - 2), 0, 100),
      chips: [0, 1, 2, 4, 2, 1],
    });
  }
  const ahead = (days: number) => iso(new Date(end.getTime() + days * 864e5));
  if (subjects[0]) upcoming.push({ id: uid(), subjectId: subjects[0].id, date: ahead(21), type: "Exam", title: "End-of-year exam", weight: 50, syllabusCoverage: 65, selfPred: { point: subjects[0].target ?? 80 } });
  if (subjects[1]) upcoming.push({ id: uid(), subjectId: subjects[1].id, date: ahead(30), type: "Exam", title: "End-of-year exam", weight: 50, syllabusCoverage: 40 });

  const duels: Duel[] = [];
  const duel = (a?: Subject, b?: Subject, winner?: Subject) => {
    if (a && b && winner) duels.push({ id: uid(), aId: a.id, bId: b.id, winnerId: winner.id, createdAt: ahead(-3) });
  };
  duel(subjects[0], subjects[2], subjects[0]);
  duel(subjects[2], subjects[4], subjects[2]);
  duel(subjects[0], subjects[4], subjects[0]);

  return {
    subjects, entries, settings: freshSettings(), sample: true,
    ...(upcoming.length ? { upcoming } : {}),
    ...(duels.length ? { duels } : {}),
  };
}
