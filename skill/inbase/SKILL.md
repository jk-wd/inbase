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
`.zed`, `.rules`, `.cline`, `.clinerules`, `.github/skills`, questions with
no code changes, or `/extract-blueprint`.

`npx inbase run` creates 10 empty chat slots. A regular chat connects to
the next unconnected slot **only for work inside `target`**. You do not need
`/inbase`. The session window **Done** button keeps applied files and frees
the color; it does not come through this chat. Do not wait for it.

## Commands

Colors: `/coral` `/amber` `/lime` `/orange` `/violet` `/teal` `/crimson`
`/forest` `/grey` `/white`. Aliases: `/red` (Coral), `/yellow` (Amber),
`/green` (Lime), `/purple` (Violet), `/darkgreen` (Forest), `/gray` (Grey).
Text after the command is the request. Empty text: attach and start from an
enabled blueprint only; ask if you need more. `/blue` is the global blueprint,
not a chat — do not attach.

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
**from the point of the last proposal**, then implement. Do not edit files
first. Do not say `Connecting to the ... session.` Do not start a new chat.
Do not ask the user to finish or **close the session** so they can start over.

## Always work via the plan

Every file change must follow the current plan. Do not freelance edits, skip
steps, or patch a waiting proposal in place.

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

`report-plan` and each recorded non-last step invoke the next step
(`VISUAL_CODER_EXECUTE`). Implement that next step in the **same turn**. Do
not stop. Do not ask the user to review a mid-plan step. After the last
recorded step, stop for `/explainit`, `/stop`, or a change request.

After `VISUAL_CODER_EXECUTE`, edit live files for that step only. Then:

```bash
npx inbase propose-patch --session <color> \
  --note "src/Foo.ts: edited bar() to reject empty input"
```

Pass `--note "path: one-line goal"` for every updated, added, or deleted file
and each changed folder. Do not pass a patch file. Do not write a unified
diff. Then implement the next invoked step. After the last recorded step,
**stop**.

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
and pointers. For other acks, echo the signal, then continue the required
tools in the same turn. Do not call tools before that sentence.

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
   - `VISUAL_CODER_BLUEPRINT_ONLY`, or either dump `enabled` true: that is the
     request. Plan only from those files, folders, symbols, imports, notes, and
     pointers. Ask if you need more. Do not invent extra files.
   - `VISUAL_CODER_NO_REQUEST`, or both blueprints empty: **stop**. Wait for a
     request, `/explainit`, or `/stop`.

   Global (blue) blueprint is shared. Local blueprint is this session's color
   only. `VISUAL_CODER_INSTRUCTION_*` is the user's request.
   `VISUAL_CODER_CONTEXT_FILES_*` are session-only context; read each `path`.
   They are not project files to create. Instruction does not override an
   enabled blueprint; if they conflict, ask. No instruction is not a conflict.

3. Read dumps between `VISUAL_CODER_BLUEPRINT_START`/`END` (global) and
   `VISUAL_CODER_LOCAL_BLUEPRINT_START`/`END` (this color). You can also read
   `.inbase/blueprint.json`. If either dump is `enabled` true, that blueprint
   is leading: create those `files`, `folders`, `addedFunctions`,
   `addedVariables`, and `addedImports` even if they are not on disk. Do not
   omit, rename, relocate, or replace them. Extra edits to existing files are
   allowed. Extra new files not in either blueprint are a deviation — **stop
   and ask** before reporting the plan. Do not use another session's local
   blueprint.

4. **Say what you see on the blueprint** before `report-plan`. Start with
   `I see on the blueprint` and name every file, folder, function, variable,
   import, note, and pointer — which are global vs this session's color. If
   both dumps are empty, say `I see nothing on the blueprint yet.`

5. List **all** steps. One recorded step = one landscape change.

6. Report the plan before editing (same `report-plan` shape as above).

7. First step is already invoked (`VISUAL_CODER_EXECUTE`). Implement it now.
   Do **not** run `wait-for-approval`. Do **not** edit until invoked.

8. **Change request** while a plan or proposal is waiting (not `/explainit` or
   `/stop`), including after the last recorded step: stay in this session.
   **Do not attach. Do not edit files yet.** Replace the waiting step with
   remaining steps for the new goal. `report-plan` with those remaining
   `--steps` only — that replaces the waiting proposal. If
   `VISUAL_CODER_EXECUTE`, implement now. Never tell the user to finish or
   close the session. Never `propose-patch` until `report-plan` has replaced
   the waiting step.

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
- Skip `read-blueprint` or skip `I see on the blueprint` before `report-plan`
- Run `wait-for-approval` or `explain wait`
- Wait for a typed request when a color command has no text and an enabled blueprint is the request
- Invent extra files when an enabled blueprint is leading; ask before differing
- Read global `user-context.json` for placed files; follow another session's local blueprint; use camera viewpoint to choose files
- Edit before `VISUAL_CODER_EXECUTE`, or before `report-plan` on a change request
- Stop after a non-last `propose-patch`
- Prefix `npx inbase` with `cd /absolute/path`, request extra Shell permissions, pass a patch file, skip `--note`, or wait for the user to approve `propose-patch`
- Explore after the last recorded step; keep editing after `/stop`
- Ask the user to close the session when they asked for changes
- Stay silent before a `VISUAL_CODER_ACK`; propose another patch after `VISUAL_CODER_FINISHED`; restore files after Done
- Use this flow for git, lockfiles, files outside `target`, or `/extract-blueprint`
