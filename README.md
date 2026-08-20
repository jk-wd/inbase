# Inbase

A first-person 3D map of a JavaScript or TypeScript codebase. Files become blocks, folders become walkable areas, and imports become lines in the air.

Install the package in a project, run `inbase init`, then `inbase run`. Cursor uses the installed skill so code changes go through the visual map.

## Use in a project

```bash
npm install -D inbase
npx inbase init
npx inbase run
```

Or install globally:

```bash
npm install -g inbase
inbase init
inbase run
```

Open the printed URL (http://localhost:5173 by default), click the scene, then walk with WASD.

`inbase run` maps the current directory. To map another folder:

```bash
inbase run --target /path/to/your/project
```

`inbase init` copies a Cursor skill into `.cursor/skills/inbase/` and gitignores `.inbase/`. After that, ask Cursor to change source files in this repo — it should follow the visual plan/patch workflow while `inbase run` is up.

## Commands

| Command | What it does |
| --- | --- |
| `inbase init` | Install the Cursor skill in this repo |
| `inbase run` | Scan this repo and start the local map |
| `inbase run --port 5174` | Start on another port |

Session commands (`start-session`, `wait-for-blueprint`, `report-plan`, `wait-for-approval`, `propose-patch`) are used by the Cursor skill. You do not need to run them yourself.

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
