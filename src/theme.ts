/**
 * "The risk desk" — Bloomberg-adjacent terminal chrome.
 * Amber is the machine's identity color (headers, active states, the wordmark);
 * green/red are reserved for gains/losses, cyan for forecasts and interaction.
 * Everything else is grayscale on near-black. Corners stay sharp.
 */
export const C = {
  bg: "#0A0D12",
  panel: "#0F131A",
  panel2: "#141A23",
  line: "#1F2733",
  lineBright: "#2C3748",
  text: "#DFE5EC",
  dim: "#97A1B2",
  faint: "#5C6779",
  /** Chrome + warnings — the terminal's signature color. */
  amber: "#E8A33D",
  up: "#2FD980",
  down: "#FF5449",
  /** Forecasts, links, focus — interactive cyan. */
  accent: "#53B1FD",
  /** The tape + status bar strips, darker than the page. */
  strip: "#05070A",
};

export const FONT = {
  mono: "'IBM Plex Mono', ui-monospace, 'Cascadia Mono', monospace",
  display: "'Archivo', system-ui, sans-serif",
};

/** Tiny uppercase tracking label — the standard panel/section header text style. */
export const microLabel = {
  fontFamily: FONT.mono,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
} as const;
