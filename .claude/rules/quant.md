---
description: The calculation layer — determinism, the gate, and the trace.
paths:
  - "src/lib/quant/**"
  - "src/lib/derive/**"
  - "src/lib/stats.ts"
---

# The engine

- `asOf` is a parameter, never a clock read, and every fit is walk-forward:
  refit on strictly-earlier prints with the cross-subject pool rebuilt as-of, or
  a desk borrows strength from results that had not happened yet.
- `npm run gate` must stay green **and unmoved**. A gate number that moves in a
  change you believed was neutral means the change leaked somewhere; stop and
  find out where before touching `baseline.json`.
- CRPS (and pinball) is the objective. MAE is reported and is never the gate — it
  rewards overconfidence, and calibration is the deliverable.
- Ship nothing the ablation cannot defend: every ensemble member and every
  premium must beat its own absence out-of-sample or it is dead weight.
- Modules hand their intermediates out through `trace.ts`; `src/lib/derive/**`
  **quotes** the trace and never recomputes. A derivation that recomputes can
  disagree with the board it is explaining.
- `derive/cite.ts` is authored data, not computed. A wrong entry is wrong forever
  and silently — verify against the record before adding one.
- A new numeric parameter goes in `params.ts` beside its siblings, with its
  justification written in the surrounding style.
- Leave the engine with a candidate. README §23 lists what is known to be weak
  and `docs/ideas.md` holds the queue — add to it whenever you touch a module and
  see something the model could read, blend, or stop paying for.
