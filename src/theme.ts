/**
 * "The risk desk" — the Gradantir Console palette.
 *
 * Electric blue is the machine's identity color (chrome, active states, the
 * wordmark, the one filled button). Risk deliberately does NOT use the retail
 * green/red convention: the scale runs blue (good) → grey (flat) → rust (bad),
 * which is what makes the board read as a risk desk rather than a brokerage
 * app. Everything else is grayscale on near-black, and corners stay sharp — the
 * console has no border radius and no transforms anywhere.
 *
 * Key names are historical. `amber` no longer holds amber; it holds the brand
 * hue, and every consumer already reads it as "the machine's signature color".
 * Prefer the `brand` alias in new code — renaming the key across its call sites
 * is a mechanical change worth doing on its own, not folded into a retint.
 */
const BRAND = "#2244FF";

export const C = {
  bg: "#0A0C10",
  panel: "#090B0E",
  panel2: "#0E1218",
  line: "#171A20",
  lineBright: "#3A4658",
  text: "#E2E4E8",
  dim: "#9CA1A9",
  /* The most-used text colour on the board — field labels, axis ticks,
     footnotes, the whole derivation panel. This tier has to clear 4.5:1 on
     `panel` at 10px everywhere it appears, and does. */
  faint: "#686E77",
  /** Chrome, active states, the one filled action. Historical key — see above. */
  amber: BRAND,
  /** Preferred name for the same value. */
  brand: BRAND,
  /** Brand at reading weight: links, live labels, section rules, the cursor. */
  brandBright: "#7C93FF",
  /** Gain / positive delta / positive z. Blue, never green. */
  up: "#8296D9",
  /** Loss, mild tier. `downHard` is the severe tier (delta < -3, breaches). */
  down: "#A5766F",
  downHard: "#D96A5F",
  /** Forecasts, links, focus, goal reference lines — interactive sky. */
  accent: "#53B1FD",
  /** The tape + status bar strips, darker than the page. */
  strip: "#05070A",
  /** The 1px grid gap that draws every panel divider in the console shell. */
  gap: "#14171E",
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
