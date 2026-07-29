import { Toggle } from "grade-exchange";

const desk = {
  background: "#0F131A",
  border: "1px solid #1F2733",
  padding: 16,
  color: "#DFE5EC",
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  display: "flex",
  alignItems: "center",
  gap: 14,
  flexWrap: "wrap" as const,
};

/** On is a filled [■]; off is an empty [ ]. No switch chrome — this is a terminal. */
export const States = () => (
  <div style={desk}>
    <Toggle on onClick={() => {}}>Weighted</Toggle>
    <Toggle on={false} onClick={() => {}}>Weighted</Toggle>
  </div>
);

/** The chart's own control strip. */
export const ChartControls = () => (
  <div style={desk}>
    <Toggle on onClick={() => {}}>Class</Toggle>
    <Toggle on={false} onClick={() => {}}>0–100</Toggle>
    <Toggle on={false} onClick={() => {}}>Forecast</Toggle>
  </div>
);

/** Stacked, as the log-result modal files its flags. */
export const Stacked = () => (
  <div style={{ ...desk, display: "grid", gap: 8, justifyItems: "start" }}>
    <Toggle on={false} onClick={() => {}}>Ceiling / floor</Toggle>
    <Toggle on onClick={() => {}}>Regime break</Toggle>
  </div>
);
