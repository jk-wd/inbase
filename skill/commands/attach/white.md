---
description: Attach this chat to the White Inbase session
---

The user invoked `/white`. Attach to **White**. Use `--session white` for every later `inbase` command.

If this chat already attached, stay. Do not attach. Treat a later request as a change request: MUST `report-plan` from the last proposal first, then implement. Never edit before `report-plan`.

```bash
npx inbase attach --color white
```

If attach fails, reply with that output and stop.

Continue the Inbase visual edits skill from `read-blueprint` with `--session white`. After it returns, reply `I see on the blueprint ...`. Then MUST `report-plan`. Only after that command invokes the first step, implement that step only. After each step's edits, MUST `propose-patch` before the next step. Never implement the whole plan first. Never edit before `report-plan`.

The user's request is:

$ARGUMENTS

If `$ARGUMENTS` is empty, there is no chat instruction. After `read-blueprint`, if the global or this session's local blueprint is enabled, that is the request: MUST `report-plan` for those files, folders, and symbols first, then implement. Ask in chat if you need more information. Do not invent extra work. Do not edit before `report-plan`. If both blueprints are empty, stop and wait for a request, `/explainit`, or `/stop`.
