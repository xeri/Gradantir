import { C, FONT } from "../../theme";
import type { AssessmentType } from "../../types";

/** Exams carry the most weight — they get the filled amber chip. */
export function TypeBadge({ type }: { type: AssessmentType }) {
  const strong = type === "Exam";
  return (
    <span
      className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] border"
      style={{
        fontFamily: FONT.mono,
        background: strong ? C.amber : "transparent",
        color: strong ? C.strip : C.dim,
        borderColor: strong ? C.amber : C.line,
      }}
    >
      {type}
    </span>
  );
}
