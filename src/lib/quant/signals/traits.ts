import type { SubjectTraits, TopicMark } from "../../../types";
import { TRAIT_MARKER_W, TRAIT_SAMPLING_W, TRAIT_SDMULT_CAP } from "./params";

/**
 * The traits read: a variance-only humility claim on the outcome sd
 * multiplier, never a point effect. Two shape priors move it — low marking
 * determinism (a judged essay vs formula marking) widens marker noise, and a
 * narrow-sampling paper (low breadth) is luckier to sit when mastery is
 * uneven across topics, so unevenness only widens the band when breadth is
 * ALSO narrow (it multiplies (1-B), it does not add on its own). A high
 * time-pressure error rate and a stated low-belief self-report each add a
 * small flat nudge on top. Every component is >= 0 — the multiplier can only
 * widen a forecast, never move its centre — and the whole thing is clamped
 * to [1, TRAIT_SDMULT_CAP] so no combination of inputs explodes the band.
 *
 * When traits is null (no shape priors set for this subject) the
 * determinism/breadth components contribute 0 — the time-error and belief
 * nudges still apply, since those come from the subject's own history and
 * self-report, not from the traits object.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function traitSdMult(
  traits: SubjectTraits | null,
  unevenness: number, // 0-1, from MasteryRead (0 when unknown)
  timeErrorShare: number, // 0-1 share of this subject's TopicMarks with errorKind "time" (0 when no marks)
  belief: number | null, // Subject.belief 1-5
): number {
  const markerTerm = traits ? TRAIT_MARKER_W * (1 - traits.determinism) : 0;
  const samplingTerm = traits ? TRAIT_SAMPLING_W * (1 - traits.breadth) * (1 + unevenness) : 0;
  const timeTerm = timeErrorShare >= 0.25 ? 0.05 : 0;
  const beliefTerm = belief != null && belief <= 2 ? 0.05 : 0;
  const raw = 1 + markerTerm + samplingTerm + timeTerm + beliefTerm;
  return round2(clamp(raw, 1, TRAIT_SDMULT_CAP));
}

/** Share of marks with errorKind "time"; 0 when empty. */
export function timeErrorShareOf(marks: TopicMark[]): number {
  if (!marks.length) return 0;
  const timeCount = marks.filter((m) => m.errorKind === "time").length;
  return timeCount / marks.length;
}
