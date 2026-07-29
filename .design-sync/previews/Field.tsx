import { Field, inputCls, inputStyle } from "grade-exchange";

const desk = {
  background: "#0F131A",
  border: "1px solid #1F2733",
  padding: 16,
  color: "#DFE5EC",
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const grid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };

/** The log-result form, as the app files it: micro-label over a mono control. */
export const LogResult = () => (
  <div style={desk}>
    <div style={{ display: "grid", gap: 16 }}>
      <div style={grid}>
        <Field label="SUBJECT">
          <select className={inputCls + " cursor-pointer font-semibold"} style={inputStyle} defaultValue="mth">
            <option value="mth">Mathematics</option>
            <option value="phy">Physics</option>
          </select>
        </Field>
        <Field label="TYPE">
          <select className={inputCls + " cursor-pointer font-semibold"} style={inputStyle} defaultValue="Exam">
            <option>Exam</option>
            <option>Test</option>
          </select>
        </Field>
      </div>
      <div style={grid}>
        <Field label="SCORE %">
          <input className={inputCls} style={inputStyle} type="number" defaultValue="82.5" />
        </Field>
        <Field label="DATE">
          <input className={inputCls} style={inputStyle} type="date" defaultValue="2026-03-14" />
        </Field>
      </div>
    </div>
  </div>
);

/** A single field — the label is always tiny, uppercase and widely tracked. */
export const Single = () => (
  <div style={desk}>
    <Field label="TARGET %">
      <input className={inputCls} style={inputStyle} type="number" defaultValue="90" />
    </Field>
  </div>
);

/** Placeholder text recedes to the faint grey; the value sits at full text. */
export const Empty = () => (
  <div style={desk}>
    <Field label="COURSEWORK % OF FINAL">
      <input className={inputCls} style={inputStyle} placeholder="e.g. 40" />
    </Field>
  </div>
);
