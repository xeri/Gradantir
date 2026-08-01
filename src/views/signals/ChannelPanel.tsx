import { C, FONT, microLabel } from "../../theme";
import { SIGNAL_A_MAX, SIGNAL_A_MIN, SIGNAL_CHANNEL_MIN_ROUNDS } from "../../lib/quant/params";
import type { ChannelRow, SignalChannelFit } from "../../lib/quant/signals/channels";
import type { SignalTermKey } from "../../lib/quant/signals/signalread";

/**
 * The channel scoreboard (audit Part I §2.5) — one row per signal channel:
 * what it has been measured to be worth against what it was authored to be
 * worth, over how many rounds, and what the book would pay to drop it.
 *
 * This is the deliverable that makes the layer ACT rather than assert. The
 * seven terms used to share one earned weight, so a student could not tell
 * whether mastery was carrying the layer while chronotype was noise, and got
 * no benefit if it was. Telling them which of their own logging habits
 * actually predicts is the only honest basis for asking them to keep logging
 * it.
 *
 * ×EARNED is a RELATIVE number by construction (§2.3): `w · a_k` is a product
 * and only the product is identified from one student's book, so the
 * multipliers are normalised to mean 1 over the measured channels and the
 * absolute size lives in the earned weight above. "MASTERY pulls 1.8× what it
 * was authored to" is a claim about mastery VERSUS the other measured
 * channels, and the footer says so.
 *
 * A pure window onto `fitSignalChannels`' own rows, the same split
 * `MasteryPanel`/`VoiPanel` hold: nothing here re-derives, re-rounds or
 * re-orders what the fit already decided.
 */

const LABEL: Record<SignalTermKey, string> = {
  stock: "STUDY STOCK",
  mastery: "TOPIC MASTERY",
  rest: "REST",
  disruption: "DISRUPTION",
  anxiety: "ANXIETY",
  chronotype: "CHRONOTYPE",
  attendance: "ATTENDANCE",
};

const VERDICT_TONE: Record<ChannelRow["verdict"], string> = {
  CARRIES: C.up,
  COSTS: C.down,
  NEUTRAL: C.faint,
  UNMEASURED: C.faint,
};

const fmtDelta = (v: number | null): string => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`);

export function ChannelPanel({ fit }: { fit: SignalChannelFit }) {
  const measured = fit.rows.filter((r) => r.verdict !== "UNMEASURED").length;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              <th className="px-2.5 py-2 text-left" style={{ ...microLabel, color: C.faint }}>CHANNEL</th>
              <th className="px-2.5 py-2 text-right" style={{ ...microLabel, color: C.faint }}>ROUNDS</th>
              <th className="px-2.5 py-2 text-right" style={{ ...microLabel, color: C.faint }}>×EARNED</th>
              <th className="px-2.5 py-2 text-right" style={{ ...microLabel, color: C.faint }}>ΔCRPS IF DROPPED</th>
              <th className="px-2.5 py-2 text-right" style={{ ...microLabel, color: C.faint }}>VERDICT</th>
            </tr>
          </thead>
          <tbody>
            {fit.rows.map((r) => (
              <tr key={r.key} className="border-b last:border-0" style={{ borderColor: C.line }}>
                <td className="px-2.5 py-2 text-xs tracking-wider" style={{ fontFamily: FONT.mono, color: C.text }}>
                  {LABEL[r.key]}
                </td>
                <td className="px-2.5 py-2 text-right text-xs tabular-nums" style={{ fontFamily: FONT.mono, color: C.faint }}>
                  {r.n}
                </td>
                <td
                  className="px-2.5 py-2 text-right text-xs font-bold tabular-nums"
                  style={{ fontFamily: FONT.mono, color: r.verdict === "UNMEASURED" ? C.faint : r.a >= 1 ? C.up : C.down }}
                >
                  ×{r.a.toFixed(2)}
                </td>
                <td className="px-2.5 py-2 text-right text-xs tabular-nums" style={{ fontFamily: FONT.mono, color: C.faint }}>
                  {fmtDelta(r.dCrps)}
                </td>
                <td className="px-2.5 py-2 text-right text-xs" style={{ ...microLabel, color: VERDICT_TONE[r.verdict] }}>
                  {r.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 border-t text-[10px] tracking-wider leading-relaxed" style={{ borderColor: C.line, color: C.faint, fontFamily: FONT.mono }}>
        {measured === 0 ? (
          <>
            NO ROUND HAS SCORED A LIVE SIGNAL READ YET, SO EVERY CHANNEL PULLS EXACTLY THE WEIGHT IT WAS AUTHORED WITH.
            A CHANNEL IS MEASURED ONCE IT HAS FIRED IN {SIGNAL_CHANNEL_MIN_ROUNDS} SCORED ROUNDS.
          </>
        ) : (
          <>
            ×EARNED IS RELATIVE, NOT ABSOLUTE: THE MULTIPLIERS ARE NORMALISED TO AVERAGE 1 ACROSS THE MEASURED
            CHANNELS, SO ×1.80 MEANS "PULLS 1.8× WHAT IT WAS AUTHORED TO, AGAINST THE OTHER MEASURED CHANNELS" —
            THE LAYER'S ABSOLUTE SIZE IS THE EARNED WEIGHT ABOVE. CLAMPED TO ×{SIGNAL_A_MIN.toFixed(2)}–×
            {SIGNAL_A_MAX.toFixed(2)} AND SHRUNK TOWARD ×1.00 UNTIL A CHANNEL'S OWN RECORD SAYS OTHERWISE.
            ΔCRPS IS WHAT THIS BOOK'S WALK-FORWARD SCORE WOULD PAY TO DROP THE CHANNEL — POSITIVE MEANS IT IS
            CARRYING ITS SEAT.
          </>
        )}
      </p>
      <p className="px-3 pb-2 text-[10px] tracking-wider leading-relaxed" style={{ color: C.faint, fontFamily: FONT.mono }}>
        CHRONOTYPE CANNOT BE MEASURED FROM THIS BOOK: A RESOLVED SITTING'S HOUR IS NOT RECORDED ANYWHERE, SO THE
        CHANNEL NEVER FIRES IN THE REPLAY AND KEEPS ITS AUTHORED WEIGHT. THAT IS A DATA-MODEL LIMIT, STATED RATHER
        THAN LEFT TO BE WONDERED ABOUT.
      </p>
    </div>
  );
}
