---
description: Explain a codebase question on the Inbase map
---

The user invoked `/explain`. Do **not** attach an Inbase coding session. Do **not** edit project files. Do **not** run `inbase start-session`.

Explain mode only runs on the map. Start it so the visualizer switches to a map-only overlay, then walk the question step by step on that map.

The user's question is:

$ARGUMENTS

1. Start explain mode (requires `npx inbase run`):

```bash
npx inbase explain start --question "$ARGUMENTS"
```

If that fails with `VISUAL_CODER_NOT_RUNNING`, reply with that message and stop.

2. Reply in this chat first with one short sentence that you opened explain mode on the map.

3. Read the codebase for this question. Use the map's files and folders as the source of truth: file ids are repo-relative paths.

4. Report the explanation as ordered steps. Each step can highlight files and folders, select a block to show import relations, and zoom the map:

```bash
npx inbase explain report \
  --question "$ARGUMENTS" \
  --step "Short title" \
  --body "What this step is showing." \
  --files path/to/file.ts \
  --folders path/to/folder \
  --select path/to/file.ts \
  --zoom path/to/folder \
  --relations path/to/file.ts:path/to/other.ts \
  --info \
  --highlight function:currentExplainStep \
  --point function:currentExplainStep
```

Repeat `--step` for every step. Flags after a `--step` apply to that step. Use `--imported-by` when the step should show who imports the selected file. `--files` and `--folders` stay at full opacity; everything else on the map goes to 0.5. `--select` clicks that block so its relations draw. `--zoom` frames that folder or file.

`--info` opens the file info panel (functions, vars, classes). Pass `--info path/to/file.ts` to choose the file; otherwise it uses `--select` or the first `--files` path. `--highlight function:name` (or `variable:`, `class:`, or a bare name) lights those symbols in the panel. `--point function:name` draws an arrow from this step to that row. `--point file` points at the file title. `--highlight` / `--point` imply `--info`.

Keep steps small. Prefer real paths from the repo.

5. Wait for a follow-up on a step, or until the user exits:

```bash
npx inbase explain wait
```

6. Read the wait output. Reply in this chat with the `VISUAL_CODER_ACK` line first, then:

- Exit `0` (`VISUAL_CODER_ACK explain` / `VISUAL_CODER_EXPLAIN`): the user clicked `?` on a file, folder, or symbol. Replace the current explanation. Do not use `--parent`. Do not walk the map. Read the path from the ACK line, then start and report **one** explanation for the modal:

```bash
npx inbase explain start --question "Explain the function of the file path/to/file.ts and where it fits in the codebase."
```

Use the printed `--question` text. Then inspect that file or folder and report a single `--step` / `--body` with `npx inbase explain report`. Then run `npx inbase explain wait` again.

- Exit `0` (`VISUAL_CODER_ACK question` / `VISUAL_CODER_EXPLAIN_QUESTION`): the user asked about the printed parent step. Do not replace the whole explanation. Read the question between `VISUAL_CODER_INSTRUCTION_START` and `VISUAL_CODER_INSTRUCTION_END`. Report closer sub-steps with `--parent` (they become `7.1`, `7.2`, … and Next walks those until the original next step):

```bash
npx inbase explain report \
  --parent "7" \
  --question "the user's follow-up" \
  --step "Closer look" \
  --body "What this sub-step is showing." \
  --files path/to/file.ts
```

Then run `npx inbase explain wait` again. Asking another question replaces the current sub-steps. Sub-steps stay one level (`7.1`, `7.2`) — never `7.1.1`. If they asked from `7.1`, still report with `--parent "7"`.

- Exit `2` (`VISUAL_CODER_ACK stopped` / `VISUAL_CODER_EXPLAIN_STOPPED`) or `3` (`VISUAL_CODER_ACK timeout`): stop. Do not attach a coding session.
