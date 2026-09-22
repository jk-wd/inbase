---
description: Attach this chat to the Lime Inbase session
---

The user invoked `/lime`. Attach to **Lime**. Use `--session lime` for every later `inbase` command.

If this chat already attached, stay. Do not attach. Treat a later request as a change request: MUST `report-plan` from the last proposal first, then implement. Never edit before `report-plan`.

After `read-blueprint`, look at this color's blueprint only. Plan sequential steps (`1`, `2`, `3`). This chat implements each invoked step itself, then `propose-patch --session <this color> --step <id>`. Do not spawn subagents.

```bash
npx inbase attach --color lime
```

If attach fails, reply with that output and stop.

Continue the Inbase visual edits skill from `read-blueprint` with `--session lime`. After it returns, reply `I see on the blueprint ...`. Then MUST `report-plan` with `--steps` for the full implementation. Only after that command invokes the first step, implement that step only. After each step's edits, MUST `propose-patch` before the next step. Never implement the whole plan first. Never edit before `report-plan`.

The user's request is:

$ARGUMENTS

If `$ARGUMENTS` is empty, there is no chat instruction. After `read-blueprint`, if this session's blueprint is enabled, that is the request: MUST `report-plan` first, then implement. Follow the blueprint as closely as possible. Ask in chat if you need more information. Extra files are allowed if the blueprint does not cover them. Do not edit before `report-plan`. If the blueprint is empty, stop and wait for a request or `/explainit`.
