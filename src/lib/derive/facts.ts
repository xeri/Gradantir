/**
 * Traces the boards hand the derivation layer.
 *
 * §24's rule is that a research note READS what the engine computed rather than
 * recomputing it — a note that re-derives its own number can drift from the one
 * on screen, and a note that has drifted is worse than none. The quant modules
 * publish their intermediates through `quant/trace.ts`; the SCORECARD and the
 * CHART boards have no equivalent, because their figures are assembled in the
 * view from several engines at once (a walk-forward backtest, a scoreboard, a
 * credibility fit, a spider). These are that missing trace: plain bundles the
 * view already holds, passed down on the derivation context so a builder can
 * quote them.
 *
 * Everything here is optional. A builder whose facts are absent returns null and
 * the figure simply carries no underline — which is the correct behaviour on a
 * board that has not finished its backtest yet.
 */

import type { WaterFill } from "../allocate";
import type { Readiness } from "../duel";
import type { ElicitScoreboard } from "../elicit";
import type { TrendFit } from "../grouping";
import type { MeanCallScore } from "../meancall";
import type { AblationRow } from "../quant/eval/ablation";
import type { BookBacktest } from "../quant/eval/backtest";
import type { MeanSkill } from "../quant/eval/skill";
import type { MeanPoolModel } from "../quant/meanpool";
import type { SelfWeightModel } from "../quant/pool";
import type { AiWeightModel } from "../quant/aipool";
import type { ReadinessSkill } from "../quant/readiness";
import type { AggregateForecast } from "../../types";

/** The effort spider's state, in the token unit the plan is stored in. */
export interface EffortFacts {
  /** The fixed budget the split must keep hitting. */
  total: number;
  hoursPerWeek: number;
  plan: Record<string, number>;
  /** Null until the student records what they actually did. */
  actual: Record<string, number> | null;
  /** The water-filled recommendation, for comparison. */
  model: Record<string, number>;
  /** The solve behind it — λ and the funded set, as `suggestAllocation` found them. */
  fill?: WaterFill | null;
  /** Advisor urgency per desk — the pressure the water-fill ran on. */
  priority: Record<string, number>;
  /** Planned − actual, per desk and in absolute total. */
  gap: { byId: Record<string, number>; totalAbs: number } | null;
  /** Tickers, so a derivation can name a desk without the whole book. */
  tickerOf: Record<string, string>;
}

/** D5 · everything the scorecard measured, as the card measured it. */
export interface ScorecardFacts {
  /** Walk-forward one-step-ahead backtest of the whole book. */
  book?: BookBacktest | null;
  /** The aggregate-mean backtest, beside its local-level naive. */
  mean?: MeanSkill | null;
  /** You against the desk on resolved sittings. */
  elicit?: ElicitScoreboard | null;
  /** What your next-exam calls have earned (§27). */
  selfFit?: SelfWeightModel | null;
  /** What the wire's AI forecasts have earned (§29). */
  aiFit?: AiWeightModel | null;
  /** What the duel pile has earned (§15c). */
  readyFit?: ReadinessSkill | null;
  /** What your aggregate calls have earned (§28). */
  meanFit?: MeanPoolModel | null;
  /** Leave-one-out rows, once the ablation has been run. */
  ablation?: AblationRow[] | null;
  /** The desk's own forward aggregate — what an aggregate call disagrees with. */
  deskForecast?: AggregateForecast | null;
  /** Whether the channel under the cursor is actually priced in right now. */
  on?: boolean;
  /** One filed aggregate call and how it scored. */
  call?: { predAvg: number; ranking: string[]; score: MeanCallScore } | null;
  /** The Elo table behind the readiness ranking, and the pile that fitted it. */
  elo?: { rows: Readiness[]; duels: number; tickerOf: Record<string, string> } | null;
  effort?: EffortFacts | null;
}

/** D2 · what the chart board drew, for the figure under the cursor. */
export interface ChartFacts {
  /** Per-subject trend fits as `addForecast` published them, by subject id. */
  trend?: Record<string, TrendFit>;
  /** The rolling window under the cursor: its span and the values in it. */
  ma?: { win: number; values: number[]; value: number } | null;
  /** The composite overlay on the pinned row. */
  comp?: { values: { ticker: string; v: number }[]; value: number } | null;
  /** Which series and which x the cursor is on. */
  ticker?: string;
  label?: string;
  color?: string;
}
