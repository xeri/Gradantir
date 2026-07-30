/**
 * Derivations for the PRICED elicitation channels (§15c, §27, §28) and the two
 * planning instruments beside them.
 *
 * These are the only places in the engine where an unaudited human input is
 * allowed to move a number the board prints, so they are the places where an
 * inspectable derivation matters most. All three channels obey one credibility
 * rule — `quant/earned.ts` — and each note states the same three properties in
 * its own terms: the weight is a SCORE RATIO rather than a preference, it
 * SHRINKS toward the desk's own call with κ pseudo-outcomes, and it is CAPPED.
 * Where a channel departs from that (readiness shrinks toward a prior, not
 * toward zero), the note says so and says why.
 */

import { examOffset } from "../quant/calibration";
import { ELO_BASE, ELO_K } from "../duel";
import { ELO_PER_LOGIT } from "../quant/readiness";
import {
  AI_POOL_CAP, AI_POOL_KAPPA, EXAM_OFFSET_SHRINK, POOL_CEIL,
  READINESS_DUEL_KAPPA, READINESS_KAPPA, READINESS_PRIOR,
  SELF_POOL_CAP, SELF_POOL_KAPPA,
} from "../quant/params";
import { PREMIUM_CAPS } from "../quant/mark";
import { fmt, sgn, v, type Derivation, type DeriveCtx } from "./types";

const pctW = (w: number): string => `${Math.round(w * 100)}%`;

/**
 * The shared credibility step, written once. Every channel substitutes its own
 * κ, cap and shrinkage target into the same two lines, which is the whole point
 * of there being one rule rather than three. Exported so `signals.ts`'s
 * `signal.adjust` can reuse it verbatim for the life-signals channel (§D5,
 * T19) — a fourth channel obeying the same rule is a reason to share this
 * function, not to fork it.
 */
export function creditSteps(
  fit: { w: number; n: number; youScore: number | null; modelScore: number | null; rawShare: number },
  opts: { kappa: number; cap: number; toward: number; unit: string },
) {
  const { kappa, cap, toward, unit } = opts;
  const shrunk = (fit.n * fit.rawShare + kappa * toward) / (fit.n + kappa);
  return [
    {
      tex: `\\text{share} \\;=\\; \\frac{S_{\\text{model}}}{S_{\\text{model}} + S_{\\text{you}}} \\qquad (\\text{${unit}, lower is better})`,
      subst:
        fit.n > 0 && fit.youScore != null && fit.modelScore != null
          ? `\\text{share} \\;=\\; \\frac{${v(fit.modelScore, 3)}}{${v(fit.modelScore, 3)} + ${v(fit.youScore, 3)}} \\;=\\; ${v(fit.rawShare, 3)}`
          : undefined,
      note: "A RATIO OF PROPER SCORES ON THE SAME OUTCOMES UNDER THE SAME RULE — NEVER A PREFERENCE. THE SHARE RISES EXACTLY INSOFAR AS THE MODEL HAS BEEN PERSISTENTLY OFF AND YOU HAVE NOT, WHICH MAKES \"THE MODELS ARE ALWAYS WRONG, SO LISTEN TO ME\" A MEASURED CLAIM RATHER THAN A MOOD.",
    },
    {
      tex: `w \\;=\\; \\operatorname{clip}_{[0,\\,${cap}]}\\!\\left(\\frac{n\\cdot\\text{share} + \\kappa\\,w_0}{n + \\kappa}\\right), \\qquad \\kappa = ${kappa}, \\quad w_0 = ${toward}`,
      subst: `w \\;=\\; \\operatorname{clip}\\!\\left(\\frac{${v(fit.n, 0)}\\cdot${v(fit.rawShare, 3)} + ${kappa}\\cdot${toward}}{${v(fit.n, 0)} + ${kappa}}\\right) \\;=\\; \\operatorname{clip}(${v(shrunk, 3)}) \\;=\\; ${v(fit.w, 3)}`,
      note: `THE SHARE A RECORD IMPLIES IS BARELY IDENTIFIED FROM THE HANDFUL OF OUTCOMES ANYONE EVER CALLS, SO IT IS APPROACHED SLOWLY AND NEVER QUITE REACHED. κ = ${kappa} PSEUDO-OUTCOMES SIT AGAINST YOURS FROM THE START; THE CAP AT ${cap} IS ABSOLUTE.`,
    },
  ];
}

/* ── §27 · your next-exam call ──────────────────────────────────────── */

export function earnSelf(ctx: DeriveCtx): Derivation | null {
  const fit = ctx.card?.selfFit ?? ctx.selfPool;
  if (!fit) return null;
  const on = ctx.card?.on !== false;
  return {
    id: "earn.self",
    title: "YOUR CALL · EARNED WEIGHT",
    symbol: "w_{\\text{self}}",
    claim: "THE SHARE OF THE NEXT-EXAM FORECAST YOUR OWN RECORD HAS BOUGHT. NOTHING IS ASSUMED; ALL OF IT IS MEASURED.",
    steps: [
      ...creditSteps(fit, { kappa: SELF_POOL_KAPPA, cap: SELF_POOL_CAP, toward: 0, unit: "CRPS or abs error" }),
      {
        tex: `\\mu \\;=\\; (1-w)\\,\\mu_m + w\\,\\mu_y, \\qquad \\sigma^2 \\;=\\; (1-w)\\sigma_m^2 + w\\,\\sigma_y^2 + \\underbrace{w(1-w)\\,(\\mu_y - \\mu_m)^2}_{\\text{disagreement}}`,
        note: "A MOMENT-MATCHED LINEAR OPINION POOL. THE LAST TERM IS THE ENTIRE SAFETY ARGUMENT: THE FURTHER YOUR CALL SITS FROM THE DESK'S, THE WIDER THE POOLED BAND — SO A CONTESTED FORECAST IS AN UNCERTAIN ONE RATHER THAN A CONFIDENT DISAGREEMENT.",
      },
      {
        tex: `\\text{register} \\;\\longleftarrow\\; \\hat F^{\\text{raw}}_m \\quad\\text{(never the pool)}`,
        note: "THE FORECAST REGISTER THAT SCORES THE DESK IS FED THE DESK'S UNPOOLED CALL. A FORECASTER CANNOT BE ALLOWED TO GRADE A PAPER IT HALF-WROTE, OR THE WEIGHT WOULD BOOTSTRAP ITSELF UPWARD.",
      },
    ],
    inputs: [
      { sym: "n", label: "scored sittings", value: String(fit.n) },
      { sym: "S_{\\text{you}}", label: "your mean score", value: fit.youScore == null ? "—" : fmt(fit.youScore, 3), missing: fit.youScore == null },
      { sym: "S_{\\text{model}}", label: "the desk's", value: fit.modelScore == null ? "—" : fmt(fit.modelScore, 3), missing: fit.modelScore == null },
      { sym: "\\text{share}", label: "raw share", value: fmt(fit.rawShare, 3) },
      { sym: "\\kappa", label: "pseudo-sittings", value: String(SELF_POOL_KAPPA) },
      { sym: "w_{\\max}", label: "hard cap", value: pctW(SELF_POOL_CAP) },
    ],
    result: { tex: "w_{\\text{self}}", value: on ? pctW(fit.w) : "OFF" },
    gates: [
      { text: "a sitting you and the desk both called", pass: fit.n > 0 },
      { text: "the channel is switched on", pass: on },
      { text: `capped strictly under a half (${pctW(SELF_POOL_CAP)})`, pass: fit.w <= SELF_POOL_CAP },
    ],
    refs: ["buhlmann1967", "stone1961", "genest1986"],
    related: ["elicit.mae", "elicit.crps", "oracle.next", "earn.aggregate"],
    source: "src/lib/quant/pool.ts · fitSelfWeight · poolNextExam",
  };
}

/* ── §29 · the wire's forecasts ─────────────────────────────────────── */

export function earnAi(ctx: DeriveCtx): Derivation | null {
  const fit = ctx.card?.aiFit;
  if (!fit) return null;
  const on = ctx.card?.on !== false;
  const wSelf = ctx.card?.selfFit?.w ?? 0;
  const overflow = wSelf + fit.w > POOL_CEIL;
  return {
    id: "earn.ai",
    title: "THE WIRE'S CALL · EARNED WEIGHT",
    symbol: "w_{\\text{ai}}",
    claim: "THE SHARE AN OUTSIDE AI DESK'S RECORD HAS BOUGHT — ON HARSHER TERMS THAN YOURS, AND JOINTLY CEILINGED WITH IT.",
    steps: [
      ...creditSteps(fit, { kappa: AI_POOL_KAPPA, cap: AI_POOL_CAP, toward: 0, unit: "CRPS or abs error" }),
      {
        tex: `w_{\\text{self}} + w_{\\text{ai}} \\;\\le\\; ${POOL_CEIL} \\quad\\text{else}\\quad w_i \\leftarrow w_i \\cdot \\frac{${POOL_CEIL}}{w_{\\text{self}} + w_{\\text{ai}}}`,
        subst: overflow
          ? `${v(wSelf, 3)} + ${v(fit.w, 3)} \\;>\\; ${POOL_CEIL} \\;\\Longrightarrow\\; \\text{both scaled by } ${v(POOL_CEIL / (wSelf + fit.w), 3)}`
          : `${v(wSelf, 3)} + ${v(fit.w, 3)} \\;\\le\\; ${POOL_CEIL}`,
        note: `THE PER-CHANNEL CAPS BIND ONE FORECASTER AT A TIME; THE JOINT CEILING BINDS THE PAIR. AN OVERFLOW IS SCALED PROPORTIONALLY — EACH CHANNEL KEEPS ITS STANDING RELATIVE TO THE OTHER — AND THE HOUSE MODEL ALWAYS KEEPS AT LEAST ${Math.round((1 - POOL_CEIL) * 100)}% OF EVERY CALL IT MAKES.`,
      },
      {
        tex: `\\text{register} \\;\\longleftarrow\\; \\hat F^{\\text{raw}}_m, \\qquad \\text{aiPred} \\in \\text{upcoming} \\;\\not\\to\\; \\text{replay}`,
        note: "SCORED AGAINST THE RAW BOARD, LIKE EVERY CHANNEL THAT GRADES THE ENGINE. AND BECAUSE THE WIRE'S CALLS LIVE ON THE FORWARD CALENDAR — OUTSIDE THE REGISTER'S INPUTS — FILING ONE CANNOT TOUCH THE RECORD IT IS JUDGED BY.",
      },
    ],
    inputs: [
      { sym: "n", label: "scored sittings", value: String(fit.n) },
      { sym: "S_{\\text{ai}}", label: "the wire's mean score", value: fit.youScore == null ? "—" : fmt(fit.youScore, 3), missing: fit.youScore == null },
      { sym: "S_{\\text{model}}", label: "the desk's", value: fit.modelScore == null ? "—" : fmt(fit.modelScore, 3), missing: fit.modelScore == null },
      { sym: "\\kappa", label: "pseudo-sittings", value: String(AI_POOL_KAPPA) },
      { sym: "w_{\\max}", label: "hard cap", value: pctW(AI_POOL_CAP) },
      { sym: "\\Sigma_{\\max}", label: "joint ceiling", value: pctW(POOL_CEIL) },
    ],
    result: { tex: "w_{\\text{ai}}", value: on ? pctW(fit.w) : "OFF" },
    gates: [
      { text: "a sitting the wire and the desk both called", pass: fit.n > 0 },
      { text: "the channel is switched on (opt-in, absent means off)", pass: on },
      { text: `capped below the student's own channel (${pctW(AI_POOL_CAP)} < ${pctW(SELF_POOL_CAP)})`, pass: fit.w <= AI_POOL_CAP },
    ],
    refs: ["stone1961", "genest1986", "buhlmann1967"],
    related: ["elicit.ai", "earn.self", "oracle.next"],
    source: "src/lib/quant/aipool.ts · fitAiWeight · poolNextExamJoint",
  };
}

/* ── §15c · the duel pile ───────────────────────────────────────────── */

export function earnReadiness(ctx: DeriveCtx): Derivation | null {
  const fit = ctx.card?.readyFit;
  if (!fit) return null;
  const duels = ctx.card?.elo?.duels ?? 0;
  const on = ctx.card?.on !== false;
  const cred = duels > 0 ? duels / (duels + READINESS_DUEL_KAPPA) : 0;
  return {
    id: "earn.readiness",
    title: "READINESS PILE · EARNED WEIGHT",
    symbol: "w_{\\text{ready}}",
    claim: "WHAT YOUR GUT ORDERING HAS EARNED AGAINST THE ORDER THE EXAMS ACTUALLY PRINTED.",
    steps: [
      {
        tex: `h \\;=\\; \\frac{\\#\\{\\text{pairs ordered correctly}\\}}{\\#\\{\\text{pairs the round separated}\\}}, \\qquad L \\;=\\; 1 - h`,
        subst:
          fit.hitRate != null && fit.modelHitRate != null
            ? `h_{\\text{you}} = ${v(fit.hitRate, 3)}, \\qquad h_{\\text{desk}} = ${v(fit.modelHitRate, 3)} \\quad (${v(fit.n, 0)}\\;\\text{rounds})`
            : undefined,
        note: "PAIRWISE HIT-RATE, NOT RANK CORRELATION: THE PILE MAKES PAIRWISE CLAIMS, SO IT IS GRADED ON PAIRS. A ROUND THAT PRINTED A TIE SEPARATES NOBODY AND THEREFORE GRADES NOBODY. THE PILE IS FROZEN AS OF THE ROUND'S FIRST PAPER — A DUEL ANSWERED AFTERWARDS KNOWS THE ANSWER.",
      },
      ...creditSteps(fit, { kappa: READINESS_KAPPA, cap: 1, toward: READINESS_PRIOR, unit: "loss = 1 - hit rate" }),
      {
        tex: `\\lambda_s \\;=\\; \\frac{R_s - \\bar R}{400/\\ln 10}, \\qquad \\sum_s \\lambda_s = 0`,
        note: "THE ELO RATING IS READ AS BRADLEY-TERRY LOG-STRENGTH, WHICH IS WHAT IT ESTIMATES. CENTRING FORCES Σλ = 0, SO A PILE CAN RETILT THE DESKS AGAINST EACH OTHER BUT CANNOT MARK THE WHOLE BOOK DOWN.",
      },
      {
        tex: `\\text{credibility} \\;=\\; \\frac{m}{m + ${READINESS_DUEL_KAPPA}}\\cdot w_{\\text{ready}}, \\qquad |\\text{charge}| \\le ${PREMIUM_CAPS.ready.toFixed(1)}\\;\\text{pts}`,
        subst: `= \\frac{${v(duels, 0)}}{${v(duels, 0)} + ${READINESS_DUEL_KAPPA}}\\cdot ${v(fit.w, 3)} \\;=\\; ${v(cred * fit.w, 3)}`,
        note: "TWO SEPARATE BRAKES: THE PILE'S SIZE, AND WHAT THE PILE HAS PROVEN. FIVE GUT CALLS BUY ABOUT A THIRD OF THE CHARGE EVEN FROM A PERFECT FORECASTER.",
      },
    ],
    inputs: [
      { sym: "m", label: "duels on record", value: String(duels) },
      { sym: "n", label: "scored rounds", value: String(fit.n) },
      { sym: "h_{\\text{you}}", label: "your hit rate", value: fit.hitRate == null ? "—" : pctW(fit.hitRate), missing: fit.hitRate == null },
      { sym: "h_{\\text{desk}}", label: "the desk's", value: fit.modelHitRate == null ? "—" : pctW(fit.modelHitRate), missing: fit.modelHitRate == null },
      { sym: "w_0", label: "unproven prior", value: pctW(READINESS_PRIOR) },
      { sym: "\\kappa", label: "pseudo-rounds", value: String(READINESS_KAPPA) },
    ],
    result: { tex: "w_{\\text{ready}}", value: on ? (duels ? pctW(fit.w) : "—") : "OFF" },
    gates: [
      { text: "at least one duel answered", pass: duels > 0 },
      { text: "a round of exams has scored the pile", pass: fit.n > 0 },
      { text: `beats the unproven prior of ${pctW(READINESS_PRIOR)}`, pass: fit.w > READINESS_PRIOR },
      { text: "the channel is switched on", pass: on },
    ],
    refs: ["bradley1952", "thurstone1927", "buhlmann1967"],
    related: ["duel.elo", "earn.self", "premium.ready"],
    source: "src/lib/quant/readiness.ts · readinessSkill · readinessBook",
  };
}

export function duelElo(ctx: DeriveCtx): Derivation | null {
  const elo = ctx.card?.elo;
  const id = ctx.key ?? ctx.stat?.sub.id;
  const row = elo?.rows.find((r) => r.id === id);
  if (!elo || !row) return null;
  const centre = elo.rows.reduce((a, r) => a + r.rating, 0) / Math.max(1, elo.rows.length);
  const lambda = (row.rating - centre) / ELO_PER_LOGIT;
  const p = 1 / (1 + Math.exp(-lambda));
  return {
    id: "duel.elo",
    title: `READINESS RATING · ${elo.tickerOf[row.id] ?? row.id}`,
    symbol: "R_s",
    claim: "A PILE OF FORCED CHOICES, FITTED. ORDINAL INFORMATION ONLY — IT SAYS WHICH DESK IS READIER, NEVER HOW READY.",
    steps: [
      {
        tex: `E_a \\;=\\; \\frac{1}{1 + 10^{(R_b - R_a)/400}}, \\qquad R_a \\leftarrow R_a + K\\,(S_a - E_a), \\qquad K = ${ELO_K}`,
        subst: `R = ${v(row.rating, 1)} \\quad\\text{from}\\quad ${v(row.wins, 0)}\\text{W} / ${v(row.losses, 0)}\\text{L},\\quad R_0 = ${ELO_BASE}`,
        note: `SEQUENTIAL, IN A FIXED ORDER (createdAt THEN id) SO THE FIT IS DETERMINISTIC REGARDLESS OF HOW THE PILE HAPPENS TO BE SORTED. K = ${ELO_K} IS DELIBERATELY SMALL: A SINGLE GUT CALL SHOULD NOT REORDER A BOOK.`,
      },
      {
        tex: `P(a \\succ b) \\;=\\; \\frac{e^{\\lambda_a}}{e^{\\lambda_a} + e^{\\lambda_b}}, \\qquad \\lambda_s = \\frac{R_s - \\bar R}{400/\\ln 10}`,
        subst: `\\lambda = \\frac{${v(row.rating, 1)} - ${v(centre, 1)}}{${v(ELO_PER_LOGIT, 1)}} \\;=\\; ${v(lambda, 3)} \\;\\Longrightarrow\\; P(\\text{over an average desk}) = ${v(p, 3)}`,
        note: "ELO'S 400-POINT SCALE IS 10:1 ODDS BY CONSTRUCTION, SO DIVIDING BY 400/ln 10 ≈ 173.7 GIVES AN INTERPRETABLE LOG-ODDS. THE PREMIUM CHARGES ON λ DIRECTLY RATHER THAN ON A z-SCORE OF THE SAMPLE, WHICH WOULD MAKE THREE DUELS AND THIRTY LOOK IDENTICAL.",
      },
      {
        tex: `\\text{forced choice} \\;\\Rightarrow\\; \\text{no scale to game}`,
        note: "A 1–10 READINESS SLIDER MEASURES A PERSON'S USE OF THE SCALE AS MUCH AS THEIR READINESS. A PAIRED COMPARISON HAS NO SCALE TO DRIFT, WHICH IS WHY THE ARENA ASKS THE HARDER QUESTION.",
      },
    ],
    inputs: [
      { sym: "R_0", label: "starting rating", value: String(ELO_BASE) },
      { sym: "K", label: "update step", value: String(ELO_K) },
      { sym: "\\bar R", label: "book centre", value: fmt(centre, 1) },
      { sym: "\\lambda", label: "log-strength", value: sgn(lambda, 3) },
      { sym: "m", label: "duels in the pile", value: String(elo.duels) },
    ],
    result: { tex: "R_s", value: String(Math.round(row.rating)) },
    gates: [{ text: "this desk has been duelled at least once", pass: row.wins + row.losses > 0 }],
    refs: ["elo1978", "bradley1952"],
    related: ["earn.readiness", "premium.ready"],
    source: "src/lib/duel.ts · eloRank",
  };
}

/* ── §28 · your aggregate call ──────────────────────────────────────── */

export function earnAggregate(ctx: DeriveCtx): Derivation | null {
  const fit = ctx.card?.meanFit;
  if (!fit) return null;
  const on = ctx.card?.on !== false;
  return {
    id: "earn.aggregate",
    title: "YOUR AGGREGATE CALL · EARNED WEIGHT",
    symbol: "w_{\\text{agg}}",
    claim: "ONE NUMBER ABOUT THE WHOLE TERM, PRICED AT THE LEVEL WHERE BOTH FORECASTERS ACTUALLY HAVE SKILL.",
    steps: [
      {
        tex: `S_{\\text{you}} \\;=\\; \\big|\\,\\text{predAvg} - \\bar y_r\\,\\big|, \\qquad S_{\\text{model}} \\;=\\; \\Big|\\,\\tfrac{1}{|C|}\\textstyle\\sum_{s \\in C} \\hat\\mu_{s,r} - \\bar y_r \\Big|`,
        subst:
          fit.n > 0 && fit.youScore != null && fit.modelScore != null
            ? `S_{\\text{you}} = ${v(fit.youScore, 2)}, \\qquad S_{\\text{model}} = ${v(fit.modelScore, 2)} \\quad (${v(fit.n, 0)}\\;\\text{rounds})`
            : undefined,
        note: "OVER THE VERY SAME DESKS C YOU RANKED, AND ONLY FOR A ROUND YOUR CALL PREDATES. A CALL LOGGED AFTER THE MARKS LANDED IS A MEMORY, NOT A FORECAST, AND EARNS NOTHING.",
      },
      ...creditSteps(fit, { kappa: SELF_POOL_KAPPA, cap: SELF_POOL_CAP, toward: 0, unit: "abs error, pts" }),
      {
        tex: `\\mu \\;=\\; (1-w)\\,\\mu_m + w\\,\\mu_y, \\qquad \\sigma^2 \\;=\\; (1-w)\\sigma_m^2 + w\\,\\sigma_y^2 + w(1-w)(\\mu_y - \\mu_m)^2`,
        note: "THE SAME MOMENT-MATCHED MIXTURE AS §27, APPLIED TO THE BOOK-LEVEL FORECAST AND NEVER TO A SINGLE DESK'S MARK. ALLOCATING AN AGGREGATE CALL BACK ACROSS THE DESKS WOULD INVENT PER-DESK OPINIONS YOU NEVER STATED.",
      },
      {
        tex: `\\rho \\;\\text{is reported, and weighs } 0`,
        subst: fit.rankCorr == null ? undefined : `\\bar\\rho \\;=\\; ${v(fit.rankCorr, 2)}`,
        note: "LEVEL AND ORDERING ARE SEPARATE CLAIMS. THE FORCED RANKING IS SCORED AND SHOWN, BUT THE ORDERING CHANNEL IS THE DUEL PILE — LETTING THE RANKING ALSO TILT THE MARKS WOULD CHARGE THE SAME OPINION TWICE.",
      },
    ],
    inputs: [
      { sym: "n", label: "scored rounds", value: String(fit.n) },
      { sym: "S_{\\text{you}}", label: "your mean |err|", value: fit.youScore == null ? "—" : fmt(fit.youScore, 2), missing: fit.youScore == null },
      { sym: "S_{\\text{model}}", label: "the desk's", value: fit.modelScore == null ? "—" : fmt(fit.modelScore, 2), missing: fit.modelScore == null },
      { sym: "\\bar\\rho", label: "mean rank corr", value: fit.rankCorr == null ? "—" : fmt(fit.rankCorr, 2), missing: fit.rankCorr == null },
      { sym: "\\sigma_y", label: "your realized rms", value: fit.selfSd == null ? "—" : fmt(fit.selfSd, 2), missing: fit.selfSd == null },
      { sym: "w_{\\max}", label: "hard cap", value: pctW(SELF_POOL_CAP) },
    ],
    result: { tex: "w_{\\text{agg}}", value: on ? pctW(fit.w) : "OFF" },
    gates: [
      { text: "a round you called before its first paper", pass: fit.n > 0 },
      { text: "the channel is switched on", pass: on },
    ],
    refs: ["stone1961", "genest1986"],
    related: ["call.score", "earn.self", "book.forecast", "skill.mae"],
    source: "src/lib/quant/meanpool.ts · meanCallSkill · poolAggregate",
  };
}

export function callScore(ctx: DeriveCtx): Derivation | null {
  const call = ctx.card?.call;
  const error = call?.score.error;
  const realizedAvg = call?.score.realizedAvg;
  if (!call || error == null || realizedAvg == null) return null;
  const s = call.score;
  const n = call.ranking.length;
  return {
    id: "call.score",
    title: "AGGREGATE CALL · SCORED",
    symbol: "e",
    claim: "WHAT THIS PARTICULAR CALL WAS WORTH ONCE THE ROUND PRINTED — LEVEL AND ORDER, SCORED SEPARATELY.",
    steps: [
      {
        tex: `\\bar y \\;=\\; \\frac{1}{|C|}\\sum_{s \\in C} y_s, \\qquad e \\;=\\; \\text{predAvg} - \\bar y`,
        subst: `e \\;=\\; ${v(call.predAvg, 1)} - ${v(realizedAvg, 1)} \\;=\\; ${v(sgn(error, 1), 0)}`,
        note: "AVERAGED OVER THE DESKS YOU RANKED THAT ACTUALLY PRINTED, SO A HALF-LANDED ROUND SCORES ON WHAT IT CAN RATHER THAN WAITING OR GUESSING. A POSITIVE ERROR IS OPTIMISM.",
      },
      {
        tex: `\\rho \\;=\\; 1 - \\frac{6\\sum_i d_i^2}{n(n^2-1)}, \\qquad d_i = \\text{rank}^{\\text{you}}_i - \\text{rank}^{\\text{realized}}_i`,
        subst:
          s.rankCorr == null
            ? undefined
            : `\\rho \\;=\\; ${v(s.rankCorr, 2)} \\quad\\text{over}\\quad n = ${v(n, 0)}\\;\\text{ranked desks}`,
        note: "SPEARMAN'S ρ ON THE SHARED DESKS, RE-RANKED WITHIN THE SHARED SET SO AN UNRANKED DESK CANNOT INFLATE d². +1 IS THE EXACT ORDER, −1 THE EXACT REVERSE, 0 NO ASSOCIATION.",
      },
      {
        tex: `\\text{Var}(\\rho) \\approx \\frac{1}{n-1} \\;\\Longrightarrow\\; \\text{s.e.} \\approx ${n > 1 ? (1 / Math.sqrt(n - 1)).toFixed(2) : "\\infty"}`,
        note: "WITH A HANDFUL OF DESKS A SINGLE SWAPPED PAIR MOVES ρ A LONG WAY. READ IT AS DIRECTIONAL EVIDENCE ACCUMULATED OVER ROUNDS, NOT AS A VERDICT ON ONE TERM.",
      },
    ],
    inputs: [
      { sym: "\\text{predAvg}", label: "your call", value: fmt(call.predAvg, 1) },
      { sym: "\\bar y", label: "realized average", value: fmt(realizedAvg, 1) },
      { sym: "|C|", label: "desks scored", value: String(n) },
      { sym: "\\rho", label: "rank correlation", value: s.rankCorr == null ? "—" : fmt(s.rankCorr, 2), missing: s.rankCorr == null },
    ],
    result: { tex: "e", value: sgn(error, 1), unit: "PTS" },
    gates: [{ text: "≥ 2 ranked desks for a rank correlation", pass: s.rankCorr != null }],
    refs: ["spearman1904", "hyndman2006"],
    related: ["earn.aggregate", "book.forecast"],
    source: "src/lib/meancall.ts · scoreMeanCall · spearman",
  };
}

/* ── The two planning instruments ───────────────────────────────────── */

export function gapExam(ctx: DeriveCtx): Derivation | null {
  const s = ctx.stat;
  if (!s) return null;
  const off = examOffset(s.entries);
  if (off.raw == null) return null;
  return {
    id: "gap.exam",
    title: "COURSEWORK → EXAM GAP",
    symbol: "\\delta",
    claim: "WHAT THIS DESK'S EXAMS PAY RELATIVE TO ITS COURSEWORK. A PROCESS PROBLEM, NOT A KNOWLEDGE ONE.",
    steps: [
      {
        tex: `\\delta_{\\text{raw}} \\;=\\; \\operatorname{wmean}_{0.1}\\big(\\{y_i : \\text{exam}\\}\\big) \\;-\\; \\operatorname{wmean}_{0.1}\\big(\\{y_i : \\text{coursework}\\}\\big)`,
        subst: `\\delta_{\\text{raw}} \\;=\\; ${v(sgn(off.raw, 2), 0)}\\;\\text{pts} \\quad (${v(off.nExams, 0)}\\;\\text{exams},\\; ${v(off.nCoursework, 0)}\\;\\text{coursework})`,
        note: "WINSORIZED AT 10% ON EACH SIDE, NOT A PLAIN MEAN: ONE CATASTROPHIC PAPER SHOULD MOVE THIS ESTIMATE, BUT NOT OWN IT. THE WINSORIZED MEAN KEEPS THE OUTLIER'S DIRECTION WHILE CAPPING ITS LEVERAGE, WHICH A TRIMMED MEAN WOULD DISCARD ENTIRELY.",
      },
      {
        tex: `\\hat\\delta \\;=\\; \\frac{n_E\\,\\delta_{\\text{raw}} + \\lambda\\cdot 0}{n_E + \\lambda}, \\qquad \\lambda = ${EXAM_OFFSET_SHRINK}`,
        subst: `\\hat\\delta \\;=\\; \\frac{${v(off.nExams, 0)}\\cdot${v(off.raw, 2)}}{${v(off.nExams, 0)} + ${EXAM_OFFSET_SHRINK}} \\;=\\; ${v(sgn(off.delta, 2), 0)}\\;\\text{pts}`,
        note: "THE CARD SHOWS THE RAW GAP BECAUSE THAT IS THE OBSERVATION; THE FORECASTS USE THE SHRUNK ONE BECAUSE THREE EXAMS ARE NOT ENOUGH TO ASSERT A STRUCTURAL OFFSET. SHRINKING TOWARD ZERO ENCODES THE NULL THAT THE TWO ASSESSMENT MODES MEASURE THE SAME ABILITY.",
      },
      {
        tex: `\\widehat{\\text{exam}}_{n+1} \\;=\\; w_E\\,\\hat\\mu_E + (1 - w_E)\\big(\\hat\\mu_C + \\hat\\delta\\big)`,
        note: "THIS IS WHERE THE GAP IS ACTUALLY SPENT: IT CROSSES COURSEWORK EVIDENCE INTO EXAM TERMS SO THE ORACLE CAN USE A DESK'S WHOLE TAPE RATHER THAN ONLY ITS TWO OR THREE EXAMS. A NEGATIVE δ IS THE MOST ACTIONABLE NUMBER ON THIS BOARD — IT IS EXAM TECHNIQUE, AND IT IS TRAINABLE.",
      },
    ],
    inputs: [
      { sym: "n_E", label: "exams", value: String(off.nExams) },
      { sym: "n_C", label: "coursework", value: String(off.nCoursework) },
      { sym: "\\hat\\delta", label: "shrunk offset", value: sgn(off.delta, 2) },
      { sym: "\\lambda", label: "shrink weight", value: String(EXAM_OFFSET_SHRINK) },
    ],
    result: { tex: "\\delta", value: sgn(off.raw, 1), unit: "PTS" },
    gates: [
      { text: "at least one exam and one coursework print", pass: off.nExams > 0 && off.nCoursework > 0 },
      { text: "≥ 3 exams before the raw gap is worth reading", pass: off.nExams >= 3 },
    ],
    refs: ["dixon1960", "jamesstein1961"],
    related: ["oracle.next", "fv.value"],
    source: "src/lib/quant/calibration.ts · examOffset",
  };
}

export function effortPlan(ctx: DeriveCtx): Derivation | null {
  const e = ctx.card?.effort;
  const id = ctx.key ?? ctx.stat?.sub.id;
  if (!e || !id || e.model[id] == null) return null;
  const w = e.priority[id] ?? 0;
  const tokens = e.model[id];
  const hours = (tokens / e.total) * e.hoursPerWeek;
  // The solve as `suggestAllocation` actually ran it. Reading the active set
  // back off the rounded split would misjudge a desk that cleared λ and then
  // rounded to zero, and the substituted λ would not reproduce the line above.
  const active = e.fill?.active.length ?? 0;
  const lambda = e.fill?.lambda ?? 0;
  const flat = e.fill?.flat ?? false;
  return {
    id: "effort.plan",
    title: `MODEL ALLOCATION · ${e.tickerOf[id] ?? id}`,
    symbol: "x_s^{\\ast}",
    claim: "HOW A FIXED WEEK SPLITS ACROSS DESKS UNDER DIMINISHING RETURNS. A PLANNING AID, NEVER A CAUSAL CLAIM.",
    steps: [
      {
        tex: `\\max_{x \\ge 0} \\;\\sum_s w_s \\ln(1 + x_s) \\quad\\text{s.t.}\\quad \\sum_s x_s = X`,
        note: "CONCAVE RESPONSE, BY ASSUMPTION AND NOT BY MEASUREMENT: THE SECOND HOUR ON A DESK IS WORTH LESS THAN THE FIRST. A SINGLE STUDENT'S BOOK CANNOT IDENTIFY THE EFFORT→GRADE RESPONSE, SO THE APP NEVER FITS ONE — IT ONLY ENCODES THE SHAPE EVERYONE AGREES ON.",
      },
      {
        tex: `x_s^{\\ast} \\;=\\; \\max\\!\\left(0,\\; \\frac{w_s}{\\lambda} - 1\\right), \\qquad \\lambda \\;\\text{s.t.}\\; \\sum_s x_s^{\\ast} = X`,
        subst: flat
          ? `\\text{all } w_s = 0 \\;\\Longrightarrow\\; x^{\\ast} = \\frac{X}{|S|} = ${v(tokens, 0)}\\;\\text{tokens} \\;=\\; ${v(hours, 1)}\\;\\text{h/wk}`
          : `x^{\\ast} \\;=\\; \\max\\!\\left(0, \\frac{${v(w, 1)}}{${v(lambda, 3)}} - 1\\right) \\;\\longrightarrow\\; ${v(tokens, 0)}\\;\\text{tokens} \\;=\\; ${v(hours, 1)}\\;\\text{h/wk}`,
        note: flat
          ? "EVERY DESK READS ZERO URGENCY, SO THE CONCAVE OBJECTIVE IS INDIFFERENT BETWEEN EVERY SPLIT AND THE BUDGET IS SHARED EVENLY. THAT IS THE HONEST ANSWER TO A BOOK WITH NOTHING PRESSING ON IT, NOT A FAILURE TO SOLVE."
          : "THE KKT STATIONARITY CONDITION OF THE PROBLEM ABOVE — CLASSIC WATER-FILLING. λ IS THE WATER LEVEL: DESKS WITH PRESSURE BELOW IT GET NOTHING, AND THE ACTIVE SET IS SHRUNK UNTIL EVERY KEPT DESK CLEARS IT. NOBODY IS EVER HANDED THE WHOLE BUDGET.",
      },
      {
        tex: `w_s \\;=\\; \\mathcal{U}_s \\quad (\\text{advisor urgency}), \\qquad X = ${e.total}\\;\\text{tokens} \\equiv ${fmt(e.hoursPerWeek, 1)}\\;\\text{h}`,
        subst: `\\mathcal{U}_{\\text{${e.tickerOf[id] ?? id}}} = ${v(w, 0)} \\;/\\; 100`,
        note: "THE PRESSURE IS THE ADVISOR'S URGENCY SCORE, WHICH IS ITSELF FOUR CLIPPED STRESS FACTORS. TOKENS ARE THE STORED UNIT — 100 TOKENS IS THE WEEK — AND HOURS ARE ONLY EVER A READING OF THEM.",
      },
    ],
    inputs: [
      { sym: "w_s", label: "advisor urgency", value: fmt(w, 0) },
      { sym: "\\lambda", label: "water level", value: flat ? "—" : fmt(lambda, 3), missing: flat },
      { sym: "X", label: "budget", value: `${e.total} tok` },
      { sym: "H", label: "week", value: `${fmt(e.hoursPerWeek, 1)} h` },
      { sym: "|A|", label: "funded desks", value: String(active) },
    ],
    result: { tex: "x_s^{\\ast}", value: hours.toFixed(1), unit: "H/WK" },
    gates: [{ text: "this desk clears the water level", pass: flat || (e.fill?.active.includes(id) ?? tokens > 0) }],
    refs: ["boyd2004"],
    related: ["advisor.priority", "effort.drift", "premium.effort"],
    source: "src/lib/allocate.ts · suggestAllocation",
  };
}

export function effortDrift(ctx: DeriveCtx): Derivation | null {
  const e = ctx.card?.effort;
  if (!e || !e.gap) return null;
  const toHours = (t: number) => (t / e.total) * e.hoursPerWeek;
  const drift = toHours(e.gap.totalAbs);
  const worst = Object.entries(e.gap.byId).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return {
    id: "effort.drift",
    title: "PLAN VS PRACTICE · DRIFT",
    symbol: "\\mathcal{D}",
    claim: "THE ONLY QUANTITY THIS CARD CAN HONESTLY MEASURE ABOUT YOU: THE DISTANCE BETWEEN WHAT YOU MEANT TO DO AND WHAT YOU DID.",
    steps: [
      {
        tex: `\\mathcal{D} \\;=\\; \\sum_s \\big| p_s - a_s \\big| \\;=\\; \\big\\| p - a \\big\\|_1`,
        subst: `\\mathcal{D} \\;=\\; ${v(e.gap.totalAbs, 0)}\\;\\text{tokens} \\;=\\; ${v(drift, 1)}\\;\\text{h/wk}`,
        note: "AN L1 DISTANCE BETWEEN TWO SPLITS OF THE SAME FIXED BUDGET. BECAUSE BOTH SUM TO X, EVERY HOUR OVERSPENT SOMEWHERE IS AN HOUR UNDERSPENT ELSEWHERE — SO Σ|·| DOUBLE-COUNTS EACH REALLOCATION, AND THE FIGURE IS BEST READ AS 'HOURS THAT ENDED UP SOMEWHERE ELSE'.",
      },
      {
        tex: `\\max_s |p_s - a_s|`,
        subst: worst
          ? `\\text{${e.tickerOf[worst[0]] ?? worst[0]}}: ${v(sgn(toHours(worst[1]), 1), 0)}\\;\\text{h}`
          : undefined,
        note: "THE SINGLE DESK CARRYING MOST OF THE DRIFT. A POSITIVE FIGURE IS A DESK YOU PLANNED AND DID NOT SIT DOWN TO; A NEGATIVE ONE IS A DESK THAT QUIETLY ATE THE WEEK.",
      },
      {
        tex: `\\mathcal{D} \\;\\text{is tracked, and prices nothing}`,
        note: `IT IS A PERSON-STABLE CALIBRATION CONSTANT — HOW MUCH OF ANY PLAN YOU KEEP — AND THAT IS ALL IT IS CLAIMED TO BE. WHAT REACHES THE MARK IS THE ALLOCATION ITSELF, AS A RESOURCING PREMIUM CAPPED AT ${PREMIUM_CAPS.effort.toFixed(1)} PTS ON THE ACTUAL RING AND ${PREMIUM_CAPS.plan.toFixed(1)} ON THE PLAN, AND NEVER AS A CLAIM THAT AN HOUR BUYS A POINT.`,
      },
    ],
    inputs: [
      { sym: "X", label: "budget", value: `${e.total} tok` },
      { sym: "H", label: "week", value: `${fmt(e.hoursPerWeek, 1)} h` },
      { sym: "|S|", label: "desks", value: String(Object.keys(e.plan).length) },
      { sym: "\\mathcal{D}_{\\text{tok}}", label: "drift in tokens", value: fmt(e.gap.totalAbs, 0) },
    ],
    result: { tex: "\\mathcal{D}", value: drift.toFixed(1), unit: "H" },
    gates: [{ text: "actual hours recorded, not just planned", pass: e.actual != null }],
    related: ["effort.plan", "premium.effort"],
    source: "src/lib/allocate.ts · allocationGap",
  };
}
