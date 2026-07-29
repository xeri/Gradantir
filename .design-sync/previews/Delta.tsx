import { Delta } from "grade-exchange";

const desk = {
  background: "#0F131A",
  border: "1px solid #1F2733",
  padding: 16,
  color: "#DFE5EC",
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  display: "flex",
  alignItems: "center",
  gap: 20,
  flexWrap: "wrap" as const,
};
const micro = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: "#7A8497",
};

/** Sign drives the colour: green up, red down, grey flat. */
export const Direction = () => (
  <div style={desk}>
    <Delta v={2.4} />
    <Delta v={-3.1} />
    <Delta v={0} />
  </div>
);

/** `size="lg"` is the headline readout beside a mark. */
export const Sizes = () => (
  <div style={desk}>
    <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>87.4</span>
      <Delta v={2.4} size="lg" />
    </span>
    <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 14, fontWeight: 700 }}>74.5</span>
      <Delta v={-1.2} size="sm" />
    </span>
  </div>
);

/** A null move is a desk with no prior print — `nullText` names why. */
export const NoPrior = () => (
  <div style={desk}>
    <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>82.0</span>
      <Delta v={null} size="lg" nullText="NEW" />
    </span>
    <Delta v={null} />
  </div>
);

/** How it reads in a row of desks. */
export const InRow = () => (
  <div style={{ ...desk, display: "block" }}>
    {[
      ["MTH311", "88.0", 2.4],
      ["PHY204", "74.5", -3.1],
      ["ENG150", "81.0", 0.4],
    ].map(([t, p, d]) => (
      <div
        key={t as string}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1F2733" }}
      >
        <span style={{ ...micro, color: "#E8A33D" }}>{t}</span>
        <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{p}</span>
          <Delta v={d as number} />
        </span>
      </div>
    ))}
  </div>
);
