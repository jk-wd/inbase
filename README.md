<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/inbase-logo-white.png" />
    <img src="docs/inbase-logo.png" alt="InBase — Dive into your codebase" width="520" />
  </picture>
</p>

A first-person 3D map of a JavaScript or TypeScript codebase. Files become blocks, folders become walkable areas, and imports become lines in the air.

<p align="center">
  <img src="docs/inbase-1.png" alt="First-person walk view of the codebase map" width="47%" />
  &nbsp;&nbsp;&nbsp;
  <img src="docs/inbase-2.png" alt="Map view with 3D overlay" width="47%" />
</p>

Install the package in a project, run `inbase init`, then `inbase run`. Cursor’s LLM then plans and patches through the visual map instead of editing files directly.

The npm package is `@jkwd/inbase` (npm blocks the unscoped name `inbase`). The command is still `inbase`.

## Use in a project

```bash
npm install -D @jkwd/inbase
npx inbase init
npx inbase run
```

Or install globally:

```bash
npm install -g @jkwd/inbase
inbase init
inbase run
```

Open the printed URL (http://localhost:5173 by default), click the scene, then walk with WASD.

`inbase run` maps the current directory. To map another folder:

```bash
inbase run --target /path/to/your/project
```

`inbase init` copies a Cursor skill into `.cursor/skills/inbase/` and gitignores `.inbase/`. Keep `inbase run` open, then ask Cursor to change source files — the LLM follows the visual plan and patch loop described below.

## LLM integration

<img src="docs/inbase-llm.png" alt="LLM working through a plan in the heads-up display overlay" align="left" width="280" hspace="16" />

Inbase does not call a model itself. The visual coding loop currently supports **Cursor**. The installed skill makes the agent work through the map: it reports a plan, waits on the **HUD** (heads-up display — the overlay panel on the 3D map), and publishes each step as a patch file. Those patch files are the source of truth and are applied on every step update.

When a chat starts, that overlay asks whether to set up a **blueprint**. **Create blueprint** lets you place files (`Space`) and folders (`B`), then **Send blueprint** — that layout is the source of truth for the chat. **Let LLM continue** skips the initial placement. You can still place files and islands on later steps; they are stored on that chat’s blueprint. When the session finishes, placement stops.

If several chats are open, only one session window is shown at a time. Switch with the tabs so the focused chat is the one whose blueprint you see and edit.

Turn on **Make LLM look where I look** if the agent should prefer the island you are standing on and the blocks you are facing. With **Step by step** on, click **Run step** to start a step, then **Accept proposal** when the patch is ready. With it off, the LLM implements the full plan; you can still walk Previous/Next over the diffs, then **Accept proposal**. Send an alternative instruction from the HUD to revise the remaining plan, or **Stop** to end the session.

The LLM never writes project files itself. It only publishes patch files. Those
stored patches are the source of truth and are applied on every step update.

<br clear="all" />

## Commands

| Command | What it does |
| --- | --- |
| `inbase init` | Install the Cursor skill in this repo |
| `inbase run` | Scan this repo and start the local map |
| `inbase run --port 5174` | Start on another port |

Session commands (`start-session`, `wait-for-blueprint`, `report-plan`, `wait-for-approval`, `propose-patch`) are used by the Cursor skill. You do not need to run them yourself.

## Editor support

The map runs in the browser. The LLM plan and patch loop currently works in **Cursor** only (`inbase init` installs a skill into `.cursor/skills/inbase/`).

## Language support

Source files (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`) become blocks with **functions**, **classes**, and **variables**, plus import edges from `import` and `require()`. Styles and docs (`.css`, `.scss`, `.html`, `.json`, `.md`) show up as blocks without symbols. Only relative specifiers (`./`, `../`) become edges — package names like `react` or `@angular/core` do not.

## How to read the map

- Each **file** is a block. Taller blocks have more lines of code.
- Small cubes on a block are **functions** (blue) and **variables** (tan).
- Each **folder** is a floor area with a center walkway.
- At the far end of an area, **bridges** lead into child folders. The folder name hangs above the bridge.
- Click a block to see **import relations**. Connected files stay lit and arcs draw to them.

## Develop Inbase itself

This repository is a workspace. The bundled demo target is `apps/example-target`.

```bash
npm install
npm run dev
```

That still maps `apps/example-target` by default. To map a different project without the CLI:

```bash
VISUAL_CODER_TARGET=/path/to/your/project npm run dev
```

To run the example React app itself:

```bash
npm run dev:target
```
