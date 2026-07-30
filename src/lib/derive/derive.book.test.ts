import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import katex from "katex";
import { describe, expect, it } from "vitest";
import { parseImport } from "../io";
import { computeStats } from "../stats";
import { advise } from "../quant/advisor";
import { fitDepth } from "../quant/depth";
import { aggregateForecast, compositeIndex, examAggregate } from "../quant/aggregate";
import { DEFAULT_HOURS_PER_WEEK, allocationGap, suggestAllocation, type WaterFill } from "../allocate";
import { DEFAULT_CALENDAR } from "../calendar";
import { addComposite, COMP_KEY } from "../composite";
import { eloRank } from "../duel";
import { elicitationScoreboard } from "../elicit";
import { addForecast, addMovingAvg, buildGroupedRows, type TrendFit } from "../grouping";
import { scoreMeanCall } from "../meancall";
import { currentTermKey, entryTermKey } from "../periods";
import { backtestBook } from "../quant/eval/backtest";
import { meanSkill } from "../quant/eval/skill";
import { meanCallSkill } from "../quant/meanpool";
import { fitSelfWeight } from "../quant/pool";
import { fitAiWeight } from "../quant/aipool";
import { readinessSkill } from "../quant/readiness";
import { classifyUpcoming } from "../upcoming";
import { makeWeightFn } from "../weights";
import { emptySignalBook, signalBoard } from "../quant/signals/signalread";
import { signalSkill } from "../quant/signals/signalskill";
import { studyStock, type StockRead } from "../quant/signals/stock";
import { topicMastery, masteryRead, type MasteryRead } from "../quant/signals/mastery";
import { valueOfInformation } from "../quant/signals/voi";
import { CITATIONS } from "./cite";
import { DERIVATION_IDS, derivationFor } from "./index";
import type { ScorecardFacts } from "./facts";
import type { Derivation, DeriveCtx } from "./types";
import type { AblationRow } from "../quant/eval/ablation";
import type { Duel, ForecastLog, MeanCall, SubjectStat, Upcoming } from "../../types";

/**
 * The derivation layer, exercised against the committed three-year fixture book
 * (anonymised from the real 2024–2026 export — same structure, synthetic marks).
 *
 * Three things are asserted, in order of how badly they would embarrass the
 * feature if they broke:
 *
 *  1. RECONCILIATION — every derivation's stated result equals the number the
 *     interface displays for the same figure. A research note that disagrees
 *     with its own output is worse than no note at all.
 *  2. VALID TYPESETTING — every LaTeX string in every derivation parses. This
 *     is the only place a formula typo can be caught before a user sees a red
 *     error where an equation should be.
 *  3. STRUCTURAL INTEGRITY — ids unique, drill-downs resolve, citations exist,
 *     no NaN or undefined leaking into a displayed value.
 */

const TODAY = "2026-07-21";
const raw = readFileSync(fileURLToPath(new URL("../__fixtures__/book.json", import.meta.url)), "utf8");
const parsed = parseImport(raw);
if (!parsed.ok) throw new Error("real book failed to parse");
const { subjects, entries, settings } = parsed.payload;
// The engine gets the whole book; the boards get the live desks. Filtering the
// subjects first would cut ECON and BUS off from the tape they inherit.
const stats = computeStats(subjects, entries, settings!, TODAY).filter((s) => !s.sub.archived);
const active = stats.map((s) => s.sub);
const depthModel = fitDepth(entries, settings!);
const index = compositeIndex(stats, null);
const forecast = aggregateForecast(stats, examAggregate(stats));
const signals = advise(
  stats.filter((s) => s.quant).map((s) => ({ sub: s.sub, quant: s.quant!, entries: s.entries })),
  TODAY,
);

const ctxFor = (stat: SubjectStat): DeriveCtx => ({
  stat,
  stats,
  index,
  forecast,
  depthModel,
  settings: settings!,
  signal: signals.find((s) => s.id === stat.sub.id) ?? null,
});

/** Every (id, desk) pair that actually builds — the corpus under test. */
const built: { id: string; ticker: string; d: Derivation }[] = [];
for (const stat of stats) {
  const ctx = ctxFor(stat);
  for (const id of DERIVATION_IDS) {
    const d = derivationFor(id, ctx);
    if (d) built.push({ id, ticker: stat.sub.ticker, d });
  }
}

/* ── D5 and D2: the boards whose figures are not per-desk ──────────────
 *
 * The scorecard and the chart board price ELICITED inputs, and the committed
 * fixture deliberately carries none — it is a tape and nothing else, so §21 and
 * the walk-forward gate stay untouched by every channel built on top of it. The
 * inputs are therefore synthesized HERE, against the fixture's own dates and
 * marks, so the derivations that read them are exercised by the same corpus
 * checks as everything else: LaTeX parses, no NaN reaches a surface, and every
 * citation in the bibliography is actually referenced by something.
 */

const cal = settings!.calendar ?? DEFAULT_CALENDAR;
const liveIds = active.map((s) => s.id);
const tickerOf = Object.fromEntries(active.map((s) => [s.id, s.ticker]));

/** A round-robin of duels, all answered before any exam in the book. */
const duels: Duel[] = [];
for (let i = 0; i < liveIds.length; i++) {
  for (let j = i + 1; j < liveIds.length; j++) {
    duels.push({
      id: `d-${i}-${j}`,
      aId: liveIds[i],
      bId: liveIds[j],
      // Alternating winners: a pile with real structure, not a sweep.
      winnerId: (i + j) % 2 === 0 ? liveIds[i] : liveIds[j],
      createdAt: "2024-01-01T00:00:00.000Z",
    });
  }
}

/** A forecast register that called every exam round, deliberately imperfectly. */
const register: ForecastLog[] = entries
  .filter((e) => e.type === "Exam")
  .map((e, i) => ({
    id: `f-${i}`,
    subjectId: e.subjectId,
    roundKey: entryTermKey(e, cal),
    target: "exam" as const,
    createdAt: "2024-01-02T00:00:00.000Z",
    modelVersion: "test",
    point: e.score + (i % 2 === 0 ? 2.5 : -3.5),
    sd: 6,
    df: 8,
    ci90: { lo: e.score - 9, hi: e.score + 9 },
  }));

/** Every exam in the book, re-staged as a sitting that was called in advance. */
const upcoming: Upcoming[] = entries
  .filter((e) => e.type === "Exam")
  .map((e, i) => ({
    id: `u-${i}`,
    subjectId: e.subjectId,
    date: e.date,
    type: "Exam" as const,
    title: "SYNTHETIC SITTING",
    selfPred: { point: e.score + (i % 3) - 1, lo: e.score - 7, hi: e.score + 7 },
    teacherPred: e.score + 1.5,
    chips: [0, 1, 2, 3, 3, 1],
    aiPred: { point: e.score + 2, lo: e.score - 6, hi: e.score + 6, basis: "SYNTHETIC" },
  }));

const { resolved } = classifyUpcoming(upcoming, entries, TODAY);
const rawById = new Map(stats.map((s) => [s.sub.id, s]));
const modelFor = (r: { upcoming: Upcoming }) => {
  const q = rawById.get(r.upcoming.subjectId)?.quant;
  return q ? { mean: q.nextExam.mean, scale: q.nextExam.sd, df: q.df } : null;
};

/**
 * The life-signals board (§D5, T19). Same discipline as the chart/scorecard
 * facts below: the committed fixture carries no signal data at all (no
 * topics, sessions, rest, disruptions or profile — signalread.ts's own
 * load-bearing invariant), so every read here collapses to the identity.
 * That is exactly the state the derivations must degrade honestly against —
 * null baselines, empty term tables, zeroed adjustments — never a NaN or a
 * fabricated substitution.
 */
const signalBook = emptySignalBook;
const signalModelMeans = new Map(stats.map((s) => [s.sub.id, s.quant?.nextExam.mean ?? null]));
const signalReads = signalBoard(subjects, signalBook, entries, upcoming, signalModelMeans, TODAY);
const signalFit = signalSkill(register, signalBook, subjects, entries, true);
const voiDesks = new Map(stats.map((s) => [s.sub.id, s.quant?.nextExam.sd ?? null]));
const voi = valueOfInformation(active, signalBook, voiDesks, TODAY);
const signalStockOf: Record<string, StockRead> = {};
const signalMasteryOf: Record<string, MasteryRead> = {};
const signalModelMeanOf: Record<string, number | null> = {};
for (const sub of active) {
  signalStockOf[sub.id] = studyStock(signalBook.sessions, signalBook.rest, sub.mix ?? null, TODAY);
  const masteries = topicMastery(signalBook.topics, signalBook.topicMarks, signalBook.sessions, entries, sub.traits ?? null, sub.mix ?? null, TODAY);
  const mm = signalModelMeans.get(sub.id) ?? null;
  signalMasteryOf[sub.id] = masteryRead(signalBook.topics, masteries, mm, sub.attendancePct ?? null, TODAY);
  signalModelMeanOf[sub.id] = mm;
}
const signalCardFacts: ScorecardFacts = {
  signalStock: signalStockOf,
  signalMastery: signalMasteryOf,
  signalModelMean: signalModelMeanOf,
};
const signalCtx: DeriveCtx = {
  ...ctxFor(stats[0]),
  signalReads,
  signalFit,
  voi,
  card: signalCardFacts,
};
for (const id of ["signal.adjust", "signal.stock", "signal.mastery"]) {
  const d = derivationFor(id, signalCtx);
  if (d) built.push({ id, ticker: "SIGNALS", d });
}
for (let i = 0; i < Math.min(3, voi.length); i++) {
  const d = derivationFor("signal.voi", { ...signalCtx, key: String(i) });
  if (d) built.push({ id: "signal.voi", ticker: "SIGNALS", d });
}

const roundKeys = [...new Set(entries.filter((e) => e.type === "Exam").map((e) => entryTermKey(e, cal)))].sort();
const meanCalls: MeanCall[] = roundKeys.map((k, i) => ({
  id: `m-${i}`,
  roundKey: k,
  predAvg: 68 + i,
  ranking: liveIds.slice(0, Math.max(2, liveIds.length - 1)),
  createdAt: "2024-01-03T00:00:00.000Z",
}));

const priority = Object.fromEntries(
  liveIds.map((id) => [id, signals.find((s) => s.id === id)?.priority ?? 0]),
);
const fill: WaterFill = { lambda: 0, active: [], flat: false };
const model = suggestAllocation(liveIds.map((id) => ({ id, priority: priority[id] })), 100, fill);
// A plan that is not quite the model's, and a week that did not go to plan.
const plan = { ...model };
const actual = Object.fromEntries(Object.entries(plan).map(([id, t], i) => [id, Math.max(0, t + (i % 2 ? 4 : -4))]));

const ablation: AblationRow[] = [
  { key: "kalman", kind: "member", baseline: 3.11, ablated: 3.24, delta: 0.13, verdict: "keep" },
  { key: "trend", kind: "member", baseline: 3.11, ablated: 3.06, delta: -0.05, verdict: "prune" },
  { key: "effort", kind: "premium", baseline: 1.42, ablated: 1.43, delta: 0.01, verdict: "neutral" },
];

const cardFacts: ScorecardFacts = {
  book: backtestBook(active, entries),
  mean: meanSkill(active, entries, cal),
  elicit: elicitationScoreboard(resolved, modelFor),
  selfFit: fitSelfWeight(resolved, modelFor),
  aiFit: fitAiWeight(resolved, modelFor),
  readyFit: readinessSkill(duels, entries, register, cal),
  meanFit: meanCallSkill(meanCalls, entries, register, cal),
  ablation,
  deskForecast: forecast,
  on: true,
  call: {
    predAvg: meanCalls[0].predAvg,
    ranking: meanCalls[0].ranking,
    score: scoreMeanCall(
      meanCalls[0],
      Object.fromEntries(
        entries.filter((e) => e.type === "Exam" && entryTermKey(e, cal) === meanCalls[0].roundKey).map((e) => [e.subjectId, e.score]),
      ),
    ),
  },
  elo: { rows: eloRank(duels, liveIds), duels: duels.length, tickerOf },
  effort: {
    total: 100,
    hoursPerWeek: DEFAULT_HOURS_PER_WEEK,
    plan,
    actual,
    model,
    fill,
    priority,
    gap: allocationGap({ roundKey: roundKeys[0] ?? "r", total: 100, planned: plan, actual } as never),
    tickerOf,
  },
};

/** The chart board's own traces, drawn off the same book. */
const chartRows = buildGroupedRows(entries, "term", "all", makeWeightFn(settings!), cal).map((r) => ({ ...r }));
addComposite(chartRows, liveIds);
addMovingAvg(chartRows, liveIds);
const trend: Record<string, TrendFit> = {};
addForecast(chartRows, liveIds, "term", trend);
const trendId = Object.keys(trend)[0] ?? liveIds[0];
const maRow = chartRows.find((r) => typeof r[trendId + "_ma"] === "number");
const compRow = chartRows.find((r) => typeof r[COMP_KEY] === "number");

const cardCtx: DeriveCtx = { ...ctxFor(stats[0]), card: cardFacts };
const chartCtx: DeriveCtx = {
  ...ctxFor(stats[0]),
  chart: {
    trend,
    ticker: tickerOf[trendId],
    label: String(compRow?.label ?? ""),
    ma: maRow
      ? { win: 3, values: [70, 72, 74], value: maRow[trendId + "_ma"] as number }
      : null,
    comp: compRow
      ? {
          values: liveIds
            .filter((id) => typeof compRow[id] === "number")
            .map((id) => ({ ticker: tickerOf[id], v: compRow[id] as number })),
          value: compRow[COMP_KEY] as number,
        }
      : null,
  },
};

/**
 * A second pass of the book WITH the elicited inputs priced in. The three
 * premium lines they open — effort, plan and readiness — exist on no tape-only
 * book, so without this the readiness charge would ship with an unparsed
 * formula and nobody would find out until it opened on a real one.
 */
const curKey = currentTermKey(cal, TODAY).key;
const elicitedStats = computeStats(subjects, entries, settings!, TODAY, undefined, {
  allocations: [{ id: "a-1", roundKey: curKey, total: 100, planned: plan, actual, hoursPerWeek: DEFAULT_HOURS_PER_WEEK, createdAt: "2024-01-04T00:00:00.000Z" }],
  duels,
  readinessSkill: 0.6,
}).filter((s) => !s.sub.archived);

for (const stat of elicitedStats) {
  const ctx: DeriveCtx = { ...ctxFor(stat), stat, card: cardFacts };
  for (const id of DERIVATION_IDS) {
    const d = derivationFor(id, ctx);
    if (d && !built.some((b) => b.ticker === "ELICITED" && b.id === id)) built.push({ id, ticker: "ELICITED", d });
  }
}

/** Both boards, over every id, keyed to the desk the cursor would be on. */
for (const id of DERIVATION_IDS) {
  for (const [label, ctx] of [
    ["SCORECARD", { ...cardCtx, key: undefined }],
    ["SCORECARD", { ...cardCtx, key: liveIds[0] }],
    ["SCORECARD", { ...cardCtx, key: "member.kalman" }],
    ["SCORECARD", { ...cardCtx, key: "premium.effort" }],
    ["CHARTBOARD", { ...chartCtx, key: trendId }],
  ] as [string, DeriveCtx][]) {
    const d = derivationFor(id, ctx);
    if (d && !built.some((b) => b.ticker === label && b.id === id)) built.push({ id, ticker: label, d });
  }
}

const texOf = (d: Derivation): string[] => [
  d.symbol,
  ...d.steps.flatMap((s) => [s.tex, s.subst].filter((x): x is string => !!x)),
  ...d.inputs.map((i) => i.sym),
  d.result.tex,
];

describe("the derivation layer on the real book", () => {
  it("builds a substantial corpus — every desk, most of the catalogue", () => {
    expect(stats.length).toBeGreaterThanOrEqual(6);
    expect(DERIVATION_IDS.length).toBeGreaterThanOrEqual(39);
    // Every desk on this book is fully priced, marked, rated and ranked.
    for (const s of stats) {
      const mine = built.filter((b) => b.ticker === s.sub.ticker);
      expect(mine.length, s.sub.ticker).toBeGreaterThanOrEqual(25);
    }
  });

  it("every LaTeX string parses — no formula typo reaches the interface", () => {
    for (const { id, ticker, d } of built) {
      for (const tex of texOf(d)) {
        expect(
          () => katex.renderToString(tex, { throwOnError: true, strict: "ignore" }),
          `${id} · ${ticker} · ${tex}`,
        ).not.toThrow();
      }
    }
  });

  it("never leaks NaN, undefined or Infinity into a displayed value", () => {
    for (const { id, ticker, d } of built) {
      const surface = [
        d.title, d.claim, d.result.value, d.source,
        ...d.inputs.map((i) => i.value),
        ...d.steps.map((s) => s.note ?? ""),
        ...texOf(d),
      ].join(" ");
      for (const bad of ["NaN", "undefined", "Infinity", "[object"]) {
        expect(surface.includes(bad), `${id} · ${ticker} · ${bad}`).toBe(false);
      }
    }
  });

  it("reconciles: the MARK derivation states the price the board shows", () => {
    for (const s of stats) {
      const d = derivationFor("mark.price", ctxFor(s))!;
      expect(d.result.value, s.sub.ticker).toBe(s.quant!.price.toFixed(1));
    }
  });

  it("reconciles: fair value, the discount and the oracle", () => {
    for (const s of stats) {
      const ctx = ctxFor(s);
      const q = s.quant!;
      expect(derivationFor("fv.value", ctx)!.result.value, s.sub.ticker).toBe(q.fv.toFixed(1));
      expect(derivationFor("mark.discount", ctx)!.result.value, s.sub.ticker).toBe(q.discount.toFixed(1));
      expect(derivationFor("oracle.next", ctx)!.result.value, s.sub.ticker).toBe(q.nextExam.mean.toFixed(1));
      expect(derivationFor("fv.p10", ctx)!.result.value, s.sub.ticker).toBe(q.p10.toFixed(1));
      expect(derivationFor("mark.regime", ctx)!.result.value, s.sub.ticker).toBe(q.regime);
    }
  });

  it("reconciles: every premium line matches its row in the waterfall", () => {
    let checked = 0;
    for (const s of stats) {
      const ctx = ctxFor(s);
      for (const line of s.quant!.premia) {
        const d = derivationFor(`premium.${line.key}`, ctx);
        expect(d, `${s.sub.ticker} · ${line.key}`).not.toBeNull();
        // The interface prints "− 4.7" for a charge and "+ 0.8" for a credit.
        const shown = `${line.pts >= 0 ? "−" : "+"}${Math.abs(line.pts).toFixed(1)}`;
        expect(d!.result.value, `${s.sub.ticker} · ${line.key}`).toBe(shown);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("reconciles: the analyst desk and the advisor", () => {
    let checked = 0;
    for (const s of stats) {
      const ctx = ctxFor(s);
      const d = derivationFor("rating.score", ctx);
      if (!d) continue;
      checked++;
      expect(d.result.value, s.sub.ticker).toBe((s.rating.score >= 0 ? "+" : "") + s.rating.score.toFixed(2));
      expect(derivationFor("rating.conviction", ctx)!.result.value).toBe(String(s.rating.conviction));
      const t = derivationFor("rating.target", ctx);
      if (t) expect(t.result.value, s.sub.ticker).toBe(s.rating.target!.toFixed(1));
      const u = derivationFor("advisor.priority", ctx);
      if (u) expect(u.result.value, s.sub.ticker).toBe(ctx.signal!.priority.toFixed(0));
    }
    expect(checked, "no desk built a rating.score to reconcile").toBeGreaterThan(0);
  });

  it("reconciles: depth reads the same percentile the drawer prints", () => {
    let checked = 0;
    for (const s of stats) {
      if (!s.depth) continue;
      const d = derivationFor("depth.field", ctxFor(s))!;
      expect(d.result.value, s.sub.ticker).toBe(s.percentile!.toFixed(0));
      checked++;
    }
    expect(checked, "no desk carried a depth read to reconcile").toBeGreaterThan(0);
  });

  it("reconciles: the composite index and the forward aggregate", () => {
    const ctx = ctxFor(stats[0]);
    expect(derivationFor("book.composite", ctx)!.result.value).toBe(index!.value!.toFixed(1));
    expect(derivationFor("book.forecast", ctx)!.result.value).toBe(`${forecast!.pct.toFixed(1)}%`);
  });

  it("reconciles: the scoreboard states the figures D5 prints", () => {
    const b = cardFacts.book!;
    const m = cardFacts.mean!;
    expect(derivationFor("skill.crps", cardCtx)!.result.value).toBe(`${(b.skill * 100).toFixed(0)}%`);
    expect(derivationFor("skill.mae", cardCtx)!.result.value).toBe(m.mae.toFixed(1));
    expect(derivationFor("skill.bias", cardCtx)!.result.value).toBe((b.bias >= 0 ? "+" : "") + b.bias.toFixed(1));
    expect(derivationFor("skill.coverage", cardCtx)!.result.value).toBe(`${Math.round(b.cover90 * 100)}%`);
    // AblationCard prints signed(delta) beside the verdict; the note must agree.
    for (const row of ablation) {
      const d = derivationFor("skill.ablation", { ...cardCtx, key: `${row.kind}.${row.key}` });
      expect(d, row.key).not.toBeNull();
      expect(d!.result.value, row.key).toBe((row.delta >= 0 ? "+" : "") + row.delta.toFixed(1));
    }
  });

  it("reconciles: you vs the desk, and every earned weight", () => {
    const e = cardFacts.elicit!;
    expect(derivationFor("elicit.mae", cardCtx)!.result.value).toBe(e.self.youMae!.toFixed(1));
    expect(derivationFor("elicit.crps", cardCtx)!.result.value).toBe(e.self.youCrps!.toFixed(1));
    expect(derivationFor("elicit.coverage", cardCtx)!.result.value).toBe(`${Math.round(e.self.coverage! * 100)}%`);
    expect(derivationFor("elicit.brier", cardCtx)!.result.value).toBe(e.chips.youBrier!.toFixed(1));
    expect(derivationFor("elicit.teacher", cardCtx)!.result.value).toBe(e.teacher.youMae!.toFixed(1));
    expect(derivationFor("elicit.ai", cardCtx)!.result.value).toBe(e.ai.youMae!.toFixed(1));
    for (const [id, w] of [
      ["earn.self", cardFacts.selfFit!.w],
      ["earn.ai", cardFacts.aiFit!.w],
      ["earn.readiness", cardFacts.readyFit!.w],
      ["earn.aggregate", cardFacts.meanFit!.w],
    ] as [string, number][]) {
      expect(derivationFor(id, cardCtx)!.result.value, id).toBe(`${Math.round(w * 100)}%`);
    }
    // Every weight the layer can quote is inside the cap its channel declares.
    expect(cardFacts.selfFit!.w).toBeLessThanOrEqual(0.45);
    expect(cardFacts.meanFit!.w).toBeLessThanOrEqual(0.45);
    expect(cardFacts.aiFit!.w).toBeLessThanOrEqual(0.35);
  });

  it("reconciles: the elo table, the scored call and the gap", () => {
    const row = cardFacts.elo!.rows[0];
    const elo = derivationFor("duel.elo", { ...cardCtx, key: row.id })!;
    expect(elo.result.value).toBe(String(Math.round(row.rating)));
    const call = cardFacts.call!;
    const scored = derivationFor("call.score", cardCtx)!;
    expect(scored.result.value).toBe((call.score.error! >= 0 ? "+" : "") + call.score.error!.toFixed(1));
    // The GAP card prints signed(raw); the shrunk δ̂ is an input, not the result.
    let checked = 0;
    for (const s of stats) {
      const d = derivationFor("gap.exam", ctxFor(s));
      if (!d) continue;
      const raw = Number(d.inputs.find((i) => i.label === "shrunk offset")!.value);
      expect(Number.isFinite(raw)).toBe(true);
      expect(d.result.value).toMatch(/^[+-]\d+\.\d$/);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("reconciles: the effort spider and the chart board", () => {
    const e = cardFacts.effort!;
    const id = Object.keys(e.model).find((k) => e.model[k] > 0)!;
    const plan = derivationFor("effort.plan", { ...cardCtx, key: id })!;
    expect(plan.result.value).toBe(((e.model[id] / e.total) * e.hoursPerWeek).toFixed(1));
    const drift = derivationFor("effort.drift", cardCtx)!;
    expect(drift.result.value).toBe(((e.gap!.totalAbs / e.total) * e.hoursPerWeek).toFixed(1));

    expect(Object.keys(trend).length, "no subject produced a trend fit").toBeGreaterThan(0);
    const t = trend[trendId];
    expect(derivationFor("chart.trend", { ...chartCtx, key: trendId })!.result.value).toBe(t.pred.toFixed(1));
    const ma = chartCtx.chart!.ma!;
    expect(derivationFor("chart.ma", chartCtx)!.result.value).toBe(ma.value.toFixed(1));
    const comp = chartCtx.chart!.comp!;
    expect(derivationFor("chart.composite", chartCtx)!.result.value).toBe(comp.value.toFixed(1));
  });

  it("reconciles: the life-signals channel states the figures the SIGNALS board shows", () => {
    const read = signalReads.get(stats[0].sub.id)!;
    const wAdj = signalFit.w * read.adj;
    const fmtPts = (x: number) => (Math.abs(x) < 0.005 ? "0.00" : `${x > 0 ? "+" : ""}${x.toFixed(2)}`);
    expect(derivationFor("signal.adjust", signalCtx)!.result.value).toBe(fmtPts(wAdj));

    const stock = signalStockOf[stats[0].sub.id];
    expect(derivationFor("signal.stock", signalCtx)!.result.value).toBe((stock.term >= 0 ? "+" : "") + stock.term.toFixed(2));

    const mastery = signalMasteryOf[stats[0].sub.id];
    expect(derivationFor("signal.mastery", signalCtx)!.result.value).toBe((mastery.term >= 0 ? "+" : "") + mastery.term.toFixed(2));

    // On this untouched book both channels collapse to the identity.
    expect(read.adj).toBe(0);
    expect(read.terms).toEqual([]);
    expect(stock.baseline).toBeNull();
    expect(mastery.predictedPaper).toBeNull();

    for (let i = 0; i < Math.min(3, voi.length); i++) {
      const d = derivationFor("signal.voi", { ...signalCtx, key: String(i) })!;
      expect(d.result.value).toBe(voi[i].score.toFixed(3));
    }
  });

  it("has no dead builders — every registered id builds somewhere", () => {
    const alive = new Set(built.map((b) => b.id));
    const dead = DERIVATION_IDS.filter((id) => !alive.has(id));
    expect(dead, `never built: ${dead.join(", ")}`).toEqual([]);
  });

  it("keeps its own house in order — ids, drill-downs, citations, sources", () => {
    expect(new Set(DERIVATION_IDS).size).toBe(DERIVATION_IDS.length);
    for (const { id, d } of built) {
      expect(d.id, id).toBe(id);
      expect(d.title.length).toBeGreaterThan(3);
      expect(d.claim.length).toBeGreaterThan(10);
      expect(d.steps.length).toBeGreaterThan(0);
      expect(d.source).toMatch(/^src\/lib\/.+\.ts · .+/);
      for (const rid of d.related ?? []) {
        expect(DERIVATION_IDS.includes(rid), `${id} → ${rid}`).toBe(true);
      }
      for (const key of d.refs ?? []) {
        expect(CITATIONS[key], `${id} → ${key}`).toBeDefined();
      }
    }
  });

  it("cites real, complete references", () => {
    for (const [key, c] of Object.entries(CITATIONS)) {
      expect(c.short, key).toMatch(/\(\d{4}\)/);
      expect(c.year).toBeGreaterThan(1700);
      expect(c.year).toBeLessThan(2030);
      expect(c.authors.length, key).toBeGreaterThan(4);
      expect(c.title.length, key).toBeGreaterThan(10);
      expect(c.venue.length, key).toBeGreaterThan(5);
      expect(c.short).toContain(String(c.year));
    }
  });

  it("is used: every citation in the bibliography is referenced by something", () => {
    const cited = new Set(built.flatMap((b) => b.d.refs ?? []));
    const orphans = Object.keys(CITATIONS).filter((k) => !cited.has(k as keyof typeof CITATIONS));
    expect(orphans, `uncited: ${orphans.join(", ")}`).toEqual([]);
  });

  it("degrades honestly on a desk with a single print", () => {
    const thin = computeStats(
      [active[0]],
      entries.filter((e) => e.subjectId === active[0].id).slice(0, 1),
      settings!,
      TODAY,
    );
    const ctx: DeriveCtx = { stat: thin[0], stats: thin, settings: settings!, depthModel };
    for (const id of DERIVATION_IDS) {
      const d = derivationFor(id, ctx);
      if (!d) continue;
      // Whatever survives at n=1 must still typeset and must not claim
      // certainty it does not have.
      for (const tex of texOf(d)) {
        expect(() => katex.renderToString(tex, { throwOnError: true, strict: "ignore" }), `${id} · ${tex}`).not.toThrow();
      }
      expect(d.result.value).not.toContain("NaN");
    }
  });
});
