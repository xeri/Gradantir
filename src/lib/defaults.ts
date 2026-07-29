import { PALETTE, freshSettings } from "../constants";
import type { AppData, Subject } from "../types";

/** The canonical six desks, in listing order. */
export interface SubjectDef {
  id: string;
  name: string;
  ticker: string;
  color: string;
}

export const DEFAULT_SUBJECT_DEFS: SubjectDef[] = [
  { id: "s-math", name: "Mathematics", ticker: "MATH", color: PALETTE[0] },
  { id: "s-eng", name: "English", ticker: "ENG", color: PALETTE[1] },
  { id: "s-phys", name: "Physics", ticker: "PHYS", color: PALETTE[2] },
  { id: "s-econ", name: "Economics", ticker: "ECON", color: PALETTE[3] },
  { id: "s-bus", name: "Business", ticker: "BUS", color: PALETTE[4] },
  { id: "s-geo", name: "Geography", ticker: "GEO", color: PALETTE[5] },
];

export const defaultSubjects = (): Subject[] =>
  DEFAULT_SUBJECT_DEFS.map((d) => ({ ...d, target: null, courseworkPct: null }));

/** A fresh book: the six desks listed, zero prints — empty states lead from there. */
export const freshBook = (): AppData => ({
  subjects: defaultSubjects(),
  entries: [],
  settings: freshSettings(),
  sample: false,
});
