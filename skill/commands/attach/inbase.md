---
description: Attach this chat to the next empty Inbase session, or stay if already attached
---

The user invoked `/inbase`. Attach to the next unlocked color.

If this conversation already printed `VISUAL_CODER_SESSION`, stay. Do not attach. Treat a later request as a change request: MUST `report-plan` from the last proposal first, then implement. Never edit before `report-plan`.

After `read-blueprint`, look at this color's blueprint only. Plan sequential steps (`1`, `2`, `3`). This chat implements each invoked step itself, then `propose-patch --session <this color> --step <id>`. Do not spawn subagents.

```bash
npx inbase attach
```

If that fails with `VISUAL_CODER_NOT_RUNNING`, `VISUAL_CODER_ALL_COLORS_LOCKED`, or `VISUAL_CODER_COLOR_UNKNOWN`, reply with that message and stop.

`VISUAL_CODER_SESSION` is the color. Use `--session` with that color for every later command.

Continue the Inbase visual edits skill from `read-blueprint`. After it returns, reply `I see on the blueprint ...`. Then MUST `report-deliveries` with titles only — do not invent steps yet. Then MUST `report-plan` for the invoked delivery only. Only after that command invokes the first step, implement that step only. After each step's edits, MUST `propose-patch` before the next step. Never implement the whole plan first. Never edit before `report-plan`.

If this chat has no request text, after `read-blueprint`, if this session's blueprint is enabled, that is the request: MUST `report-deliveries` first (titles only), then `report-plan` for the invoked delivery, then implement. Follow the blueprint as closely as possible. Ask in chat if you need more information. Extra files are allowed if the blueprint does not cover them. Do not edit before `report-plan`. If the blueprint is empty, stop and wait for a request, `/explainit`, or `/stop`.
