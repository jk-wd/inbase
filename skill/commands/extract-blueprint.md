---
description: Extract a valuable Inbase blueprint from an existing folder
---

The user invoked `/extract-blueprint`. Do **not** attach an Inbase session. Do **not** run `read-blueprint`, `report-plan`, or `propose-patch`. Do **not** edit application source files. This writes a blueprint folder only.

Arguments:

$ARGUMENTS

Parse two paths: `[target folder] [output folder]`. Example: `apps/web blueprints/web`. The output folder gets `web.blueprint.json` and `web-wrapper.json` (named after the folder). A trailing `.json` on the output path is dropped. If either path is missing, ask for it and stop.

1. Reply in this chat first with one short sentence that you are extracting a blueprint from that folder to that output folder.

2. Scan the folder (does not write the blueprint yet):

```bash
npx inbase extract-blueprint "<folder>" "<output-folder>"
```

Read `VISUAL_CODER_EXTRACT_INVENTORY_START` / `END` and `VISUAL_CODER_EXTRACT_INSTRUCTION_START` / `END`. Follow that instruction.

3. **Loop the folders in the inventory.** Do not extract everything. For each architectural folder, open only the files that look important (entry points, public APIs, core domain). Skip generated files, lockfiles, tests unless they are the contract, snapshots, and trivial helpers. Use `role` in the inventory as a hint, not a rule.

4. Curate a **small** layer JSON. Paths are relative to the scanned folder. You may omit `id` / `name` / `folder` / `parent`; the CLI fills those in and creates parent folders for kept files.

Keep:
- The folder skeleton that defines the architecture
- The most important files, functions, classes, and vars
- Imports that show a real coupling between kept files
- Notes that a later LLM needs: why this file exists, the contract, invariants, "do not X"

Put classes in `functions`. Drop everything else. Prefer fewer, better items. Notes must add information; do not restate the name.

```json
{
  "files": [{ "path": "src/App.tsx" }],
  "folders": [{ "path": "src" }],
  "functions": [{ "name": "App", "file": "src/App.tsx" }],
  "variables": [{ "name": "theme", "file": "src/theme.ts" }],
  "imports": [{ "name": "theme", "from": "./theme", "file": "src/App.tsx" }],
  "notes": [
    { "file": "src/App.tsx", "kind": "file", "note": "Root UI. Mounts routes; do not add data fetching here." },
    { "file": "src/App.tsx", "kind": "function", "name": "App", "note": "Top-level layout shell." }
  ],
  "pointers": []
}
```

5. Write the curated layer (not the inventory) with `--write`. Pass JSON on stdin, or `--write layer.json`:

```bash
npx inbase extract-blueprint "<folder>" "<output-folder>" --write
```

6. Tell the user the blueprint file from `VISUAL_CODER_EXTRACT_SAVED` and briefly what you kept. Then **stop**.
