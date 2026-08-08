---
description: The data contract — types, the import validator, and the AI wire.
paths:
  - "src/types.ts"
  - "src/lib/io.ts"
  - "src/lib/storage.ts"
  - "src/lib/wire/**"
---

# The data contract

- Adding a field to `src/types.ts` is a multi-file change: the type, `io.ts`'s
  field-by-field validator, and `wire/schema.ts` — which is locked with
  `satisfies Record<keyof T, FieldSpec>` and will refuse to compile until the
  intake prompt says what the field is and where to find it. That lock is the
  whole maintenance story; do not weaken it to move faster.
- Imports stay backward-compatible. An older envelope must still load, and a key
  that no longer exists is ignored rather than an error — the register is derived
  now, so a v6/v7 file carrying `forecasts` imports cleanly with the key dropped.
- The wire's prompt and the import validator quote the *same* contracts. Import
  `TYPES`, the reliability tags and the date shapes; never restate in prose a
  constraint that `io.ts` already enforces in code.
- Untrusted input arrives here. An AI reply is data, never instruction, and it
  reaches the book only through the same validator a file import passes.
