import { Activity, FlaskConical } from "lucide-react";
import { C, FONT } from "../../theme";
import { Btn } from "../../components/ui/Btn";
import { Card, Derived, Loading } from "./Card";
import { fmt1, signed } from "./format";
import type { DeriveCtx } from "../../lib/derive";
import type { AblationRow } from "../../lib/quant/eval/ablation";

export interface AblationReport {
  members: AblationRow[];
  premia: AblationRow[];
}

export function AblationCard({ ablation, ablating, onRun, dctx }: { ablation: AblationReport | null; ablating: boolean; onRun: () => void; dctx?: DeriveCtx }) {
  const tone = (v: string) => (v === "keep" ? C.up : v === "prune" ? C.down : C.faint);
  return (
    <Card
      icon={FlaskConical}
      title="EARNS ITS PLACE?"
      accent={C.faint}
      help="Leave-one-out ablation: Δ > 0 means removing the piece hurt out-of-sample skill, so it earns its place. Red means it is costing skill. This one is heavy — run it when you want it."
      right={!ablation && <Btn onClick={onRun} disabled={ablating} title="Run the leave-one-out ablation (a few seconds)"><Activity size={12} /> {ablating ? "Running…" : "Run ablation"}</Btn>}
    >
      {ablating ? (
        <Loading label="Repricing every fold with each piece removed…" />
      ) : !ablation ? (
        <p className="text-[11px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
          The heaviest check on the board — it reprices the whole walk-forward with each member and premium removed. Run it on demand.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {[...ablation.members, ...ablation.premia].map((r) => (
            <div key={r.kind + r.key} className="flex items-center justify-between border px-2 py-1" style={{ borderColor: C.line, background: C.panel2 }} title={`without it: ${fmt1(r.ablated)} · with it: ${fmt1(r.baseline)}`}>
              <span className="text-[11px] uppercase" style={{ color: C.dim, fontFamily: FONT.mono }}>{r.key}</span>
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider tabular-nums" style={{ fontFamily: FONT.mono }}>
                <Derived on={dctx ? { id: "skill.ablation", ctx: { ...dctx, key: `${r.kind}.${r.key}` } } : null}>
                  <span style={{ color: C.faint }}>{signed(r.delta)}</span>
                </Derived>
                <span style={{ color: tone(r.verdict) }}>{r.verdict}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
