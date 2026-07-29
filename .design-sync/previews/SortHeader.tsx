import { SortHeader } from "grade-exchange";

const desk = {
  background: "#0F131A",
  border: "1px solid #1F2733",
  padding: 16,
  color: "#DFE5EC",
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const table = { width: "100%", borderCollapse: "collapse" as const, fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

/* SortHeader renders a <th>: it is only ever true inside a table head. */

/** The active column takes amber and its direction caret; the rest stay faint. */
export const ScreenerHead = () => (
  <div style={desk}>
    <table style={table}>
      <thead>
        <tr>
          <SortHeader label="TICKER" sortKey="ticker" sort={{ key: "mark", dir: "desc" }} onSort={() => {}} align="left" />
          <SortHeader label="MARK" sortKey="mark" sort={{ key: "mark", dir: "desc" }} onSort={() => {}} />
          <SortHeader label="CHG" sortKey="chg" sort={{ key: "mark", dir: "desc" }} onSort={() => {}} />
          <SortHeader label="VOL" sortKey="vol" sort={{ key: "mark", dir: "desc" }} onSort={() => {}} />
        </tr>
      </thead>
      <tbody>
        {[
          ["MTH311", "88.0", "+2.4", "3.1"],
          ["PHY204", "74.5", "−3.1", "6.8"],
        ].map((r) => (
          <tr key={r[0]} style={{ borderBottom: "1px solid #1F2733" }}>
            <td style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, color: "#E8A33D" }}>{r[0]}</td>
            <td style={{ padding: "8px 10px", fontSize: 12, textAlign: "right", fontWeight: 700 }}>{r[1]}</td>
            <td style={{ padding: "8px 10px", fontSize: 12, textAlign: "right", color: r[2].startsWith("+") ? "#2FD980" : "#FF5449" }}>{r[2]}</td>
            <td style={{ padding: "8px 10px", fontSize: 12, textAlign: "right", color: "#97A1B2" }}>{r[3]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Ascending flips the caret; the column stays amber while it holds the sort. */
export const Ascending = () => (
  <div style={desk}>
    <table style={table}>
      <thead>
        <tr>
          <SortHeader label="TICKER" sortKey="ticker" sort={{ key: "ticker", dir: "asc" }} onSort={() => {}} align="left" />
          <SortHeader label="MARK" sortKey="mark" sort={{ key: "ticker", dir: "asc" }} onSort={() => {}} />
        </tr>
      </thead>
    </table>
  </div>
);
