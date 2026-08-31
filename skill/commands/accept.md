---
description: Accept the current Inbase proposal
---

The user invoked `/accept`. Accept the current proposal — apply it and continue to the next step, or finish if this was the last step.

This chat should already be attached to an Inbase session (`VISUAL_CODER_SESSION` in this conversation). Do **not** attach a new session. Do **not** report a new plan. Do **not** edit files until `VISUAL_CODER_EXECUTE`.

1. Accept the waiting proposal (requires `npx inbase run`):

```bash
npx inbase accept --session "<session-id>"
```

Use the `VISUAL_CODER_SESSION` from this conversation. If `--session` is omitted, Inbase uses the focused map session.

If that fails with `VISUAL_CODER_NOT_RUNNING`, reply with that message and stop. If it says there is no proposal to accept, tell the user to `/go` to start making one.

2. Reply in this chat first with the `VISUAL_CODER_ACK` line, then:

- `VISUAL_CODER_EXECUTE`: the next step is invoked. Implement that step now — edit live files for that step only, `npx inbase propose-patch --session "<session-id>"` with no patch file, then `wait-for-approval`.
- `VISUAL_CODER_FINISHED`: that was the last step. Tell the user the feature is done and **stop**. Do not propose another patch.

If `wait-for-approval` was already running and now returns EXECUTE or FINISHED, follow that the same way.
