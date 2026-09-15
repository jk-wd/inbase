---
description: Stop the current Inbase session and clean it up
---

The user invoked `/stop`. End this session. Discard the plan and patches, and free the color. Keep live project files. Then **stop**. Do not edit. Do not attach. Do not report a new plan.

1. Reply that you are stopping the session.

```bash
npx inbase stop --session <color>
```

Use this chat's color (`VISUAL_CODER_SESSION`) as `--session`. If `--session` is omitted, Inbase uses the focused map session.

If that fails with `VISUAL_CODER_NOT_RUNNING`, reply with that message and stop. If this chat has never printed `VISUAL_CODER_SESSION` and there is no focused session, tell the user there is no Inbase session to stop.

If the output includes `VISUAL_CODER_STOPPED`, the session is cleared. **Stop.**
