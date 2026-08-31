---
description: Start making the current Inbase proposal
---

The user invoked `/go`. Start making the current proposal — invoke the waiting plan step and implement it.

This chat should already be attached to an Inbase session (`VISUAL_CODER_SESSION` in this conversation). Do **not** attach a new session. Do **not** report a new plan.

1. Invoke the waiting step (requires `npx inbase run`):

```bash
npx inbase go --session "<session-id>"
```

Use the `VISUAL_CODER_SESSION` from this conversation. If `--session` is omitted, Inbase uses the focused map session.

If that fails with `VISUAL_CODER_NOT_RUNNING`, reply with that message and stop. If it says a proposal is already waiting, tell the user to `/accept` (or send an instruction) instead.

2. Reply in this chat first with one short sentence that you are starting the proposal.

3. If the output includes `VISUAL_CODER_EXECUTE`, implement that step now: edit live files for that step only, then `npx inbase propose-patch --session "<session-id>"` with no patch file. Then **stop**. Wait for the user to type `/accept` (or an alternative instruction) in chat.
