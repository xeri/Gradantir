import { Sel, Field } from "grade-exchange";

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

/** The standalone select — uppercase mono options, sharp corners. */
export const Standard = () => (
  <div style={desk}>
    <Sel
      ariaLabel="Filter by subject"
      value="all"
      onChange={() => {}}
      options={[
        { value: "all", label: "ALL SUBJECTS" },
        { value: "mth", label: "MTH311" },
        { value: "phy", label: "PHY204" },
      ]}
    />
  </div>
);

/** The blotter's filter row: two Sels and a right-aligned count. */
export const FilterRow = () => (
  <div style={{ ...desk, gap: 8 }}>
    <Sel
      ariaLabel="Filter by subject"
      value="all"
      onChange={() => {}}
      options={[{ value: "all", label: "ALL SUBJECTS" }, { value: "mth", label: "MTH311" }]}
    />
    <Sel
      ariaLabel="Filter by type"
      value="exams"
      onChange={() => {}}
      options={[{ value: "all", label: "ALL TYPES" }, { value: "exams", label: "EXAMS" }]}
    />
    <span style={{ marginLeft: "auto", fontSize: 10, letterSpacing: "0.14em", color: "#7A8497" }}>18 ENTRIES</span>
  </div>
);

/** Inside a Field when the control needs a visible label. */
export const Labelled = () => (
  <div style={{ ...desk, display: "block" }}>
    <Field label="GROUP RESULTS BY">
      <Sel
        value="term"
        onChange={() => {}}
        options={[
          { value: "term", label: "TERM" },
          { value: "year", label: "YEAR" },
        ]}
      />
    </Field>
  </div>
);
