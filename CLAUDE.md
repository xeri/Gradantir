# CLAUDE.md

@AGENTS.md

Claude-specific routing. The shared brief is `AGENTS.md`, imported above.

- Path-scoped rules live in `.claude/rules/` (`quant`, `console`, `data`) and
  apply when you touch matching files. They are not repeated here.
- `.claude/settings.json` holds the real guardrails: the generated fixture and
  the private book are permission-denied, a purity check runs on `src/lib/**`
  writes, and a background typecheck runs when the turn ends. If a hook fires
  wrongly, fix or delete the hook — never route around it.
- A session-start hook injects the `docs/board.md` digest — live workstreams,
  overlapping path claims, plans on disk with no board row, open loose ends, and
  the `docs/ideas.md` count. Treat it as the standing agenda, and fix the drift
  it reports rather than ignoring it.
- `docs/agent-notes.md` is the mutable half: what is currently red, what is
  mid-flight, which docs have gone stale. Read it before debugging a failing
  test you did not cause.
- Keep this file under ~25 lines and `AGENTS.md` under ~115. Delete any rule that
  stops being true — a stale instruction is worse than none, because it still
  gets followed.
