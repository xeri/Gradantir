import { DelistedTag, DELISTED_STYLE } from "grade-exchange";

const desk = {
  background: "#0F131A",
  border: "1px solid #1F2733",
  padding: 16,
  color: "#DFE5EC",
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap" as const,
};

/** The stamp, dated and undated. A closed desk leaves the live palette entirely. */
export const Stamp = () => (
  <div style={desk}>
    <DelistedTag closedAt="2025-11-14" />
    <DelistedTag />
    <DelistedTag closedAt="2025-11-14" size="lg" />
  </div>
);

/**
 * The row treatment: `DELISTED_STYLE` dims and desaturates the whole row, and
 * the ticker takes a strike-through. The marks stay readable on purpose — a
 * closed desk still carries real results.
 */
export const ClosedRow = () => (
  <div style={{ ...desk, display: "block" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #1F2733" }}>
      <span style={{ width: 8, height: 8, background: "#E8A33D" }} />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#E8A33D" }}>MTH311</span>
      <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 13 }}>88.0</span>
    </div>
    <div style={{ ...DELISTED_STYLE, display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px dashed #2C3748" }}>
      <span style={{ width: 8, height: 8, background: "#7A8497" }} />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#97A1B2", textDecoration: "line-through" }}>LAT101</span>
      <DelistedTag closedAt="2025-11-14" />
      <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 13 }}>79.5</span>
    </div>
  </div>
);
