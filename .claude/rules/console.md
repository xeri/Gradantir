---
description: The console surface — palette, density, and continuous input.
paths:
  - "src/components/**"
  - "src/views/**"
  - "src/App.tsx"
  - "src/theme.ts"
  - "src/index.css"
---

# The console

- Colour comes from `src/theme.ts` (`C`, `FONT`, `microLabel`). Never a literal
  hex — not in a component and **not in a test assertion**. The Console retint
  broke `SpiderAllocator.test.tsx` in exactly that way; assert `C.brand`.
- Sharp corners. No border-radius, no transforms. Dividers are a 1px grid `gap`
  painted `C.gap`, not a `border-right` between siblings.
- `App` serialises the whole book on every `data` change. Anything continuous — a
  drag, a slider, the spider allocator — holds a local draft and commits once on
  interaction end, or every mouse-move writes localStorage.
- Views read `SubjectStat`. If the number you need is not on it, add it in
  `src/lib/`, not in the component.
- Heavy work (the skill backtest, the register replay) is deferred past first
  paint. Keep it that way; never block a render on the engine.
- Every control answers: a distinct hover, active and disabled state, and visible
  feedback that the click landed. A control that looks the same before and after
  reads as broken, and an expensive one is opt-in rather than automatic.
- Any figure a user might question gets a derivation id, so the popover can show
  the working. A number with no explanation is the thing this product exists to
  replace.
- `.design-sync/conventions.md` documents the pre-Console palette and is stale.
  `src/theme.ts` wins.
