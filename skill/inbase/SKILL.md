---
name: inbase
description: >-
  Grounds source-file changes in the Inbase visual map. Use when creating,
  editing, or deleting application source files in this repository. Lists every
  feature step, then works only via patch files. Patch files are the single
  source of truth: never Write, StrReplace, or Delete project files; only write
  a unified diff and publish it. Do not use for git, docs-only, lockfiles, or
  questions.
---

# Inbase visual edits

Apply this skill **whenever the work is file changes in this repository**.
Skip it for git, lockfiles, `.inbase`, `.cursor`, or questions with no code
changes.

The LLM uses a plan-first loop. It reports the complete plan before writing a
patch. When **Step by step** is on, it waits for the user to invoke the first
step, publishes only that step's diff, then waits for **Accept proposal** on
that step or an alternative instruction. When **Step by step** is
off, `inbase wait-for-approval` returns `VISUAL_CODER_EXECUTE` for every
remaining step without the user clicking; after the last patch, wait
for the user to **Accept proposal**. They can still walk Previous/Next over the diffs.

**Patch files are the single source of truth.** Do not Write, StrReplace, or
Delete project files. Only write a unified diff and publish it with
`inbase propose-patch`. That command stores the patch and applies the live
patch chain (baseline + accepted patches + this step). A later instruction
replaces the withdrawn step's patch; write the new diff against the accepted
live files, not against the withdrawn proposal.

Every Cursor chat has an explicit session ID. Pass that same ID to every
command. The visualizer stores immutable diffs under `.inbase/diff-sessions/<session-id>/diffs/`.

Inbase must already be running (`inbase run` or `npx inbase run`). Prefer
`npx inbase` so the local package is used.

## Required sequence

1. As soon as this skill applies, start the visual session so the explorer can
   offer a blueprint handshake. Do this before reading context or listing steps:

```bash
npx inbase start-session --session "<current-cursor-chat-id>"
```

2. **Stop and wait for the blueprint handshake**. Do not report a plan and do
   not write a patch until this prints `VISUAL_CODER_BLUEPRINT_READY`:

```bash
npx inbase wait-for-blueprint --session "<current-cursor-chat-id>"
```

   The explorer asks **Setup blueprint: Yes vs No**.
   - **No**: skip the initial placement. The user can still place files and
     islands on later steps; re-read this session's `blueprint.json` before
     each step.
   - **Yes**: the user places files (`Space`) and islands (`B`), then clicks
     **Send blueprint**. They can keep placing on later steps. This chat's
     blueprint is stored only for this session.
3. Read the handshake output between `VISUAL_CODER_BLUEPRINT_START` and
   `VISUAL_CODER_BLUEPRINT_END`, or read
   `.inbase/diff-sessions/<session-id>/blueprint.json`.
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
4. Read `.inbase/user-context.json` for viewpoint only.
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
   one patch is one landscape change (usually one new file, or a few related
   edits).
7. Report the plan before making a diff:

```bash
npx inbase report-plan \
  --session "<current-cursor-chat-id>" \
  --feature "short feature name" \
  --steps "Add Clock component" \
  --steps "Show Clock on Home"
```

8. **Stop and wait for invocation**:

```bash
npx inbase wait-for-approval --session "<current-cursor-chat-id>"
```

   Do not write a patch until this prints `VISUAL_CODER_EXECUTE`. If Step by
   step is off, this returns immediately for each remaining step. Before
   implementing, re-read this session's `blueprint.json`; the user can place
   files and islands on any step.
9. Implement only the invoked step as a unified diff against the current live
   files (baseline + accepted patch files). Paths are relative to the
   project root (same ids as `codebase.json`):

```diff
--- /dev/null
+++ b/src/components/Clock.tsx
@@ -0,0 +1,5 @@
+export function Clock() {
+  return <time>00:00</time>
+}
```

```diff
--- a/src/pages/Home.tsx
+++ b/src/pages/Home.tsx
@@ -1,3 +1,4 @@
+import { Clock } from '../components/Clock'
 import { Counter } from '../components/Counter'
```

   Write that diff to a new `.patch` file, then publish it:

```bash
npx inbase propose-patch \
  --session "<current-cursor-chat-id>" \
  /tmp/step.patch
```

   The patch path or stdin is required. Never write or replace a patch already
   stored in the session folder. `inbase propose-patch` stores the new file and
   applies the live patch chain. Do not `git apply`, copy files, or edit
   project files yourself.

10. **Stop.** Do not edit project files. The stored patch files are already the
    live tree.
11. Wait until the user clicks **Accept proposal** on the current step (or, when Step by
   step is off, until the next step is auto-invoked), sends an alternative
   instruction, or stops the workflow:

```bash
npx inbase wait-for-approval --session "<current-cursor-chat-id>"
```

12. Read the wait command output:

   - Exit `0` (`VISUAL_CODER_EXECUTE`): the highlighted step was invoked. Re-read
     this session's `blueprint.json` first; the user can place files and islands
     on any step, not only during the initial blueprint. Build only that step as
     a unified diff against the live files, publish it with `inbase propose-patch`,
     then wait again. Do not edit project files.
   - Exit `5` (`VISUAL_CODER_FINISHED`): that was the last step. The visualizer
     already applied the final patch and removed stored session diffs and
     blueprint drafts. Optionally run `--clear` if anything remains, tell the
     user the feature is done, and **stop**. Do not propose another patch.
   - Exit `4` (`VISUAL_CODER_REPLAN`): do **not** edit project files and do not
     rewrite an earlier accepted patch. The withdrawn proposal is no longer live;
     disk is baseline + accepted patch files. Follow the text between
     `VISUAL_CODER_INSTRUCTION_START` and `VISUAL_CODER_INSTRUCTION_END`, read
     this session's `blueprint.json` when it is enabled (files, islands,
     `addedFunctions`, `addedVariables`, `addedImports`). The blueprint stays
     leading. If the new instruction would differ from it, ask the user before
     replacing the plan. Read `user-context.json` (follow the viewpoint only if
     `followLook` is true), replace the plan from the current step onward using
     `inbase report-plan`, then wait for the user to invoke the first revised
     step. The replacement patch must apply on top of the accepted live files,
     not the withdrawn proposal.
   - Exit `2` (`VISUAL_CODER_STOPPED`) or `3` (timeout): make no further
     project changes.

13. After a finished handshake, the explorer already removed stored session
    diffs and blueprint drafts. Optionally run:

```bash
npx inbase propose-patch --session "<current-cursor-chat-id>" --clear
```

## Do not

- Skip `inbase start-session` once this skill applies
- Skip `inbase wait-for-blueprint` or report a plan before `VISUAL_CODER_BLUEPRINT_READY`
- Treat the chat request, viewpoint, or your own plan as overriding an enabled blueprint
- Skip, rename, relocate, or replace this session's `blueprint.json` files, islands, functions, variables, or imports when `enabled` is true
- Silently differ from the blueprint; ask the user first
- Read global `user-context.json` for placed files; those live on the session blueprint
- Follow the user's look when `followLook` is false
- Write, edit, create, or delete project files directly
- `git apply`, copy, or otherwise materialize a patch yourself
- Treat on-disk project files as something to edit; they are a replay of the
  stored patch files
- Announce file lists instead of a patch
- Write a patch before its plan step is invoked
- Propose the next step before `inbase wait-for-approval` returns `VISUAL_CODER_EXECUTE`
- Propose another patch after `VISUAL_CODER_FINISHED`
- Reuse, overwrite, or expand an existing session diff
- Use this flow for git, lockfiles, or other non-source work
