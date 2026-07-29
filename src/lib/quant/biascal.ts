import { clamp } from "../utils";
import { shrinkToward } from "./shrinkage";
import { BIAS_KAPPA_GLOBAL, BIAS_KAPPA_SUBJECT, BIAS_KAPPA_WIDTH } from "./params";
import type { ForecastLog } from "../../types";

/**
 * The shrunk-hierarchical bias calibrator — the equation half of the forecast
 * register. From resolved forecasts it estimates a pooled GLOBAL offset (well
 * identified) plus PER-SUBJECT offsets shrunk hard toward the global (barely
 * identified, so they barely leave the pool — this is what stops the register
 * oscillating), and a width recalibration toward realized coverage.
 *
 * It is exactly the identity on an empty register, so the live board and the
 * §21 lock are untouched until real forecasts accumulate.
 */

export interface BiasModel {
  /** Pooled optimism/pessimism offset (point − realized), shrunk toward 0. */
  global: number;
  /** Per-subject offsets, shrunk hard toward `global`. */
  bySubject: Record<string, number>;
  /** Multiplier on the predictive sd to hit realized coverage. */
  widthScale: number;
  n: number;
  nBySubject: Record<string, number>;
}

export const IDENTITY_BIAS: BiasModel = { global: 0, bySubject: {}, widthScale: 1, n: 0, nBySubject: {} };

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function fitBias(logs: ForecastLog[], target: "exam" | "price"): BiasModel {
  const resolved = logs.filter(
    (l): l is ForecastLog & { error: number } =>
      l.target === target && l.resolvedAt != null && l.error != null && Number.isFinite(l.error),
  );
  if (!resolved.length) return { ...IDENTITY_BIAS };

  const errors = resolved.map((l) => l.error);
  const global = shrinkToward(mean(errors), resolved.length, 0, BIAS_KAPPA_GLOBAL);

  const bySubject: Record<string, number> = {};
  const nBySubject: Record<string, number> = {};
  const groups = new Map<string, number[]>();
  for (const l of resolved) {
    const g = groups.get(l.subjectId) ?? [];
    g.push(l.error);
    groups.set(l.subjectId, g);
  }
  for (const [id, errs] of groups) {
    bySubject[id] = shrinkToward(mean(errs), errs.length, global, BIAS_KAPPA_SUBJECT);
    nBySubject[id] = errs.length;
  }

  // Width: the rms of standardized errors. >1 means the bands were too tight.
  const ratios = resolved.filter((l) => l.sd > 0).map((l) => (l.error / l.sd) ** 2);
  const rms = ratios.length ? Math.sqrt(mean(ratios)) : 1;
  const widthScale = clamp(shrinkToward(rms, resolved.length, 1, BIAS_KAPPA_WIDTH), 0.5, 2);

  return { global, bySubject, widthScale, n: resolved.length, nBySubject };
}

export interface BiasableForecast {
  mean: number;
  sd: number;
  df: number;
}

/** Subtract the learned offset and rescale the band. Identity under IDENTITY_BIAS. */
export function applyBias<T extends BiasableForecast>(f: T, model: BiasModel, subjectId: string): T {
  const offset = subjectId in model.bySubject ? model.bySubject[subjectId] : model.global;
  return { ...f, mean: f.mean - offset, sd: f.sd * model.widthScale };
}
