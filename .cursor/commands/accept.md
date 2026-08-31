---
description: Accept the current Inbase proposal (same as /go)
---

The user invoked `/accept`. This is the same as `/go`: accept the waiting proposal and start the next step, or finish if this was the last proposal.

This chat should already be attached to an Inbase session (`VISUAL_CODER_SESSION` in this conversation). Do **not** attach a new session. Do **not** report a new plan. Do **not** edit files until `VISUAL_CODER_EXECUTE`.

1. Advance the session (requires `npx inbase run`):

```bash
npx inbase accept --session "<session-id>"
```

Use the `VISUAL_CODER_SESSION` from this conversation. If `--session` is omitted, Inbase uses the focused map session.

If that fails with `VISUAL_CODER_NOT_RUNNING`, reply with that message and stop. If it says the session is not waiting for `/go`, tell the user to `/go` when a plan or proposal is ready.

2. Reply in this chat first with the `VISUAL_CODER_ACK` line, then:

- `VISUAL_CODER_EXECUTE`: the proposal was accepted and the next step is invoked. Implement that step now — edit live files for that step only, `npx inbase propose-patch --session "<session-id>"` with no patch file, then **stop** for `/go` if more remains.
- `VISUAL_CODER_FINISHED`: that was the last step. Tell the user the feature is done and **stop**. Do not propose another patch.
