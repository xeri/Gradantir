// design-sync barrel — the public API surface synced to Claude Design.
// Re-exports ONLY the reusable UI primitives from src/components/ui/ so the
// esbuild IIFE never pulls in the app shell (main.tsx mounts on load) or the
// heavy views (recharts). The components themselves are the real, unmodified
// source — this file only chooses what to expose.
export { Btn } from "../src/components/ui/Btn";
// The colour maps ride along with their badges: they encode which hue means
// which call/regime, which is design language the agent cannot infer.
export { DelistedTag, DELISTED_STYLE } from "../src/components/ui/DelistedTag";
export { Delta } from "../src/components/ui/Delta";
// inputCls/inputStyle ship with Field: a raw <input> inside a Field is the
// app's own idiom, and without these the control renders browser-default on a
// near-black panel. Lowercase, so component discovery ignores them.
export { Field, Sel, inputCls, inputStyle } from "../src/components/ui/Field";
export { Modal } from "../src/components/ui/Modal";
export { Panel } from "../src/components/ui/Panel";
export { RatingBadge, RATING_COLOR, RATING_SHORT } from "../src/components/ui/RatingBadge";
export { RegimeTag, REGIME_COLOR } from "../src/components/ui/RegimeTag";
export { SortHeader } from "../src/components/ui/SortHeader";
export { Sparkline } from "../src/components/ui/Sparkline";
export { Toggle } from "../src/components/ui/Toggle";
export { TypeBadge } from "../src/components/ui/TypeBadge";
