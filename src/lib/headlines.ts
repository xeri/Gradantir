import { round1 } from "./utils";
import { subjectForecast } from "./regression";
import type { CompositeIndex, SubjectStat } from "../types";

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
}

/**
 * The news wire: recent results scored against the estimate that stood
 * before them, ATH prints, then standing desk notes (targets, volatility,
 * composite move). Newest first, capped.
 */
export function buildWire(stats: SubjectStat[], comp: CompositeIndex, cap = 14): WireItem[] {
  const items: WireItem[] = [];

  // Per-entry events, newest first across all subjects.
  const dated: { date: string; make: () => WireItem | null }[] = [];
  for (const s of stats) {
    const es = s.entries;
    for (let i = Math.max(0, es.length - 5); i < es.length; i++) {
      const e = es[i];
      const prior = es.slice(0, i);
      dated.push({
        date: e.date,
        make: () => {
          const isAth = prior.length >= 3 && e.score > Math.max(...prior.map((p) => p.score));
          const est = subjectForecast(prior);
          if (isAth) {
            const beat = est ? ` — BEATS EST ${est.pred.toFixed(1)}` : "";
            return {
              id: "ath-" + e.id, date: e.date, tag: s.sub.ticker,
              text: `PRINTS ALL-TIME HIGH ${e.score.toFixed(1)}${beat}`,
              tone: "gain", icon: "zap",
            };
          }
          if (!est) return null;
          const diff = round1(e.score - est.pred);
          if (diff > 0.5) return {
            id: "beat-" + e.id, date: e.date, tag: s.sub.ticker,
            text: `${e.score.toFixed(1)} — BEATS EST ${est.pred.toFixed(1)} (+${diff.toFixed(1)})`,
            tone: "gain", icon: "trending-up",
          };
          if (diff < -0.5) return {
            id: "miss-" + e.id, date: e.date, tag: s.sub.ticker,
            text: `${e.score.toFixed(1)} — MISSES EST ${est.pred.toFixed(1)} (${diff.toFixed(1)})`,
            tone: "loss", icon: "trending-down",
          };
          return {
            id: "line-" + e.id, date: e.date, tag: s.sub.ticker,
            text: `${e.score.toFixed(1)} — IN LINE WITH EST ${est.pred.toFixed(1)}`,
            tone: "info", icon: "minus",
          };
        },
      });
    }
  }
  dated.sort((a, b) => (a.date > b.date ? -1 : 1));
  for (const d of dated) {
    const it = d.make();
    if (it) items.push(it);
    if (items.length >= cap - 4) break;
  }

  // Standing desk notes.
  if (comp.delta != null && Math.abs(comp.delta) >= 0.5) {
    const up = comp.delta > 0;
    items.push({
      id: "comp", date: "", tag: "COMP",
      text: `COMPOSITE ${up ? "UP" : "DOWN"} ${Math.abs(comp.delta).toFixed(1)} ON TERM TO ${comp.value?.toFixed(1)}`,
      tone: up ? "gain" : "loss", icon: up ? "trending-up" : "trending-down",
    });
  }
  const above = stats.filter((s) => s.sub.target != null && s.curAvg != null && s.curAvg >= s.sub.target);
  if (above.length) items.push({
    id: "above", date: "", tag: "DESK",
    text: `${above.map((s) => s.sub.ticker).join(", ")} TRADING ABOVE TARGET THIS TERM`,
    tone: "gain", icon: "target",
  });
  const gaps = stats
    .filter((s) => s.sub.target != null && s.curAvg != null && s.curAvg < (s.sub.target as number) - 1)
    .map((s) => ({ s, gap: round1((s.sub.target as number) - (s.curAvg as number)) }))
    .sort((a, b) => b.gap - a.gap);
  if (gaps.length) items.push({
    id: "gap", date: "", tag: "DESK",
    text: `${gaps[0].s.sub.ticker} SITS ${gaps[0].gap.toFixed(1)} PTS UNDER ITS ${gaps[0].s.sub.target}% TARGET — WIDEST GAP ON THE BOOK`,
    tone: "accent", icon: "target",
  });
  const vol = stats.filter((s) => s.scores.length >= 4).sort((a, b) => b.sd - a.sd)[0];
  if (vol && vol.sd >= 6) items.push({
    id: "vol", date: "", tag: "RISK",
    text: `${vol.sub.ticker} VOLATILITY ELEVATED — SWINGS ±${vol.sd.toFixed(1)} PTS BETWEEN ASSESSMENTS`,
    tone: "warn", icon: "activity",
  });
  const alphas = stats.filter((s) => s.alpha != null && s.alphaCount >= 3).sort((a, b) => (b.alpha as number) - (a.alpha as number));
  if (alphas.length && (alphas[0].alpha as number) >= 1) items.push({
    id: "alpha", date: "", tag: "DESK",
    text: `${alphas[0].sub.ticker} RUNNING +${alphas[0].alpha?.toFixed(1)} ALPHA OVER CLASS AVERAGE`,
    tone: "gain", icon: "sparkles",
  });

  if (!items.length) items.push({
    id: "empty", date: "", tag: "WIRE",
    text: "QUIET TAPE — LOG MORE RESULTS AND HEADLINES WILL PRINT HERE",
    tone: "info", icon: "sparkles",
  });
  return items.slice(0, cap);
}
