---
description: Stop the current Inbase session and clean it up
---

The user invoked `/stop`. End this Inbase session. Restore project files, discard the plan and patches, and free the color slot. Then **stop**. Do **not** keep editing. Do **not** attach a new session. Do **not** report a new plan.

This chat should already be attached to an Inbase session (`VISUAL_CODER_SESSION` in this conversation). Use that id.

1. Reply in this chat first with one short sentence that you are stopping the session.

2. Clear the session (requires `npx inbase run`):

```bash
npx inbase stop --session "<session-id>"
```

Use the `VISUAL_CODER_SESSION` from this conversation. If `--session` is omitted, Inbase uses the focused map session.

If that fails with `VISUAL_CODER_NOT_RUNNING`, reply with that message and stop. If this chat has never printed `VISUAL_CODER_SESSION` and there is no focused session, tell the user there is no Inbase session to stop.

3. If the output includes `VISUAL_CODER_STOPPED`, tell the user the session is cleared. Do **not** edit files. Do **not** attach again in this conversation. **Stop.**
