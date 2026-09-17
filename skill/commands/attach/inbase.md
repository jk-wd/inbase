---
description: Attach this chat to the next empty Inbase session, or stay if already attached
---

The user invoked `/inbase`. Attach to the next unlocked color. A regular chat does the same thing.

If this conversation already printed `VISUAL_CODER_SESSION`, stay. Do not attach. Treat a later request as a change request: MUST `report-plan` from the last proposal first, then implement. Never edit before `report-plan`.

```bash
npx inbase attach
```

If that fails with `VISUAL_CODER_NOT_RUNNING`, `VISUAL_CODER_ALL_COLORS_LOCKED`, or `VISUAL_CODER_COLOR_UNKNOWN`, reply with that message and stop.

`VISUAL_CODER_SESSION` is the color. Use `--session` with that color for every later command.

Continue the Inbase visual edits skill from `read-blueprint`. After it returns, reply `I see on the blueprint ...`. Then MUST `report-plan`. Only after that command invokes the first step, implement that step only. After each step's edits, MUST `propose-patch` before the next step. Never implement the whole plan first. Never edit before `report-plan`.

If this chat has no request text, after `read-blueprint`, if the global or this session's local blueprint is enabled, that is the request: MUST `report-plan` for those files, folders, and symbols first, then implement. Ask in chat if you need more information. Do not invent extra work. Do not edit before `report-plan`. If both blueprints are empty, stop and wait for a request, `/explainit`, or `/stop`.
