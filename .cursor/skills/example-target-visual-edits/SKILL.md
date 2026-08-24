---
name: example-target-visual-edits
description: >-
  Grounds example-target code changes in the Visual Coder map. Use when
  creating, editing, or deleting files under apps/example-target, including
  when the user chats a change request without /inbase. Direct chat is blocked
  unless they invoked /inbase or /skipinbase. List every feature step, then
  edit live example-target files after invocation and record each step with
  inbase propose-patch (no patch file). Do not use for explorer, Vite, Three.js,
  or other non-target changes.
---

# Example-target visual edits

Apply this skill **only** when the work is file changes in `apps/example-target`.
Skip it for explorer, layout, lighting, or other Visual Coder app work.

Sessions start only from the visualizer (**Setup LLM session**). This chat
cannot open a session.

- **`/skipinbase`**: do the user's request without Inbase. Do not attach, wait,
  or record patches.
- **`/inbase`**, or this conversation already has a `VISUAL_CODER_SESSION` from
  `/inbase`: connect if needed, then follow Required sequence. Do not refuse.
- **Any other file-change request**: do not edit files and do not run Inbase
  commands. Reply with exactly this line, then **stop**:

```
direct chat interaction not allowed use /skipinbase [request] to bypass inbase.
```

The LLM uses a plan-first loop. It reports the complete plan before editing
files. When **Step by step** is on, it waits for the user to click **Create
proposal** on the first step, edits live files for that step, records them with `inbase propose-patch`,
then waits for **Accept proposal** or an alternative instruction. When **Step
by step** is off, `inbase wait-for-approval` returns `VISUAL_CODER_EXECUTE` for
every remaining step without the user clicking; after the last recorded step,
wait for the user to **Accept proposal**. They can still walk Previous/Next
over the recorded diffs.

**Recorded patches are the session record.** After `VISUAL_CODER_EXECUTE`, edit
files under `apps/example-target` with Write, StrReplace, and Delete for that
step only. Then run `inbase propose-patch` with no patch file. Inbase diffs
the working tree against the snapshot taken at invoke and stores that patch.
A later instruction replaces the withdrawn step; edit from the accepted live
files, not from the withdrawn proposal. Do not write a unified diff yourself.

The visualizer stores immutable diffs under the running instance's
`diff-sessions/<session-id>/diffs/` folder. Inbase must already be running
(`npm run dev` or `npx inbase run`). Prefer `npx inbase` so this package's CLI
is used.

If this chat is not yet attached, run:

```bash
npx inbase attach
```

That attaches this chat to the session currently focused in the map. No id is
passed in; read `VISUAL_CODER_SESSION` from the output and use that
`--session` value for every later command. Then continue from
`wait-for-blueprint` below. Do **not** run `start-session`. Do **not** wait
for a blueprint handshake.

## Direct response

Visualizer signals arrive as `VISUAL_CODER_ACK` from `attach`,
`wait-for-blueprint`, and `wait-for-approval`. While a wait command is running
you cannot chat; that process is the listen loop.

The moment a command prints `VISUAL_CODER_ACK`, **reply in this chat first**
with one short sentence that acknowledges the signal. Echo the ack, for
example: `Got it — running step 2: Show ColorGenerator on Home.` Then continue
the required tools in the same turn. Do not wait for the user after the ack.
Do not start with a long analysis. Do not call tools before that sentence.

After `propose-patch` on a non-final step, the **next tool call must be**
`wait-for-approval`. Do not explore, search, or re-plan in between. **Accept
proposal** invokes the next step; when that wait returns `EXECUTE`, implement
that step immediately. Do not run `wait-for-blueprint` again. Do not report a
new plan.

## Required sequence

1. **Read the current layout**. `/inbase` already started the session. Run
   this once to load the optional blueprint and instruction — it returns
   immediately. Do not wait for the user to send a blueprint. Then report a
   plan.

```bash
npx inbase wait-for-blueprint --session "<session-id>"
```

   The user may have placed files (`Space`) and islands (`B`), or left the
   blueprint empty. That choice is already on the session. They can keep
   placing on later steps. This chat's blueprint is stored only for this
   session.
   If `wait-for-blueprint` prints `VISUAL_CODER_INSTRUCTION_START` /
   `VISUAL_CODER_INSTRUCTION_END`, that text is the user's request for this
   session. Plan from that instruction and the blueprint together. The
   instruction does not override an enabled blueprint; if they conflict,
   ask the user.
3. Read the handshake output between `VISUAL_CODER_BLUEPRINT_START` and
   `VISUAL_CODER_BLUEPRINT_END`, or read this session's `blueprint.json` in
   the running instance's `diff-sessions/<session-id>/` folder.
   If `enabled` is true, **the blueprint is leading**. Treat
   `userCreatedBlocks`, `userCreatedIslands`, `addedFunctions`,
   `addedVariables`, and `addedImports` as the source of truth for this chat.
   Create those paths and add those symbols even if they are not on disk.
   They belong to this chat only.
   Do not omit, rename, relocate, or replace a blueprint file, island, symbol,
   or import. Extra edits to existing files are allowed when needed to finish
   the feature. Extra new files that are not in the blueprint are a deviation.
   If the user request, viewpoint, a later instruction, or your own plan would
   differ from the blueprint, **stop and ask the user in chat** before
   reporting the plan. Do not silently deviate.
4. Read the running instance's `user-context.json` for viewpoint only (path in
   `INBASE_ATTACHED`, otherwise `apps/explorer/src/data/user-context.json`).
5. Use the user's viewpoint only when `followLook` is true:
   - `island` is where they are standing
   - `lookingAt` / `lookingAtFiles` are the blocks they are looking at
   - `selected` is the block they clicked
   - `filesOnIsland` is the rest of that folder
   Prefer those files while `followLook` is true, unless the request clearly
   needs something else. If `followLook` is false or missing, ignore viewpoint
   and choose files from the request itself. Viewpoint never overrides the
   blueprint: still follow this session's blueprint when `enabled` is true.
6. List **all** steps needed to finish the feature. Keep steps small enough that
   one recorded step is one landscape change (usually one new file, or a few
   related edits).
7. Report the plan before editing files:

```bash
npx inbase report-plan \
  --session "<session-id>" \
  --feature "short feature name" \
  --steps "Add Clock component" \
  --steps "Show Clock on Home"
```

8. **Stop and wait for invocation**:

```bash
npx inbase wait-for-approval --session "<session-id>"
```

   Do not edit example-target files until this prints `VISUAL_CODER_ACK execute`
   / `VISUAL_CODER_EXECUTE`. If Step by step is off, this returns immediately
   for each remaining step. First reply in chat acknowledging the ack, then
   re-read this session's `blueprint.json`; the user can place files and
   islands on any step.
9. Implement only the invoked step by editing live files under
   `apps/example-target` (Write, StrReplace, Delete). Paths are the same ids as
   `codebase.json`. Then record the step — Inbase diffs the working tree against
   the snapshot taken at invoke:

```bash
npx inbase propose-patch --session "<session-id>"
```

   Do not write a unified diff. Do not pass a `.patch` file. Never write or
   replace a patch already stored in the session folder.

10. **Stop editing** `apps/example-target` until the next `VISUAL_CODER_EXECUTE`.
    The stored patch is the session record; disk already has your edits. Your
    next tool call is `wait-for-approval` — nothing else.
11. Wait until the user clicks **Accept proposal** on the current step (or, when Step by
   step is off, until the next step is auto-invoked), sends an alternative
   instruction, or stops the workflow:

```bash
npx inbase wait-for-approval --session "<session-id>"
```

12. Read the wait script output. Reply in chat with the `VISUAL_CODER_ACK`
    line first, then:

   - Exit `0` (`VISUAL_CODER_ACK execute` / `VISUAL_CODER_EXECUTE`): the
     highlighted step was invoked. If this is a later step, implement it now —
     do not explore, re-plan, or run `wait-for-blueprint`. Re-read this
     session's `blueprint.json` only if you need placed files. Edit live files
     for that step only, record with `inbase propose-patch` (no patch file),
     then wait again.
   - Exit `5` (`VISUAL_CODER_ACK finished` / `VISUAL_CODER_FINISHED`): that was
     the last step. The visualizer already applied the final patch and removed
     stored session diffs and blueprint drafts. Optionally run `--clear` if
     anything remains, tell the user the feature is done, and **stop**. Do not
     propose another patch.
   - Exit `4` (`VISUAL_CODER_ACK replan` / `VISUAL_CODER_REPLAN`): do **not**
     edit project files and do not rewrite an earlier accepted patch. The
     withdrawn proposal is no longer live; disk is baseline + accepted patch
     files. Follow the text between `VISUAL_CODER_INSTRUCTION_START` and
     `VISUAL_CODER_INSTRUCTION_END`, read this session's `blueprint.json` when
     it is enabled (files, islands, `addedFunctions`, `addedVariables`,
     `addedImports`). The blueprint stays leading. If the new instruction would
     differ from it, ask the user before replacing the plan. Read
     `user-context.json` (follow the viewpoint only if `followLook` is true),
     replace the plan from the current step onward using `inbase report-plan`,
     then wait for the next `VISUAL_CODER_EXECUTE` before editing again. The
     replacement edits must sit on the accepted live files, not the withdrawn
     proposal.
   - Exit `2` (`VISUAL_CODER_ACK stopped` / `VISUAL_CODER_STOPPED`) or `3`
     (`VISUAL_CODER_ACK timeout`): make no further example-target changes.

13. After a finished handshake, the explorer already removed stored session
    diffs and blueprint drafts. Optionally run:

```bash
npx inbase propose-patch --session "<session-id>" --clear
```

## Do not

- Start a visual session from chat with `start-session`; sessions start only
  from **Setup LLM session** in the map
- Edit files on a direct chat request; reply with the `/skipinbase` line and stop
- Invent a session id for `/inbase`; run `npx inbase attach` with no `--session`
- Skip `inbase wait-for-blueprint`; it returns immediately and provides the optional blueprint and instruction
- Treat the chat request, viewpoint, or your own plan as overriding an enabled blueprint
- Skip, rename, relocate, or replace this session's `blueprint.json` files, islands, functions, variables, or imports when `enabled` is true
- Silently differ from the blueprint; ask the user first
- Read global `user-context.json` for placed files; those live on the session blueprint
- Follow the user's look when `followLook` is false
- Edit `apps/example-target` files before `VISUAL_CODER_EXECUTE`
- Keep editing after `inbase propose-patch` until the next `VISUAL_CODER_EXECUTE`
- Write a unified diff yourself; `inbase propose-patch` with no file records the git diff
- Pass a `.patch` file to `propose-patch` unless you are debugging the CLI
- Explore, search, or re-plan after `propose-patch` before `wait-for-approval`
- Stay silent or call tools before acknowledging a `VISUAL_CODER_ACK` in chat
- Propose the next step before `inbase wait-for-approval` returns `VISUAL_CODER_EXECUTE`
- Propose another patch after `VISUAL_CODER_FINISHED`
- Reuse, overwrite, or expand an existing session diff
- Use this flow for explorer or other non-target work
