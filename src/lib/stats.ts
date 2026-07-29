import { clamp, round1, stdev, todayStr } from "./utils";
import { sessionDaysBetween } from "./calendar";
import { currentTermKey, entryTermKey, prevTermKey } from "./periods";
import { subjectForecast, volatilityLabel } from "./regression";
import { entriesAvg } from "./weights";
import { closeTermOf, listedAt } from "./listing";
import { assertLineageIntact, crossSectionAt, groupByLineage, inheritedEntries } from "./lineage";
import { poolStats, poolableScores } from "./quant/shrinkage";
import { priceSubject, projectGrade } from "./quant/price";
import { IDENTITY_BIAS, type BiasModel } from "./quant/biascal";

import { fitDepth, subjectDepth } from "./quant/depth";
import { effortFor, effortPressure } from "./quant/effort";
import { readinessFor } from "./quant/readiness";
import { READINESS_PRIOR } from "./quant/params";
import { applyMark, markBook } from "./quant/mark";
import { rateBook } from "./quant/ratings";
import type { FactorInput } from "./quant/factors";
import type { Allocation, AppData, Duel, GradeEntry, NextExamForecast, Settings, Subject, SubjectStat } from "../types";

/**
 * Precompute every per-subject figure the UI shows. Averages honor weights;
 * the quant fields ride the ensemble engine, with cross-subject pooling so a
 * thin subject borrows strength from the rest of the book.
 */
/**
 * Shift + rescale a next-exam forecast by the learned bias, preserving the
 * interval shape (offset the centre, scale the half-widths). Identity when the
 * register is empty, so the live board and §21 are untouched until it fills.
 */
function correctNextExam(nx: NextExamForecast, offset: number, widthScale: number): NextExamForecast {
  const mean = nx.mean - offset;
  const band = (iv: { lo: number; hi: number }) => ({
    lo: clamp(mean - (nx.mean - iv.lo) * widthScale, 0, 100),
    hi: clamp(mean + (iv.hi - nx.mean) * widthScale, 0, 100),
  });
  return { mean: clamp(mean, 0, 100), sd: nx.sd * widthScale, ci50: band(nx.ci50), ci90: band(nx.ci90) };
}

/**
 * The elicited inputs the marking desk is allowed to price — what the student
 * told the book, as opposed to what the book measured. Gathered into one object
 * rather than trailing positionals because there are now several of them and
 * each carries its own switch and its own credibility (§15b, §15c).
 */
export interface ElicitedInputs {
  /** Effort budgets (D1). The one filed for the round being priced is read. */
  allocations?: Allocation[];
  /** Forced-choice readiness duels (D2). */
  duels?: Duel[];
  /**
   * The multiplier the duel pile has earned against realized exam orderings —
   * fitted by `quant/readiness.readinessSkill`, which needs the register and so
   * cannot be fitted here. Defaults to the unscored prior, so a caller that has
   * not scored the pile still prices it as the self-report it is.
   */
  readinessSkill?: number;
}

export function computeStats(
  subjects: Subject[],
  entries: GradeEntry[],
  settings: Settings,
  todayIso: string = todayStr(),
  bias: BiasModel = IDENTITY_BIAS,
  elicited: ElicitedInputs = {},
): SubjectStat[] {
  assertLineageIntact(subjects);
  const cal = settings.calendar;
  const cur = currentTermKey(cal, todayIso);
  const prev = prevTermKey(cal, todayIso);
  const ownBySubject = subjects.map((sub) =>
    entries
      .filter((e) => e.subjectId === sub.id)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  );
  // The prior pools over LINEAGES, not desks: each print counted once, under
  // the tape it belongs to. Pooling over desks would see a split book as two
  // thin subjects where there is really one long one — and a duplicated tape
  // as two identical subjects, which deflates tau² and leaves the engine more
  // confident about a book it understands less well.
  const pool = poolStats(poolableScores(groupByLineage(subjects, entries)));
  // INHERITED prints — what this desk is worth is a question about the whole
  // lineage. A desk that split last term still prices off the years behind it.
  const bySubject = subjects.map((sub) => inheritedEntries(sub, subjects, entries));
  // Depth is fitted once over the whole book: a period's class strength is only
  // separable from the student's own when every desk is read together.
  const depthModel = fitDepth(entries, settings);
  /* Silence is measured in SCHOOL DAYS. A desk cannot print over the summer,
     so the summer must not age it — on calendar time the whole book drifts
     toward caution every January for no reason anyone chose. Ability drift
     (Kalman, EWMA) deliberately stays on calendar time inside the ensemble. */
  const silence = (from: string): number => sessionDaysBetween(from, todayIso, cal);

  const rows = subjects.map((sub, si) => {
    // `es` is the LINEAGE tape — every figure describing this desk reads it, so
    // a desk that split last term is still judged on the years behind it.
    // `own` is what this desk reported under its own name, and it is what the
    // cross-desk sums are handed: see `lib/lineage.ts` for why the two differ.
    const es = bySubject[si];
    const own = ownBySubject[si];
    const scores = es.map((e) => e.score);
    const latest = es[es.length - 1] || null;
    const before = es[es.length - 2] || null;
    const tickDelta = latest && before ? round1(latest.score - before.score) : null;

    const curEntries = es.filter((e) => entryTermKey(e, cal) === cur.key);
    const prevEntries = es.filter((e) => entryTermKey(e, cal) === prev.key);
    const curAvgRaw = entriesAvg(curEntries, settings);
    const prevAvgRaw = entriesAvg(prevEntries, settings);
    const overallRaw = entriesAvg(es, settings);
    const curAvg = curAvgRaw != null ? round1(curAvgRaw) : null;
    const prevAvg = prevAvgRaw != null ? round1(prevAvgRaw) : null;
    const periodDelta = curAvg != null && prevAvg != null ? round1(curAvg - prevAvg) : null;

    const sd = round1(stdev(scores.slice(-10)));

    let ath: number | null = null, athDate: string | null = null, atl: number | null = null;
    for (const e of es) {
      if (ath == null || e.score > ath) { ath = e.score; athDate = e.date; }
      if (atl == null || e.score < atl) atl = e.score;
    }

    // Alpha is the edge over whoever you were measured against. Most school
    // reports publish a year-level mean and no class average at all, so the
    // class figure is preferred but never required — reading only classAvg
    // leaves alpha blank across an entire real book.
    const withClass = es.filter((e) => e.classAvg != null);
    const withYear = es.filter((e) => e.yearAvg != null);
    const alphaRef: SubjectStat["alphaRef"] = withClass.length ? "class" : withYear.length ? "year" : null;
    const alphaSrc = alphaRef === "class" ? withClass : alphaRef === "year" ? withYear : [];
    const alpha = alphaSrc.length
      ? round1(
          alphaSrc.reduce(
            (a, e) => a + (e.score - ((alphaRef === "class" ? e.classAvg : e.yearAvg) as number)),
            0,
          ) / alphaSrc.length,
        )
      : null;

    const quant = priceSubject(es, pool, settings, todayIso);
    const depth = subjectDepth(sub, es, depthModel, settings);

    return {
      // `entries` is the LINEAGE tape — every figure about this desk, and every
      // consumer downstream, reads a desk's whole history whatever it used to
      // be called. `own` rides alongside for the few callers that must know
      // what this desk reported under its own name.
      sub, entries: es, own, scores, latest, tickDelta,
      overallAvg: overallRaw != null ? round1(overallRaw) : null,
      curAvg, prevAvg, periodDelta, curCount: curEntries.length,
      sd, volatility: volatilityLabel(sd),
      forecast: subjectForecast(es),
      ath, athDate, atl,
      fromAth: latest && ath != null ? round1(latest.score - ath) : null,
      alpha, alphaCount: alphaSrc.length, alphaRef,
      curLabel: cur.label, prevLabel: prev.label,
      quant,
      priceDelta: quant && quant.prevPrice != null ? round1(quant.price - quant.prevPrice) : null,
      gradeProj: projectGrade(es, sub, settings),
      // Both percentiles read from the LATEST placement — where you stand now.
      // Averaging a 2024 placement with a 2026 one describes nobody. The
      // headline is the FIELD figure; the class one stays beside it rather
      // than masquerading as it.
      percentile: depth ? depth.latest.fieldPct : null,
      percentileCount: depth ? depth.history.length : 0,
      classPercentile: depth ? depth.latest.classPct : null,
      depth,
      staleDays: latest ? silence(latest.date) : null,
    };
  });

  // The mark-to-market pass: fair values become harsh marks, book-wide.
  // prevPrice is rewritten to the PREVIOUS MARK via leave-one-out — the desk
  // loses only its latest print, every other tape stands, the whole book is
  // re-marked — so priceDelta and the rating rewind stay attributable to that
  // one print under the same cross-sectional lens as the live board.
  // A desk whose tape has been inherited by a successor is HISTORY, not a
  // participant in today's cross-section. ECON and BUS already carry BEA's
  // prints, so seating BEA beside them would enter one tape three times and
  // quietly reset every "versus the book" comparison drawn from it. Desks that
  // simply closed (LAT, SPA, GRA) have no successor and stay: they are
  // independent evidence.
  const inSection = new Set(crossSectionAt(subjects, entries, todayIso).map((s) => s.id));
  // Effort weighting (§15b): the study budget filed for the round being priced,
  // read as each desk's share of an even week. Off by switch, absent by default,
  // and an exact identity at the marking desk in both cases — a book that has
  // never touched the spider is priced exactly as it was before the feature.
  const effort = effortPressure(effortFor(elicited.allocations, cur.key, settings.effortWeighting !== false));
  /* Readiness weighting (§15c): the duel pile, read as centred Bradley-Terry
     log-strength. Centred over the LIVE desks only — a closed desk has no
     readiness worth asking about, and seating it in the centring at base rating
     would drag every live desk's λ toward a desk nobody duelled. Off by switch,
     absent on a book that has never duelled, and an exact identity at the
     marking desk in both cases. */
  const section = rows.filter((r) => inSection.has(r.sub.id));
  const readiness = readinessFor(
    elicited.duels,
    section.filter((r) => !r.sub.archived).map((r) => r.sub.id),
    elicited.readinessSkill ?? READINESS_PRIOR,
    settings.readinessWeighting !== false,
  );
  const withElicited = <T extends { sub: Subject }>(r: T) =>
    ({ ...r, effort: effort.get(r.sub.id) ?? null, readiness: readiness.get(r.sub.id) ?? null });
  const crossSection = section.map(withElicited);
  const marks = markBook(crossSection, todayIso);
  const looInput = (r: (typeof rows)[number]): FactorInput => {
    const es = r.entries.slice(0, -1);
    const latest = es[es.length - 1] ?? null;
    return {
      sub: r.sub,
      entries: es,
      scores: es.map((e) => e.score),
      latest,
      ath: es.length ? Math.max(...es.map((e) => e.score)) : null,
      staleDays: latest ? silence(latest.date) : null,
      quant: priceSubject(es, pool, settings, todayIso),
      // The rewind drops a PRINT, never the elicitations: prevPrice must stay
      // attributable to that one print, so both reads are held fixed.
      effort: effort.get(r.sub.id) ?? null,
      readiness: readiness.get(r.sub.id) ?? null,
    };
  };
  const marked = rows.map((r) => {
    const m = r.quant ? marks.get(r.sub.id) : undefined;
    if (!r.quant || !m) return r;
    let prevPrice = r.quant.prevPrice;
    if (prevPrice != null && r.entries.length >= 2) {
      // Swapped by ID, not by reference: `crossSection` carries the effort read
      // alongside each row, so its members are no longer the very objects in
      // `rows` and an identity check would silently never substitute.
      const loo = markBook(crossSection.map((o) => (o.sub.id === r.sub.id ? looInput(r) : o)), todayIso).get(r.sub.id);
      prevPrice = loo ? loo.mark : prevPrice;
    }
    const quant = { ...applyMark(r.quant, m), prevPrice };
    return {
      ...r,
      quant,
      priceDelta: prevPrice != null ? round1(quant.price - prevPrice) : null,
    };
  });

  // Ratings are cross-sectional — a desk is rated against the book's own
  // drift — so they need every price first. One pass, then attach. Delisted
  // desks are rated but excluded from the benchmark: their history is evidence,
  // their non-existent future is not a bar anyone has to clear.
  const ratings = rateBook(
    marked.map((r) => ({
      sub: r.sub,
      quant: r.quant,
      n: r.entries.length,
      staleDays: r.staleDays,
      listed: listedAt(closeTermOf(r.sub, r.entries, cal), todayIso, cal),
    })),
  );
  return applyBias(
    marked.map((r) => {
      const rated = ratings.get(r.sub.id)!;
      return { ...r, rating: rated.rating, ratingPrev: rated.prev };
    }),
    bias,
  );
}

/**
 * Apply the register's learned bias to an already-priced board.
 *
 * The correction is a POST-PROCESS and nothing above it reads the bias model:
 * it shifts and rescales the next-exam call after the price, the mark, the
 * leave-one-out rewind and the ratings are all settled. That is why it can live
 * out here, and why it matters that it does — the shell needs two boards at
 * once, the uncorrected one the register must keep scoring itself against and
 * the corrected one the user reads, and pricing the whole book a second time to
 * get the second is the single most expensive thing the terminal does per edit.
 *
 * Exactly the identity on an empty register: the same array comes back, so a
 * book that has never resolved a forecast costs nothing and every downstream
 * memo keeps its reference. `stats.bias.test.ts` locks this against a full
 * recompute on the fixture book.
 */
export function applyBias(stats: SubjectStat[], bias: BiasModel): SubjectStat[] {
  if (!(bias.n > 0)) return stats;
  return stats.map((row) => {
    if (!row.quant) return row;
    // `in`, not a truthiness check: a desk whose fitted offset is exactly 0 has
    // been measured as unbiased, which is not the same as never measured.
    const offset = row.sub.id in bias.bySubject ? bias.bySubject[row.sub.id] : bias.global;
    return {
      ...row,
      quant: { ...row.quant, nextExam: correctNextExam(row.quant.nextExam, offset, bias.widthScale) },
    };
  });
}

export const statsOf = (data: AppData, bias?: BiasModel, readinessSkill?: number): SubjectStat[] =>
  computeStats(data.subjects, data.entries, data.settings, undefined, bias, {
    allocations: data.allocations, duels: data.duels, readinessSkill,
  });
