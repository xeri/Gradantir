import { RegimeTag } from "grade-exchange";

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

/** The risk ladder: par is green, distress is red, the middle rides amber/grey. */
export const Ladder = () => (
  <div style={desk}>
    <RegimeTag regime="PRIME" />
    <RegimeTag regime="STABLE" />
    <RegimeTag regime="STRESSED" />
    <RegimeTag regime="DISTRESSED" />
  </div>
);

/** `size="lg"` for the drawer's risk line. */
export const Large = () => (
  <div style={desk}>
    <RegimeTag regime="PRIME" size="lg" />
    <RegimeTag regime="STRESSED" size="lg" />
  </div>
);

/** Beside a mark, which is where the drawer actually files it. */
export const WithMark = () => (
  <div style={{ ...desk, display: "block" }}>
    {[
      ["MTH311", "88.0", "PRIME"],
      ["PHY204", "74.5", "STRESSED"],
      ["CHM220", "61.2", "DISTRESSED"],
    ].map(([tk, mark, rg]) => (
      <div key={tk as string} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #1F2733" }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#E8A33D" }}>{tk}</span>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{mark}</span>
        <span style={{ marginLeft: "auto" }}>
          <RegimeTag regime={rg as "PRIME" | "STRESSED" | "DISTRESSED"} />
        </span>
      </div>
    ))}
  </div>
);
