import { Panel, Delta, Sel } from "grade-exchange";

const desk = {
  background: "#0A0D12",
  padding: 16,
  color: "#DFE5EC",
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const micro = {
  ...mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "#7A8497",
};

/** The standard panel: amber header strip, hairline border, padded body. */
export const Standard = () => (
  <div style={desk}>
    <Panel title="INDEX">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ ...mono, fontSize: 28, fontWeight: 700, lineHeight: 1 }}>78.4</span>
        <Delta v={1.8} size="lg" />
      </div>
      <div style={{ ...micro, marginTop: 8 }}>6 desks · 41 prints</div>
    </Panel>
  </div>
);

/** `right` parks a control in the header strip, opposite the title. */
export const WithRight = () => (
  <div style={desk}>
    <Panel
      title="BLOTTER"
      right={
        <Sel
          ariaLabel="Filter by subject"
          value="all"
          onChange={() => {}}
          options={[
            { value: "all", label: "ALL SUBJECTS" },
            { value: "mth", label: "MTH311" },
          ]}
        />
      }
    >
      <div style={micro}>18 entries</div>
    </Panel>
  </div>
);

/** `pad={false}` for tables that own their own cell padding. */
export const Flush = () => (
  <div style={desk}>
    <Panel title="RECENT PRINTS" pad={false}>
      <table style={{ ...mono, width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
        <tbody>
          {[
            ["14 MAR", "MTH311", "88.0"],
            ["02 MAR", "PHY204", "74.5"],
            ["25 FEB", "ENG150", "81.0"],
          ].map(([d, t, s]) => (
            <tr key={d} style={{ borderBottom: "1px solid #1F2733" }}>
              <td style={{ padding: "8px 12px", color: "#7A8497" }}>{d}</td>
              <td style={{ padding: "8px 12px", color: "#E8A33D", fontWeight: 700 }}>{t}</td>
              <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>{s}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  </div>
);

/** No title — a bare bordered surface for chart wells and empty states. */
export const Bare = () => (
  <div style={desk}>
    <Panel>
      <div style={micro}>No results filed for this period.</div>
    </Panel>
  </div>
);
