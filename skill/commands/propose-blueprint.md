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

This prints `VISUAL_CODER_PROPOSE_BLUEPRINT` with the description and an instruction block. Follow that instruction.

4. Read the codebase if needed. Look at the target folder structure to understand what already exists. Use the description to decide:
   - What files should be created or modified
   - What folders should exist
   - What functions, classes, and variables should be added
   - What imports should exist between files
   - What notes should be attached to explain the architecture

   Curate a **small** layer JSON. Paths are relative to the target root.

   Keep:
   - The folder skeleton that defines the architecture
   - Entry points, public APIs, core domain modules
   - Exported functions and classes that are the real API
   - Important constants, shared state, and config vars
   - Imports that show real coupling between files
   - Notes that say why a file or symbol exists, the contract, or a non-obvious invariant

   Drop:
   - Generated files, lockfiles, dist/build/coverage, snapshots, editor/tooling noise
   - Tests unless they are the contract for this area
   - Trivial re-export barrels unless they ARE the public API
   - Every helper, getter, loop var, and one-off local
   - Notes that only restate the file or symbol name
   - Pointers unless something is a landmark the next chat must keep in view

   Prefer fewer, better items. Notes must add information.

   ```json
   {
     "files": [{ "path": "src/App.tsx" }],
     "folders": [{ "path": "src" }],
     "addedFunctions": [{ "name": "App", "file": "src/App.tsx" }],
     "addedVariables": [{ "name": "theme", "file": "src/theme.ts" }],
     "addedImports": [{ "name": "theme", "from": "./theme", "file": "src/App.tsx" }],
     "notes": [
       { "file": "src/App.tsx", "kind": "file", "note": "Root UI. Mounts routes; do not add data fetching here." }
     ],
     "pointers": []
   }
   ```

5. Write the proposed blueprint:

```bash
npx inbase propose-blueprint --session <color> --description "<description>" --write
```

Pass the curated layer JSON on stdin. This saves the blueprint to the session, making it visible on the map.

6. Tell the user that the blueprint has been proposed and is now visible on the map. Briefly name the files, folders, and symbols you proposed.

7. **Stop.** Do not start implementing. The user will invoke the session color (e.g., `/coral`) to start implementing the blueprint.
