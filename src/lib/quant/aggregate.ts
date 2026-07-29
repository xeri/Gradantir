import { clamp, round1 } from "../utils";
import { sessionDaysBetween, type SchoolCalendar } from "../calendar";
import { buildRounds, examRounds, type Round } from "../rounds";
import { assertRoster, crossSectionAt, groupByLineage, inheritedEntries, rosterAt } from "../lineage";
import { poolStats, poolableScores } from "./shrinkage";
import { markBook } from "./mark";
import { priceSubject } from "./price";
import type { FactorInput } from "./factors";
import type {
  AggregateForecast, AggregatePoint, CompositeIndex, ExamAggregate,
  GradeEntry, PriceResult, Settings, Subject,
} from "../../types";

/**
 * The book's three headline instruments:
 *
 *   AGGREGATE   — every desk's LAST EXAM, summed. No model, no forecast.
 *   PREDICTION  — the same desks' next exam round, priced by the oracle.
 *   COMPOSITE   — the scaled capability index: mean model price per desk.
 *
 * All three exclude desks that have nothing to report from the sum AND the
 * denominator (a new listing shows as pending, not as a drag), and every
 * term-over-term delta compares only desks present in both snapshots — a
 * newly listed subject cannot fake a rally.
 *
 * The histories run on the WHOLE book, delisted desks included, and ask
 * `listedAt` who was actually reporting at each cutoff. A term you sat six
 * subjects in is scored out of 600 forever, even if two of them have since
 * closed; the live headline still counts only the desks open today. The three
 * point-in-time functions take whatever roster they are handed — App passes
 * the desks listed now — so the filtering rule lives in exactly one place.
 *
 * Both tapes are struck at ROUNDS, not at term-ends: a term the school never
 * examined in never appears, because carrying April's exams forward and
 * stamping a later term on them is how the board ends up claiming a result it
 * does not have. The x-axis is therefore the book's own reporting rhythm.
 */

const Z90 = 1.6449; // the per-desk t-tails have already been priced in; the sum is ~normal

/**
 * Sd of a sum of desk forecasts under a single hand-set equicorrelation ρ (the
 * subject-affinity prior). Quadrature — `√Σσ²` — assumes the desks' errors are
 * independent, but §17 fits a common period effect π_t precisely because they
 * are not: a term that goes badly tends to go badly across the board, so the
 * true aggregate band is wider. With Var(Σ) = (1−ρ)Σσ² + ρ(Σσ)²:
 *   • ρ = 0 recovers exact quadrature (the byte-identical default);
 *   • ρ = 1 adds the sds linearly (perfectly common shocks).
 * The correlation is a prior, not a fit — one student's book cannot identify a
 * cross-subject covariance (no second student to separate "hard term" from "bad
 * term"), so the user sets it; ρ = 0 asserts nothing.
 */
export function correlatedSumSd(sds: number[], rho: number): number {
  const quad = sds.reduce((a, s) => a + s * s, 0); // Σσ²
  const lin = sds.reduce((a, s) => a + s, 0); // Σσ
  return Math.sqrt((1 - rho) * quad + rho * lin * lin);
}

/** Four years of rounds — a school career, not a single year. */
const ROUNDS_BACK = 16;

const byDate = (a: GradeEntry, b: GradeEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/* ── 1 · AGGREGATE — raw, model-free ──────────────────────────────── */

/**
 * The headline: each desk's most recent exam print, summed out of 100 apiece.
 * Carried forward however old it is — an exam is the last thing the desk
 * actually reported. Desks that have never sat one are excluded entirely.
 */
export function examAggregate(stats: { sub: Subject; entries: GradeEntry[] }[]): ExamAggregate | null {
  // The headline is a cross-desk sum, so it is subject to the same lineage rule
  // as the tapes: an ancestor and its successor on the book together would
  // count one desk's prints twice.
  assertRoster(stats, stats.map((s) => s.sub));
  type Row = { sub: Subject; last: GradeEntry | undefined; prior: GradeEntry | undefined };
  const rows = stats
    .map(({ sub, entries }): Row => {
      const exams = [...entries].filter((e) => e.type === "Exam").sort(byDate);
      return { sub, last: exams[exams.length - 1], prior: exams[exams.length - 2] };
    })
    .filter((r): r is Row & { last: GradeEntry } => r.last != null);
  if (!rows.length) return null;

  // Two desks may report the SAME physical print: a desk that split before
  // either successor sat an exam under its own name leaves both of them
  // carrying the ancestor's last paper. That is one exam, and the book counts
  // it once — in the sum and in the denominator alike. Deduping on the print's
  // identity makes this true however the caller assembled its tapes.
  const seen = new Set<string>();
  const counted = rows.filter((r) => !seen.has(r.last.id) && (seen.add(r.last.id), true));

  const sum = counted.reduce((a, r) => a + r.last.score, 0);
  const outOf = 100 * counted.length;

  const common = counted.filter((r) => r.prior != null);
  let delta: number | null = null;
  let pctDelta: number | null = null;
  if (common.length) {
    const now = common.reduce((a, r) => a + r.last.score, 0);
    const then = common.reduce((a, r) => a + (r.prior as GradeEntry).score, 0);
    delta = round1(now - then);
    pctDelta = round1((now - then) / common.length);
  }

  return {
    sum: round1(sum),
    outOf,
    count: counted.length,
    pct: round1((100 * sum) / outOf),
    delta,
    pctDelta,
    reported: counted.length,
    listed: stats.length,
    asOf: counted.reduce((a, r) => (r.last.date > a ? r.last.date : a), counted[0].last.date),
    perSubject: counted.map((r) => ({
      id: r.sub.id,
      ticker: r.sub.ticker,
      color: r.sub.color,
      score: r.last.score,
      date: r.last.date,
      // A book whose every last exam printed 0 has no shares to apportion.
      share: sum > 0 ? round1((100 * r.last.score) / sum) : 0,
    })),
  };
}

/* ── 2 · PREDICTION — the next exam round ─────────────────────────── */

/** Σ next-exam oracle over priced desks, with the errors added in quadrature. */
export function aggregateForecast(
  stats: { sub: Subject; quant: PriceResult | null }[],
  realized: ExamAggregate | null,
  rho = 0,
): AggregateForecast | null {
  const priced = stats.filter((s): s is { sub: Subject; quant: PriceResult } => s.quant != null);
  if (!priced.length) return null;
  const sum = priced.reduce((a, s) => a + s.quant.nextExam.mean, 0);
  const outOf = 100 * priced.length;
  const sd = correlatedSumSd(priced.map((s) => s.quant.nextExam.sd), rho);

  // The expected move is only meaningful over desks that have BOTH a forecast
  // and a last exam to compare it against.
  let vsLast: number | null = null;
  if (realized) {
    const lastBySub = new Map(realized.perSubject.map((p) => [p.id, p.score]));
    const both = priced.filter((s) => lastBySub.has(s.sub.id));
    if (both.length) {
      const fc = both.reduce((a, s) => a + s.quant.nextExam.mean, 0);
      const was = both.reduce((a, s) => a + (lastBySub.get(s.sub.id) as number), 0);
      vsLast = round1((fc - was) / both.length);
    }
  }

  return {
    sum: round1(sum),
    outOf,
    count: priced.length,
    pct: round1((100 * sum) / outOf),
    sd: round1(sd),
    ci90: {
      lo: round1(clamp(sum - Z90 * sd, 0, outOf)),
      hi: round1(clamp(sum + Z90 * sd, 0, outOf)),
    },
    vsLast,
  };
}

/* ── 3 · GX COMPOSITE — the scaled capability index ───────────────── */

export function compositeIndex(
  stats: { sub: Subject; quant: PriceResult | null }[],
  prevPrices: Map<string, number> | null,
  rho = 0,
): CompositeIndex | null {
  const priced = stats.filter((s): s is { sub: Subject; quant: PriceResult } => s.quant != null);
  if (!priced.length) return null;
  const sum = priced.reduce((a, s) => a + s.quant.price, 0);
  const outOf = 100 * priced.length;
  const sd = correlatedSumSd(priced.map((s) => s.quant.sd), rho);

  let delta: number | null = null;
  if (prevPrices) {
    const common = priced.filter((s) => prevPrices.has(s.sub.id));
    if (common.length) {
      const now = common.reduce((a, s) => a + s.quant.price, 0);
      const then = common.reduce((a, s) => a + (prevPrices.get(s.sub.id) as number), 0);
      delta = round1((now - then) / common.length);
    }
  }

  return {
    value: round1(sum / priced.length),
    delta,
    sum: round1(sum),
    outOf,
    count: priced.length,
    sd: round1(sd),
    ci90: {
      lo: round1(clamp(sum - Z90 * sd, 0, outOf)),
      hi: round1(clamp(sum + Z90 * sd, 0, outOf)),
    },
    perSubject: priced.map((s) => ({
      id: s.sub.id,
      ticker: s.sub.ticker,
      color: s.sub.color,
      price: s.quant.price,
      share: sum > 0 ? round1((100 * s.quant.price) / sum) : 0,
    })),
  };
}

/* ── Histories ────────────────────────────────────────────────────── */

/**
 * Re-MARK every subject using only prints dated on or before the cutoff: the
 * same fair pricing and the same harsh marking sweep the live board runs, so
 * the history tape and today's board never disagree about what a desk was
 * worth. Cross-sectional context (relative lag, vol vs book) is rebuilt from
 * the book as it stood at that cutoff.
 */
export function pricesAsOf(
  subjects: Subject[],
  entries: GradeEntry[],
  settings: Settings,
  cutoffIso: string,
  opts?: { drop?: ReadonlySet<string> },
): Map<string, number> {
  // Pooled over lineages for the same reason the live board is — a tape must
  // enter the prior exactly once however many desks it has since become.
  const truncated = entries.filter((e) => e.date <= cutoffIso);
  const pool = poolStats(poolableScores(groupByLineage(subjects, truncated)));
  const inputs: FactorInput[] = [];
  // The same cross-section rule the live board uses, asked at the cutoff — so a
  // repriced history and today's board can never disagree about who was being
  // compared with whom. At a 2025 cutoff ECON has not printed yet, so BEA holds
  // the seat; by 2026 its successors hold it and BEA steps out.
  for (const s of crossSectionAt(subjects, truncated, cutoffIso)) {
    // Priced on the LINEAGE tape: a desk that split still carries its history.
    const es = inheritedEntries(s, subjects, truncated);
    if (!es.length) continue;
    const latest = es[es.length - 1];
    inputs.push({
      sub: s,
      entries: es,
      scores: es.map((e) => e.score),
      latest,
      staleDays: sessionDaysBetween(latest.date, cutoffIso, settings.calendar),
      ath: Math.max(...es.map((e) => e.score)),
      quant: priceSubject(es, pool, settings, cutoffIso),
    });
  }
  const marks = markBook(inputs, cutoffIso, opts);
  const out = new Map<string, number>();
  for (const inp of inputs) {
    if (!inp.quant) continue;
    out.set(inp.sub.id, marks.get(inp.sub.id)?.mark ?? inp.quant.price);
  }
  return out;
}

const point = (r: Round | { key: string; label: string; date: string }, sum: number, outOf: number, live = false): AggregatePoint => ({
  key: r.key,
  label: r.label,
  date: r.date,
  sum: round1(sum),
  outOf,
  pct: round1((100 * sum) / outOf),
  ...(live ? { live: true } : {}),
});

/**
 * The rounds a tape is struck at: every term that printed, capped at a school
 * career and never reaching past today. The cutoff is the round's own last
 * print — the day the term's results were actually all in.
 */
const tapeRounds = (rounds: Round[], todayIso: string, back: number): Round[] =>
  rounds.filter((r) => r.date <= todayIso).slice(-back);

/** The AGGREGATE's own tape: what the exams printed, one point per exam round. */
export function examAggregateHistory(
  subjects: Subject[],
  entries: GradeEntry[],
  todayIso: string,
  cal: SchoolCalendar,
  back = ROUNDS_BACK,
): AggregatePoint[] {
  const points: AggregatePoint[] = [];
  for (const round of tapeRounds(examRounds(buildRounds(entries, cal)), todayIso, back)) {
    let sum = 0;
    let n = 0;
    // Membership is asked ONCE, of one function. Delisting, not-yet-listed and
    // lineage all live in `rosterAt`, so this tape and the mark tape below
    // cannot drift apart about who was on the book.
    for (const row of rosterAt(subjects, entries, round.date, cal)) {
      // A desk that skipped this round still carries its last exam — the
      // AGGREGATE asks what each desk last printed, not what it printed today.
      let last: GradeEntry | null = null;
      for (const e of row.entries) if (e.type === "Exam") last = e;
      if (last) { sum += last.score; n++; }
    }
    if (n) points.push(point(round, sum, 100 * n));
  }
  return points;
}

/**
 * The COMPOSITE's tape: the whole book repriced and re-marked at each round,
 * plus a live point at today whenever the open term has not printed yet — the
 * mark moves between rounds and the tape must not pretend otherwise.
 */
export function aggregateHistory(
  subjects: Subject[],
  entries: GradeEntry[],
  settings: Settings,
  todayIso: string,
  back = ROUNDS_BACK,
): AggregatePoint[] {
  const cal = settings.calendar;
  const rounds = buildRounds(entries, cal);
  const struck = tapeRounds(rounds, todayIso, back);

  const strike = (at: { key: string; label: string; date: string }, live = false): AggregatePoint | null => {
    // Every desk with a tape gets repriced — a closed one still lends its
    // history to the pooled prior — but only the desks on the book then are
    // summed, and `rosterAt` is the only thing that decides who those are.
    const prices = pricesAsOf(subjects, entries, settings, at.date);
    let sum = 0;
    let n = 0;
    for (const row of rosterAt(subjects, entries, at.date, cal)) {
      const p = prices.get(row.sub.id);
      if (p == null) continue;
      sum += p;
      n++;
    }
    return n ? point(at, sum, 100 * n, live) : null;
  };

  const points: AggregatePoint[] = [];
  for (const round of struck) {
    const p = strike(round);
    if (p) points.push(p);
  }
  const last = struck[struck.length - 1];
  if (last && last.date < todayIso) {
    const live = strike({ key: "__live", label: "NOW", date: todayIso }, true);
    if (live) points.push(live);
  }
  return points;
}
