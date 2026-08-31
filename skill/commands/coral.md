---
description: Attach this chat to the Coral Inbase session
---

The user invoked `/coral`. Attach this chat to the **Coral** Inbase session, not the next empty slot.

Do **not** ask for a session id. Do **not** run `inbase start-session`.

1. Attach to the Coral session:

```bash
npx inbase attach --color coral
```

If attach fails with `VISUAL_CODER_NOT_RUNNING`, `VISUAL_CODER_CHAT_LIMIT`, `VISUAL_CODER_COLOR_BUSY`, or `VISUAL_CODER_COLOR_UNKNOWN`, reply with that message and stop.

2. Read `VISUAL_CODER_SESSION` from the output. That id is the session to use for every later `inbase` command.

3. Continue the Inbase visual edits skill from `wait-for-blueprint` onward with that `--session` id. Attach already started the session. `wait-for-blueprint` only reads the optional blueprint, instruction, and attached files; it does not wait.

The user's request is:

$ARGUMENTS
