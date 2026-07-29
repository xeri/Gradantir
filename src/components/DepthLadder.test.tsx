import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DepthLadder } from "./DepthLadder";
import { fitDepth, subjectDepth } from "../lib/quant/depth";
import { freshSettings } from "../constants";
import type { GradeEntry, Settings, Subject } from "../types";

const sub: Subject = { id: "s1", name: "English", ticker: "ENG", color: "#E0662E", target: null };

let seq = 0;
const e = (date: string, score: number, rank: number, cohortN: number, yearAvg: number | null): GradeEntry => ({
  id: `e${seq++}`, subjectId: "s1", date, type: "Exam", score, title: "",
  classAvg: null, yearAvg, rank, cohortN, worthPct: null,
});

/** Two periods of placements across three desks so the model actually fits. */
const book = (yearAvg: number | null): GradeEntry[] => {
  const rows: GradeEntry[] = [];
  [["2025-11-15", 68, 24], ["2026-02-15", 57, 23]].forEach(([d, sc, rk]) => {
    rows.push(e(d as string, sc as number, rk as number, 36, yearAvg));
    for (const off of [6, -6]) {
      rows.push({ ...e(d as string, (sc as number) + off, (rk as number) - off, 36, yearAvg), subjectId: `s${off}` });
    }
  });
  return rows;
};

const render = (entries: GradeEntry[], settings: Settings) => {
  const model = fitDepth(entries, settings);
  const depth = subjectDepth(sub, entries.filter((x) => x.subjectId === "s1"), model, settings)!;
  return renderToStaticMarkup(<DepthLadder depth={depth} color={sub.color} />);
};

describe("DepthLadder", () => {
  const streamed: Settings = {
    ...freshSettings(),
    depth: { streamsPerLevel: 15, yearSize: 540, streamTightness: 0.7 },
  };

  it("renders a ladder with a field rank and a marked touch", () => {
    const html = render(book(59), streamed);
    expect(html).toContain("/ 540");
    expect(html).toContain("ESTIMATED PLACE IN THE YEAR LEVEL");
    expect(html).toContain("AHEAD OF YOU");
    // The touch row is marked, exactly once.
    expect(html.split("▸").length - 1).toBe(1);
  });

  it("quotes the stream when the book is streamed, and stays quiet when it is not", () => {
    expect(render(book(59), streamed)).toContain("STREAM ");
    expect(render(book(59), freshSettings())).not.toContain("STREAM ");
  });

  it("renders without a year-level mark anywhere", () => {
    // The class is the only anchor; the component must not blow up on it.
    const html = render(book(null), freshSettings());
    expect(html).toContain("ESTIMATED PLACE IN THE YEAR LEVEL");
    expect(html).not.toContain("NaN");
  });

  it("never emits NaN or undefined into the markup", () => {
    for (const s of [streamed, freshSettings()]) {
      const html = render(book(59), s);
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("undefined");
    }
  });
});
