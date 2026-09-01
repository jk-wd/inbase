---
description: Attach this chat to the next empty Inbase session
---

The user invoked `/inbase`. Attach this chat to the next unconnected Inbase session. You do not need this command — a regular Cursor chat does the same thing.

Do **not** ask for a session id. Do **not** run `inbase start-session`.

1. Attach to the next unconnected visualizer session (oldest first; skip sessions that already have an LLM):

```bash
npx inbase attach
```

If attach fails with `VISUAL_CODER_NOT_RUNNING`, `VISUAL_CODER_CHAT_LIMIT`, `VISUAL_CODER_COLOR_BUSY`, or `VISUAL_CODER_COLOR_UNKNOWN`, reply with that message and stop.

2. Read `VISUAL_CODER_SESSION` from the output. That id is the session to use for every later `inbase` command.

3. Continue the Inbase visual edits skill from `read-blueprint` onward with that `--session` id. Attach already started the session. `read-blueprint` reads the optional blueprint, instruction, and attached files. After it returns, reply in chat with `I see on the blueprint ...` naming the files, folders, symbols, imports, notes, and pointers so the user can confirm you read it correctly. Then continue.

If this chat has no request text, after `read-blueprint`, if the global or this session's local blueprint is enabled, that is the request: create those files, folders, and symbols. Ask in chat if you need more information. Do not invent extra work. If both blueprints are empty, stop and wait for a request, `/go`, or `/explain`.
