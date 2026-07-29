import { ENGINE_VERSION } from "../params";
import { backtestBook, type BookBacktest } from "./backtest";
import { meanSkill, type MeanSkill } from "./skill";
import { ablateMembers, ablatePremia, type AblationRow } from "./ablation";
import type { AppData } from "../../../types";

/**
 * The skill scoreboard: the engine graded against itself. Per-subject skill vs a
 * random-walk naive, the far-more-forecastable all-subject mean beside it, the
 * optimism/pessimism bias, realized interval coverage, and a leave-one-out
 * verdict on every ensemble member and every premium — kept or pruned by whether
 * it beats its own absence. This IS the objective every later change is gated on.
 */

export interface Scoreboard {
  asOf: string;
  modelVersion: string;
  book: BookBacktest;
  mean: MeanSkill;
  members: AblationRow[];
  premia: AblationRow[];
}

export function evaluateBook(data: AppData, todayIso: string): Scoreboard {
  return {
    asOf: todayIso,
    modelVersion: ENGINE_VERSION,
    book: backtestBook(data.subjects, data.entries),
    mean: meanSkill(data.subjects, data.entries, data.settings.calendar),
    members: ablateMembers(data.subjects, data.entries),
    premia: ablatePremia(data.subjects, data.entries, data.settings),
  };
}

export type { BookBacktest, SubjectBacktest } from "./backtest";
export type { MeanSkill, MeanPoint } from "./skill";
export type { AblationRow } from "./ablation";
export { scoreT, type Scores } from "./scoring";
