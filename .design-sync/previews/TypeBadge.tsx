import { TypeBadge } from "grade-exchange";

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

/** The four assessment types — Exam is the only filled chip. */
export const AllTypes = () => (
  <div style={desk}>
    <TypeBadge type="Exam" />
    <TypeBadge type="Test" />
    <TypeBadge type="Assignment" />
    <TypeBadge type="Quiz" />
  </div>
);

/** As the blotter files it: chip, then the result's own title. */
export const InBlotter = () => (
  <div style={{ ...desk, display: "block" }}>
    {[
      ["Exam", "Term 1 examination"],
      ["Test", "Calculus — differentiation"],
      ["Assignment", "Statistics portfolio"],
    ].map(([t, title]) => (
      <div key={title as string} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #1F2733" }}>
        <TypeBadge type={t as "Exam" | "Test" | "Assignment"} />
        <span style={{ fontSize: 11, color: "#97A1B2" }}>{title}</span>
        <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 12 }}>
          {t === "Exam" ? "88.0" : t === "Test" ? "76.5" : "91.0"}%
        </span>
      </div>
    ))}
  </div>
);
