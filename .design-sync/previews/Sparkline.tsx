import { Sparkline } from "grade-exchange";

const desk = {
  background: "#0F131A",
  border: "1px solid #1F2733",
  padding: 16,
  color: "#DFE5EC",
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const micro = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: "#7A8497",
};

const RUN = [71, 68, 74, 79, 77, 83, 81, 86, 88];
const DATES = ["12 Feb", "26 Feb", "07 Mar", "14 Mar", "21 Mar", "04 Apr", "18 Apr", "02 May", "16 May"];

/** The default line — last 14 prints, area fill under the stroke, last point marked. */
export const Standard = () => (
  <div style={desk}>
    <Sparkline scores={RUN} color="#E8A33D" labels={DATES} />
  </div>
);

/** Colour is the subject's own; the line carries no semantic hue of its own. */
export const SubjectColours = () => (
  <div style={{ ...desk, display: "grid", gap: 12 }}>
    {[
      ["MTH311", "#53B1FD", RUN],
      ["PHY204", "#2FD980", [80, 77, 81, 75, 72, 74, 70, 68, 71]],
      ["CHM220", "#FF5449", [66, 70, 64, 61, 63, 58, 60, 55, 57]],
    ].map(([tk, c, s]) => (
      <div key={tk as string} style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ ...micro, color: c as string, width: 68 }}>{tk}</span>
        <Sparkline scores={s as number[]} color={c as string} labels={DATES} />
      </div>
    ))}
  </div>
);

/** Sized up for the subject card, where it carries the whole run. */
export const Tall = () => (
  <div style={desk}>
    <div style={{ ...micro, marginBottom: 6 }}>MTH311 · LAST 9 PRINTS</div>
    <Sparkline scores={RUN} color="#E8A33D" w={280} h={64} labels={DATES} />
  </div>
);

/** Under two points there is no line to draw, so it says so rather than drawing noise. */
export const TooFewPoints = () => (
  <div style={desk}>
    <Sparkline scores={[82]} color="#E8A33D" />
  </div>
);
