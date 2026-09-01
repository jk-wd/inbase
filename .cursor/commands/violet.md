---
description: Attach this chat to the Violet Inbase session
---

The user invoked `/violet`. Attach this chat to the **Violet** Inbase session, not the next empty slot.

Do **not** ask for a session id. Do **not** run `inbase start-session`.

1. Attach to the Violet session:

```bash
npx inbase attach --color violet
```

If attach fails with `VISUAL_CODER_NOT_RUNNING`, `VISUAL_CODER_CHAT_LIMIT`, `VISUAL_CODER_COLOR_BUSY`, or `VISUAL_CODER_COLOR_UNKNOWN`, reply with that message and stop.

2. Read `VISUAL_CODER_SESSION` from the output. That id is the session to use for every later `inbase` command.

3. Continue the Inbase visual edits skill from `read-blueprint` onward with that `--session` id. Attach already started the session. `read-blueprint` reads the optional blueprint, instruction, and attached files. After it returns, reply in chat with `I see on the blueprint ...` naming the files, folders, symbols, imports, notes, and pointers so the user can confirm you read it correctly. Then continue.

The user's request is:

$ARGUMENTS

If `$ARGUMENTS` is empty, there is no chat instruction. After `read-blueprint`, if the global or this session's local blueprint is enabled, that is the request: create those files, folders, and symbols. Ask in chat if you need more information. Do not invent extra work. If both blueprints are empty, stop and wait for a request, `/accept`, or `/explain`.
