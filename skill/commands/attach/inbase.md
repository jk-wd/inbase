---
description: Attach this chat to the next empty Inbase session, or stay if already attached
---

The user invoked `/inbase`. Attach to the next unlocked color. A regular chat does the same thing.

If this conversation already printed `VISUAL_CODER_SESSION`, stay. Do not attach. Treat a later request as a change request: `report-plan` from the last proposal, then implement.

```bash
npx inbase attach
```

If that fails with `VISUAL_CODER_NOT_RUNNING`, `VISUAL_CODER_ALL_COLORS_LOCKED`, or `VISUAL_CODER_COLOR_UNKNOWN`, reply with that message and stop.

`VISUAL_CODER_SESSION` is the color. Use `--session` with that color for every later command.

Continue the Inbase visual edits skill from `read-blueprint`. After it returns, reply `I see on the blueprint ...` then continue.

If this chat has no request text, after `read-blueprint`, if the global or this session's local blueprint is enabled, that is the request: create those files, folders, and symbols. Ask in chat if you need more information. Do not invent extra work. If both blueprints are empty, stop and wait for a request, `/explainit`, or `/stop`.
