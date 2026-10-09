---
description: Propose a first blueprint for a session color based on a description
---

The user invoked `/propose-blueprint [color] [description]`. This command makes the LLM propose a first blueprint suggestion based on the description.

Arguments:

$ARGUMENTS

Parse the arguments: `[color] [description]`. The color is the session color (e.g., `coral`, `blue`, `amber`). The description is a natural-language description of what the blueprint should contain.

If either argument is missing, ask for it and stop.

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

4. Read `interpreting-blueprints.md` beside the inbase `SKILL.md`. Interpret every blueprint entity that way. Then read the codebase if needed. Look at the target folder structure to understand what already exists. Curate a layer JSON. Paths are relative to the target root. Use every blueprint construct the description needs. Leave a field empty only when the plan does not need it.

   Put new modules in `files` and `folders`, with their functions, vars, relations, and notes. Point at the existing entry point you will edit. Each import's `file` and `from` are project file paths, even when those files sit in different folders. `from` is the exporting file's path, never a symbol name, a package name, or a relative specifier. Start from the current blueprint steps if any: keep the useful ones, reword, merge, or drop the rest, and add missing ones. Omit `steps` to keep the current steps unchanged.

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

5. Save the proposed blueprint. This always writes the folder `blueprints/<subject>-<num>/` in the target, with the blueprint in `<subject>-<num>.blueprint.json` and the session color in `<subject>-<num>-wrapper.json`. The layer JSON has no color; the session color comes from `--session`. Do not pass `--write`.

```bash
npx inbase propose-blueprint --session <color> --description "<description>"
```

Pass the curated layer JSON on stdin, or pass a `layer.json` path. The number is the next free one for that subject. The blueprint is also saved on the session and shown on the map. Pass `--dont-write-to-file` only when the map should update and the blueprint folder should not be written.

6. Tell the user that the blueprint has been proposed and is now visible on the map. Name the blueprint file from `VISUAL_CODER_BLUEPRINT_FILE` (its folder also holds the wrapper from `VISUAL_CODER_BLUEPRINT_WRAPPER`). Briefly name the files, folders, functions, vars, relations, notes, pointers, deletions, and steps you proposed.

7. **Stop.** Do not start implementing. The user will invoke the session color (e.g., `/coral`) to start implementing the blueprint.
