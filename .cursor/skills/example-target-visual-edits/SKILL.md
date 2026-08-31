---
name: example-target-visual-edits
description: >-
  Grounds example-target code changes in the Visual Coder map. Use when
  creating, editing, or deleting files under apps/example-target, including
  when the user chats a change request without /inbase. Connects this chat to
  the next empty Inbase session, or to a color with /coral /red /amber and
  the other session colors. List every feature step, then edit live
  example-target files after invocation and record each step with inbase
  propose-patch (no patch file). Do not use for explorer, Vite, Three.js, or
  other non-target changes.
---

# Example-target visual edits

Apply this skill **only** when the work is file changes in `apps/example-target`.
Skip it for explorer, layout, lighting, or other Visual Coder app work.

`npx inbase run` creates 5 empty chat slots. A regular Cursor chat connects to
the next unconnected slot. You do not need `/inbase`.

- **`/coral` `/amber` `/lime` `/orange` `/violet`**: attach this chat to that
  color's empty slot. Aliases: `/red` (Coral), `/yellow` (Amber), `/green`
  (Lime), `/purple` (Violet). The text after the command is the user's request.
- **`/blue`**: Blue is the global blueprint, not a chat. Do not attach.
- **`/go`**: start making the current proposal (invoke the waiting plan step).
- **`/accept`**: accept the current proposal and continue, or finish on the last step.
- **`/explain [question]`**: explain mode on the map. If a plan or proposal is
  waiting, explain that proposal; the question is optional extra focus.
- **`/skipinbase`**: do the user's request without Inbase. Do not attach, wait,
  or record patches.
- **Any other file-change request**, or this conversation already has a
  `VISUAL_CODER_SESSION`: connect if needed, then follow Required sequence.
  Do not refuse.

The LLM uses a plan-first loop. It reports the complete plan before editing
files. When **Step by step** is on, it waits for the user to type `/go`
on the first step, edits live files for that step, records them with `inbase propose-patch`,
then waits for `/accept` or an alternative instruction. When **Step
by step** is off, `inbase wait-for-approval` returns `VISUAL_CODER_EXECUTE` for
every remaining step without the user invoking; after the last recorded step,
wait for the user to `/accept`. They can still walk Previous/Next
over the recorded diffs.

**Recorded patches are the session record.** After `VISUAL_CODER_EXECUTE`, edit
files under `apps/example-target` with Write, StrReplace, and Delete for that
step only. Then run `inbase propose-patch` with no patch file. Inbase diffs
the working tree against the snapshot taken at invoke and stores that patch.
A later instruction updates that live proposal; edit those files, then
propose-patch again. Wait for `/accept` before the next step. Do not
write a unified diff yourself.

The visualizer stores immutable diffs under the running instance's
`diff-sessions/<session-id>/diffs/` folder. Inbase must already be running
(`npm run dev` or `npx inbase run`). Prefer `npx inbase` so this package's CLI
is used.

If this chat is not yet attached:

- If the user invoked `/coral`, `/red`, `/amber`, `/yellow`, `/lime`,
  `/green`, `/orange`, `/violet`, or `/purple`, run
  `npx inbase attach --color <that command name>` (for example `/red` →
  `--color red`).
- Otherwise run:

```bash
npx inbase attach
```

That attaches this chat to the matching color's empty slot, or to the next
unconnected visualizer session (oldest first). Already-connected sessions are
skipped unless you asked for that color — then attach fails with
`VISUAL_CODER_COLOR_BUSY`. Window focus does not matter.
No id is passed in; read `VISUAL_CODER_SESSION` from the output and use that
`--session` value for every later command. Read `VISUAL_CODER_COLOR` and **reply
in this chat first** with one short sentence that names that color, for example:
`Connecting to the Coral session.` Then continue from `wait-for-blueprint` below.

If attach fails:

- `VISUAL_CODER_NOT_RUNNING`: reply with exactly this line, then **stop**:

```
Inbase isn't running. Start it with `npx inbase run`, then send this request again.
```

- `VISUAL_CODER_CHAT_LIMIT`: reply with exactly this line, then **stop**:

```
Only 5 Inbase chats can be connected at once. Finish or stop one in the map, then start a new chat.
```

- `VISUAL_CODER_COLOR_BUSY` or `VISUAL_CODER_COLOR_UNKNOWN`: reply with the rest
  of that line (it names the color), then **stop**.

Then continue from `wait-for-blueprint` below. Do **not** run `start-session`.
Do **not** wait for a blueprint handshake.

## Direct response

Visualizer signals arrive as `VISUAL_CODER_ACK` from `attach`,
`wait-for-blueprint`, and `wait-for-approval`. While a wait command is running
you cannot chat; that process is the listen loop.

The moment a command prints `VISUAL_CODER_ACK`, **reply in this chat first**
with one short sentence that acknowledges the signal. After `attach`, name the
color from `VISUAL_CODER_COLOR`, for example: `Connecting to the Coral session.`
For later acks, echo the signal, for example: `Got it — running step 2: Show ColorGenerator on Home.` Then continue
the required tools in the same turn. Do not wait for the user after the ack.
Do not start with a long analysis. Do not call tools before that sentence.

After `propose-patch` on a non-final step, the **next tool call must be**
`wait-for-approval`. Do not explore, search, or re-plan in between. `/accept`
invokes the next step; when that wait returns `EXECUTE`, implement
that step immediately. Do not run `wait-for-blueprint` again. Do not report a
new plan.

## Required sequence

1. **Read the current layout**. Attach already started the session. Run
   this once to load the optional blueprint, instruction, and attached files — it returns
   immediately. Do not wait for the user to send a blueprint. If that output
   includes `VISUAL_CODER_ACK explain`, follow exit `7` below. If you cannot
   report a plan yet (no instruction and no enabled blueprint work), **do not
   ask in chat**. Immediately run `wait-for-approval` so `?` clicks on the map
   are heard. Then report a plan when you have one.

```bash
npx inbase wait-for-blueprint --session "<session-id>"
```

   The user may have placed files and islands on the map, or left the
   blueprints empty. The **global** (blue) blueprint is shared across sessions.
   This chat also has a **local** blueprint in this session's color; only this
   chat receives it. They can keep placing at any time.
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
   `VISUAL_CODER_BLUEPRINT_END` (global, shared), and between
   `VISUAL_CODER_LOCAL_BLUEPRINT_START` and `VISUAL_CODER_LOCAL_BLUEPRINT_END`
   (this session's color only). You can also read the global `blueprint.json`
   in the running instance data dir (path in `INBASE_ATTACHED`, otherwise
   `.inbase/blueprint.json`).
   If either dump has `enabled` true, **that blueprint is leading**. Treat
   `userCreatedBlocks`, `userCreatedIslands`, `addedFunctions`,
   `addedVariables`, and `addedImports` as the source of truth for this chat.
   Create those paths and add those symbols even if they are not on disk.
   Honor the global blueprint and this session's local blueprint. Do not use
   another session's local blueprint.
   Do not omit, rename, relocate, or replace a blueprint file, island, symbol,
   or import. Extra edits to existing files are allowed when needed to finish
   the feature. Extra new files that are not in either blueprint are a deviation.
   If the user request, a later instruction, or your own plan would
   differ from an enabled blueprint, **stop and ask the user in chat** before
   reporting the plan. Do not silently deviate.
4. List **all** steps needed to finish the feature. Keep steps small enough that
   one recorded step is one landscape change (usually one new file, or a few
   related edits).
5. Report the plan before editing files:

```bash
npx inbase report-plan \
  --session "<session-id>" \
  --feature "short feature name" \
  --steps "Add Clock component" \
  --steps "Show Clock on Home"
```

6. **Stop and wait for invocation**:

```bash
npx inbase wait-for-approval --session "<session-id>"
```

   Describe this tool call as `inbase wait-for-approval`, not "waiting for the
   user to invoke". The command keeps running until they type `/go`,
   `/accept`, or `/explain`, or click `?` on a file, folder, or symbol; when it
   returns, they already did. Do not edit
   example-target files until this prints `VISUAL_CODER_ACK execute` /
   `VISUAL_CODER_EXECUTE`. If it prints `VISUAL_CODER_ACK explain`, follow
   exit `7` below, then wait again. If Step by step is off, this returns
   immediately for each remaining step. First reply in chat acknowledging the
   ack, then re-read the global `blueprint.json` and this session's local
   blueprint; the user can place files and islands at any time.
7. Implement only the invoked step by editing live files under
   `apps/example-target` (Write, StrReplace, Delete). Paths are the same ids as
   `codebase.json`. Then record the step — Inbase diffs the working tree against
   the snapshot taken at invoke:

```bash
npx inbase propose-patch --session "<session-id>"
```

   Do not write a unified diff. Do not pass a `.patch` file. Never write or
   replace a patch already stored in the session folder.

8. **Stop editing** `apps/example-target` until the next `VISUAL_CODER_EXECUTE`.
    The stored patch is the session record; disk already has your edits. Your
    next tool call is `wait-for-approval` — nothing else.
9. Wait until the user types `/accept` or `/explain` on the current step (or, when Step by
   step is off, until the next step is auto-invoked), sends an alternative
   instruction, or stops the workflow:

```bash
npx inbase wait-for-approval --session "<session-id>"
```

10. Read the wait script output. Reply in chat with the `VISUAL_CODER_ACK`
    line first, then:

   - Exit `0` (`VISUAL_CODER_ACK execute` / `VISUAL_CODER_EXECUTE`): follow
     the printed `VISUAL_CODER_EXECUTE` line. If it says **Update the current
     proposal**, edit those live files, record with `inbase propose-patch` (no
     patch file), then wait again for `/accept`. Do not start the
     next step and do not report a new plan. Otherwise the highlighted step
     was invoked: implement that step now — do not explore, re-plan, or run
     `wait-for-blueprint`. Re-read the global `blueprint.json` and this
     session's local blueprint if you need placed files. Edit live files for
     that step only, record with
     `inbase propose-patch` (no patch file), then wait again.
   - Exit `6` (`VISUAL_CODER_ACK blueprint` / `VISUAL_CODER_BLUEPRINT`): a
     blueprint this chat can see changed (global, this session's color, or
     both). Follow the latest files, islands, functions, variables, and
     imports from those dumps. Do not omit, rename, relocate, or replace them.
     Ignore other sessions' local blueprints.
     If this would differ from the current plan, ask the user before replacing
     the plan. Then run `wait-for-approval` again.
   - Exit `5` (`VISUAL_CODER_ACK finished` / `VISUAL_CODER_FINISHED`): that was
     the last step. The visualizer already applied the final patch and removed
     stored session diffs. The global blueprint remains. Optionally run
     `--clear` if anything remains, tell the user the feature is done, and
     **stop**. Do not propose another patch.
   - Exit `4` (`VISUAL_CODER_ACK replan` / `VISUAL_CODER_REPLAN`): live files
     still contain the current proposal. Do not reset them and do not report a
     new plan. Follow the text between `VISUAL_CODER_INSTRUCTION_START` and
     `VISUAL_CODER_INSTRUCTION_END`, edit those live files, then
     `inbase propose-patch`. Wait for `/accept`. Do not start the
     next step.
   - Exit `7` (`VISUAL_CODER_ACK explain` / `VISUAL_CODER_EXPLAIN`): the user
     wants something explained on the map — either the current proposal or a
     file/folder they clicked **?** next to. Do not edit example-target files
     and do not invoke the next step. Follow the printed `VISUAL_CODER_EXPLAIN`
     line: `npx inbase explain start --question "..."`, then
     `npx inbase explain report`. For a `?` click, report one `--step` /
     `--body` for the modal. For `/explain` of the current proposal, report every map step
     in one command with
     `--files` / `--folders` / `--select` / `--zoom` / `--info` /
     `--highlight` / `--point`. Do not walk the map after reporting; the user
     navigates. After
     reporting, run `npx inbase explain wait`. If that returns
     `VISUAL_CODER_EXPLAIN_QUESTION`, report sub-steps with `--parent` and wait
     again. If it returns another `VISUAL_CODER_EXPLAIN` for a file or folder,
     replace the explanation. When explain wait returns stopped or timeout, run
     `wait-for-approval` again. The plan is still waiting for
     `/go` or `/accept`.
   - Exit `2` (`VISUAL_CODER_ACK stopped` / `VISUAL_CODER_STOPPED`) or `3`
     (`VISUAL_CODER_ACK timeout`): make no further example-target changes.

11. After a finished handshake, the explorer already removed stored session
    diffs. The global blueprint remains. Optionally run:

```bash
npx inbase propose-patch --session "<session-id>" --clear
```

## Do not

- Start a visual session from chat with `start-session`; `npx inbase run` already opened 5 empty slots
- Invent a session id; run `npx inbase attach` with no `--session`, or
  `npx inbase attach --color <name>` when the user invoked a color command
- Skip `inbase wait-for-blueprint`; it returns immediately and provides the optional blueprint, instruction, and attached files
- Treat the chat request or your own plan as overriding an enabled blueprint
- Skip, rename, relocate, or replace files, islands, functions, variables, or imports from the global blueprint or this session's local blueprint when that dump is `enabled`
- Silently differ from an enabled blueprint; ask the user first
- Read global `user-context.json` for placed files; those live on the global or this session's local blueprint
- Follow another session's local blueprint
- Use the user's camera viewpoint to choose files
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
