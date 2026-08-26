---
name: inbase
description: >-
  Grounds source-file changes in the Inbase visual map. Use when creating,
  editing, or deleting application source files in this repository, including
  when the user chats a change request without /inbase. Direct chat is blocked
  unless they invoked /inbase or /skipinbase. Lists every feature step, then
  edits live files after invocation and records each step with inbase
  propose-patch (no patch file). Do not use for git, docs-only, lockfiles, or
  questions.
---

# Inbase visual edits

Apply this skill **whenever the work is file changes in this repository**.
Skip it for git, lockfiles, `.inbase`, `.cursor`, or questions with no code
changes.

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
live project files with Write, StrReplace, and Delete for that step only. Then
run `inbase propose-patch` with no patch file. Inbase diffs the working tree
against the snapshot taken at invoke and stores that patch. A later instruction
updates that live proposal; edit those files, then propose-patch again. Wait
for **Accept proposal** before the next step. Do not write a unified diff yourself.

The visualizer stores immutable diffs under
`.inbase/diff-sessions/<session-id>/diffs/`. Inbase must already be running
(`inbase run` or `npx inbase run`). Prefer `npx inbase` so the local package
is used.

If this chat is not yet attached, run:

```bash
npx inbase attach
```

That attaches this chat to the next waiting visualizer session (oldest first).
Already-attached sessions are skipped. Window focus does not matter. No id is
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
   this once to load the optional blueprint, instruction, and attached files — it returns
   immediately. Do not wait for the user to send a blueprint. Then report a
   plan.

```bash
npx inbase wait-for-blueprint --session "<session-id>"
```

   The user may have placed files (`Space`) and islands (`B`), or left the
   shared blueprint empty. That blueprint is shared across sessions. They can
   keep placing at any time.
   If `wait-for-blueprint` prints `VISUAL_CODER_INSTRUCTION_START` /
   `VISUAL_CODER_INSTRUCTION_END`, that text is the user's request for this
   session. If it prints `VISUAL_CODER_CONTEXT_FILES_START` /
   `VISUAL_CODER_CONTEXT_FILES_END`, those are session-only files the user
   dropped as initial context. Read each `path` (and any printed
   `VISUAL_CODER_CONTEXT_FILE` contents). They are not project files to create.
   Plan from that instruction, attached files, and the blueprint together. The
   instruction does not override an enabled blueprint; if they conflict,
   ask the user.
3. Read the handshake output between `VISUAL_CODER_BLUEPRINT_START` and
   `VISUAL_CODER_BLUEPRINT_END`, or read `.inbase/blueprint.json`.
   If `enabled` is true, **the blueprint is leading**. Treat
   `userCreatedBlocks`, `userCreatedIslands`, `addedFunctions`,
   `addedVariables`, and `addedImports` as the source of truth for this chat.
   Create those paths and add those symbols even if they are not on disk.
   The same blueprint is shared with every session.
   Do not omit, rename, relocate, or replace a blueprint file, island, symbol,
   or import. Extra edits to existing files are allowed when needed to finish
   the feature. Extra new files that are not in the blueprint are a deviation.
   If the user request, viewpoint, a later instruction, or your own plan would
   differ from the blueprint, **stop and ask the user in chat** before
   reporting the plan. Do not silently deviate.
4. Read `.inbase/user-context.json` for viewpoint only.
5. Use the user's viewpoint only when `followLook` is true:
   - `island` is where they are standing
   - `lookingAt` / `lookingAtFiles` are the blocks they are looking at
   - `selected` is the block they clicked
   - `filesOnIsland` is the rest of that folder
   Prefer those files while `followLook` is true, unless the request clearly
   needs something else. If `followLook` is false or missing, ignore viewpoint
   and    choose files from the request itself. Viewpoint never overrides the
   blueprint: still follow the shared blueprint when `enabled` is true.
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

   Describe this tool call as `inbase wait-for-approval`, not "waiting for the
   user to invoke". The command keeps running until they invoke; when it
   returns, they already did. Do not edit project files until this prints
   `VISUAL_CODER_ACK execute` / `VISUAL_CODER_EXECUTE`. If Step by step is off,
   this returns immediately for each remaining step. First reply in chat
   acknowledging the ack, then re-read the shared `blueprint.json`; the
   user can place files and islands at any time.
9. Implement only the invoked step by editing the live project files (Write,
   StrReplace, Delete). Paths are the same ids as `codebase.json`. Then record
   the step — Inbase diffs the working tree against the snapshot taken at
   invoke:

```bash
npx inbase propose-patch --session "<session-id>"
```

   Do not write a unified diff. Do not pass a `.patch` file. Never write or
   replace a patch already stored in the session folder.

10. **Stop editing** until the next `VISUAL_CODER_EXECUTE`. The stored patch is
    the session record; disk already has your edits. Your next tool call is
    `wait-for-approval` — nothing else.
11. Wait until the user clicks **Accept proposal** on the current step (or, when Step by
   step is off, until the next step is auto-invoked), sends an alternative
   instruction, or stops the workflow:

```bash
npx inbase wait-for-approval --session "<session-id>"
```

12. Read the wait command output. Reply in chat with the `VISUAL_CODER_ACK`
    line first, then:

   - Exit `0` (`VISUAL_CODER_ACK execute` / `VISUAL_CODER_EXECUTE`): follow
     the printed `VISUAL_CODER_EXECUTE` line. If it says **Update the current
     proposal**, edit those live files, record with `inbase propose-patch` (no
     patch file), then wait again for **Accept proposal**. Do not start the
     next step and do not report a new plan. Otherwise the highlighted step
     was invoked: implement that step now — do not explore, re-plan, or run
     `wait-for-blueprint`. Re-read the shared `blueprint.json` if you need
     placed files. Edit live files for that step only, record with
     `inbase propose-patch` (no patch file), then wait again.
   - Exit `6` (`VISUAL_CODER_ACK blueprint` / `VISUAL_CODER_BLUEPRINT`): the
     shared blueprint changed. Follow the latest files, islands, functions,
     variables, and imports. Do not omit, rename, relocate, or replace them.
     If this would differ from the current plan, ask the user before replacing
     the plan. Then run `wait-for-approval` again.
   - Exit `5` (`VISUAL_CODER_ACK finished` / `VISUAL_CODER_FINISHED`): that was
     the last step. The visualizer already applied the final patch and removed
     stored session diffs. The shared blueprint remains. Optionally run
     `--clear` if anything remains, tell the user the feature is done, and
     **stop**. Do not propose another patch.
   - Exit `4` (`VISUAL_CODER_ACK replan` / `VISUAL_CODER_REPLAN`): live files
     still contain the current proposal. Do not reset them and do not report a
     new plan. Follow the text between `VISUAL_CODER_INSTRUCTION_START` and
     `VISUAL_CODER_INSTRUCTION_END`, edit those live files, then
     `inbase propose-patch`. Wait for **Accept proposal**. Do not start the
     next step.
   - Exit `2` (`VISUAL_CODER_ACK stopped` / `VISUAL_CODER_STOPPED`) or `3`
     (`VISUAL_CODER_ACK timeout`): make no further project changes.

13. After a finished handshake, the explorer already removed stored session
    diffs. The shared blueprint remains. Optionally run:

```bash
npx inbase propose-patch --session "<session-id>" --clear
```

## Do not

- Start a visual session from chat with `start-session`; sessions start only
  from **Setup LLM session** in the map
- Edit files on a direct chat request; reply with the `/skipinbase` line and stop
- Invent a session id for `/inbase`; run `npx inbase attach` with no `--session`
- Skip `inbase wait-for-blueprint`; it returns immediately and provides the optional blueprint, instruction, and attached files
- Treat the chat request, viewpoint, or your own plan as overriding an enabled blueprint
- Skip, rename, relocate, or replace the shared `blueprint.json` files, islands, functions, variables, or imports when `enabled` is true
- Silently differ from the blueprint; ask the user first
- Read global `user-context.json` for placed files; those live on the shared blueprint
- Follow the user's look when `followLook` is false
- Edit project files before `VISUAL_CODER_EXECUTE`
- Keep editing after `inbase propose-patch` until the next `VISUAL_CODER_EXECUTE`
- Write a unified diff yourself; `inbase propose-patch` with no file records the git diff
- Pass a `.patch` file to `propose-patch` unless you are debugging the CLI
- Explore, search, or re-plan after `propose-patch` before `wait-for-approval`
- Stay silent or call tools before acknowledging a `VISUAL_CODER_ACK` in chat
- Propose the next step before `inbase wait-for-approval` returns `VISUAL_CODER_EXECUTE`
- Propose another patch after `VISUAL_CODER_FINISHED`
- Reuse, overwrite, or expand an existing session diff
- Use this flow for git, lockfiles, or other non-source work
