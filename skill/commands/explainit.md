---
description: Explain a codebase question on the Inbase map
---

The user invoked `/explainit`. Do **not** edit project files.

The user's question is:

$ARGUMENTS

## Write each `--body`

The map shows this text next to the step. Write it for a **mid-level developer** sitting next to you: easy to read, and still precise and technical. Prefer more text over a compressed one-liner.

Keep the `--step` title short. Put the explanation in `--body`.

- Open with what this file or step is, in one normal sentence.
- Then how it works: name the functions, flags, types, or data, and what each one does.
- Close with why it is here, or how it connects to the previous or next step.
- Use short paragraphs (about 2–4 sentences). Repeat `--body` once per paragraph, or put `\n\n` between paragraphs.
- Talk in complete sentences. "This file…" / "That function…" is easier to scan than fragments.

Do not pack a list of jobs into one colon-separated sentence. Avoid telegraphic copy like "New file. Browser-safe helpers for X: parse A, decide B, synthesize C, and format D." Split that into sentences a teammate can actually read.

## Proposal or diff in progress

If this chat is already attached to an Inbase session (`VISUAL_CODER_SESSION` in this conversation) and a plan or proposal is waiting, **explain that proposal**. Stay in this session. Do not attach a new coding session.

If `npx inbase explain start` prints `VISUAL_CODER_PROPOSAL`, a proposal (or its recorded diff) is on the map even if this chat is not the coding session — explain **what has changed in that proposal**. Do not attach.

If it prints `VISUAL_CODER_DIFF`, the map is showing the current git branch diff — explain **what has changed in this diff**. Do not attach.

If it prints `VISUAL_CODER_EXPLAIN` for a map `?` click, explain that file or folder instead (one `--step`).

If it prints `VISUAL_CODER_EXPLAIN_FOLLOWUP`, the map is already in explain mode — report sub-steps with `--parent` from `VISUAL_CODER_PARENT`. Nested follow-ups are allowed: 1.1, 1.1.1, 1.1.1.1, and so on. Do not replace the whole explanation.

Use the user's question when they provided one. If they did not, explain the current proposal, the current diff, or the pending `?` target.

1. Reply in this chat first with one short sentence that you are explaining.

2. Start explain mode (requires `npx inbase run`):

```bash
npx inbase explain start --question "$ARGUMENTS"
```

If `$ARGUMENTS` is empty, omit `--question` unless start asks for one. If that fails with `VISUAL_CODER_NOT_RUNNING`, reply with that message and stop.

3. Inspect the named files. When start prints `VISUAL_CODER_CHANGES_START` / `VISUAL_CODER_CHANGES_END`, those are the added, updated, and removed files (plus functions, vars, and imports) to walk. Report ordered steps that walk the map:

```bash
npx inbase explain report \
  --question "$ARGUMENTS" \
  --step "Short title" \
  --body "What this file or step is, in one normal sentence." \
  --body "How it works: name the functions, flags, or data, and what each one does." \
  --body "Why it is here, or how it connects to the previous or next step." \
  --files path/to/file.ts \
  --folders path/to/folder \
  --select path/to/file.ts \
  --zoom path/to/folder \
  --relations path/to/file.ts:path/to/other.ts \
  --info \
  --highlight function:currentExplainStep \
  --point function:currentExplainStep
```

For a follow-up, add `--parent` from `VISUAL_CODER_PARENT`. Repeat `--step` for that parent's children (`7.1`, `7.1.1`, `7.1.1.1`, …). For a `?` click, use a single `--step`. Repeat `--step` for every changed file or proposal step. Keep those map steps small. Prefer real paths from the repo.

4. **Stop.** Do not run `explain wait`. The user navigates the map. They type `/explainit` again for a follow-up or another `?` click, or click **Done** in the session window to keep the files and free the color.

## No proposal or diff

Do **not** attach an Inbase coding session. Explain mode only runs on the map. Start it so the visualizer switches to a map-only overlay, then walk the question step by step on that map.

1. Start explain mode (requires `npx inbase run`):

```bash
npx inbase explain start --question "$ARGUMENTS"
```

If that fails with `VISUAL_CODER_NOT_RUNNING`, reply with that message and stop. If the output includes `VISUAL_CODER_PROPOSAL`, `VISUAL_CODER_DIFF`, `VISUAL_CODER_EXPLAIN`, or `VISUAL_CODER_EXPLAIN_FOLLOWUP`, follow **Proposal or diff in progress** instead.

2. Reply in this chat first with one short sentence that you opened explain mode on the map.

3. Read the codebase for this question. Use the map's files and folders as the source of truth: file ids are repo-relative paths.

4. Report the explanation as ordered steps. Each step can highlight files and folders, select a block to show import relations, and zoom the map. Flags after a `--step` apply to that step.

Keep map steps small. Prefer real paths from the repo. Write each `--body` as in **Write each `--body`** above.

5. **Stop.** Wait for `/explainit` in chat for a follow-up. Do not run `explain wait`.
