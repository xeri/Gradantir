import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Signals } from ".";
import { computeStats } from "../../lib/stats";
import { sanitizeSettings } from "../../lib/io";
import { emptySignalBook, signalBoard } from "../../lib/quant/signals/signalread";
import { NO_SIGNAL_SKILL } from "../../lib/quant/signals/signalskill";
import type { AppData } from "../../types";

/**
 * THE COMMITTED FIXTURE CARRIES NO LIFE-SIGNALS DATA.
 *
 * signalread.ts's own doc comment calls this the load-bearing invariant: on a
 * book that has never touched study sessions, rest logs, disruptions, topic
 * marks or the person profile, every desk's read collapses to the identity —
 * adj 0, sdMult 1, terms []. The SIGNALS view shell has to honour that
 * honestly: zero per-term marginals, a 0.00 ADJ and a 0.00 W·ADJ on every
 * live desk, no NaN anywhere, and no crash — never a fabricated number where
 * the engine produced none. This is also the shell's gate-safety net: if it
 * ever recomputed the board instead of reusing App's memos, or mis-called the
 * `{drop}` ablation seam, this is where a stray NaN or a nonzero phantom
 * figure would first show up.
 */

const TODAY = "2026-07-21";
const raw = JSON.parse(readFileSync("src/lib/__fixtures__/book.json", "utf8"));
const base: AppData = { ...raw.data, settings: sanitizeSettings(raw.data.settings) };

const stats = computeStats(base.subjects, base.entries, base.settings, TODAY);
const signalBook = emptySignalBook;
const modelMeans = new Map(stats.map((s) => [s.sub.id, s.quant?.nextExam.mean ?? null]));
const signalReads = signalBoard(base.subjects, signalBook, base.entries, base.upcoming ?? [], modelMeans, TODAY);

function render(signalOn = true) {
  return renderToStaticMarkup(
    <Signals
      stats={stats}
      entries={base.entries}
      upcoming={base.upcoming ?? []}
      signalBook={signalBook}
      signalReads={signalReads}
      modelMeans={modelMeans}
      signalFit={NO_SIGNAL_SKILL}
      signalOn={signalOn}
      todayIso={TODAY}
      onSetSignalWeighting={() => {}}
      onLogSession={() => {}}
      onLogRest={() => {}}
      onLogDisruption={() => {}}
      onAddTopic={() => {}}
      onEditTopic={() => {}}
      profile={null}
      onSaveTraits={() => {}}
      onSaveProfile={() => {}}
    />,
  );
}

describe("the signals shell on an untouched book", () => {
  it("renders the priced banner and the per-desk terms table without crashing", () => {
    const html = render();
    expect(html).toMatch(/signals priced into predictions/i);
    expect(html).toContain("PER-DESK TERMS");
  });

  it("lists a ticker row for every live desk, and none for a delisted one", () => {
    const html = render();
    for (const s of stats.filter((x) => !x.sub.archived)) expect(html).toContain(s.sub.ticker);
    const delisted = stats.find((x) => x.sub.archived);
    expect(delisted).toBeTruthy();
    expect(html).not.toContain(delisted!.sub.ticker);
  });

  it("prints every desk's ADJ and W·ADJ as an honest zero, never NaN", () => {
    const html = render();
    expect(html).not.toContain("NaN");
    const liveCount = stats.filter((x) => !x.sub.archived).length;
    // ADJ and W·ADJ are each their own cell, so a clean book prints at least
    // 2 zero cells per live desk (7 term columns are ALSO zero, but those
    // render as an em dash rather than "0.00" — see the view's own doc note).
    expect((html.match(/0\.00/g) ?? []).length).toBeGreaterThanOrEqual(liveCount * 2);
  });

  it("hosts the signalWeighting switch, on by default per the student-input polarity", () => {
    const html = render();
    expect(html).toContain("[■]"); // the terminal checkbox, checked
    expect(html).toMatch(/role="switch"/);
    expect(html).toMatch(/aria-checked="true"/);
  });

  it("shows the switch unchecked and the off-copy when signalOn is false", () => {
    const html = render(false);
    expect(html).toContain("[ ]");
    expect(html).toMatch(/aria-checked="false"/);
    expect(html).toContain("OUT OF THE PRICING");
  });
});
