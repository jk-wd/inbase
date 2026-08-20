# Visual Coder

A first-person 3D map of a codebase. Files become blocks, folders become walkable areas, and imports become lines in the air.

This version maps **JavaScript and TypeScript** projects — React, Angular, Node, Vite, or plain `.js` / `.ts`. The bundled demo is a small React app; point the scanner at any other JS/TS repo to map that instead.

## Apps

- `apps/example-target` — small Vite + React app used as the default mapped codebase
- `apps/explorer` — Three.js first-person explorer that scans a target project and renders it

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173, click the scene, then walk with WASD.

To map a different JS/TS project:

```bash
VISUAL_CODER_TARGET=/path/to/your/project npm run dev
```

Relative paths resolve from the current working directory. The default is `apps/example-target`.

To run the example React app itself:

```bash
npm run dev:target
```

## Language support

Source files (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`) become blocks with **functions**, **classes**, and **variables**, plus import edges from `import` and `require()`. Styles and docs (`.css`, `.scss`, `.html`, `.json`, `.md`) show up as blocks without symbols. Only relative specifiers (`./`, `../`) become edges — package names like `react` or `@angular/core` do not.

## How to read the map

- Each **file** is a block. Taller blocks have more lines of code.
- Small cubes on a block are **functions** (blue) and **variables** (tan).
- Each **folder** is a floor area with a center walkway.
- At the far end of an area, **bridges** lead into child folders. The folder name hangs above the bridge.
- Click a block to see **import relations**. Connected files stay lit and arcs draw to them.
