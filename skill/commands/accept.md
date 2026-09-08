---
description: Accept the current Inbase proposal to finish
---

The user invoked `/accept`. Accept the last proposal to finish the session.

This chat should already be attached to an Inbase session (`VISUAL_CODER_SESSION` in this conversation). Do **not** attach a new session. Do **not** report a new plan. Do **not** treat `/accept` as a change request. Do **not** edit files until `VISUAL_CODER_EXECUTE`.

1. Advance the session (requires `npx inbase run`):

```bash
npx inbase accept --session "<session-id>"
```

Use the `VISUAL_CODER_SESSION` from this conversation. If `--session` is omitted, Inbase uses the focused map session.

If that fails with `VISUAL_CODER_NOT_RUNNING`, reply with that message and stop. If it says the session is not waiting for `/accept`, tell the user to `/accept` when the last proposal is ready.

2. Reply in this chat first with one short sentence that you are accepting the proposal.

3. If the output includes `VISUAL_CODER_EXECUTE`, implement that step now: edit live files for that step only, then `npx inbase propose-patch --session "<session-id>"` with no patch file. If the next step is already invoked, implement it now. After the last recorded step, **stop**.

4. If the output includes `VISUAL_CODER_ACCEPTED`, the proposal is accepted. Do **not** edit files. **Stop.**

5. If the output includes `VISUAL_CODER_FINISHED`, that was the last proposal. Tell the user the feature is done and **stop**. Do not propose another patch. Do not report a new plan.
