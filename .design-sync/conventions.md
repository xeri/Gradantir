# Grade Exchange — a trading-terminal UI kit

A dark, Bloomberg-adjacent "risk desk" aesthetic: near-black surfaces, hairline
borders, **sharp corners (no border-radius)**, IBM Plex Mono for data and
Archivo for display. Amber is the machine's identity color; green/red are
reserved for gains/losses; cyan for forecasts and interactive states.

## Setup — no provider, just load and go on a dark surface

There is **no theme provider or React context** — every component is
self-styled. Load the two files once (React must already be on the page), then
render into a **dark container**, because the components are designed to sit on
near-black chrome, not white:

```jsx
// <link rel="stylesheet" href="styles.css">  ·  <script src="_ds_bundle.js"></script>
const { Panel, Delta, Btn } = window.GradeExchange;
<div style={{ background: "var(--gx-bg)", color: "var(--gx-text)", padding: 16, minHeight: "100vh" }}>
  <Panel title="MATH · MTH311">
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 28, color: "var(--gx-text)" }}>87.4</span>
      <Delta v={2.3} size="lg" />
    </div>
    <div style={{ marginTop: 12 }}>
      <Btn variant="primary">LOG RESULT</Btn>
    </div>
  </Panel>
</div>
```

## Styling idiom — vary by PROPS, not classes

Components carry their own look. You choose appearance through **props**, never
by adding CSS classes: `Btn variant="primary"|"ghost"|"danger"`,
`Delta size`, `Toggle on`, `Modal wide`, `TypeBadge type`, `Panel title/right`,
`RatingBadge rating/short/size`, `RegimeTag regime`, `DelistedTag closedAt`.
Don't wrap them in utility classes to restyle — that fights the baked-in theme.

**Non-component exports** ship alongside, because the components are unusable
without them:
- `inputCls` + `inputStyle` — the class string and style object for a raw
  `<input>`/`<select>` inside a `Field`. Always use both; an unstyled input on
  a near-black panel renders browser-default white.
- `RATING_COLOR` / `RATING_SHORT` (by `Rating`), `REGIME_COLOR` (by `Regime`) —
  which hue means which call. Use these to colour a ticker or row by rating or
  regime instead of picking a hex.
- `DELISTED_STYLE` — the dim/desaturate treatment for a closed desk's whole row.

For **your own layout glue** around the components, style with **inline styles
using the palette below**. Important: `styles.css` is a JIT-compiled Tailwind
build, so only the utility classes this app already used are present — do **not**
assume arbitrary Tailwind utilities (`grid-cols-3`, `gap-8`, …) exist. The
`var(--gx-*)` custom properties and the fixed hex values below are always safe.

**Palette** (six are live CSS variables; the rest are fixed DS hex):
- Surfaces: `var(--gx-bg)` #0A0D12 · `var(--gx-panel)` #0F131A · panel-2 #141A23 · `var(--gx-line)` #1F2733 · bright line #2C3748 · strip #05070A
- Text: `var(--gx-text)` #DFE5EC · `var(--gx-dim)` #97A1B2 · faint #7A8497
- Semantic: `var(--gx-amber)` #E8A33D (chrome/identity/active) · gain #2FD980 · loss #FF5449 · forecast/cyan #53B1FD

**Type:** IBM Plex Mono for numbers, tickers, and micro-labels (the house style
is tiny UPPERCASE with ~0.14em letter-spacing); Archivo for display headings.

## Where the truth lives

- `styles.css` — the single stylesheet entry; `@import`s the fonts and
  `_ds_bundle.css`. Link this one file.
- `_ds_bundle.css` — declares the `--gx-*` tokens and the `@font-face` rules.
- `components/<group>/<Name>/<Name>.prompt.md` (usage + JSDoc) and `<Name>.d.ts`
  (the exact prop contract). Read these before composing a component.
