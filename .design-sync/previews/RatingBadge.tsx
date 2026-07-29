import { RatingBadge } from "grade-exchange";

const desk = {
  background: "#0F131A",
  border: "1px solid #1F2733",
  padding: 16,
  color: "#DFE5EC",
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap" as const,
};

/** The consensus scale: conviction saturates, HOLD stays grey, N/A recedes. */
export const Scale = () => (
  <div style={desk}>
    <RatingBadge rating="STRONG BUY" />
    <RatingBadge rating="BUY" />
    <RatingBadge rating="HOLD" />
    <RatingBadge rating="SELL" />
    <RatingBadge rating="STRONG SELL" />
    <RatingBadge rating="N/A" />
  </div>
);

/** `short` for the tape and tight table cells. */
export const Short = () => (
  <div style={desk}>
    <RatingBadge rating="STRONG BUY" short />
    <RatingBadge rating="BUY" short />
    <RatingBadge rating="HOLD" short />
    <RatingBadge rating="STRONG SELL" short />
  </div>
);

/** `size="lg"` is the drawer header stamp. */
export const Large = () => (
  <div style={desk}>
    <RatingBadge rating="STRONG BUY" size="lg" />
    <RatingBadge rating="HOLD" size="lg" />
    <RatingBadge rating="SELL" size="lg" />
  </div>
);

/** On a subject card: ticker left, the call parked right of the name. */
export const OnCard = () => (
  <div style={{ ...desk, display: "block" }}>
    {[
      ["MTH311", "Mathematics", "STRONG BUY"],
      ["PHY204", "Physics", "HOLD"],
      ["ENG150", "English", "SELL"],
    ].map(([tk, name, r]) => (
      <div key={tk as string} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #1F2733" }}>
        <span style={{ width: 8, height: 8, background: "#E8A33D" }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#E8A33D" }}>{tk}</span>
        <span style={{ fontSize: 11, color: "#7A8497", textTransform: "uppercase" }}>{name}</span>
        <span style={{ marginLeft: "auto" }}>
          <RatingBadge rating={r as "STRONG BUY" | "HOLD" | "SELL"} short />
        </span>
      </div>
    ))}
  </div>
);
