---
name: inbase
description: >-
  Grounds source-file changes in the Inbase visual map. Use only when creating,
  editing, or deleting files inside the mapped target from inbase.json
  (`target`; default `.`), including when the user chats a change request
  without /inbase. On the first turn, connects this chat to the next empty
  Inbase session, or to a color with /coral /red /amber and the other session
  colors. Later turns stay in that session: never attach again. Always works
  via the plan. A later change request must report-plan from the last proposal
  before editing, including after the last recorded step. Do not use for files
  outside that target (sibling apps, CLI, map tooling), git, docs-only,
  lockfiles, questions, or `/extract-blueprint`.
---

# Inbase visual edits

Apply this skill **only when the work is file changes inside the mapped
target**. Read `inbase.json` `target` (relative to that file; `.` if missing).
If none of the files you would create, edit, or delete live under that
folder, do **not** attach, do **not** run `npx inbase attach`, and do **not**
follow the visual plan loop. Continue as a normal coding task.

Skip it for git, lockfiles, `.inbase`, `.cursor`, `.claude`, `.agents`,
`.cline`, `.clinerules`, `.github/skills`, questions with no code changes,
or `/extract-blueprint`.

`npx inbase run` creates 10 empty chat slots. A regular chat connects to
the next unconnected slot **only for work inside `target`**. You do not need
`/inbase`.

- **`/coral` `/amber` `/lime` `/orange` `/violet` `/teal` `/crimson` `/forest` `/grey` `/white`**: attach this chat to that
  color's empty slot. Aliases: `/red` (Coral), `/yellow` (Amber), `/green`
  (Lime), `/purple` (Violet), `/darkgreen` (Forest), `/gray` (Grey). The text after the command is the user's request.
  If there is no text (`/violet` with nothing after it), attach and start from
  the enabled blueprint only: create those files and structure. Ask if you
  need more information.
- **`/blue`**: Blue is the global blueprint, not a chat. Do not attach.
- **`/stop`**: end this session. Restore files, discard the plan and patches,
  and free the color slot. Then stop. Do not edit files after `/stop`.
- **`/explainit [question]`**: explain mode on the map. If a plan or proposal is
  waiting, or the map is showing a proposal diff, explain what has changed in
  that proposal; the question is optional extra focus. If branch changes (diff
  mode) is on, `/explainit` with no question explains what has changed in that
  git diff. After a `?` click on the map, `/explainit` explains that file or
  folder. During explain mode, `/explainit [question]` reports follow-up
  sub-steps.
- **`/extract-blueprint [folder] [output file]`**: extract a valuable blueprint
  from an existing folder. Do not attach. Follow the extract-blueprint command.
- **Any other file-change request inside `target`**: if this conversation
  already has a `VISUAL_CODER_SESSION`, stay in that session and follow
  Required sequence from the current plan. Do **not** attach. If it does not,
  attach once, then follow Required sequence. Do not refuse. If the files are
  outside `target`, skip this skill.

The session window has a **Done** button. The user clicks it to keep the
applied files and free that color for another chat. That does not come
through this chat. Do not wait for it. Do not run a command for it.

## Stay in this session

If this conversation already printed `VISUAL_CODER_SESSION`, you are already
attached. **Do not run `npx inbase attach`.** Attach without `--session`
connects a **different empty slot**. Find that id in this conversation, even
many messages ago, even after the last proposal.

A waiting last proposal is still this session. When the user asks to update,
change, redo, or continue the work: `report-plan` with the new remaining
steps from that last proposal (replace the waiting step), then implement.
Do not say `Connecting to the ... session.` Do not start a new chat.

## Always work via the plan

Every file change must follow the current plan. Do not freelance edits, skip
steps, or patch a waiting proposal in place. The map plan is the work.

If the user asks for something that requires the plan to change, that is
allowed. **Update the plan from the point of the last proposal**, then
implement. Do not edit files first.

Example: the plan is `1. Step A`, `2. Step B`, `3. Step C`. The user does not
click Done and asks for a change. Stay in this session. Do not attach.
Replace step C with one or more remaining steps for the new goal. Keep A and
B. Pass **only those remaining `--steps`** to `report-plan`. That **replaces**
the waiting proposal. Then implement the invoked step. The same applies when
C is the last recorded step.

```bash
npx inbase report-plan \
  --session "<session-id>" \
  --feature "short feature name" \
  --steps "New step C" \
  --steps "Follow-up D"
```

Do **not** ask the user to finish or close the session so they can start over.

The user drives the next action from this chat. Do not poll the visualizer:

- **`/stop`**: end this session. Restore files, discard the plan and patches,
  and free the color slot. Then stop. Do not edit files after `/stop`.
- **`/explainit`**: explain the current proposal or git diff (what has changed),
  a pending map `?` click, or a follow-up question.
- **A later change request** (this chat already has `VISUAL_CODER_SESSION`,
  including after the last recorded step while a proposal is waiting): stay
  in this session. Do not attach. `report-plan` with the new remaining steps
  from the last proposal. That **replaces** the waiting proposal. Then
  implement. Never edit first.

`report-plan` and each recorded non-last step invoke the next step immediately
(`VISUAL_CODER_EXECUTE`). Implement that next step in the **same turn**. Do not
stop. Do not ask the user to review a mid-plan step. After the last
recorded step, stop for `/explainit`, `/stop`, or a change request in this
same session. The user clicks **Done** in the session window to keep the
files and free the color.

**Recorded map snapshots are the session record.** After `VISUAL_CODER_EXECUTE`, edit
live project files for that step only. Then
run `inbase propose-patch` with no extra arguments. Inbase stores the map overlay
of the current git working-tree changes. Then implement the
next invoked step in this same turn. After the last recorded step, **stop**. Do
not write a unified diff yourself.

The visualizer stores those overlays under
`.inbase/diff-sessions/<session-id>/diffs/`. Inbase must already be running
(`inbase run` or `npx inbase run`). Prefer `npx inbase` so the local package
is used.

Run `npx inbase` from the project working directory. Do not prefix it with
`cd /absolute/path`. Do not request extra Shell permissions (`all`,
`full_network`) for Inbase CLI — that leaves the sandbox and Cursor Auto-review
will ask the user to approve. These commands only write local files under
`.inbase/`. They are not a remote publish. Record the snapshot immediately; do
not wait for the user to click Run.

If this conversation already printed `VISUAL_CODER_SESSION`, skip attach.
Use that id. Continue from the current plan (a change request → `report-plan`).

If this chat is not yet attached (this conversation has **never** printed
`VISUAL_CODER_SESSION`):

- If the user invoked `/coral`, `/red`, `/amber`, `/yellow`, `/lime`,
  `/green`, `/orange`, `/violet`, `/purple`, `/teal`, `/crimson`, `/forest`,
  `/darkgreen`, `/grey`, `/gray`, or `/white`, run
  `npx inbase attach --color <that command name>` (for example `/red` →
  `--color red`).
- Else if this request would only change files outside `inbase.json`
  `target`, **stop following this skill**. Do not attach. Do not say you are
  connecting to a color session. Do the work without the visual plan loop.
- Otherwise run:

```bash
npx inbase attach
```

That attaches this chat to the matching color's slot, or to the next
unconnected visualizer session (oldest first). Already-connected sessions are
skipped unless you asked for that color — then leftover LLM work on that color
is discarded so this chat starts clean. A new attach always starts from an
empty plan: leftover steps, patches, and working state from a previous chat
are cleared. User-placed blueprint files, the initial instruction, and attached
context files stay. Recorded file changes from that leftover session are
restored. Window focus does not matter.
No id is passed in; read `VISUAL_CODER_SESSION` from the output and use that
`--session` value for every later command. Read `VISUAL_CODER_COLOR` and **reply
in this chat first** with one short sentence that names that color, for example:
`Connecting to the Coral session.` Then continue from `read-blueprint` below.
Run attach **once** per conversation. Never run it again to "continue" or
"update" — that would connect a new empty slot.

If attach fails:

- `VISUAL_CODER_NOT_RUNNING`: reply with exactly this line, then **stop**:

```
Inbase isn't running. Start it with `npx inbase run`, then send this request again.
```

- `VISUAL_CODER_CHAT_LIMIT`: reply with exactly this line, then **stop**:

```
Only 10 Inbase chats can be connected at once. Click Done in a session window or type /stop in a connected chat, then start a new chat.
```

- `VISUAL_CODER_COLOR_UNKNOWN`: reply with the rest of that line (it names
  the color), then **stop**.

Then continue from `read-blueprint` below. Do **not** run `start-session`.
Do **not** wait for a blueprint handshake.

## Direct response

The moment a command prints `VISUAL_CODER_ACK`, **reply in this chat first**
with one short sentence that acknowledges the signal. After the **first**
`attach` in this conversation, name the color from `VISUAL_CODER_COLOR`, for
example: `Connecting to the Coral session.` Do not say that on a later turn.
After `read-blueprint`, the ack is what you see: start with
`I see on the blueprint` and name the files, folders, symbols, imports, notes,
and pointers. For other later acks, echo the signal, for example:
`Got it — running step 2: Show ColorGenerator on Home.` Then continue
the required tools in the same turn. Do not start with a long analysis. Do not
call tools before that sentence.

After `propose-patch`, if the next step is invoked (`VISUAL_CODER_EXECUTE` or
"already invoked"), implement that original next plan step **now in this same
turn**. Do not stop. Do not tell the user to review the step. After the last
recorded step, **stop**. Do not explore, search, or re-plan on your own. Do not
attach. Wait for `/explainit`, `/stop`, or a **change request** in this chat. A
change request must `report-plan` first (remaining steps from the last
proposal), then implement. That includes after the last recorded step. Do not
edit files before that `report-plan`. Do not ask the user to finish or close
the session so they can start over. Do not start a new chat.

## Required sequence

If this conversation already has `VISUAL_CODER_SESSION` and a plan or proposal
is waiting, do **not** restart from step 1. Do **not** attach.
`/explainit` → step 9. `/stop` → step 11. A change request
(including after the last recorded step) → step 8.

1. **Read the current layout**. Attach already started the session. Run
   this once to load the optional blueprint, instruction, and attached files — it returns
   immediately. Do not wait for the user to send a blueprint.

   If the color command or chat has **no instruction** (empty `$ARGUMENTS`, and
   `read-blueprint` printed no `VISUAL_CODER_INSTRUCTION_*`):
   - If it prints `VISUAL_CODER_BLUEPRINT_ONLY`, or either blueprint dump has
     `enabled` true, **that is the request**. Plan only from those files,
     folders, symbols, imports, notes, and pointers. The goal is to create the
     structure the user drew. Ask in chat if you need more information before
     reporting the plan. Do not invent extra files or a larger feature.
   - If it prints `VISUAL_CODER_NO_REQUEST`, or both blueprints are empty,
     **stop**. Wait for the user to type a request, `/explainit`, or `/stop`.

```bash
npx inbase read-blueprint --session "<session-id>"
```

   The user may have placed files and folders on the map, or left the
   blueprints empty. The **global** (blue) blueprint is shared across sessions.
   This chat also has a **local** blueprint in this session's color; only this
   chat receives it. They can keep placing at any time.
   If `read-blueprint` prints `VISUAL_CODER_INSTRUCTION_START` /
   `VISUAL_CODER_INSTRUCTION_END`, that text is the user's request for this
   session. If it prints `VISUAL_CODER_CONTEXT_FILES_START` /
   `VISUAL_CODER_CONTEXT_FILES_END`, those are session-only files the user
   dropped as initial context. Read each `path` (and any printed
   `VISUAL_CODER_CONTEXT_FILE` contents). They are not project files to create.
   Plan from that instruction, attached files, and the blueprint together. The
   instruction does not override an enabled blueprint; if they conflict,
   ask the user. No instruction is not a conflict: an enabled blueprint alone
   is enough to start.
3. Read the handshake output between `VISUAL_CODER_BLUEPRINT_START` and
   `VISUAL_CODER_BLUEPRINT_END` (global, shared), and between
   `VISUAL_CODER_LOCAL_BLUEPRINT_START` and `VISUAL_CODER_LOCAL_BLUEPRINT_END`
   (this session's color only). You can also read the global
   `.inbase/blueprint.json`.
   If either dump has `enabled` true, **that blueprint is leading**. Treat
   `files`, `folders`, `addedFunctions`,
   `addedVariables`, and `addedImports` as the source of truth for this chat.
   Create those paths and add those symbols even if they are not on disk.
   Honor the global blueprint and this session's local blueprint. Do not use
   another session's local blueprint.
   Do not omit, rename, relocate, or replace a blueprint file, folder, symbol,
   or import. Extra edits to existing files are allowed when needed to finish
   the feature. Extra new files that are not in either blueprint are a deviation.
   If the user request, a later request, or your own plan would
   differ from an enabled blueprint, **stop and ask the user in chat** before
   reporting the plan. Do not silently deviate.
4. **Say what you see on the blueprint** in this chat before listing steps or
   calling `report-plan`. Start with `I see on the blueprint` and name every
   file, folder, function, variable, import, note, and pointer from the dumps —
   say which are global and which are this session's color. This tells the user
   you interpreted the drawing correctly. Do not summarize vaguely. If both
   dumps are empty, say `I see nothing on the blueprint yet.` Then continue
   (or stop on `VISUAL_CODER_NO_REQUEST`).
5. List **all** steps needed to finish the feature. Keep steps small enough that
   one recorded step is one landscape change (usually one new file, or a few
   related edits).
6. Report the plan before editing files:

```bash
npx inbase report-plan \
  --session "<session-id>" \
  --feature "short feature name" \
  --steps "Add Clock component" \
  --steps "Show Clock on Home"
```

7. `report-plan` prints that the first step is already invoked
   (`VISUAL_CODER_EXECUTE` / phase working). Implement that step now. Do **not**
   run `wait-for-approval`. Do **not** edit project files until the step is
   invoked.
8. If the user types a **change request** while a plan or proposal is waiting
   (not `/explainit` or `/stop`), including after the last recorded
   step: stay in this session. **Do not attach. Do not edit files yet.**
   List the new remaining steps from the last proposal: replace that waiting
   step with one or more steps for the new goal (example: drop step C, keep
   A and B, report `New step C` and any follow-ups). Run `report-plan` with
   those remaining `--steps` only — do not repeat already-accepted steps.
   That replaces the waiting proposal. If that prints `VISUAL_CODER_EXECUTE`,
   implement that step now. Never tell the user to finish or close the session.
   Never `propose-patch` a change until
   `report-plan` has replaced the waiting step. Never connect a new chat
   because the last step looks done.
9. When the user types **`/explainit`**, do not edit project files and do not
    invoke the next step. Run `npx inbase explain start` (with `--question` when
    they provided one). If that prints `VISUAL_CODER_EXPLAIN` for a map `?`
    click, inspect that path and report one `--step`. If it prints
    `VISUAL_CODER_EXPLAIN_FOLLOWUP`, report sub-steps with `--parent`. If it
    prints `VISUAL_CODER_PROPOSAL` or `VISUAL_CODER_DIFF`, walk the listed
    changes (between `VISUAL_CODER_CHANGES_START` / `END` when present). Then
    `npx inbase explain report`. After reporting, **stop**. The user navigates
    the map. They type `/explainit` again for a follow-up, click **Done** in the
    session window to keep the files and free the color, `/stop` to end the
    session, or a change request to replace the waiting proposal.
10. After a finished session, the explorer already removed stored session
    diffs. **Keep the applied project files.** Do not restore, revert, or
    delete the work. The global blueprint remains. Optionally run
    `npx inbase propose-patch --session "<session-id>" --clear` to drop leftover
    session artifacts — that must not revert files.
11. When the user types **`/stop`**, do not edit project files. Run
    `npx inbase stop --session "<session-id>"`. That restores files, discards
    the plan and patches, and frees the color slot. Then **stop**. Do not
    attach again in this conversation. Do not report a new plan.

## Do not

- Start a visual session from chat with `start-session`; `npx inbase run` already opened 10 empty slots
- Run `npx inbase attach` after this conversation already printed
  `VISUAL_CODER_SESSION` — that connects a different empty slot
- Say `Connecting to the ... session` on a later turn, or start a new chat
  because the last proposal is waiting or the plan looks finished
- Invent a session id; run `npx inbase attach` with no `--session` only when
  this conversation has never printed `VISUAL_CODER_SESSION`, or
  `npx inbase attach --color <name>` when the user invoked a color command
  and this chat is not yet attached
- Skip `inbase read-blueprint`; it provides the optional blueprint, instruction, and attached files
- Skip saying what you see on the blueprint after `read-blueprint`
- Report a plan before telling the user what you see on the blueprint (`I see on the blueprint ...`)
- Run `wait-for-approval` or `explain wait`; those commands are gone
- Wait for a typed request when `/coral` `/amber` `/lime` `/orange` `/violet` `/teal` `/crimson` `/forest` `/grey` `/white` (or an alias) has no text and an enabled blueprint is already the request
- Invent extra files or a larger feature when there is no chat instruction and an enabled blueprint is leading
- Treat the chat request or your own plan as overriding an enabled blueprint
- Skip, rename, relocate, or replace files, islands, functions, variables, or imports from the global blueprint or this session's local blueprint when that dump is `enabled`
- Silently differ from an enabled blueprint; ask the user first
- Read global `user-context.json` for placed files; those live on the global or this session's local blueprint
- Follow another session's local blueprint
- Use the user's camera viewpoint to choose files
- Edit project files before `VISUAL_CODER_EXECUTE`
- Edit files for a change request before `report-plan` has replaced the waiting proposal
- Stop after a non-last `propose-patch` — implement the next invoked step in the same turn. Only stop after the last recorded step
- Write a unified diff yourself; `inbase propose-patch` records the current map overlay
- Prefix `npx inbase` with `cd /absolute/path`, request extra Shell permissions for it, or wait for the user to approve `propose-patch`
- Pass a patch file to `propose-patch`
- Explore, search, or re-plan after the last `propose-patch` before the user types `/explainit`, `/stop`, or a change request
- Keep editing after `/stop`; that command restores files and ends this session
- Ask the user to finish or close the session when they asked for changes — `report-plan` with the new remaining steps from the last proposal instead, which replaces the waiting proposal
- Stay silent or call tools before acknowledging a `VISUAL_CODER_ACK` in chat
- Propose another patch after `VISUAL_CODER_FINISHED`
- Restore, revert, or delete applied files after the user clicks Done or `VISUAL_CODER_FINISHED`
- Reuse, overwrite, or expand an existing session overlay yourself; `report-plan` replaces a waiting proposal, then `propose-patch` records a new snapshot
- Use this flow for git, lockfiles, or other non-source work
- Attach or follow the visual plan loop for files outside `inbase.json`
  `target`
- Attach or follow the visual plan loop for `/extract-blueprint`; that command
  writes a blueprint file only
