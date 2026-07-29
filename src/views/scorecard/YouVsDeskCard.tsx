import { Crosshair } from "lucide-react";
import { C, FONT } from "../../theme";
import { Toggle } from "../../components/ui/Toggle";
import { Card, Derived, type DeriveRef } from "./Card";
import { edgeColor, fmt1, pct0 } from "./format";
import type { DeriveCtx } from "../../lib/derive";
import type { elicitationScoreboard } from "../../lib/elicit";
import type { SelfWeightModel } from "../../lib/quant/pool";
import type { AiWeightModel } from "../../lib/quant/aipool";

function VsRow({ label, you, model, n, kind, hint, derive }: { label: string; you: number | null; model: number | null; n: number; kind: string; hint: string; derive?: DeriveRef | null }) {
  if (n === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-b py-1.5 last:border-0" style={{ borderColor: C.line }} title={hint}>
      <span className="text-[11px] uppercase tracking-wider" style={{ color: C.dim, fontFamily: FONT.mono }}>{label} <span style={{ color: C.faint }}>·{n}</span></span>
      <span className="flex items-center gap-2 tabular-nums text-sm" style={{ fontFamily: FONT.mono }}>
        <Derived on={derive}>
          <span style={{ color: edgeColor(you, model) }}>{fmt1(you)}</span>
        </Derived>
        <span className="text-[10px]" style={{ color: C.faint }}>YOU</span>
        <span style={{ color: C.faint }}>/</span>
        <span style={{ color: C.dim }}>{fmt1(model)}</span>
        <span className="text-[10px]" style={{ color: C.faint }}>{kind}</span>
      </span>
    </div>
  );
}

/**
 * What your record has bought your own call in the next-exam forecast, and the
 * switch that takes it back out. The bar is deliberately literal — this is the
 * one place the engine hands a share of a forecast to an unaudited input, so it
 * says out loud how big that share is and what earned it.
 */
function SelfWeightRow({ fit, on, onToggle, derive }: { fit: SelfWeightModel; on: boolean; onToggle: (on: boolean) => void; derive?: DeriveRef | null }) {
  const pct = Math.round(fit.w * 100);
  const beating = fit.youScore != null && fit.modelScore != null && fit.youScore < fit.modelScore;
  return (
    <div className="mt-2 border-t pt-2 space-y-1.5" style={{ borderColor: C.line }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Toggle on={on} onClick={() => onToggle(!on)}>Your call priced into the forecast</Toggle>
        <Derived on={derive}>
          <span className="text-sm font-bold tabular-nums" style={{ color: on && fit.w > 0 ? C.accent : C.faint, fontFamily: FONT.mono }}>
            {on ? `${pct}%` : "OFF"}
          </span>
        </Derived>
      </div>
      {on && (
        <>
          {/* the weight, as a bar you can read at a glance */}
          <div className="h-1 w-full" style={{ background: C.line }}>
            <div className="h-full" style={{ width: `${Math.min(100, pct)}%`, background: C.accent }} />
          </div>
          <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
            {fit.n === 0
              ? "NOTHING SCORED YET — THE DESK OWNS EVERY CALL UNTIL YOU BEAT IT ON A SITTING IT ALSO CALLED."
              : fit.w === 0
                ? `THE DESK HAS BEEN THE BETTER FORECASTER OVER ${fit.n} SITTING${fit.n === 1 ? "" : "S"} — YOUR CALL CARRIES NO WEIGHT.`
                : `${beating ? "THE DESK HAS BEEN OFF AND YOU HAVE NOT" : "YOU HAVE HELD YOUR OWN"} OVER ${fit.n} SITTING${fit.n === 1 ? "" : "S"}, SO YOUR CALL CARRIES ${pct}% OF THE NEXT-EXAM FORECAST. DISAGREE WITH THE DESK AND THE BAND WIDENS — A CONTESTED CALL IS AN UNCERTAIN ONE.`}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The wire's seat, beside yours — the same literal bar, on harsher terms. This
 * is the ONLY place an outside desk's opinion can reach a forecast, so the row
 * quotes its cap, the joint ceiling, and the measured charge in points before
 * the switch is touched (the PricedBanner rule, worn by a row).
 */
function AiWeightRow({ fit, on, charge, onToggle, derive }: {
  fit: AiWeightModel;
  on: boolean;
  charge?: { desks: number; maxAbsMove: number };
  onToggle: (on: boolean) => void;
  derive?: DeriveRef | null;
}) {
  const pct = Math.round(fit.w * 100);
  const moving = on && fit.w > 0 && charge != null && charge.desks > 0;
  return (
    <div className="mt-2 border-t pt-2 space-y-1.5" style={{ borderColor: C.line }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Toggle on={on} onClick={() => onToggle(!on)}>The wire's forecasts priced in</Toggle>
        <Derived on={derive}>
          <span className="text-sm font-bold tabular-nums" style={{ color: on && fit.w > 0 ? C.accent : C.faint, fontFamily: FONT.mono }}>
            {on ? `${pct}%` : "OFF"}
          </span>
        </Derived>
      </div>
      {on ? (
        <>
          <div className="h-1 w-full" style={{ background: C.line }}>
            <div className="h-full" style={{ width: `${Math.min(100, pct)}%`, background: C.accent }} />
          </div>
          <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
            {fit.n === 0
              ? "NOTHING SCORED YET — THE WIRE EARNS ITS SEAT ONLY BY BEATING THE DESK ON RESOLVED SITTINGS IT CALLED IN ADVANCE."
              : fit.w === 0
                ? `THE DESK HAS BEEN THE BETTER FORECASTER OVER ${fit.n} SITTING${fit.n === 1 ? "" : "S"} — THE WIRE'S CALL CARRIES NO WEIGHT.`
                : `OVER ${fit.n} SITTING${fit.n === 1 ? "" : "S"} THE WIRE HAS EARNED ${pct}% OF THE NEXT-EXAM FORECAST${moving ? ` — MOVING ${charge!.desks} CALL${charge!.desks === 1 ? "" : "S"} BY UP TO ${charge!.maxAbsMove} PTS RIGHT NOW` : ""}. CAPPED AT 35%, CEILINGED JOINTLY WITH YOURS — THE HOUSE MODEL ALWAYS KEEPS AT LEAST 40%.`}
          </p>
        </>
      ) : (
        <p className="text-[10px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
          THE WIRE'S FORECASTS ARE FILED AND SCORED, AND WEIGH NOTHING. SWITCH ON AND ITS RECORD STARTS BUYING A CAPPED SEAT IN THE NEXT-EXAM FORECAST — A STRONGER MODEL BEHIND THE PROMPT TENDS TO EARN A BIGGER ONE.
        </p>
      )}
    </div>
  );
}

export function YouVsDeskCard({
  elicit, hasSittings, hasAiCalls, selfFit, selfOn, aiFit, aiOn, aiCharge,
  onSetSelfWeighting, onSetAiWeighting, dctx, aiDctx,
}: {
  elicit: ReturnType<typeof elicitationScoreboard>;
  hasSittings: boolean;
  /** Whether ANY sitting carries a wire call — the row is noise before then. */
  hasAiCalls?: boolean;
  /** What your record has earned your call in the next-exam forecast. */
  selfFit: SelfWeightModel;
  selfOn: boolean;
  /** What the wire's record has earned (§29). */
  aiFit?: AiWeightModel;
  aiOn?: boolean;
  aiCharge?: { desks: number; maxAbsMove: number };
  onSetSelfWeighting: (on: boolean) => void;
  onSetAiWeighting?: (on: boolean) => void;
  dctx?: DeriveCtx;
  /** A second context carrying the WIRE channel's own switch state. */
  aiDctx?: DeriveCtx;
}) {
  const any = elicit.self.n || elicit.teacher.n || elicit.ai.n || elicit.chips.n;
  const on = (id: string): DeriveRef | null => (dctx ? { id, ctx: dctx } : null);
  return (
    <Card
      icon={Crosshair}
      title="YOU VS THE DESK"
      accent={C.accent}
      help={any ? "Green = your call beat the desk on that scored, resolved sitting. Lower is better throughout. Where the desk keeps missing and you do not, your own call is pooled into its next-exam forecast — the weight below is what your record has earned, and it is capped." : undefined}
    >
      {any ? (
        <div>
          <VsRow label="YOUR MARK ERROR" you={elicit.self.youMae} model={elicit.self.modelMae} n={elicit.self.n} kind="DESK" hint="Mean absolute error of your point prediction vs the desk's, on the same sittings." derive={on("elicit.mae")} />
          <VsRow label="YOUR RANGE CRPS" you={elicit.self.youCrps} model={elicit.self.modelCrps} n={elicit.self.youCrps != null ? elicit.self.n : 0} kind="DESK" hint="Proper score of your stated 90% range vs the desk's predictive." derive={on("elicit.crps")} />
          <VsRow label="TEACHER ERROR" you={elicit.teacher.youMae} model={elicit.teacher.modelMae} n={elicit.teacher.n} kind="DESK" hint="Your teacher's predicted grade vs the desk, mean absolute error." derive={on("elicit.teacher")} />
          <VsRow label="AI ERROR" you={elicit.ai.youMae} model={elicit.ai.modelMae} n={elicit.ai.n} kind="DESK" hint="The wire's AI forecast vs the desk, mean absolute error on the same sittings." derive={on("elicit.ai")} />
          <VsRow label="CHIP BRIER" you={elicit.chips.youBrier} model={elicit.chips.modelBrier} n={elicit.chips.n} kind="DESK" hint="Quadratic score of your staked distribution vs the desk's, over the score bands." derive={on("elicit.brier")} />
          {elicit.self.coverage != null && (
            <div className="pt-2 text-[10px] uppercase tracking-wider" style={{ color: C.faint, fontFamily: FONT.mono }}>
              YOUR 90% RANGES CONTAINED THE MARK{" "}
              <Derived on={on("elicit.coverage")}><span style={{ color: C.dim }}>{pct0(elicit.self.coverage)}</span></Derived>{" "}
              OF THE TIME
            </div>
          )}
          <SelfWeightRow fit={selfFit} on={selfOn} onToggle={onSetSelfWeighting} derive={on("earn.self")} />
          {hasAiCalls && aiFit && onSetAiWeighting && (
            <AiWeightRow
              fit={aiFit}
              on={aiOn === true}
              charge={aiCharge}
              onToggle={onSetAiWeighting}
              derive={aiDctx ? { id: "earn.ai", ctx: aiDctx } : null}
            />
          )}
        </div>
      ) : (
        <p className="text-[11px] uppercase tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
          {hasSittings ? "Your calls score here once their sittings print a real mark." : "No calls yet — schedule a sitting below and predict its mark. Once it prints, your call is scored against the desk here."}
        </p>
      )}
    </Card>
  );
}
