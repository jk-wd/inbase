---
name: inbase
description: >-
  Grounds source-file changes in the Inbase visual map. Use only when creating,
  editing, or deleting files inside the mapped target from inbase.json
  (`target`; default `.`), including when the user chats a change request
  without /inbase. On the first turn, connects this chat to the next empty
  Inbase session, or to a color with /coral /red /amber and the other session
  colors. Later turns stay in that session: never attach again. MUST run
  `npx inbase report-deliveries` with titles only — do not invent steps yet —
  then `npx inbase report-plan` for the invoked delivery before any file edit
  or propose-patch. Chat steps are not the plan. After each invoked step, MUST
  propose-patch before the next step. Never implement the whole plan first.
  After the last step of a delivery, if the next delivery is invoked, report-plan
  for that delivery only. A later change request must report-plan from the last
  proposal before editing, including after the last recorded step. Do not
  use for files outside that target (sibling apps, CLI, map tooling), git,
  docs-only, lockfiles, questions, or `/extract-blueprint`.
---

# Inbase visual edits

Apply this skill **only when the work is file changes inside the mapped
target**. Read `inbase.json` `target` (relative to that file; `.` if missing).
If none of the files you would create, edit, or delete live under that
folder, do **not** attach, do **not** run `npx inbase attach`, and do **not**
follow the visual plan loop. Continue as a normal coding task.

Skip it for git, lockfiles, `.inbase`, `.cursor`, `.claude`, `.agents`,
`.zed`, `.rules`, `.cline`, `.clinerules`, `.github/skills`, `.opencode`,
`.lmstudio`, questions with no code changes, or `/extract-blueprint`.

`npx inbase run` creates 11 empty chat slots. A regular chat connects to
the next unconnected slot **only for work inside `target`**. You do not need
`/inbase`. The session window **Done** button keeps applied files and frees
the color; it does not come through this chat. Do not wait for it.

## Commands

Colors: `/blue` `/coral` `/amber` `/lime` `/orange` `/violet` `/teal` `/crimson`
`/forest` `/grey` `/white`. Aliases: `/sky` (Blue), `/red` (Coral), `/yellow` (Amber),
`/green` (Lime), `/purple` (Violet), `/darkgreen` (Forest), `/gray` (Grey).
Text after the command is the request. Empty text: attach and start from an
enabled blueprint only — MUST `report-deliveries` first (titles only, no steps),
then `report-plan` for the invoked delivery, then implement as closely as
possible; ask if you need more. Extra files are allowed if the blueprint does not cover them.

- **`/stop`**: discard the plan and patches, free the color, keep live project
  files, then stop. Do not edit files after `/stop`.
- **`/explainit [question]`**: do not edit. Explain a waiting proposal, git
  diff (`VISUAL_CODER_DIFF`), map `?` click, or follow-up sub-steps.
- **`/extract-blueprint`**: do not attach. Follow that command.
- **Any other file-change request inside `target`**: if this conversation
  already has `VISUAL_CODER_SESSION`, stay in that session. Do **not** attach.
  Else attach once. If the files are outside `target`, skip this skill.

## Stay in this session

If this conversation already printed `VISUAL_CODER_SESSION`, you are already
attached. **Do not run `npx inbase attach`.** That value is the color. Use it
as `--session`. Attach without `--session` locks a **different color**.
never attach again to continue or update.

A waiting last proposal is still this session. Update the plan
**from the point of the last proposal** with `report-plan` first, then
implement. Do not edit files first. Do not say `Connecting to the ... session.`
Do not start a new chat. Do not ask the user to finish or **close the session**
so they can start over.

## Always work via the plan

**First `report-deliveries` (titles only), then `report-plan` for the invoked
delivery, then implement. Always. Never invent steps before deliveries.**

You MUST run `npx inbase report-deliveries` after the blueprint and before
any `report-plan`. Pass only short delivery titles. A delivery is a shippable
chunk (a few related files or one coherent feature). Do **not** invent
implementation steps yet. Do **not** list steps in chat. Do **not** think
through how each file will be written. Titles only.

Then MUST run `npx inbase report-plan` with `--steps` for the **invoked
delivery only**, before any Write, StrReplace, edit, delete, or
`propose-patch`. Listing steps in chat is **not** the plan. Reading the
blueprint is **not** the plan. Do not invent steps for later deliveries.
The first step is **not** invoked until `report-plan` prints
`VISUAL_CODER_EXECUTE`. Do not skip `report-deliveries` or `report-plan`
because the work is obvious, one file, already on the blueprint, or the
same as last time. Do not freelance edits, skip steps, or patch a waiting
proposal in place.

```bash
npx inbase report-deliveries \
  --session <color> \
  --feature "short feature name" \
  --delivery "Score system" \
  --delivery "Balloon physics"
```

Example: plan is `1. A`, `2. B`, `3. C`. User asks for a change. Keep A and B.
Replace C with remaining steps. Pass **only those remaining `--steps`** to
`report-plan`. That **replaces the waiting proposal**. Then implement.
Same after the last recorded step.

```bash
npx inbase report-plan \
  --session <color> \
  --feature "short feature name" \
  --steps "New step C" \
  --steps "Follow-up D"
```

**One step, then `propose-patch`. Always. Never implement the whole plan first.**

`report-plan` and each recorded non-last step invoke the next step
(`VISUAL_CODER_EXECUTE`). Never implement before that execute line. After
`VISUAL_CODER_EXECUTE` for step N, edit files for step N only. Then MUST
`propose-patch` before any file for step N+1. Chat "done" is not the record.
Do not batch all plan steps into one edit pass. A non-last `propose-patch`
invokes the next step — implement that next step only, then `propose-patch`
again, in the **same turn**. Do not stop. Do not ask the user to review a mid-plan step.
If `propose-patch` prints `VISUAL_CODER_PLAN_DELIVERY`, MUST `report-plan`
with `--steps` for **that delivery only**. Do not invent steps for later
deliveries. After the last recorded step, stop for `/explainit`, `/stop`, or a change
request.

```bash
npx inbase propose-patch --session <color> \
  --note "src/Foo.ts: edited bar() to reject empty input"
```

Pass `--note "path: one-line goal"` for every updated, added, or deleted file
and each changed folder. Do not pass a patch file. Do not write a unified
diff. After the last recorded step, **stop**.

Prefer `npx inbase`. Run it from the project working directory.
Do not prefix it with `cd /absolute/path`. Do not request extra Shell
permissions (`all`, `full_network`) for Inbase CLI. Record immediately; do
not wait for the user to click Run.

### Attach (once)

If this chat has **never** printed `VISUAL_CODER_SESSION`:

- Color command → `npx inbase attach --color <that command name>` (`/red` → `--color red`).
- Else if work is only outside `inbase.json` `target`, **stop following this skill**.
- Else: `npx inbase attach`

Already-connected colors are skipped unless you asked for that color — then
leftover LLM work is discarded so this chat **starts clean**. A new attach
clears leftover steps, patches, and working state. Blueprint files, the
initial instruction, and attached context stay. Recorded file changes from
that leftover session are restored.

`VISUAL_CODER_SESSION` is the color. Use `--session <color>` later. Read
`VISUAL_CODER_COLOR` and reply first: `Connecting to the Coral session.`
Then continue from `read-blueprint`. Run attach **once** per conversation.

Attach failures — reply with exactly this line, then **stop**:

- `VISUAL_CODER_NOT_RUNNING`:

```
Inbase isn't running. Start it with `npx inbase run`, then send this request again.
```

- `VISUAL_CODER_ALL_COLORS_LOCKED`:

```
Every color already has a chat connected. Click Done in a session window or type /stop in a connected chat, then try again.
```

- `VISUAL_CODER_COLOR_UNKNOWN`: reply with the rest of that line, then **stop**.

## Direct response

The moment a command prints `VISUAL_CODER_ACK`, **reply in this chat first**
with one short sentence. After the **first** `attach`, name the color from
`VISUAL_CODER_COLOR`, for example: `Connecting to the Coral session.` Do not
say that on a later turn. After `read-blueprint`, start with
`I see on the blueprint` and name the files, folders, symbols, imports, notes,
and pointers. Then MUST `report-deliveries` with titles only — do not invent
steps yet. Then MUST `report-plan` for the invoked delivery before any edit.
For other acks, echo the signal, then continue the required tools in the same
turn. Do not call tools before that sentence. Do not edit before `report-plan`.

## Required sequence

If this conversation already has `VISUAL_CODER_SESSION` and a plan or proposal
is waiting, do **not** restart from step 1. Do **not** attach.
`/explainit` → step 9. `/stop` → step 11. A change request
(including after the last recorded step) → step 8.

1. **Read the current layout**.

```bash
npx inbase read-blueprint --session <color>
```

   No instruction (empty `$ARGUMENTS`, no `VISUAL_CODER_INSTRUCTION_*`):
   - `VISUAL_CODER_BLUEPRINT_ONLY`, or the dump `enabled` true: that is the
     request. MUST `report-deliveries` first (titles only — do not invent
     steps), then `report-plan` for the invoked delivery from those files,
     folders, symbols, imports, notes, and pointers, then implement as closely
     as possible. Ask if you need more. Extra files are allowed if the blueprint does not cover them.
   - `VISUAL_CODER_NO_REQUEST`, or an empty blueprint: **stop**. Wait for a
     request, `/explainit`, or `/stop`.

   This session's blueprint is this color only. `VISUAL_CODER_INSTRUCTION_*`
   is the user's request.
   `VISUAL_CODER_CONTEXT_FILES_*` are session-only context; read each `path`.
   They are not project files to create. Instruction does not override an
   enabled blueprint; if they conflict, ask. No instruction is not a conflict.

3. Read the dump between `VISUAL_CODER_BLUEPRINT_START`/`END`. If that dump is
   `enabled` true, that blueprint is leading: follow it as closely as possible.
   After `report-plan`, create those `files`, `folders`, `addedFunctions`,
   `addedVariables`, and `addedImports` even if they are not on disk. Do not
   omit, rename, relocate, or replace them. Extra edits to existing files are
   allowed. Extra new files not in this blueprint are allowed when needed if
   the blueprint does not cover them. Do not use another session's blueprint.

4. **Say what you see on the blueprint** before `report-deliveries`. Start with
   `I see on the blueprint` and name every file, folder, function, variable,
   import, note, and pointer. If the dump is empty, say
   `I see nothing on the blueprint yet.` Do not list implementation steps.

5. **MUST run `report-deliveries` now** with every delivery as `--delivery`.
   Titles only. Do not invent implementation steps. Do not list steps in chat.
   Split a large blueprint into a few shippable deliveries. Small work can be
   one delivery.

6. **MUST run `report-plan` now** with `--steps` for the **invoked delivery
   only**. One recorded step = one landscape change. Chat is not a substitute.
   Do not edit. Do not `propose-patch`. Do not plan later deliveries.
   Wait for `VISUAL_CODER_EXECUTE` from that command.

7. **Only then** implement the **invoked step only**. Then MUST
   `propose-patch` before touching any later step. Repeat: one step, one
   `propose-patch`. Do **not** implement the whole plan then record once.
   `VISUAL_CODER_EXECUTE` exists only after `report-plan`. Do **not** run
   `wait-for-approval`. Do **not** edit until that execute line.
   If `VISUAL_CODER_PLAN_DELIVERY`, go back to step 6 for that delivery only.

8. **Change request** while a plan or proposal
   is waiting (not `/explainit` or `/stop`), including after the last recorded
   step: stay in this session. **Do not attach. Do not edit files yet.** MUST
   `report-plan` first. Replace the waiting step with remaining steps for the
   new goal. `report-plan` with those remaining `--steps` only — that replaces
   the waiting proposal. If `VISUAL_CODER_EXECUTE`, implement the invoked step
   only, then `propose-patch`. Never tell the user to finish or close the
   session. Never `propose-patch` until `report-plan` has replaced the waiting
   step.

9. **`/explainit`**: do not edit. `npx inbase explain start` (with `--question`
   when given). `VISUAL_CODER_EXPLAIN` → one `--step` for that path.
   `VISUAL_CODER_EXPLAIN_FOLLOWUP` → sub-steps with `--parent` (`1.1`,
   `1.1.1`, …). `VISUAL_CODER_PROPOSAL` or `VISUAL_CODER_DIFF` → walk
   `VISUAL_CODER_CHANGES_START`/`END`. Then `npx inbase explain report`.
   Write each `--body` for a mid-level developer: short paragraphs, name the
   functions, no compressed colon-lists. Then **stop**.

10. After a finished session, **Keep the applied project files.** Do not
    restore, revert, or delete the work. Optionally
    `npx inbase propose-patch --session <color> --clear` — that must not revert
    files.

11. **`/stop`**: do not edit. `npx inbase stop --session <color>`. Then **stop**.

## Do not

- Attach after `VISUAL_CODER_SESSION` — that locks a different color
- Say `Connecting to the ... session` on a later turn
- Skip `read-blueprint` or skip `I see on the blueprint` before `report-deliveries`
- Invent implementation steps before `report-deliveries`, or plan later
  deliveries before they are invoked
- Skip `report-deliveries`, skip `report-plan`, treat chat steps as the plan,
  or edit / `propose-patch` before `report-plan` prints `VISUAL_CODER_EXECUTE`
- Run `wait-for-approval` or `explain wait`
- Wait for a typed request when a color command has no text and an enabled blueprint is the request
- Omit, rename, relocate, or replace files, folders, or symbols from an enabled
  blueprint; follow it as closely as possible. Extra files are allowed only
  when the blueprint does not cover them
- Read global `user-context.json` for placed files; follow another session's blueprint; use camera viewpoint to choose files
- Edit before `VISUAL_CODER_EXECUTE` on a first plan or a change request
- Implement two or more plan steps before `propose-patch`, or skip
  `propose-patch` after a finished step
- Stop after a non-last `propose-patch`
- Prefix `npx inbase` with `cd /absolute/path`, request extra Shell permissions, pass a patch file, skip `--note`, or wait for the user to approve `propose-patch`
- Explore after the last recorded step; keep editing after `/stop`
- Ask the user to close the session when they asked for changes
- Stay silent before a `VISUAL_CODER_ACK`; propose another patch after `VISUAL_CODER_FINISHED`; restore files after Done
- Use this flow for git, lockfiles, files outside `target`, or `/extract-blueprint`
