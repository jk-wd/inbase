---
description: Propose a blueprint from a description, optionally for a session color
---

The user invoked `/propose-blueprint [description] [color] [--execute]`. This command proposes a blueprint from the description. The color is optional. With a color, the blueprint is also placed on that session. With no color, only the blueprint file is written. `--execute` is optional and may appear anywhere. When it is present, write the blueprint file and implement it immediately.

Arguments:

$ARGUMENTS

Parse `[description] [color]`. Strip a bare `--execute` flag first, wherever it appears. The description is required. The color is optional, and only the last remaining word is a color when it is one of these session colors or aliases: `blue`, `sky`, `coral`, `red`, `amber`, `yellow`, `lime`, `green`, `orange`, `violet`, `purple`, `teal`, `crimson`, `forest`, `darkgreen`, `grey`, `gray`, `white`. Everything before that word is the description. If the last word is not one of those names, the whole remaining text is the description and there is no color.

If the description is missing, ask for it and stop.

When the user passed `--execute`, add `--execute` to every `propose-blueprint` command below. Do not pass `--dont-write-to-file` together with `--execute`.

## No color

1. Reply in this chat first with one short sentence that you are proposing a blueprint file from the description, with no session color.

2. Do **not** attach. Do **not** run `npx inbase attach`.

3. Run `propose-blueprint` to get the instruction. Do not pass `--session`.

```bash
npx inbase propose-blueprint --description "<description>"
```

This prints `VISUAL_CODER_PROPOSE_BLUEPRINT` with the description and an instruction block. Follow that instruction.

4. Curate the layer JSON as described below.

5. Save the blueprint file. Run the same command again and pass the curated layer JSON on stdin, or pass a `layer.json` path. Do not pass `--session`. Do not pass `--write`.

```bash
npx inbase propose-blueprint --description "<description>"
```

This writes `blueprints/<subject>-<num>/<subject>-<num>.blueprint.json` only. It does not write a wrapper and does not update the map. Pass `--dont-write-to-file` only when the file should not be written.

6. Tell the user the blueprint file was written and was not placed on a session. Name the file from `VISUAL_CODER_BLUEPRINT_FILE`. Briefly name the files, folders, functions, vars, relations, notes, pointers, deletions, and steps you proposed.

7. If the save command printed `VISUAL_CODER_PROPOSE_EXECUTE`, implement that blueprint now. Do not attach. Do not run `report-plan`. Create, edit, and delete the files, folders, symbols, imports, and deletions it names. Otherwise **stop.** Do not start implementing.

## With a color

1. Reply in this chat first with one short sentence that you are proposing a blueprint for that session color.

2. Attach to the session color:

```bash
npx inbase attach --color <color>
```

If attach fails, reply with that output and stop.

3. Run `propose-blueprint` to get the instruction:

```bash
npx inbase propose-blueprint --session <color> --description "<description>"
```

This prints `VISUAL_CODER_PROPOSE_BLUEPRINT` with the description and an instruction block. Follow that instruction. If it prints `VISUAL_CODER_BLUEPRINT_STEPS_START`/`END`, those are the steps the user already suggested on this color.

4. Curate the layer JSON as described below.

5. Save the proposed blueprint. Run the same command again and pass the curated layer JSON on stdin, or pass a `layer.json` path. Do not pass `--write`.

```bash
npx inbase propose-blueprint --session <color> --description "<description>"
```

This writes the folder `blueprints/<subject>-<num>/` in the target, with the blueprint in `<subject>-<num>.blueprint.json` and the session color in `<subject>-<num>-wrapper.json`. The layer JSON has no color; the session color comes from `--session`. The blueprint is also saved on the session and shown on the map. Pass `--dont-write-to-file` only when the map should update and the blueprint folder should not be written.

6. Tell the user that the blueprint has been proposed and is now visible on the map. Name the blueprint file from `VISUAL_CODER_BLUEPRINT_FILE` (its folder also holds the wrapper from `VISUAL_CODER_BLUEPRINT_WRAPPER`). Briefly name the files, folders, functions, vars, relations, notes, pointers, deletions, and steps you proposed.

7. If the save command printed `VISUAL_CODER_PROPOSE_EXECUTE`, implement it now. You are already attached. Do not attach again. Run `npx inbase read-blueprint --session <color>`, say what you see on the blueprint, then `report-plan` with `--steps` for the full implementation. After `VISUAL_CODER_EXECUTE`, implement one invoked step, `propose-patch`, and continue through the last step, then `finish`. Otherwise **stop.** Do not start implementing. The user will invoke the session color (e.g., `/coral`) to start implementing the blueprint.

## Layer JSON

Read `interpreting-blueprints.md` beside the inbase `SKILL.md`. Interpret every blueprint entity that way. Find existing files and folders in `codebase.json` first — the path is `VISUAL_CODER_CODEBASE_MAP`. Scan the target tree only when that map does not already name the file or folder. Curate a layer JSON. Paths are relative to the target root. Use every blueprint construct the description needs. Leave a field empty only when the plan does not need it.

Put new modules in `files` and `folders`, with their functions, vars, relations, and notes. Point at the existing entry point you will edit. Each import's `file` and `from` are project file paths, even when those files sit in different folders. `from` is the exporting file's path, never a symbol name, a package name, or a relative specifier. Start from the current blueprint steps if any: keep the useful ones, reword, merge, or drop the rest, and add missing ones. Omit `steps` to keep the current steps unchanged. With no session color, there are no current steps.

Drop:
- Generated files, lockfiles, dist/build/coverage, snapshots, editor/tooling noise
- Tests unless they are the contract for this area
- Trivial re-export barrels unless they ARE the public API
- Every helper, getter, loop var, and one-off local
- Notes that only restate the file or symbol name

Include `"subject"`: a short kebab-case name for this plan, such as `"timer"`.

```json
{
  "subject": "timer",
  "files": [{ "path": "src/timer/Timer.tsx" }],
  "folders": [{ "path": "src/timer" }],
  "functions": [{ "name": "Timer", "file": "src/timer/Timer.tsx" }],
  "variables": [{ "name": "WORK_SECONDS", "file": "src/timer/types.ts" }],
  "imports": [{ "name": "Timer", "from": "src/timer/Timer.tsx", "file": "src/App.tsx" }],
  "notes": [
    { "file": "src/timer", "kind": "folder", "note": "Timer feature. No extra packages." },
    { "file": "src/timer/Timer.tsx", "kind": "file", "note": "Wire the hook to the view." },
    { "file": "src/timer/Timer.tsx", "kind": "function", "name": "Timer", "note": "Top-level component. Props only." },
    { "file": "src/timer/types.ts", "kind": "variable", "name": "WORK_SECONDS", "note": "25 * 60. Do not read this from props." }
  ],
  "pointers": [
    { "kind": "file", "path": "src/App.tsx" },
    { "kind": "folder", "path": "src" },
    { "kind": "function", "path": "src/App.tsx", "name": "App" },
    { "kind": "variable", "path": "src/theme.ts", "name": "theme" }
  ],
  "deleted": ["src/legacy/OldTimer.tsx"],
  "steps": [
    "Add the timer types and constants",
    "Build the Timer component",
    "Render Timer in App and remove OldTimer"
  ]
}
```
