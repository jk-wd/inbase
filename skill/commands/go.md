---
description: Start or continue the current Inbase proposal
---

The user invoked `/go`. Start the waiting plan step, or accept the current proposal. After a proposal is accepted, **stop** — another `/go` starts the next step. The last proposal still needs `/go` to finish. `/accept` is the same as `/go`.

This chat should already be attached to an Inbase session (`VISUAL_CODER_SESSION` in this conversation). Do **not** attach a new session. Do **not** report a new plan. Do **not** edit files until `VISUAL_CODER_EXECUTE`.

1. Advance the session (requires `npx inbase run`):

```bash
npx inbase go --session "<session-id>"
```

Use the `VISUAL_CODER_SESSION` from this conversation. If `--session` is omitted, Inbase uses the focused map session.

If that fails with `VISUAL_CODER_NOT_RUNNING`, reply with that message and stop. If it says the session is not waiting for `/go`, tell the user to `/go` when a plan or proposal is ready.

2. Reply in this chat first with one short sentence that you are starting or accepting the proposal.

3. If the output includes `VISUAL_CODER_EXECUTE`, implement that step now: edit live files for that step only, then `npx inbase propose-patch --session "<session-id>"` with no patch file. Then **stop**. Wait for the user to type `/go` in chat.

4. If the output includes `VISUAL_CODER_ACCEPTED`, the proposal is accepted. Do **not** edit files. **Stop.** Wait for the user to type `/go` on the next step.

5. If the output includes `VISUAL_CODER_FINISHED`, that was the last proposal. Tell the user the feature is done and **stop**. Do not propose another patch.
