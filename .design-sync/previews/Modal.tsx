import { Modal, Field, Btn, Toggle, inputCls, inputStyle } from "grade-exchange";

/*
 * Modal is `position: fixed; inset: 0` — it owns the whole viewport, overlay
 * included. So this card renders one open dialog at a fixed viewport
 * (cfg.overrides.Modal), which is the only state of a dialog worth showing.
 */

const grid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };

/** The log-result dialog, open, exactly as the app files a print. */
export const LogResult = () => (
  <div style={{ position: "relative", minHeight: 400, background: "#0A0D12" }}>
    <Modal title="LOG A RESULT" onClose={() => {}}>
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
        <div style={{ display: "flex", gap: 14 }}>
          <Toggle on={false} onClick={() => {}}>Ceiling / floor</Toggle>
          <Toggle on onClick={() => {}}>Regime break</Toggle>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Btn onClick={() => {}}>Cancel</Btn>
          <Btn variant="primary" onClick={() => {}}>File result</Btn>
        </div>
      </div>
    </Modal>
  </div>
);
