import { C, FONT } from "../../theme";

/** Signed change readout: ▲ green, ▼ red, · flat. */
export function Delta({ v, size = "sm", nullText = "—" }: { v: number | null; size?: "sm" | "lg"; nullText?: string }) {
  if (v == null) {
    return (
      <span className="text-[11px]" style={{ color: C.faint, fontFamily: FONT.mono }}>
        {nullText}
      </span>
    );
  }
  const up = v > 0.05;
  const down = v < -0.05;
  const color = up ? C.up : down ? C.down : C.faint;
  return (
    <span
      className={`inline-flex items-baseline gap-1 font-semibold ${size === "lg" ? "text-sm" : "text-xs"}`}
      style={{ color, fontFamily: FONT.mono }}
    >
      <span aria-hidden="true" className="text-[0.8em]">{up ? "▲" : down ? "▼" : "·"}</span>
      {up ? "+" : ""}
      {v.toFixed(1)}
    </span>
  );
}
