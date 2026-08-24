---
description: Attach this chat to the next waiting Inbase visualizer session
---

The user invoked `/inbase`. This is how a chat joins the visualizer session that **Setup LLM session** already created.

Do **not** ask for a session id. Do **not** run `inbase start-session`. Do **not** print the "direct chat interaction not allowed" message.

1. Attach to the next waiting visualizer session (newest first; skip sessions that already have an LLM):

```bash
npx inbase attach
```

2. Read `VISUAL_CODER_SESSION` from the output. That id is the session to use for every later `inbase` command.

3. Continue the Inbase visual edits skill from `wait-for-blueprint` onward with that `--session` id. `/inbase` already started the session. `wait-for-blueprint` only reads the optional blueprint and instruction; it does not wait.
