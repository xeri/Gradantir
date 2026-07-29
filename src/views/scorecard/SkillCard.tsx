import { Gauge } from "lucide-react";
import { C, FONT, microLabel } from "../../theme";
import { Card, Derived, Loading, Stat, type DeriveRef } from "./Card";
import { fmt1, pct0, signed } from "./format";
import type { DeriveCtx } from "../../lib/derive";
import type { BookBacktest } from "../../lib/quant/eval/backtest";
import type { MeanSkill } from "../../lib/quant/eval/skill";

export interface SkillReport {
  book: BookBacktest;
  mean: MeanSkill;
}

export function SkillCard({ skill, dctx }: { skill: SkillReport | null; dctx?: DeriveCtx }) {
  const on = (id: string): DeriveRef | null => (dctx ? { id, ctx: dctx } : null);
  return (
    <Card
      icon={Gauge}
      title="WHERE THE SKILL IS"
      accent={C.amber}
      help="The desk graded against itself, walk-forward. Trust the aggregate; read each desk as a wide band. Every figure here opens its scoring rule."
    >
      {!skill ? (
        <Loading label="Crunching the walk-forward backtest…" />
      ) : (() => {
        const b = skill.book;
        const m = skill.mean;
        const meanBeats = m.mae < m.naiveMae;
        return (
          <div>
            <div className="flex items-baseline gap-3 mb-3 pb-3 border-b" style={{ borderColor: C.line }}>
              <div>
                <div style={{ ...microLabel, color: C.faint }}>AGGREGATE FORECAST ERROR</div>
                <Derived on={on("skill.mae")}>
                  <span className="block text-3xl font-black tabular-nums leading-none" style={{ color: meanBeats ? C.up : C.down, fontFamily: FONT.mono }}>
                    {fmt1(m.mae)}<span className="text-sm" style={{ color: C.faint }}> MAE</span>
                  </span>
                </Derived>
              </div>
              <div className="text-[11px] uppercase tracking-wider leading-snug" style={{ color: C.dim, fontFamily: FONT.mono }}>
                {meanBeats ? "BEATS" : "NO EDGE ON"} THE NAIVE ({fmt1(m.naiveMae)})<br />
                <span style={{ color: C.faint }}>THE HEADLINE THE ENGINE CAN ACTUALLY FORECAST</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="PER-SUBJECT SKILL" value={(b.skill * 100).toFixed(0) + "%"} sub={`MAE ${fmt1(b.mae)}`} tone={b.skill > 0.02 ? C.up : b.skill < -0.02 ? C.down : C.dim} derive={on("skill.crps")} />
              <Stat label="OPTIMISM BIAS" value={signed(b.bias)} sub="OVER-PREDICTION" tone={Math.abs(b.bias) < 1.5 ? C.up : C.amber} derive={on("skill.bias")} />
              <Stat label="90% COVERAGE" value={pct0(b.cover90)} sub={`n=${b.n}`} tone={b.cover90 >= 0.85 ? C.up : C.amber} derive={on("skill.coverage")} />
            </div>
          </div>
        );
      })()}
    </Card>
  );
}
