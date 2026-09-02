---
name: inbase
description: >-
  Grounds source-file changes in the Inbase visual map. Use when creating,
  editing, or deleting application source files in this repository, including
  when the user chats a change request without /inbase. Connects this chat to
  the next empty Inbase session, or to a color with /coral /red /amber and
  the other session colors. Always works via the plan: lists every feature
  step, then edits live files after invocation and records each step with
  inbase propose-patch (no patch file). A later change request must
  report-plan from the last proposal before editing. Do not use for git,
  docs-only, lockfiles, or questions.
---

# Inbase visual edits

Apply this skill **whenever the work is file changes in this repository**.
Skip it for git, lockfiles, `.inbase`, `.cursor`, or questions with no code
changes.

`npx inbase run` creates 5 empty chat slots. A regular Cursor chat connects to
the next unconnected slot. You do not need `/inbase`.

- **`/coral` `/amber` `/lime` `/orange` `/violet`**: attach this chat to that
  color's empty slot. Aliases: `/red` (Coral), `/yellow` (Amber), `/green`
  (Lime), `/purple` (Violet). The text after the command is the user's request.
  If there is no text (`/violet` with nothing after it), attach and start from
  the enabled blueprint only: create those files and structure. Ask if you
  need more information.
- **`/blue`**: Blue is the global blueprint, not a chat. Do not attach.
- **`/go`**: start the waiting plan step, or accept the current proposal.
  After accept, stop; another `/go` starts the next step. The last proposal
  still needs `/go` to finish.
- **`/accept`**: same as `/go`. The last proposal still needs `/accept` or
  `/go` to finish.
- **`/explain [question]`**: explain mode on the map. If a plan or proposal is
  waiting, or the map is showing a proposal diff, explain what has changed in
  that proposal; the question is optional extra focus. If branch changes (diff
  mode) is on, `/explain` with no question explains what has changed in that
  git diff. After a `?` click on the map, `/explain` explains that file or
  folder. During explain mode, `/explain [question]` reports follow-up
  sub-steps.
- **`/skipinbase`**: do the user's request without Inbase. Do not attach or
  record patches.
- **Any other file-change request**, or this conversation already has a
  `VISUAL_CODER_SESSION`: connect if needed, then follow Required sequence.
  Do not refuse.

## Always work via the plan

Every file change must follow the current plan. Do not freelance edits, skip
steps, or patch a waiting proposal in place. The map plan is the work.

If the user asks for something that requires the plan to change, that is
allowed. **Update the plan from the point of the last proposal**, then
implement. Do not edit files first.

Example: the plan is `1. Step A`, `2. Step B`, `3. Step C`. The user does not
`/go` step C and asks for a change. Replace step C with one or more remaining
steps for the new goal. Keep A and B. Pass **only those remaining `--steps`**
to `report-plan`. That **replaces** the waiting proposal. Then implement the
invoked step.

```bash
npx inbase report-plan \
  --session "<session-id>" \
  --feature "short feature name" \
  --steps "New step C" \
  --steps "Follow-up D"
```

Do **not** ask the user to `/go` or `/accept` the last proposal, finish, or close the
session so they can start over.

The user drives the next action from this chat. Do not poll the visualizer:

- **`/go`** or **`/accept`**: invoke the waiting plan step, or accept the
  current proposal. After accept, stop; another `/go` or `/accept` starts the
  next step. The last proposal still needs `/go` or `/accept` to finish.
- **`/explain`**: explain the current proposal or git diff (what has changed),
  a pending map `?` click, or a follow-up question.
- **A later change request** (this chat already has `VISUAL_CODER_SESSION`,
  and a plan or proposal is waiting): stay in this session. `report-plan`
  with the new remaining steps from the last proposal. That **replaces** the
  waiting proposal. Then implement. Never edit first. `/accept` and `/go`
  are not change requests — they finish or continue the current proposal.

**Step by step** is off by default. Then `report-plan` and `/go` invoke the next
step immediately (`VISUAL_CODER_EXECUTE`). Implement that step in the same turn.
After the last recorded step, stop for `/go` or `/accept`. When the switch is on, wait for
`/go` or `/accept` between steps.

**Recorded patches are the session record.** After `VISUAL_CODER_EXECUTE`, edit
live project files with Write, StrReplace, and Delete for that step only. Then
run `inbase propose-patch` with no patch file. Inbase diffs the working tree
against the snapshot taken at invoke and stores that patch. Then **stop**,
unless Step by step is off and the next step is already invoked. Do not write a
unified diff yourself.

The visualizer stores immutable diffs under
`.inbase/diff-sessions/<session-id>/diffs/`. Inbase must already be running
(`inbase run` or `npx inbase run`). Prefer `npx inbase` so the local package
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
`Connecting to the Coral session.` Then continue from `read-blueprint` below.

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

Then continue from `read-blueprint` below. Do **not** run `start-session`.
Do **not** wait for a blueprint handshake.

## Direct response

The moment a command prints `VISUAL_CODER_ACK`, **reply in this chat first**
with one short sentence that acknowledges the signal. After `attach`, name the
color from `VISUAL_CODER_COLOR`, for example: `Connecting to the Coral session.`
After `read-blueprint`, the ack is what you see: start with
`I see on the blueprint` and name the files, folders, symbols, imports, notes,
and pointers. For other later acks, echo the signal, for example:
`Got it — running step 2: Show ColorGenerator on Home.` Then continue
the required tools in the same turn. Do not start with a long analysis. Do not
call tools before that sentence.

After `propose-patch`, **stop** unless Step by step is off and the next step is
already invoked — then implement that original next plan step now. Do not
explore, search, or re-plan on your own. Wait for `/go`, `/accept`, `/explain`, or a
**change request** in this chat. A change request must `report-plan` first
(remaining steps from the last proposal), then implement. Do not edit files
before that `report-plan`. Do not ask the user to `/go` the last proposal so
they can close the session.

## Required sequence

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
     **stop**. Wait for the user to type a request, `/go`, `/accept`, or `/explain`.

```bash
npx inbase read-blueprint --session "<session-id>"
```

   The user may have placed files and islands on the map, or left the
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
   `userCreatedBlocks`, `userCreatedIslands`, `addedFunctions`,
   `addedVariables`, and `addedImports` as the source of truth for this chat.
   Create those paths and add those symbols even if they are not on disk.
   Honor the global blueprint and this session's local blueprint. Do not use
   another session's local blueprint.
   Do not omit, rename, relocate, or replace a blueprint file, island, symbol,
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

7. **Step by step is off by default**, so `report-plan` usually prints that the
   first step is already invoked (`VISUAL_CODER_EXECUTE` / phase working).
   Implement that step now. If the switch is on, **stop** and tell the user the
   plan is on the map and they can type `/go` to start the first step (or
   `/explain` to walk it). Do **not** run `wait-for-approval`. Do **not** edit
   project files until the step is invoked.
8. When the user types **`/go`** or **`/accept`**, run
   `npx inbase go --session "<session-id>"` or
   `npx inbase accept --session "<session-id>"` (they do the same thing).
   If that prints `VISUAL_CODER_EXECUTE`, implement only that step by editing
   the live project files (Write, StrReplace, Delete). Paths are the same ids as
   `codebase.json`. Then record the step:

```bash
npx inbase propose-patch --session "<session-id>"
```

   Do not write a unified diff. Do not pass a `.patch` file. Never write or
   replace a patch already stored in the session folder. Then **stop**, unless
   Step by step is off and the next step is already invoked — implement that
   step now. Wait for `/go`, `/accept`, `/explain`, or a change request in chat.
   `/go` and `/accept` accept the last proposal to finish. A **change request** must
   **replace** that waiting proposal instead: do not ask the user to `/go`
   so they can close the session. If `/go` or `/accept` prints `VISUAL_CODER_ACCEPTED`,
   do not edit files. **Stop.** Wait for `/go` or `/accept` on the next step unless it is
   already invoked. The last proposal still needs `/go` or `/accept` to finish — unless
   the user asked for changes, in which case replace it.
   If that prints `VISUAL_CODER_FINISHED`, tell the user the feature is done
   and **stop**. Do not propose another patch.
9. If the user types a **change request** while a plan or proposal is waiting
   (not `/go`, `/accept`, or `/explain`): stay in this session. **Do not edit files yet.**
   List the new remaining steps from the last proposal: replace that waiting
   step with one or more steps for the new goal (example: drop step C, keep
   A and B, report `New step C` and any follow-ups). Run `report-plan` with
   those remaining `--steps` only — do not repeat already-accepted steps.
   That replaces the waiting proposal. If that prints `VISUAL_CODER_EXECUTE`,
   implement that step now. Never tell the user to `/go` the last proposal so
   they can close the session. Never `propose-patch` a change until
   `report-plan` has replaced the waiting step.
10. When the user types **`/explain`**, do not edit project files and do not
    invoke the next step. Run `npx inbase explain start` (with `--question` when
    they provided one). If that prints `VISUAL_CODER_EXPLAIN` for a map `?`
    click, inspect that path and report one `--step`. If it prints
    `VISUAL_CODER_EXPLAIN_FOLLOWUP`, report sub-steps with `--parent`. If it
    prints `VISUAL_CODER_PROPOSAL` or `VISUAL_CODER_DIFF`, walk the listed
    changes (between `VISUAL_CODER_CHANGES_START` / `END` when present). Then
    `npx inbase explain report`. After reporting, **stop**. The user navigates
    the map. They type `/explain` again for a follow-up, `/go` or `/accept` to continue
    the plan, or a change request to replace the waiting proposal.
11. After a finished handshake, the explorer already removed stored session
    diffs. The global blueprint remains. Optionally run:

```bash
npx inbase propose-patch --session "<session-id>" --clear
```

## Do not

- Start a visual session from chat with `start-session`; `npx inbase run` already opened 5 empty slots
- Invent a session id; run `npx inbase attach` with no `--session`, or
  `npx inbase attach --color <name>` when the user invoked a color command
- Skip `inbase read-blueprint`; it provides the optional blueprint, instruction, and attached files
- Skip saying what you see on the blueprint after `read-blueprint`
- Report a plan before telling the user what you see on the blueprint (`I see on the blueprint ...`)
- Run `wait-for-approval` or `explain wait`; those commands are gone
- Wait for a typed request when `/coral` `/amber` `/lime` `/orange` `/violet` (or an alias) has no text and an enabled blueprint is already the request
- Invent extra files or a larger feature when there is no chat instruction and an enabled blueprint is leading
- Treat the chat request or your own plan as overriding an enabled blueprint
- Skip, rename, relocate, or replace files, islands, functions, variables, or imports from the global blueprint or this session's local blueprint when that dump is `enabled`
- Silently differ from an enabled blueprint; ask the user first
- Read global `user-context.json` for placed files; those live on the global or this session's local blueprint
- Follow another session's local blueprint
- Use the user's camera viewpoint to choose files
- Edit project files before `VISUAL_CODER_EXECUTE`
- Edit files for a change request before `report-plan` has replaced the waiting proposal
- Keep editing after `inbase propose-patch` until the user types `/go`, `/accept`, `/explain`, or a change request (or Step by step is off and the next step is already invoked)
- Write a unified diff yourself; `inbase propose-patch` with no file records the git diff
- Pass a `.patch` file to `propose-patch` unless you are debugging the CLI
- Explore, search, or re-plan after `propose-patch` before the user types `/go`, `/accept`, `/explain`, or a change request
- Ask the user to `/go` or `/accept` the last proposal, finish, or close the session when they asked for changes — `report-plan` with the new remaining steps from the last proposal instead, which replaces the waiting proposal
- Stay silent or call tools before acknowledging a `VISUAL_CODER_ACK` in chat
- Propose the next original step before the user types `/go` or `/accept` (unless Step by step is off or they asked for changes)
- Propose another patch after `VISUAL_CODER_FINISHED`
- Reuse, overwrite, or expand an existing session diff file yourself; `report-plan` replaces a waiting proposal, then `propose-patch` records a new patch
- Use this flow for git, lockfiles, or other non-source work
