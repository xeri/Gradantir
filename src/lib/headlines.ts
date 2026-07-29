import { MONTHS } from "../constants";
import { subjectForecast } from "./regression";
import { avg, pDate, round1, todayStr } from "./utils";
import { computeFactors, decayFactor, VOL_FLOOR, type DeskFactors } from "./quant/factors";
import { median } from "./quant/robust";
import { RATINGS, ratingMove } from "./quant/ratings";
import type { CompositeIndex, Rating, Signal, SubjectStat } from "../types";

export type WireTone = "gain" | "loss" | "warn" | "info" | "accent";

/** Icon is a name (mapped to a lucide component by the view) to keep this lib React-free. */
export interface WireItem {
  id: string;
  /** ISO date the item refers to, or "" for standing desk notes. */
  date: string;
  /** Short source tag, e.g. ticker or "DESK". */
  tag: string;
  text: string;
  tone: WireTone;
  icon: string;
  /** Effective severity after market-time decay, 0–100 — the sort key. */
  severity?: number;
}

interface Candidate extends WireItem {
  severity: number;
  /** Prints on the desk that superseded this dated story. */
  printsSince?: number;
  /** Desk the note is about — the standing-note budget key. */
  about?: string;
}

const NUM_WORDS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE"];
const word = (v: number) => NUM_WORDS[v] ?? String(v);
const monthOf = (dateIso: string) => MONTHS[pDate(dateIso).getMonth()].toUpperCase();
const sevCap = (v: number, hi: number) => Math.max(0, Math.min(hi, v));

/** A crisis desk gets at most this many standing notes — the tape stays a book. */
const STANDING_BUDGET = 3;
/** Decayed below this an item is dead air, not news. */
const NOISE_FLOOR = 2;

/**
 * The news wire, rebuilt as a severity-ranked candidate market: every
 * generator prices its own story 0–100, dated stories decay in market time
 * (prints superseded, not days elapsed), and the harshest stories lead.
 * Copy rules: accusations ride τ-gated trends, sigma-floored shocks, or
 * explicit z-scores — the wire is brutal because the math clears it, never
 * because a template felt like it. Praise exists, is rare, and is earned.
 */
export function buildWire(
  stats: SubjectStat[],
  comp: Pick<CompositeIndex, "value" | "delta"> | null,
  cap = 14,
  signals?: Signal[] | null,
  todayIso: string = todayStr(),
): WireItem[] {
  const { book, desks } = computeFactors(stats, todayIso);
  const byId = new Map(desks.map((d) => [d.id, d]));
  const cands: Candidate[] = [];

  for (const s of stats) {
    const f = byId.get(s.sub.id);
    if (!f || !s.entries.length) continue;
    const es = s.entries;
    const T = s.sub.ticker;
    const latestDate = es[es.length - 1].date;
    const cw = f.coursework;

    // ── Earnings shock: the latest exam vs its own trailing tape, in sigma.
    let shockEntryId: string | null = null;
    if (f.shockZ != null && f.shock != null && f.examTrail != null && f.shockZ <= -1.5) {
      let lastExam = null, lastExamIdx = -1;
      for (let i = es.length - 1; i >= 0; i--) if (es[i].type === "Exam") { lastExam = es[i]; lastExamIdx = i; break; }
      if (lastExam) {
        shockEntryId = lastExam.id;
        const z = Math.abs(f.shockZ), drop = Math.abs(f.shock);
        const text =
          f.shockZ <= -4
            ? `${lastExam.score.toFixed(1)} — DOWN ${drop.toFixed(1)} ON TRAIL ${f.examTrail.toFixed(1)}, A ${z.toFixed(1)}-SIGMA EVENT. THIS IS NOT A DIP, IT IS STRUCTURAL FAILURE`
            : f.shockZ <= -2.5
              ? `${lastExam.score.toFixed(1)} CRATERS ${drop.toFixed(1)} UNDER TRAIL ${f.examTrail.toFixed(1)} — ${z.toFixed(1)} SIGMA. THE BASE IS GONE`
              : `${lastExam.score.toFixed(1)} — MISSES TRAIL ${f.examTrail.toFixed(1)} (${f.shock.toFixed(1)})${f.downStreak >= 2 ? `. ${word(f.downStreak)} STRAIGHT LOWER PRINTS — THE FLOOR KEEPS MOVING` : ". THE TAPE NOTICED"}`;
        cands.push({
          id: "shock-" + lastExam.id, date: lastExam.date, tag: T, text,
          tone: "loss", icon: f.shockZ <= -4 ? "siren" : "trending-down",
          severity: sevCap(55 + 12 * (z - 1.5), 96), printsSince: es.length - 1 - lastExamIdx,
        });
      }
    }

    // ── Per-print earnings events vs the estimate that stood before them.
    for (let i = Math.max(0, es.length - 5); i < es.length; i++) {
      const e = es[i];
      if (e.id === shockEntryId) continue; // the shock item owns that print
      const prior = es.slice(0, i);
      const printsSince = es.length - 1 - i;
      const isAth = prior.length >= 3 && e.score > Math.max(...prior.map((p) => p.score));
      // On a mixed tape the linreg estimate is polluted by coursework prints,
      // so exams are judged only by the sigma-floored shock — never here.
      if (!isAth && e.type === "Exam" && cw.nCoursework > 0) continue;
      const est = subjectForecast(prior);
      if (isAth) {
        const beat = est ? ` — BEATS EST ${est.pred.toFixed(1)}` : "";
        cands.push({
          id: "ath-" + e.id, date: e.date, tag: T,
          text: `PRINTS ALL-TIME HIGH ${e.score.toFixed(1)}${beat}. THE CEILING WAS A STORY YOU TOLD YOURSELF`,
          tone: "gain", icon: "zap", severity: 42, printsSince,
        });
        continue;
      }
      if (!est) continue;
      const diff = round1(e.score - est.pred);
      if (diff > 0.5) {
        cands.push({
          id: "beat-" + e.id, date: e.date, tag: T,
          text: `${e.score.toFixed(1)} — BEATS EST ${est.pred.toFixed(1)} (+${diff.toFixed(1)})`,
          tone: "gain", icon: "trending-up",
          severity: sevCap(20 + 3 * Math.min(diff, 6), 42), printsSince,
        });
      } else if (diff < -0.5) {
        const deficit = -diff;
        cands.push({
          id: "miss-" + e.id, date: e.date, tag: T,
          text: `${e.score.toFixed(1)} — MISSES EST ${est.pred.toFixed(1)} (${diff.toFixed(1)})${deficit >= 8 ? ". THAT IS NOT VARIANCE, THAT IS A HOLE IN THE BOOK" : ""}`,
          tone: "loss", icon: "trending-down",
          severity: sevCap(34 + 5 * Math.min(deficit, 8), 74), printsSince,
        });
      } else {
        cands.push({
          id: "line-" + e.id, date: e.date, tag: T,
          text: `${e.score.toFixed(1)} — IN LINE WITH EST ${est.pred.toFixed(1)}`,
          tone: "info", icon: "minus", severity: 8, printsSince,
        });
      }
    }

    // ── Miss streak: the estimate keeps being wrong in the same direction.
    if (f.missStreak >= 2) {
      const text =
        f.missStreak === 2
          ? "MISSES ESTIMATES TWICE RUNNING — GUIDANCE CREDIBILITY IN QUESTION"
          : f.missStreak === 3
            ? "THIRD CONSECUTIVE MISS — THE MODEL NO LONGER BELIEVES YOUR FORECAST. WHY DO YOU?"
            : `${word(f.missStreak)}-PRINT MISS STREAK — PRICED FOR FAILURE UNTIL A BEAT PRINTS`;
      cands.push({
        id: "streak-" + s.sub.id, date: latestDate, tag: T, text,
        tone: "loss", icon: "flame",
        severity: sevCap(40 + 14 * (f.missStreak - 1) + 2 * f.avgMissDeficit, 96), printsSince: 0,
      });
    }

    // ── Lagging / bleed: only ever alleged on a τ-gated significant trend.
    if (f.slope30 <= -0.5) {
      const x = (-f.slope30).toFixed(1);
      const text =
        f.slope30 <= -3
          ? `SELL-SIDE ALERT — DUMPING ${x} PTS/30D. THIS IS NOT A DIP, IT IS A DELISTING PATH`
          : f.slope30 <= -1.5
            ? `CONFIRMED DOWNTREND — BLEEDING ${x} PTS/30D. EVERY SESSION UNSTUDIED, THE POSITION DEGRADES`
            : `BLEEDING ${x} PTS/30D — THE TREND CLEARS ITS SIGNIFICANCE GATE. THIS IS DIRECTION, NOT NOISE`;
      cands.push({
        id: "bleed-" + s.sub.id, date: "", tag: T, text, tone: "loss", icon: "alert-triangle",
        severity: sevCap(45 + 6 * -f.slope30 + 4 * Math.max(0, -(f.relSlope30 ?? 0)) + 1.5 * Math.min(f.drawdown, 10), 92),
        about: T,
      });
    } else if (f.relSlope30 != null && f.relSlope30 <= -1.5 && (book.medianSlope30 ?? 0) > 0) {
      cands.push({
        id: "lag-" + s.sub.id, date: "", tag: T,
        text: `BOOK GRINDS HIGHER, THIS DESK DOESN'T — LAGGING THE TAPE ${(-f.relSlope30).toFixed(1)} PTS/30D. UNDERPERFORMANCE IS A CHOICE`,
        tone: "warn", icon: "alert-triangle",
        severity: sevCap(45 + 4 * -f.relSlope30, 80), about: T,
      });
    }

    // ── Self-volatility vs the book norm (print-to-print, exam-aware).
    if (f.volRatio != null && f.volRatio >= 1.5) {
      const r = f.volRatio.toFixed(1);
      cands.push({
        id: "vol-" + s.sub.id, date: "", tag: "RISK",
        text:
          f.volRatio >= 2
            ? `${T} AT ${r}× BOOK VOL — THIS IS GAMBLING, NOT INVESTING. NO DESK PAYS OUT ON COIN FLIPS`
            : `${T} SWINGS ±${f.vol.toFixed(1)} PTS PRINT-TO-PRINT — ${r}× BOOK NORM. RETURNS THIS ERRATIC ARE VARIANCE, NOT SKILL`,
        tone: "warn", icon: "gauge",
        severity: sevCap(30 + 18 * (f.volRatio - 1) + 10 * Math.max(0, (f.volExpansion ?? 1) - 1), 88),
        about: T,
      });
    } else if (f.volExpansion != null && f.volExpansion >= 1.8) {
      cands.push({
        id: "vol-" + s.sub.id, date: "", tag: "RISK",
        text: `VOL REGIME SHIFT ON ${T} — RECENT PRINTS SWING ${f.volExpansion.toFixed(1)}× OWN HISTORY. SOMETHING CHANGED. FIND IT`,
        tone: "warn", icon: "gauge",
        severity: sevCap(30 + 10 * (f.volExpansion - 1), 88), about: T,
      });
    } else if (f.volRatio == null && s.sd >= 7) {
      cands.push({
        id: "vol-" + s.sub.id, date: "", tag: "RISK",
        text: `${T} VOLATILITY ELEVATED — SWINGS ±${s.sd.toFixed(1)} PTS BETWEEN ASSESSMENTS. STABILITY IS A SKILL. ACQUIRE IT`,
        tone: "warn", icon: "activity", severity: 30, about: T,
      });
    }

    // ── Downside asymmetry: the drops outweigh the pops.
    if (f.semiDev >= 4 && f.semiDev / Math.max(f.vol, VOL_FLOOR) >= 0.85) {
      cands.push({
        id: "semi-" + s.sub.id, date: "", tag: T,
        text: `DOWNSIDE SEMIDEV ${f.semiDev.toFixed(1)} PTS — THE DROPS OUTWEIGH THE POPS. ASYMMETRY IS THE TELL`,
        tone: "warn", icon: "activity",
        severity: sevCap(28 + 5 * (f.semiDev - 4), 72), about: T,
      });
    }

    // ── Coursework: never pays the grade, always prices the exam.
    if (cw.surpriseZ != null && cw.nCoursework >= 3 && cw.surpriseZ <= -0.8) {
      cands.push({
        id: "lead-" + s.sub.id, date: "", tag: T,
        text:
          cw.surpriseZ <= -1.5
            ? `LEADING INDICATOR FLASHING RED — COURSEWORK TAPE IMPLIES A ${Math.abs(cw.surprise!).toFixed(0)}-PT EXAM MISS. THE EXAM IS WHERE THE MONEY IS, AND THE MONEY IS LEAVING`
            : `COURSEWORK DOESN'T PAY OUT — BUT IT PRICES THE EXAM. THE TAPE IMPLIES ${cw.impliedExam!.toFixed(1)} AGAINST A ${cw.examAnchor!.toFixed(1)} ANCHOR`,
        tone: "loss", icon: "banknote",
        severity: sevCap(50 + 10 * -cw.surpriseZ, 94), about: T,
      });
    } else if (
      cw.surpriseZ != null && cw.surpriseZ >= 1.5 && cw.nExams >= 2 &&
      (f.shock == null || f.shock <= 0)
    ) {
      const pair = f.worstPair && f.worstPair.gap > 0 ? f.worstPair : null;
      cands.push({
        id: "exec-" + s.sub.id, date: "", tag: T,
        text: pair
          ? `CAPABILITY PRINTED ${pair.coursework.toFixed(1)}, PAYOUT PRINTED ${pair.exam.toFixed(1)} — A ${pair.gap.toFixed(0)}-PT EXECUTION GAP. KNOWS THE MATERIAL, DOESN'T GET PAID. CONVERSION IS THE WHOLE JOB`
          : `COURSEWORK IMPLIES ${cw.impliedExam!.toFixed(1)}, EXAMS CLEAR AT ${cw.examAnchor!.toFixed(1)} — KNOWS THE MATERIAL, DOESN'T GET PAID. CONVERSION IS THE WHOLE JOB`,
        tone: "loss", icon: "scale",
        severity: sevCap(40 + 8 * cw.surpriseZ, 85), about: T,
      });
    } else if (cw.surpriseZ != null && cw.surpriseZ >= 0.8) {
      cands.push({
        id: "hot-" + s.sub.id, date: "", tag: T,
        text: `COURSEWORK RUNNING HOT — IMPLIED NEXT EXAM ${cw.impliedExam!.toFixed(1)} OVER A ${cw.examAnchor!.toFixed(1)} ANCHOR. CONVERT IT AT THE WINDOW OR IT'S PAPER PROFIT`,
        tone: "accent", icon: "trending-up", severity: 24, about: T,
      });
    }
    if (cw.cwSlope30 != null && cw.cwSlope30 <= -1.5) {
      cands.push({
        id: "cwroll-" + s.sub.id, date: "", tag: T,
        text: `COURSEWORK ROLLING OVER AT ${(-cw.cwSlope30).toFixed(1)} PTS/30D — EXAMS FOLLOW COURSEWORK. THEY ALWAYS DO`,
        tone: "warn", icon: "banknote",
        severity: sevCap(45 + 6 * -cw.cwSlope30, 88), about: T,
      });
    }
    if (cw.nExams === 0 && cw.nCoursework >= 3 && cw.cwMean != null) {
      cands.push({
        id: "unver-" + s.sub.id, date: "", tag: T,
        text: `UNVERIFIED AT SETTLEMENT — ALL SIGNAL, NO PAYOUT. COURSEWORK PRICES ${cw.cwMean.toFixed(1)} AND NOTHING HAS CLEARED AT AN EXAM YET`,
        tone: "warn", icon: "hourglass", severity: 28, about: T,
      });
    }
    // Stale coursework: judged against the desk's OWN cadence, and only when
    // it is dark relative to the book — six identical nags are one macro story.
    if (
      cw.cwStaleDays != null && cw.cwGapMedian != null && book.medianCwStaleDays != null &&
      cw.cwStaleDays > Math.max(28, 1.5 * cw.cwGapMedian) &&
      cw.cwStaleDays - book.medianCwStaleDays >= 45
    ) {
      const over = Math.round(cw.cwStaleDays - Math.max(28, 1.5 * cw.cwGapMedian));
      cands.push({
        id: "cwdark-" + s.sub.id, date: "", tag: T,
        text: `NO COURSEWORK IN ${cw.cwStaleDays}D, ${over}D PAST ITS OWN CADENCE — FLYING BLIND INTO THE PAYOUT WINDOW`,
        tone: "warn", icon: "eye-off",
        severity: sevCap(20 + 0.8 * over, 70), about: T,
      });
    } else if (cw.nCoursework === 0 && cw.nExams >= 2) {
      cands.push({
        id: "nocov-" + s.sub.id, date: "", tag: T,
        text: "NO LEADING INDICATOR COVERAGE — EXAM-ONLY TAPE. EVERY PRINT IS AN AMBUSH",
        tone: "warn", icon: "eye-off", severity: 30, about: T,
      });
    }

    // ── Drawdown: the high proved the capability.
    if (f.drawdown >= 8) {
      cands.push({
        id: "dd-" + s.sub.id, date: "", tag: T,
        text: `${f.drawdown.toFixed(1)} PTS OFF ITS HIGH — THE HIGH PROVED THE CAPABILITY. THE TAPE SHOWS THE EFFORT`,
        tone: "loss", icon: "trending-down",
        severity: sevCap(22 + 1.8 * (f.drawdown - 8), 72), about: T,
      });
    }

    // ── Year over year: the same session, one year of work later.
    if (f.yoyDelta != null && f.yoyDelta <= -10) {
      cands.push({
        id: "yoy-" + s.sub.id, date: "", tag: T,
        text: `DOWN ${Math.abs(f.yoyDelta).toFixed(1)} ON THE SAME SESSION LAST YEAR — A FULL YEAR OF WORK, NEGATIVE RETURN`,
        tone: "loss", icon: "hourglass",
        severity: sevCap(25 + 1.8 * -f.yoyDelta, 80), about: T,
      });
    } else if (f.yoyDelta != null && f.yoyDelta >= 10) {
      cands.push({
        id: "yoy-" + s.sub.id, date: "", tag: T,
        text: `UP ${f.yoyDelta.toFixed(1)} ON THE SAME SESSION LAST YEAR — THE COMPOUNDING IS REAL`,
        tone: "gain", icon: "trending-up", severity: 20, about: T,
      });
    }

    // ── Alpha: the field is the benchmark that never sleeps.
    const refLbl = s.alphaRef === "class" ? "CLASS" : "YEAR";
    if (f.alphaLatest != null && f.alphaLatest < 0) {
      cands.push({
        id: "alpha-" + s.sub.id, date: "", tag: T,
        text: `TRADES ${Math.abs(f.alphaLatest).toFixed(1)} UNDER THE ${refLbl} LEVEL — THE FIELD IS BEATING YOU AND IT ISN'T CLOSE`,
        tone: "loss", icon: "trending-down",
        severity: sevCap(30 + 2 * Math.max(0, -(f.alphaCollapse ?? 0)) + 10, 85), about: T,
      });
    } else if (f.alphaCollapse != null && f.alphaCollapse <= -8) {
      cands.push({
        id: "alpha-" + s.sub.id, date: "", tag: T,
        text: `EDGE OVER THE ${refLbl} LEVEL DOWN ${Math.abs(f.alphaCollapse).toFixed(1)} FROM TRAIL — THE MOAT IS GONE`,
        tone: "loss", icon: "trending-down",
        severity: sevCap(30 + 2 * -f.alphaCollapse, 85), about: T,
      });
    }

    // ── Ratings that moved on the latest print.
    const move = ratingMove(s.ratingPrev, s.rating.rating);
    if (move) {
      cands.push({
        id: "rate-" + s.sub.id, date: s.latest?.date ?? "", tag: T,
        text: `${move}D TO ${s.rating.rating} FROM ${s.ratingPrev} ON THE LATEST PRINT — PT ${s.rating.target?.toFixed(1)}${move === "DOWNGRADE" ? ". THE DESK HAS STOPPED GIVING YOU THE BENEFIT OF THE DOUBT" : ""}`,
        tone: move === "UPGRADE" ? "gain" : "loss",
        icon: move === "UPGRADE" ? "trending-up" : "trending-down",
        severity: move === "UPGRADE" ? 35 : 55, printsSince: 0,
      });
    }
  }

  // ── Consistency credit: at most one, and only while it is earned.
  const steady = desks.filter((d) => d.consistent).sort((a, b) => a.vol - b.vol)[0];
  if (steady) {
    cands.push({
      id: "steady-" + steady.id, date: "", tag: steady.ticker,
      text: `PRINTS LIKE CLOCKWORK — ±${steady.vol.toFixed(1)} PTS, ZERO MISSES. CONSISTENCY IS AN ASSET. DON'T SPEND IT`,
      tone: "gain", icon: "shield", severity: 26, about: steady.ticker,
    });
  }

  // ── Book breadth: the latest session where most of the book printed.
  const breadth = sessionBreadth(stats);
  if (breadth && breadth.red.length / breadth.total >= 0.6) {
    const share = breadth.red.length / breadth.total;
    cands.push({
      id: "breadth", date: breadth.date, tag: "BOOK",
      text: `${word(breadth.red.length)} OF ${word(breadth.total)} DESKS PRINT RED AT THE ${monthOf(breadth.date)} SESSION — AVERAGE DROP ${breadth.avgDrop.toFixed(1)} PTS. THIS IS A BOOK-WIDE MARGIN CALL`,
      tone: "loss", icon: "siren",
      severity: sevCap(40 + 25 * (share - 0.5) + 1.2 * breadth.avgDrop, 90),
      printsSince: breadth.printsSince,
    });
  }

  // ── Book dark: staleness is a condition of the tape, not six desk nags.
  // Measured in SCHOOL days (lib/calendar.ts), so the summer never darkens a
  // book nobody could have printed into: six teaching weeks of silence does.
  if (book.medianStaleDays != null && book.medianStaleDays >= 30) {
    let newest = "";
    for (const s of stats) if (s.latest && s.latest.date > newest) newest = s.latest.date;
    cands.push({
      id: "dark", date: "", tag: "WIRE",
      text: `TAPE DARK ${book.medianStaleDays} SESSION DAYS — NOTHING HAS PRINTED SINCE ${newest ? monthOf(newest) : "LISTING"}. THE BOOK IS TRADING ON MEMORY, AND MEMORY DECAYS`,
      tone: "warn", icon: "eye-off",
      // On the session clock a term of silence is ~55 days, so the slope is
      // steeper than the old calendar-day one: six quiet teaching weeks is a
      // macro condition that outranks another desk-level miss.
      severity: sevCap(40 + 0.9 * (book.medianStaleDays - 30), 80),
    });
  }

  // ── Advisor and the reallocation call: where the marginal hour pays.
  const top = signals?.[0];
  if (top && top.priority >= 30) {
    cands.push({
      id: "advisor", date: "", tag: "ADVISOR",
      text: `${top.ticker} TOP PRIORITY ${Math.round(top.priority)}${top.reasons.length ? ` — ${top.reasons.slice(0, 2).join(", ")}` : ""}. THE DESK IS TELLING YOU WHERE THE MONEY IS`,
      tone: "accent", icon: "target",
      severity: sevCap(30 + 0.5 * top.priority, 85),
    });
    const strong = stats
      .filter((s) => s.quant && s.sub.id !== top.id)
      .sort((a, b) => b.quant!.price - a.quant!.price)[0];
    if (strong) {
      cands.push({
        id: "rotate", date: "", tag: "DESK",
        text:
          top.priority >= 60
            ? `CAPITAL MISALLOCATION — ${top.ticker} AT PRIORITY ${Math.round(top.priority)} WHILE YOU POLISH ${strong.sub.ticker}. THE BONUS IS PAID ON THE WEAK DESK`
            : `EVERY HOUR ON ${top.ticker} RETURNS WHAT ${strong.sub.ticker} CANNOT — THE MARGINAL POINT IS CHEAPEST AT THE BOTTOM OF THE BOOK`,
        tone: "accent", icon: "scale",
        severity: sevCap(35 + 0.45 * top.priority, 90),
      });
    }
  }

  // ── Targets, where they exist (dormant on an untargeted book).
  const gaps = desks
    .filter((d) => d.targetGap != null && d.targetGap > 1)
    .sort((a, b) => (b.targetGap as number) - (a.targetGap as number));
  if (gaps.length) {
    const g = gaps[0];
    const target = stats.find((s) => s.sub.id === g.id)?.sub.target;
    cands.push({
      id: "gap", date: "", tag: "DESK",
      text: `${g.ticker} SITS ${g.targetGap!.toFixed(1)} PTS UNDER ITS ${target}% TARGET — THE MOST EXPENSIVE LINE ON THE BOOK`,
      tone: "accent", icon: "banknote",
      severity: sevCap(25 + 2.2 * g.targetGap!, 78),
    });
  }
  const above = stats.filter((s) => s.sub.target != null && s.curAvg != null && s.curAvg >= s.sub.target);
  if (above.length) {
    cands.push({
      id: "above", date: "", tag: "DESK",
      text: `${above.map((s) => s.sub.ticker).join(", ")} TRADING ABOVE TARGET THIS TERM — TARGETS ARE FLOORS, NOT TROPHIES`,
      tone: "gain", icon: "target", severity: 14,
    });
  }

  // ── Composite move.
  if (comp?.delta != null && Math.abs(comp.delta) >= 0.5) {
    const up = comp.delta > 0;
    cands.push({
      id: "comp", date: "", tag: "COMP",
      text: `CAPABILITY INDEX ${up ? "UP" : "DOWN"} ${Math.abs(comp.delta).toFixed(1)} PTS/DESK ON THE TERM TO ${comp.value?.toFixed(1)}${up ? "" : " — THE WHOLE BOOK IS CHEAPER AND NOBODY IS BUYING"}`,
      tone: up ? "gain" : "loss", icon: up ? "trending-up" : "trending-down",
      severity: sevCap(20 + 8 * Math.abs(comp.delta) + (up ? 0 : 6), 70),
    });
  }

  // ── Calm-tape filler: consensus and the alpha leader.
  const covered = stats.filter((s) => s.rating.rating !== "N/A");
  if (covered.length >= 2) {
    const tally = new Map<Rating, number>();
    for (const s of covered) tally.set(s.rating.rating, (tally.get(s.rating.rating) ?? 0) + 1);
    const parts = RATINGS.filter((r) => tally.has(r)).map((r) => `${tally.get(r)} ${r}`);
    cands.push({
      id: "consensus", date: "", tag: "RESEARCH",
      text: `BOOK CONSENSUS — ${parts.join(" · ")}`,
      tone: "info", icon: "sparkles", severity: 12,
    });
  }
  const alphas = stats
    .filter((s) => s.alpha != null && s.alphaCount >= 3)
    .sort((a, b) => (b.alpha as number) - (a.alpha as number));
  if (alphas.length && (alphas[0].alpha as number) >= 1) {
    cands.push({
      id: "alphaLead", date: "", tag: "DESK",
      text: `${alphas[0].sub.ticker} RUNNING +${alphas[0].alpha?.toFixed(1)} ALPHA OVER ${alphas[0].alphaRef === "class" ? "CLASS" : "YEAR"} AVERAGE`,
      tone: "gain", icon: "sparkles", severity: 16,
    });
  }

  // ── Rank: harshest first, in market time; one desk cannot flood the tape.
  const todayMs = pDate(todayIso).getTime();
  const ranked = cands
    .map((c) => {
      const age = c.date ? Math.max(0, Math.round((todayMs - pDate(c.date).getTime()) / 86400000)) : 0;
      return { c, eff: c.severity * (c.date ? decayFactor(c.printsSince ?? 0, age) : 1) };
    })
    .filter((r) => r.eff >= NOISE_FLOOR)
    .sort(
      (a, b) =>
        b.eff - a.eff ||
        (a.c.date > b.c.date ? -1 : a.c.date < b.c.date ? 1 : 0) ||
        (a.c.tag < b.c.tag ? -1 : a.c.tag > b.c.tag ? 1 : 0) ||
        (a.c.id < b.c.id ? -1 : 1),
    );

  const budget = new Map<string, number>();
  const items: WireItem[] = [];
  for (const { c, eff } of ranked) {
    if (items.length >= cap) break;
    if (!c.date && c.about) {
      const used = budget.get(c.about) ?? 0;
      if (used >= STANDING_BUDGET) continue;
      budget.set(c.about, used + 1);
    }
    items.push({ id: c.id, date: c.date, tag: c.tag, text: c.text, tone: c.tone, icon: c.icon, severity: round1(eff) });
  }

  if (!items.length) {
    items.push({
      id: "empty", date: "", tag: "WIRE",
      text: "QUIET TAPE — LOG MORE RESULTS AND HEADLINES WILL PRINT HERE",
      tone: "info", icon: "sparkles", severity: 0,
    });
  }
  return items;
}

/**
 * The latest date where at least three desks printed, each judged against its
 * own prior mean: red under −2, green over +2. The book's advance/decline line.
 */
function sessionBreadth(stats: SubjectStat[]): {
  date: string;
  red: string[];
  green: string[];
  total: number;
  avgDrop: number;
  printsSince: number;
} | null {
  const byDate = new Map<string, Set<string>>();
  for (const s of stats) for (const e of s.entries) {
    const set = byDate.get(e.date) ?? new Set();
    set.add(s.sub.id);
    byDate.set(e.date, set);
  }
  const dates = [...byDate.entries()]
    .filter(([, ids]) => ids.size >= 3)
    .map(([d]) => d)
    .sort((a, b) => (a > b ? -1 : 1));
  for (const date of dates) {
    const red: string[] = [], green: string[] = [];
    const drops: number[] = [];
    const later: number[] = [];
    let total = 0;
    for (const s of stats) {
      const at = s.entries.filter((e) => e.date === date);
      if (!at.length) continue;
      const prior = s.entries.filter((e) => e.date < date).map((e) => e.score);
      if (prior.length < 2) continue;
      total++;
      later.push(s.entries.filter((e) => e.date > date).length);
      const base = avg(prior);
      const score = avg(at.map((e) => e.score));
      if (score < base - 2) { red.push(s.sub.ticker); drops.push(base - score); }
      else if (score > base + 2) green.push(s.sub.ticker);
    }
    if (total < 3) continue;
    return {
      date, red, green, total,
      avgDrop: drops.length ? round1(avg(drops)) : 0,
      printsSince: later.length ? Math.round(median(later) ?? 0) : 0,
    };
  }
  return null;
}

export type { DeskFactors };
