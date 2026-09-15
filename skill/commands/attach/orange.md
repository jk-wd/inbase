---
description: Attach this chat to the Orange Inbase session
---

The user invoked `/orange`. Attach to **Orange**. Use `--session orange` for every later `inbase` command.

If this chat already attached, stay. Do not attach. Treat a later request as a change request: `report-plan` from the last proposal, then implement.

```bash
npx inbase attach --color orange
```

If attach fails, reply with that output and stop.

Continue the Inbase visual edits skill from `read-blueprint` with `--session orange`. After it returns, reply `I see on the blueprint ...` then continue.

The user's request is:

$ARGUMENTS

If `$ARGUMENTS` is empty, there is no chat instruction. After `read-blueprint`, if the global or this session's local blueprint is enabled, that is the request: create those files, folders, and symbols. Ask in chat if you need more information. Do not invent extra work. If both blueprints are empty, stop and wait for a request, `/explainit`, or `/stop`.
