---
name: inbase
description: >-
  Grounds source-file changes in the Inbase visual map. Use when creating,
  editing, or deleting application source files in this repository, including
  when the user chats a change request without /inbase. Connects this chat to
  the next empty Inbase session, or to a color with /coral /red /amber and
  the other session colors. Lists every feature step, then edits live
  files after invocation and records each step with inbase propose-patch (no
  patch file). Do not use for git, docs-only, lockfiles, or questions.
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
- **`/blue`**: Blue is the global blueprint, not a chat. Do not attach.
- **`/go`**: start the waiting plan step, or accept the current proposal.
  After accept, stop; another `/go` starts the next step. The last proposal
  still needs `/go` to finish.
- **`/accept`**: same as `/go`.
- **`/explain [question]`**: explain mode on the map. If a plan or proposal is
  waiting, explain that proposal; the question is optional extra focus. After a
  `?` click on the map, `/explain` explains that file or folder. During explain
  mode, `/explain [question]` reports follow-up sub-steps.
- **`/skipinbase`**: do the user's request without Inbase. Do not attach or
  record patches.
- **Any other file-change request**, or this conversation already has a
  `VISUAL_CODER_SESSION`: connect if needed, then follow Required sequence.
  Do not refuse.

The LLM uses a plan-first loop. It reports the complete plan before editing
files, then **stops**. Do not poll the visualizer. The user drives the next
action from this chat:

- **`/go`**: invoke the waiting plan step, or accept the current proposal.
  After accept, stop; another `/go` starts the next step. The last proposal
  still needs `/go` to finish.
- **`/accept`**: same as `/go`.
- **`/explain`**: explain the current proposal, a pending map `?` click, or a
  follow-up question.
- An **alternative instruction** in chat while a proposal is waiting: edit those
  live files and `propose-patch` again, then stop for `/go`.

**Step by step** is off by default. Then `report-plan` and `/go` invoke the next
step immediately (`VISUAL_CODER_EXECUTE`). Implement that step in the same turn.
After the last recorded step, stop for `/go`. When the switch is on, wait for
`/go` between steps.

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

The moment a command prints `VISUAL_CODER_ACK`, **reply in this chat first**
with one short sentence that acknowledges the signal. After `attach`, name the
color from `VISUAL_CODER_COLOR`, for example: `Connecting to the Coral session.`
For later acks, echo the signal, for example: `Got it — running step 2: Show ColorGenerator on Home.` Then continue
the required tools in the same turn. Do not start with a long analysis. Do not
call tools before that sentence.

After `propose-patch`, **stop** unless Step by step is off and the next step is
already invoked — then implement that step now. Do not explore, search, or
re-plan. Otherwise wait for `/go`, `/explain`, or an alternative instruction
in this chat.

## Required sequence

1. **Read the current layout**. Attach already started the session. Run
   this once to load the optional blueprint, instruction, and attached files — it returns
   immediately. Do not wait for the user to send a blueprint. If you cannot
   report a plan yet (no instruction and no enabled blueprint work), **stop**.
   Wait for the user to type a request, `/go`, or `/explain` in chat.

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

6. **Step by step is off by default**, so `report-plan` usually prints that the
   first step is already invoked (`VISUAL_CODER_EXECUTE` / phase working).
   Implement that step now. If the switch is on, **stop** and tell the user the
   plan is on the map and they can type `/go` to start the first step (or
   `/explain` to walk it). Do **not** run `wait-for-approval`. Do **not** edit
   project files until the step is invoked.
7. When the user types **`/go`** (or **`/accept`**), run
   `npx inbase go --session "<session-id>"`.
   If that prints `VISUAL_CODER_EXECUTE`, implement only that step by editing
   the live project files (Write, StrReplace, Delete). Paths are the same ids as
   `codebase.json`. Then record the step:

```bash
npx inbase propose-patch --session "<session-id>"
```

   Do not write a unified diff. Do not pass a `.patch` file. Never write or
   replace a patch already stored in the session folder. Then **stop**, unless
   Step by step is off and the next step is already invoked — implement that
   step now. Wait for `/go` to accept the last proposal (or an alternative
   instruction) in chat. If that prints `VISUAL_CODER_ACCEPTED`, do not edit
   files. **Stop.** Wait for `/go` on the next step unless it is already
   invoked. The last proposal still needs `/go` to finish.
   If that prints `VISUAL_CODER_FINISHED`, tell the user the feature is done
   and **stop**. Do not propose another patch.
8. When the user types **`/explain`**, do not edit project files and do not
   invoke the next step. Run `npx inbase explain start` (with `--question` when
   they provided one). If that prints `VISUAL_CODER_EXPLAIN` for a map `?`
   click, inspect that path and report one `--step`. If it prints
   `VISUAL_CODER_EXPLAIN_FOLLOWUP`, report sub-steps with `--parent`. If it
   prints `VISUAL_CODER_PROPOSAL`, report every map step for that proposal.
   Then `npx inbase explain report`. After reporting, **stop**. The user
   navigates the map. They type `/explain` again for a follow-up, or `/go`
   to continue the plan.
9. If the user sends an **alternative instruction** while a proposal is
   waiting, edit those live files, then `inbase propose-patch`. Stop for
   `/go`. Do not start the next step and do not report a new plan.
10. After a finished handshake, the explorer already removed stored session
    diffs. The global blueprint remains. Optionally run:

```bash
npx inbase propose-patch --session "<session-id>" --clear
```

## Do not

- Start a visual session from chat with `start-session`; `npx inbase run` already opened 5 empty slots
- Invent a session id; run `npx inbase attach` with no `--session`, or
  `npx inbase attach --color <name>` when the user invoked a color command
- Skip `inbase wait-for-blueprint`; it returns immediately and provides the optional blueprint, instruction, and attached files
- Run `wait-for-approval` or `explain wait`; those commands are gone
- Treat the chat request or your own plan as overriding an enabled blueprint
- Skip, rename, relocate, or replace files, islands, functions, variables, or imports from the global blueprint or this session's local blueprint when that dump is `enabled`
- Silently differ from an enabled blueprint; ask the user first
- Read global `user-context.json` for placed files; those live on the global or this session's local blueprint
- Follow another session's local blueprint
- Use the user's camera viewpoint to choose files
- Edit project files before `VISUAL_CODER_EXECUTE`
- Keep editing after `inbase propose-patch` until the user types `/go` (or Step by step is off and the next step is already invoked)
- Write a unified diff yourself; `inbase propose-patch` with no file records the git diff
- Pass a `.patch` file to `propose-patch` unless you are debugging the CLI
- Explore, search, or re-plan after `propose-patch` before the user types a command
- Stay silent or call tools before acknowledging a `VISUAL_CODER_ACK` in chat
- Propose the next step before the user types `/go` (unless Step by step is off)
- Propose another patch after `VISUAL_CODER_FINISHED`
- Reuse, overwrite, or expand an existing session diff
- Use this flow for git, lockfiles, or other non-source work
